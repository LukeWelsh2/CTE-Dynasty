// Pure season-rollover planning (no database access). rollover.ts applies the plan; previews and unit tests
// use it directly.
import type { LeagueSettings } from "@/lib/settings/schema";
import { experienceNextSeason, keeperContractYears, needsDesignation, nextSeasonCap, salaryAfterRaises } from "@/lib/keepers/logic";

export const PHASES = ["PRESEASON", "REGULAR", "PLAYOFFS", "OFFSEASON", "KEEPER"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_INFO: Record<Phase, { label: string; description: string }> = {
  PRESEASON: {
    label: "Preseason",
    description: "Before Week 1. Salary auction and rookie draft happen here; lineups don't score yet.",
  },
  REGULAR: {
    label: "Regular season",
    description: "Weekly matchups count toward the standings. Waivers run on schedule and the trade deadline applies.",
  },
  PLAYOFFS: {
    label: "Playoffs",
    description: "Bracket play. Rosters lock if the league locks rosters in the playoffs; trades follow the playoff trade rule.",
  },
  OFFSEASON: {
    label: "Offseason",
    description: "The season is over. Offseason trades and adds follow league rules. Roll over when you're ready to start the next league year.",
  },
  KEEPER: {
    label: "Keeper window",
    description: "Managers designate which expiring players to keep before the keeper deadline. Roll over after the deadline.",
  },
};

export function isPhase(v: string): v is Phase {
  return (PHASES as readonly string[]).includes(v);
}

/** Rollover is allowed from OFFSEASON / KEEPER; any other phase needs the commissioner's force flag. */
export function rolloverPhaseProblem(phase: string, force: boolean): string | null {
  if (phase === "OFFSEASON" || phase === "KEEPER") return null;
  if (force) return null;
  return `The league is in the ${PHASE_INFO[phase as Phase]?.label ?? phase} phase. Move it to Offseason or Keeper window first, or force the rollover.`;
}

export interface RolloverSpot {
  id: string;
  teamId: string;
  playerId: string;
  name: string;
  status: string;
  salary: number;
  contractYears: number;
  keeperCount: number;
  isRookieContract: boolean;
  isFranchiseTagged: boolean;
  yearsExp: number | null;
  rookieYear: number | null;
}

export interface RolloverDesignation {
  teamId: string;
  playerId: string;
  keeperSalary: number;
  contractYears: number;
  status: string;
}

export type SpotAction =
  | { kind: "KEEP"; spot: RolloverSpot; salary: number; contractYears: number; status: string; promoted: boolean }
  | { kind: "ROLL"; spot: RolloverSpot; salary: number; contractYears: number; status: string; promoted: boolean }
  | { kind: "RELEASE"; spot: RolloverSpot };

export interface TeamRolloverSummary {
  teamId: string;
  kept: number;
  released: number;
  rolled: number;
  promoted: number;
  payrollNext: number;
}

export interface RolloverPlan {
  fromSeason: number;
  toSeason: number;
  actions: SpotAction[];
  byTeam: Map<string, TeamRolloverSummary>;
}

/** Cap hit used for next season's payroll in the plan */
function hit(salary: number, status: string, s: LeagueSettings): number {
  if (status === "IR" && !s.roster.irCountsAgainstCap) return 0;
  if (status === "TAXI") return s.roster.taxiCountsAgainstCap ? salary : Math.round((salary * (s.roster.taxiCapPercent ?? 0)) / 100);
  return salary;
}

export function planRollover(input: { settings: LeagueSettings; fromSeason: number; spots: RolloverSpot[]; designations: RolloverDesignation[] }): RolloverPlan {
  const s = input.settings;
  const toSeason = input.fromSeason + 1;
  const desig = new Map(input.designations.filter((d) => d.status !== "RELEASED").map((d) => [d.playerId, d]));
  const actions: SpotAction[] = [];
  const byTeam = new Map<string, TeamRolloverSummary>();
  const sum = (teamId: string) => {
    if (!byTeam.has(teamId)) byTeam.set(teamId, { teamId, kept: 0, released: 0, rolled: 0, promoted: 0, payrollNext: 0 });
    return byTeam.get(teamId)!;
  };
  for (const sp of input.spots) {
    const t = sum(sp.teamId);
    const promoted = sp.status === "TAXI" && experienceNextSeason(sp, toSeason) > s.roster.taxiMaxYearsExp;
    const status = promoted ? "ACTIVE" : sp.status;
    if (needsDesignation(sp, s) && s.keepers.enabled) {
      const d = desig.get(sp.playerId);
      if (d && d.teamId === sp.teamId) {
        const years = d.contractYears > 0 ? d.contractYears : keeperContractYears(sp);
        actions.push({ kind: "KEEP", spot: sp, salary: d.keeperSalary, contractYears: years, status, promoted });
        t.kept++;
        if (promoted) t.promoted++;
        t.payrollNext += hit(d.keeperSalary, status, s);
      } else {
        actions.push({ kind: "RELEASE", spot: sp });
        t.released++;
      }
      continue;
    }
    if (needsDesignation(sp, s) && !s.keepers.enabled && s.contracts.enabled) {
      // keepers turned off: expiring contracts simply end
      actions.push({ kind: "RELEASE", spot: sp });
      t.released++;
      continue;
    }
    const salary = s.contracts.enabled ? salaryAfterRaises(sp.salary, 1, s, sp) : sp.salary;
    const years = s.contracts.enabled ? Math.max(1, sp.contractYears - 1) : sp.contractYears;
    actions.push({ kind: "ROLL", spot: sp, salary, contractYears: years, status, promoted });
    t.rolled++;
    if (promoted) t.promoted++;
    t.payrollNext += hit(salary, status, s);
  }
  return { fromSeason: input.fromSeason, toSeason, actions, byTeam };
}

/** FAB for the new season: the full budget plus (optionally) last season's unused balance. */
export function faabForNewSeason(balance: number, settings: Pick<LeagueSettings, "waivers">): { budget: number; carry: number; total: number } {
  const budget = settings.waivers.faabBudget;
  const carry = settings.waivers.faabRollover ? Math.max(0, balance) : 0;
  return { budget, carry, total: budget + carry };
}

export interface DeadCapEntry {
  teamId: string;
  season: number;
  amount: number;
}

/** Drop dead-money charges for seasons that have ended. */
export function pruneDeadCap(entries: DeadCapEntry[], newSeason: number): DeadCapEntry[] {
  return entries.filter((e) => e.season >= newSeason);
}

export function capAfterRollover(settings: Pick<LeagueSettings, "salaryCap">): number {
  return nextSeasonCap(settings);
}

/** Pick seasons every team should hold after the rollover: the new season's draft plus `futurePickYears` more. */
export function pickSeasonsAfterRollover(newSeason: number, settings: Pick<LeagueSettings, "trades">): number[] {
  const out: number[] = [];
  for (let y = 0; y <= settings.trades.futurePickYears; y++) out.push(newSeason + y);
  return out;
}

/**
 * Convert a wall-clock time in a time zone ("2027-02-10T20:00" in America/New_York) to a UTC Date.
 * Used for datetime-local inputs, which carry no zone.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0));
  // offset of the zone at that instant (iterate twice for DST edges)
  let guess = asUtc;
  for (let i = 0; i < 2; i++) guess = asUtc - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** zone time − UTC in ms at a given instant */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const zoned = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return zoned - Math.floor(at.getTime() / 1000) * 1000;
}

/** Inverse of zonedLocalToUtc: value for a datetime-local input in the league zone. */
export function utcToZonedLocal(d: Date | string | null | undefined, timeZone: string): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

/** Text the commissioner must type to confirm a rollover */
export function rolloverConfirmText(toSeason: number): string {
  return `ROLLOVER ${toSeason}`;
}
