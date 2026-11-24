// Pure rookie-pick projections: projected draft slot from standings, tier labels, rookie-scale salary.
import type { LeagueSettings } from "@/lib/settings/schema";
import { ordinal } from "@/lib/utils";

export interface StandingLite {
  teamId: string;
  rank: number;
  pointsFor: number;
}

/**
 * Projected rookie-draft order (team ids, pick 1 first) from current standings.
 * Reverse standings for REVERSE_STANDINGS / LOTTERY (pre-lottery); reverse points-for for the PF-based methods.
 */
export function projectedPickOrder(standings: StandingLite[], method: LeagueSettings["draft"]["rookie"]["orderMethod"]): string[] {
  const list = [...standings];
  if (method === "REVERSE_MAX_PF" || method === "REVERSE_POTENTIAL_POINTS") list.sort((a, b) => a.pointsFor - b.pointsFor || b.rank - a.rank);
  else list.sort((a, b) => b.rank - a.rank);
  return list.map((s) => s.teamId);
}

export function orderMethodLabel(method: LeagueSettings["draft"]["rookie"]["orderMethod"]): string {
  switch (method) {
    case "REVERSE_MAX_PF":
      return "reverse max points-for";
    case "REVERSE_POTENTIAL_POINTS":
      return "reverse potential points";
    case "LOTTERY":
      return "reverse standings (before the lottery)";
    default:
      return "reverse standings";
  }
}

/** "Early 1st" / "Mid 2nd" / "Late 1st" by pick position within a round */
export function pickTier(round: number, pickInRound: number | null, teamCount: number): string {
  if (!pickInRound) return `${ordinal(round)} round`;
  const third = pickInRound / Math.max(1, teamCount);
  const part = third <= 1 / 3 ? "Early" : third <= 2 / 3 ? "Mid" : "Late";
  return `${part} ${ordinal(round)}`;
}

/** Rookie-scale salary for a pick (null when the scale doesn't cover it) */
export function rookieScaleSalary(settings: LeagueSettings, round: number, pickInRound: number | null): number | null {
  if (!pickInRound) return null;
  const row = settings.contracts.rookieScale[String(round)];
  if (!row || !row.length) return settings.salaryCap.enabled ? settings.salaryCap.minSalary : null;
  return row[Math.min(row.length - 1, pickInRound - 1)] ?? null;
}
