// Roster rules: slot eligibility, roster limits, IR/taxi eligibility and salary-cap math.
import type { Player, RosterSpot } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings, RosterSlotDef } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { activeRosterLimit, capCheck, capLimit, capLimitLabel, capWarningNote, type PhaseOptions } from "@/lib/roster-rules";

export {
  activeRosterLimit,
  bindingCapRoom,
  capCheck,
  capEnforcement,
  capLimit,
  capLimitLabel,
  capWarningNote,
  deadlineInstant,
  deadlineLabel,
  deadMoneyCharges,
  isOffseasonPhase,
  isPreseasonPhase,
  type CapCheck,
  type CapEnforcement,
  type DeadMoneyCharge,
  type PhaseOptions,
} from "@/lib/roster-rules";

export type RosterEntry = RosterSpot & { player: Player };

export function playerFantasyPosition(p: Pick<Player, "position">): string {
  return normalizePosition(p.position);
}

export function slotAccepts(slot: Pick<RosterSlotDef, "eligible">, position: string): boolean {
  return slot.eligible.includes(normalizePosition(position));
}

export async function getTeamRoster(teamId: string): Promise<RosterEntry[]> {
  return db.rosterSpot.findMany({ where: { teamId }, include: { player: true }, orderBy: [{ salary: "desc" }] });
}

export function isIrEligible(p: Pick<Player, "injuryStatus" | "status">, settings: LeagueSettings): boolean {
  if (!settings.roster.irRequireInjuryStatus) return true;
  const statuses = settings.roster.irEligibleStatuses.map((s) => s.toLowerCase());
  const inj = (p.injuryStatus ?? "").toLowerCase();
  const st = (p.status ?? "").toLowerCase();
  if (inj && statuses.includes(inj)) return true;
  if (st.includes("injured reserve") && statuses.includes("ir")) return true;
  if (st.includes("physically unable") && statuses.includes("pup")) return true;
  if (st.includes("suspend") && statuses.includes("sus")) return true;
  return false;
}

export function isTaxiEligible(p: Pick<Player, "yearsExp">, settings: LeagueSettings): boolean {
  return (p.yearsExp ?? 99) <= settings.roster.taxiMaxYearsExp;
}

export interface CapSummary {
  cap: number;
  /** payroll ceiling cap checks use (capLimit: the cap, or cap + softCapMaxOverage for a soft cap; null = none) */
  limit: number | null;
  floor: number;
  committed: number; // salary counted against the cap
  deadMoney: number;
  space: number;
  totalSalary: number; // every rostered player incl. exempt IR/taxi
  bySeason: { season: number; committed: number }[]; // future commitments
}

/** Salary that counts against the cap for one roster spot */
export function capHit(spot: Pick<RosterSpot, "salary" | "status">, settings: LeagueSettings): number {
  if (spot.status === "IR" && !settings.roster.irCountsAgainstCap) return 0;
  if (spot.status === "TAXI") {
    if (settings.roster.taxiCountsAgainstCap) return spot.salary;
    return Math.round((spot.salary * (settings.roster.taxiCapPercent ?? 0)) / 100);
  }
  return spot.salary;
}

/** Salary for a contract in a future season given annual raise settings. yearOffset 0 = current season. */
/**
 * Does the annual contract raise apply to this contract? (settings.contracts.raiseAppliesTo)
 * ALL_EXCEPT_ROOKIE skips rookie-scale deals; VETERANS_ONLY also skips players who haven't played out a
 * standard rookie contract yet (fewer NFL seasons than contracts.rookieContractYears).
 */
export function raiseApplies(
  spot: { isRookieContract?: boolean | null; player?: { yearsExp?: number | null } | null; yearsExp?: number | null } | null | undefined,
  settings: Pick<LeagueSettings, "contracts">,
): boolean {
  const mode = settings.contracts.raiseAppliesTo ?? "ALL";
  if (!spot || mode === "ALL") return true;
  if (spot.isRookieContract) return false;
  if (mode === "VETERANS_ONLY") return (spot.yearsExp ?? spot.player?.yearsExp ?? 0) >= (settings.contracts.rookieContractYears ?? 3);
  return true;
}

/**
 * Salary `yearOffset` seasons into a contract after annual raises (settings.contracts.annualRaisePercent),
 * honoring raiseAppliesTo (pass the roster spot) and raiseRounding. Matches the season rollover exactly.
 */
export function salaryInYear(
  salary: number,
  yearOffset: number,
  settings: Pick<LeagueSettings, "contracts">,
  spot?: Parameters<typeof raiseApplies>[0],
): number {
  const raise = settings.contracts.annualRaisePercent ?? 0;
  if (!raise || yearOffset <= 0 || !raiseApplies(spot, settings)) return salary;
  // guard against float noise (e.g. 20 × 1.1 = 22.000000000000004)
  const v = Math.round(salary * Math.pow(1 + raise / 100, yearOffset) * 1e6) / 1e6;
  const mode = settings.contracts.raiseRounding ?? "NEAREST";
  return mode === "UP" ? Math.ceil(v) : mode === "DOWN" ? Math.floor(v) : Math.round(v);
}

export async function deadMoneyFor(leagueId: string, teamId: string, season: number): Promise<number> {
  const states = await db.leaguePlayerState.findMany({ where: { leagueId }, select: { deadCap: true } });
  let total = 0;
  for (const s of states) {
    for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) {
      if (d.teamId === teamId && d.season === season) total += d.amount;
    }
  }
  return total;
}

export async function capSummary(leagueId: string, teamId: string, season: number, settings: LeagueSettings, roster?: RosterEntry[]): Promise<CapSummary> {
  const spots = roster ?? (await getTeamRoster(teamId));
  const committed = spots.reduce((a, s) => a + capHit(s, settings), 0);
  const totalSalary = spots.reduce((a, s) => a + s.salary, 0);
  const deadMoney = await deadMoneyFor(leagueId, teamId, season);
  const cap = settings.salaryCap.cap;
  const bySeason: { season: number; committed: number }[] = [];
  for (let y = 0; y < settings.contracts.maxYears; y++) {
    const total = spots.filter((s) => s.contractYears > y).reduce((a, s) => a + salaryInYear(s.salary, y, settings, s), 0);
    bySeason.push({ season: season + y, committed: total });
  }
  return { cap, limit: capLimit(settings), floor: settings.salaryCap.floor, committed: committed + deadMoney, deadMoney, space: cap - committed - deadMoney, totalSalary, bySeason };
}

export interface RosterCounts {
  active: number;
  ir: number;
  taxi: number;
  byPosition: Record<string, number>;
}

export function rosterCounts(spots: { status: string; player: Pick<Player, "position"> }[]): RosterCounts {
  const byPosition: Record<string, number> = {};
  let active = 0, ir = 0, taxi = 0;
  for (const s of spots) {
    if (s.status === "IR") ir++;
    else if (s.status === "TAXI") taxi++;
    else active++;
    const pos = normalizePosition(s.player.position);
    byPosition[pos] = (byPosition[pos] ?? 0) + 1;
  }
  return { active, ir, taxi, byPosition };
}

export interface RosterCheckOptions extends PhaseOptions {
  /** check the salary cap (capCheck: the capLimit ceiling, enforced per capEnforcement for `phase`) */
  checkCap?: boolean;
  /** dead money on the books this season (added to the payroll) */
  deadMoney?: number;
  /** payroll (incl. dead money) before the move: a move that doesn't add salary is never over the cap */
  capBefore?: number;
}

/**
 * Roster-size and position-limit problems only (no eligibility or cap checks) — what roster.illegalRosterPolicy
 * treats as an illegal roster. The active limit is activeRosterLimit: pass `phase` (or the legacy `offseason` flag)
 * for roster.offseasonMaxActiveRoster until roster.rosterCutdownDate.
 */
export function rosterLimitProblems(spots: { status: string; player: Pick<Player, "position"> }[], settings: LeagueSettings, opts: PhaseOptions = {}): string[] {
  const errors: string[] = [];
  const counts = rosterCounts(spots);
  const maxActive = activeRosterLimit(settings, opts);
  if (counts.active > maxActive) errors.push(`Active roster would have ${counts.active} players (max ${maxActive}).`);
  if (counts.ir > settings.roster.irSlots) errors.push(`IR would have ${counts.ir} players (max ${settings.roster.irSlots}).`);
  if (counts.taxi > settings.roster.taxiSlots) errors.push(`Taxi squad would have ${counts.taxi} players (max ${settings.roster.taxiSlots}).`);
  for (const [pos, lim] of Object.entries(settings.roster.positionLimits)) {
    const n = counts.byPosition[pos] ?? 0;
    if (lim.max !== null && lim.max !== undefined && n > lim.max) errors.push(`Too many ${pos}s (${n}, max ${lim.max}).`);
  }
  return errors;
}

type CheckSpot = { status: string; salary: number; player: Pick<Player, "position" | "injuryStatus" | "status" | "yearsExp" | "fullName"> };

/**
 * Validate a hypothetical roster (after adds / drops / trades / status moves): `spots` is the full resulting roster.
 * `errors` block the move; `warnings` (the cap in WARN mode) never do. Roster limits use activeRosterLimit; the cap
 * check (opts.checkCap) uses capCheck — the capLimit ceiling, enforced per capEnforcement for opts.phase (no phase:
 * the in-season rules, or the offseason rules with the legacy opts.offseason flag).
 */
export function rosterCheck(spots: CheckSpot[], settings: LeagueSettings, opts: RosterCheckOptions = {}): { errors: string[]; warnings: string[] } {
  const errors: string[] = rosterLimitProblems(spots, settings, opts);
  const warnings: string[] = [];
  for (const s of spots) {
    if (s.status === "IR" && !isIrEligible(s.player, settings)) errors.push(`${s.player.fullName} is not IR-eligible.`);
    if (s.status === "TAXI" && !isTaxiEligible(s.player, settings)) errors.push(`${s.player.fullName} is not taxi-eligible.`);
  }
  if (opts.checkCap && settings.salaryCap.enabled) {
    const committed = spots.reduce((a, s) => a + capHit({ salary: s.salary, status: s.status }, settings), 0) + (opts.deadMoney ?? 0);
    const phase = opts.phase !== undefined && opts.phase !== null ? opts.phase : opts.offseason ? "OFFSEASON" : null;
    const chk = capCheck(committed, settings, { phase, now: opts.now, before: opts.capBefore });
    if (chk.over > 0 && chk.limit !== null) {
      const msg = `Salary would be $${committed}, over the $${chk.limit} ${capLimitLabel(settings)}.`;
      if (chk.blocked) errors.push(msg);
      else if (chk.warned) warnings.push(`${msg} ${capWarningNote(settings)}`);
    }
  }
  return { errors, warnings };
}

/**
 * Problems a roster change introduces — free-agent adds, claims at placement, IR / taxi moves. Problems the roster
 * already had are ignored (an illegal roster shouldn't freeze every move), and the cap only counts against a change
 * that adds salary. errors block the change; warnings (the cap in WARN mode) don't.
 */
export function rosterChangeProblems(
  before: CheckSpot[],
  after: CheckSpot[],
  settings: LeagueSettings,
  opts: PhaseOptions & { deadBefore?: number; deadAfter?: number } = {},
): { errors: string[]; warnings: string[] } {
  const { deadBefore = 0, deadAfter = deadBefore, ...phase } = opts;
  const capBefore = before.reduce((a, s) => a + capHit(s, settings), 0) + deadBefore;
  const pre = new Set(rosterCheck(before, settings, { ...phase, checkCap: true, deadMoney: deadBefore }).errors);
  const res = rosterCheck(after, settings, { ...phase, checkCap: true, deadMoney: deadAfter, capBefore });
  return { errors: res.errors.filter((e) => !pre.has(e)), warnings: res.warnings };
}

/** Blocking problems of a hypothetical roster (rosterCheck errors). */
export function validateRoster(spots: CheckSpot[], settings: LeagueSettings, opts: RosterCheckOptions = {}): string[] {
  return rosterCheck(spots, settings, opts).errors;
}

/** Contract display e.g. "$24 · 3 yrs (thru 2028)" */
export function contractLabel(salary: number, years: number, season: number) {
  return `$${salary} · ${years} yr${years === 1 ? "" : "s"} (thru ${season + years - 1})`;
}
