// "Why is A above B?" — plain-language tiebreaker notes for teams with the same win percentage (pure).
import type { StandingRow } from "@/lib/standings";
import { fmtPts, record } from "@/lib/utils";

type H2H = Record<string, { w: number; l: number }>;

/**
 * For each team that shares its win percentage with the team ranked right below it, the first tiebreaker in
 * `chain` that separates them. Mirrors the comparator in standingsFromMatchups (pairwise); when a multi-team
 * tie was settled through other teams, says so.
 */
export function tiebreakNotes(standings: StandingRow[], h2h: H2H, chain: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i + 1 < standings.length; i++) {
    const a = standings[i]!;
    const b = standings[i + 1]!;
    if (a.pct !== b.pct) continue;
    const why = explain(a, b, h2h, chain);
    const name = b.team.name;
    out.set(a.team.id, why ? (why.favorsA ? `Ahead of ${name}: ${why.text}` : `Ahead of ${name} through the other tied teams (${name} ${why.textForB})`) : `Tied with ${name}; standings order kept`);
  }
  return out;
}

function explain(a: StandingRow, b: StandingRow, h2h: H2H, chain: readonly string[]): { favorsA: boolean; text: string; textForB: string } | null {
  for (const tb of chain) {
    if (tb === "H2H") {
      const e = h2h[`${a.team.id}|${b.team.id}`];
      if (e && e.w !== e.l) {
        const favorsA = e.w > e.l;
        return { favorsA, text: `won the head-to-head (${e.w}-${e.l})`, textForB: `won the head-to-head ${e.l}-${e.w}` };
      }
    } else if (tb === "POINTS_FOR") {
      if (a.pointsFor !== b.pointsFor)
        return { favorsA: a.pointsFor > b.pointsFor, text: `more points for (${fmtPts(a.pointsFor)} to ${fmtPts(b.pointsFor)})`, textForB: `has more points for` };
    } else if (tb === "DIVISION_RECORD") {
      const ap = a.divWins + a.divLosses ? a.divWins / (a.divWins + a.divLosses) : 0;
      const bp = b.divWins + b.divLosses ? b.divWins / (b.divWins + b.divLosses) : 0;
      if (ap !== bp)
        return {
          favorsA: ap > bp,
          text: `better division record (${record(a.divWins, a.divLosses, a.divTies)} to ${record(b.divWins, b.divLosses, b.divTies)})`,
          textForB: `has the better division record`,
        };
    } else if (tb === "POINTS_AGAINST") {
      if (a.pointsAgainst !== b.pointsAgainst)
        return { favorsA: a.pointsAgainst > b.pointsAgainst, text: `more points against (${fmtPts(a.pointsAgainst)} to ${fmtPts(b.pointsAgainst)})`, textForB: `has more points against` };
    } else if (tb === "ALL_PLAY") {
      if (a.allPlayWins !== b.allPlayWins) return { favorsA: a.allPlayWins > b.allPlayWins, text: `more all-play wins (${a.allPlayWins} to ${b.allPlayWins})`, textForB: `has more all-play wins` };
    } else if (tb === "COIN_FLIP") {
      return { favorsA: a.team.id < b.team.id, text: "won the coin flip", textForB: "won the coin flip" };
    }
  }
  return null;
}
