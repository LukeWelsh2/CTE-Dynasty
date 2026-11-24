// Pure helpers for commissioner roster tools. Client-safe.
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
): DeadMoneyPreview {
  const s = settings.salaryCap;
  if (!s.enabled) return { total: 0, bySeason: [], reason: "Salary cap is off" };
  if (!s.deadMoney.enabled) return { total: 0, bySeason: [], reason: "Dead money is off" };
  if (spot.isRookieContract && s.deadMoney.rookieContractsExempt) return { total: 0, bySeason: [], reason: "Rookie contracts are exempt" };
  if (s.deadMoney.waivedInSeasonBeforeWeek && week < s.deadMoney.waivedInSeasonBeforeWeek) return { total: 0, bySeason: [], reason: `Cuts before Week ${s.deadMoney.waivedInSeasonBeforeWeek} are free` };
  if (spot.salary <= s.minSalary) return { total: 0, bySeason: [], reason: "Minimum-salary cuts are free" };
  const bySeason: { season: number; amount: number }[] = [];
  const cur = Math.round((spot.salary * s.deadMoney.currentSeasonPercent) / 100);
  if (cur > 0) bySeason.push({ season, amount: cur });
  for (let y = 1; y < spot.contractYears; y++) {
    const fut = Math.round((spot.salary * s.deadMoney.futureSeasonPercent) / 100);
    if (fut > 0) bySeason.push({ season: season + y, amount: fut });
  }
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
