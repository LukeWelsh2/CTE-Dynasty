// Pure helpers for commissioner roster tools. Client-safe.
import { deadMoneyCharges, isPreseasonPhase } from "@/lib/roster-rules";
import type { LeagueSettings } from "@/lib/settings/schema";

export interface DeadMoneyPreview {
  total: number;
  bySeason: { season: number; amount: number }[];
  reason: string | null;
}

/** Dead money a cut would create (mirrors dropPlayerFromTeam in roster-ops). */
export function deadMoneyPreview(
  spot: { salary: number; contractYears: number; isRookieContract: boolean },
  settings: LeagueSettings,
  season: number,
  week: number,
  phase?: string | null,
): DeadMoneyPreview {
  const s = settings.salaryCap;
  if (!s.enabled) return { total: 0, bySeason: [], reason: "Salary cap is off" };
  if (!s.deadMoney.enabled) return { total: 0, bySeason: [], reason: "Dead money is off" };
  if (spot.isRookieContract && s.deadMoney.rookieContractsExempt) return { total: 0, bySeason: [], reason: "Rookie contracts are exempt" };
  if (s.deadMoney.waivedInSeasonBeforeWeek && week < s.deadMoney.waivedInSeasonBeforeWeek) return { total: 0, bySeason: [], reason: `Cuts before Week ${s.deadMoney.waivedInSeasonBeforeWeek} are free` };
  if (spot.salary <= s.minSalary) return { total: 0, bySeason: [], reason: "Minimum-salary cuts are free" };
  const bySeason = deadMoneyCharges(spot, settings, season, week, { preseason: isPreseasonPhase(phase) });
  return { total: bySeason.reduce((a, d) => a + d.amount, 0), bySeason, reason: null };
}

/** Contract sanity checks for commissioner edits (warnings: the commissioner may override league limits). */
export function contractWarnings(c: { salary: number; contractYears: number }, settings: LeagueSettings): string[] {
  const w: string[] = [];
  const cap = settings.salaryCap;
  if (cap.enabled && c.salary < cap.minSalary) w.push(`Salary is below the $${cap.minSalary} league minimum.`);
  if (cap.enabled && cap.maxSalary !== null && c.salary > cap.maxSalary) w.push(`Salary is above the $${cap.maxSalary} league maximum.`);
  if (settings.contracts.enabled && c.contractYears > settings.contracts.maxYears) w.push(`Contract is longer than the ${settings.contracts.maxYears}-year maximum.`);
  if (settings.contracts.enabled && c.contractYears < settings.contracts.minYears) w.push(`Contract is shorter than the ${settings.contracts.minYears}-year minimum.`);
  return w;
}

/** Remove dead money entries for one team + season from a LeaguePlayerState.deadCap list */
export function forgiveEntries(deadCap: { teamId: string; season: number; amount: number }[], teamId: string, season: number | null) {
  const kept = deadCap.filter((d) => !(d.teamId === teamId && (season === null || d.season === season)));
  const removed = deadCap.filter((d) => d.teamId === teamId && (season === null || d.season === season));
  return { kept, removed, amount: removed.reduce((a, d) => a + d.amount, 0) };
}

/**
 * Roster settings in force right now: in the offseason (before the cutdown date) the active roster may
 * grow to settings.roster.offseasonMaxActiveRoster. Use for roster validation in commissioner views.
 */
export function effectiveRosterSettings(settings: LeagueSettings, phase: string, now: Date = new Date()): LeagueSettings {
  const r = settings.roster;
  if (r.offseasonMaxActiveRoster === null || r.offseasonMaxActiveRoster <= r.maxActiveRoster) return settings;
  const offseason = phase === "OFFSEASON" || phase === "KEEPER" || phase === "PRESEASON";
  const cutdown = r.rosterCutdownDate ? new Date(r.rosterCutdownDate) : null;
  const beforeCutdown = !cutdown || Number.isNaN(cutdown.getTime()) || now < cutdown;
  if (!offseason || !beforeCutdown) return settings;
  return { ...settings, roster: { ...r, maxActiveRoster: r.offseasonMaxActiveRoster } };
}

export interface AmnestyStatus {
  allowed: number;
  used: number;
  remaining: number;
}

/** Amnesty cuts (settings.salaryCap.deadMoney.amnestyCutsPerTeam) are counted over the life of the league. */
export function amnestyStatus(settings: LeagueSettings, used: number): AmnestyStatus {
  const allowed = settings.salaryCap.enabled && settings.salaryCap.deadMoney.enabled ? settings.salaryCap.deadMoney.amnestyCutsPerTeam : 0;
  return { allowed, used, remaining: Math.max(0, allowed - used) };
}

/**
 * Luxury tax owed on a soft-cap overage: settings.salaryCap.luxuryTaxRate × dollars over the cap, rounded
 * up to whole dollars. Zero for hard caps and for payrolls at or under the cap.
 */
export function luxuryTaxFor(committed: number, settings: LeagueSettings): number {
  const c = settings.salaryCap;
  if (!c.enabled || c.capType !== "SOFT" || committed <= c.cap || !(c.luxuryTaxRate > 0)) return 0;
  return Math.ceil((committed - c.cap) * c.luxuryTaxRate - 1e-9);
}

/**
 * Cap problem for a payroll (incl. dead money), or null. Hard cap: over the cap. Soft cap: over the cap plus
 * salaryCap.softCapMaxOverage (no limit when that is null; overages then only owe luxury tax).
 */
export function capProblem(committed: number, settings: LeagueSettings): string | null {
  const c = settings.salaryCap;
  if (!c.enabled) return null;
  if (c.capType === "SOFT") {
    if (c.softCapMaxOverage === null || c.softCapMaxOverage === undefined) return null;
    const ceiling = c.cap + c.softCapMaxOverage;
    return committed > ceiling ? `Salary is $${committed}, over the $${ceiling} soft-cap limit by $${committed - ceiling}.` : null;
  }
  return committed > c.cap ? `Salary is $${committed}, over the $${c.cap} cap by $${committed - c.cap}.` : null;
}

export const LUXURY_TAX_PAID_AS: Record<LeagueSettings["salaryCap"]["luxuryTaxPaidAs"], string> = {
  NEXT_YEAR_CAP: "taken off next season's cap",
  FAAB: "paid in FAB",
  DUES: "added to league dues",
};
