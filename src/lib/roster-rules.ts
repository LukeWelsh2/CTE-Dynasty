// Pure roster / contract rules shared by server code and client components (no DB access).
// Re-exported from @/lib/roster; import from here in modules that client components also load.
import type { LeagueSettings } from "@/lib/settings/schema";

export interface DeadMoneyCharge {
  season: number;
  amount: number;
}

/**
 * Dead money a release creates (settings.salaryCap.deadMoney): currentSeasonPercent of the salary this season
 * (preseasonCutPercent instead for cuts before Week 1, when set) plus futureSeasonPercent for each later contract
 * year. Exempt: rookie deals (rookieContractsExempt), in-season cuts before waivedInSeasonBeforeWeek and
 * minimum-salary players. The single formula every drop preview and dropPlayerFromTeam use.
 */
export function deadMoneyCharges(
  spot: { salary: number; contractYears: number; isRookieContract?: boolean | null },
  settings: Pick<LeagueSettings, "salaryCap">,
  season: number,
  week: number,
  opts: { preseason?: boolean } = {},
): DeadMoneyCharge[] {
  const s = settings.salaryCap;
  const dm = s.deadMoney;
  if (!s.enabled || !dm.enabled) return [];
  if (spot.isRookieContract && dm.rookieContractsExempt) return [];
  if (!opts.preseason && dm.waivedInSeasonBeforeWeek && week < dm.waivedInSeasonBeforeWeek) return [];
  if (spot.salary <= s.minSalary) return [];
  const out: DeadMoneyCharge[] = [];
  const curPct = opts.preseason && dm.preseasonCutPercent !== null && dm.preseasonCutPercent !== undefined ? dm.preseasonCutPercent : dm.currentSeasonPercent;
  const cur = Math.round((spot.salary * curPct) / 100);
  if (cur > 0) out.push({ season, amount: cur });
  for (let y = 1; y < spot.contractYears; y++) {
    const fut = Math.round((spot.salary * dm.futureSeasonPercent) / 100);
    if (fut > 0) out.push({ season: season + y, amount: fut });
  }
  return out;
}

/** Cuts made in this league phase count as "before Week 1" for deadMoney.preseasonCutPercent. */
export function isPreseasonPhase(phase: string | null | undefined): boolean {
  return phase === "PRESEASON";
}

/** Cap ceiling used for legality checks: the hard cap, or cap + softCapMaxOverage for soft caps (null = no ceiling). */
export function capLimit(settings: Pick<LeagueSettings, "salaryCap">): number | null {
  const c = settings.salaryCap;
  if (c.capType === "SOFT") return c.softCapMaxOverage === null || c.softCapMaxOverage === undefined ? null : c.cap + c.softCapMaxOverage;
  return c.cap;
}
