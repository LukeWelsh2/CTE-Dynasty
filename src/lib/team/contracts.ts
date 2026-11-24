// Pure contract & cap math for the My Team module: dead-money previews, extensions, franchise tags,
// rookie options and roster-window rules. No database access (unit-tested in tests/team.test.ts).
import type { LeagueSettings } from "@/lib/settings/schema";

export interface ContractSpot {
  salary: number;
  contractYears: number;
  isRookieContract: boolean;
  isFranchiseTagged: boolean;
  status?: string;
}

export interface DeadMoneyEntry {
  season: number;
  amount: number;
}

/** Dead money a drop would create (mirrors dropPlayerFromTeam in @/lib/roster-ops). */
export function deadMoneyPreview(spot: Pick<ContractSpot, "salary" | "contractYears" | "isRookieContract">, settings: LeagueSettings, season: number, week: number): DeadMoneyEntry[] {
  const s = settings.salaryCap;
  const out: DeadMoneyEntry[] = [];
  if (!s.enabled || !s.deadMoney.enabled) return out;
  if (spot.isRookieContract && s.deadMoney.rookieContractsExempt) return out;
  if (s.deadMoney.waivedInSeasonBeforeWeek && week < s.deadMoney.waivedInSeasonBeforeWeek) return out;
  if (spot.salary <= s.minSalary) return out;
  const cur = Math.round((spot.salary * s.deadMoney.currentSeasonPercent) / 100);
  if (cur > 0) out.push({ season, amount: cur });
  for (let y = 1; y < spot.contractYears; y++) {
    const fut = Math.round((spot.salary * s.deadMoney.futureSeasonPercent) / 100);
    if (fut > 0) out.push({ season: season + y, amount: fut });
  }
  return out;
}

/** League cap for a season `yearOffset` seasons from now (annualCapIncrease is a flat $ amount per season). */
export function capForSeason(settings: LeagueSettings, yearOffset: number): number {
  return settings.salaryCap.cap + Math.max(0, yearOffset) * (settings.salaryCap.annualCapIncrease ?? 0);
}

/** Should moves that add salary be blocked when they'd put a team over the cap? */
export function capEnforced(settings: LeagueSettings): boolean {
  return settings.salaryCap.enabled && settings.salaryCap.enforceInSeason;
}

export function contractEndSeason(season: number, years: number): number {
  return season + Math.max(1, years) - 1;
}

function clampSalary(n: number, settings: LeagueSettings): number {
  let v = Math.max(settings.salaryCap.minSalary, Math.round(n));
  if (settings.salaryCap.maxSalary !== null && settings.salaryCap.maxSalary !== undefined) v = Math.min(v, settings.salaryCap.maxSalary);
  return v;
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

// ───────── Extensions ─────────

export function maxExtensionYears(spot: Pick<ContractSpot, "contractYears">, settings: LeagueSettings): number {
  return Math.max(0, settings.contracts.maxYears - spot.contractYears);
}

export function extensionEligibility(spot: ContractSpot, settings: LeagueSettings, opts: { extendedThisSeason: boolean }): Eligibility {
  if (!settings.contracts.enabled) return { ok: false, reason: "Contracts are disabled in this league." };
  if (!settings.contracts.extensionsAllowed) return { ok: false, reason: "Extensions are not allowed in this league." };
  if (spot.isFranchiseTagged) return { ok: false, reason: "Franchise-tagged players can't be extended." };
  if (opts.extendedThisSeason) return { ok: false, reason: "Already extended this season." };
  if (maxExtensionYears(spot, settings) < 1) return { ok: false, reason: `Contract is already at the ${settings.contracts.maxYears}-year maximum.` };
  return { ok: true };
}

/** New salary after adding `years` (compounding extensionRaisePercent per year added). */
export function extensionSalary(salary: number, years: number, settings: LeagueSettings): number {
  const pct = settings.contracts.extensionRaisePercent ?? 0;
  const raised = salary * Math.pow(1 + pct / 100, Math.max(0, years));
  return clampSalary(pct > 0 ? Math.max(raised, salary + 1) : raised, settings);
}

// ───────── Franchise tag ─────────

export function franchiseTagEligibility(spot: ContractSpot, settings: LeagueSettings, opts: { tagsUsedThisSeason: number }): Eligibility {
  const ft = settings.contracts.franchiseTag;
  if (!settings.contracts.enabled) return { ok: false, reason: "Contracts are disabled in this league." };
  if (!ft.enabled) return { ok: false, reason: "Franchise tags are disabled." };
  if (spot.isFranchiseTagged) return { ok: false, reason: "Already franchise-tagged." };
  if (spot.contractYears !== 1) return { ok: false, reason: "Only players in the final year of their contract can be tagged." };
  if (opts.tagsUsedThisSeason >= ft.perTeam) return { ok: false, reason: `You've used all ${ft.perTeam} franchise tag${ft.perTeam === 1 ? "" : "s"} this season.` };
  return { ok: true };
}

/** Franchise tag salary. `positionSalaries` = every rostered salary at the player's position in the league. */
export function franchiseTagSalary(salary: number, positionSalaries: number[], settings: LeagueSettings): number {
  const ft = settings.contracts.franchiseTag;
  if (ft.costMethod === "TOP5_AVG_AT_POSITION") {
    const top = [...positionSalaries].sort((a, b) => b - a).slice(0, 5);
    const avg = top.length ? top.reduce((a, b) => a + b, 0) / top.length : salary;
    return clampSalary(Math.max(salary, Math.ceil(avg)), settings);
  }
  return clampSalary(Math.max(salary, salary * (1 + (ft.raisePercent ?? 0) / 100)), settings);
}

// ───────── Rookie 4th-year option ─────────

export function rookieOptionEligibility(spot: ContractSpot, settings: LeagueSettings, opts: { optionUsed: boolean }): Eligibility {
  if (!settings.contracts.enabled) return { ok: false, reason: "Contracts are disabled in this league." };
  if (!settings.contracts.rookieFourthYearOption) return { ok: false, reason: "Rookie options are disabled." };
  if (!spot.isRookieContract) return { ok: false, reason: "Only rookie contracts have an option year." };
  if (opts.optionUsed) return { ok: false, reason: "Option already exercised." };
  if (spot.contractYears !== 1) return { ok: false, reason: "The option can be exercised in the final year of the rookie deal." };
  return { ok: true };
}

export function rookieOptionSalary(salary: number, settings: LeagueSettings): number {
  const pct = settings.contracts.rookieOptionRaisePercent ?? 0;
  return clampSalary(Math.max(salary, salary * (1 + pct / 100)), settings);
}

// ───────── Roster windows ─────────

const OFF_PHASES = new Set(["PRESEASON", "OFFSEASON", "KEEPER"]);

export function isInSeasonPhase(phase: string): boolean {
  return !OFF_PHASES.has(phase);
}

/**
 * Taxi squad stashing is open before `taxiDeadlineWeek` (always open in the offseason; on the deadline week
 * itself until that week's first kickoff).
 */
export function taxiWindowOpen(settings: LeagueSettings, phase: string, week: number, deadlineWeekKickedOff: boolean): boolean {
  const dl = settings.roster.taxiDeadlineWeek;
  if (dl === null || dl === undefined || dl <= 0) return true;
  if (!isInSeasonPhase(phase)) return true;
  if (week < dl) return true;
  if (week === dl) return !deadlineWeekKickedOff;
  return false;
}

export function taxiPromotionOpen(settings: LeagueSettings, phase: string): boolean {
  return settings.roster.taxiPromotionAllowedInSeason || !isInSeasonPhase(phase);
}

export type ContractTag = "ROOKIE" | "TAG" | "EXPIRING";

export function contractTags(spot: Pick<ContractSpot, "contractYears" | "isRookieContract" | "isFranchiseTagged">): ContractTag[] {
  const out: ContractTag[] = [];
  if (spot.isRookieContract) out.push("ROOKIE");
  if (spot.isFranchiseTagged) out.push("TAG");
  if (spot.contractYears <= 1) out.push("EXPIRING");
  return out;
}
