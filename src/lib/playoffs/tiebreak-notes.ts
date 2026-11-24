// "Why is A above B?" — plain-language tiebreaker notes for teams with the same win percentage (pure).
import type { H2HRecord, StandingRow, TieSplit } from "@/lib/standings";
import { fmtPts, record } from "@/lib/utils";

type H2H = Record<string, H2HRecord>;

/**
 * For each team that shares its win percentage with the team ranked right below it, the step that separated them.
 *
 * Built from the ranking's own trace (StandingRow.tiebreak, or StandingRow.divisionTiebreak with `opts.division`),
 * so multi-team ties read the way they were decided: head-to-head among the whole tied group, restarts for the
 * teams still tied after a step, and the points-for / coin-flip tail. `standings` must be in rank order (for
 * division notes: one division's rows in division-rank order). Rows without a trace (built by hand) fall back to a
 * pairwise explanation from `chain`.
 */
export function tiebreakNotes(standings: StandingRow[], h2h: H2H, chain: readonly string[], opts: { division?: boolean } = {}): Map<string, string> {
  const out = new Map<string, string>();
  const names = new Map(standings.map((r) => [r.team.id, r.team.name]));
  for (let i = 0; i + 1 < standings.length; i++) {
    const a = standings[i]!;
    const b = standings[i + 1]!;
    if (a.pct !== b.pct) continue;
    const name = b.team.name;
    const split = opts.division ? a.divisionTiebreak : a.tiebreak;
    if (split) {
      const tied = standings.filter((r) => r.pct === a.pct).length;
      out.set(a.team.id, `Ahead of ${name}: ${splitText(split, a, b, tied, names)}`);
      continue;
    }
    const why = explain(a, b, h2h, chain);
    out.set(a.team.id, why ? (why.favorsA ? `Ahead of ${name}: ${why.text}` : `Ahead of ${name} through the other tied teams (${name} ${why.textForB})`) : `Tied with ${name}; standings order kept`);
  }
  return out;
}

const rec = (r: readonly [number, number, number]) => record(r[0], r[1], r[2]);

function listNames(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  const n = ids.map((id) => names.get(id) ?? "another team");
  return n.length <= 2 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/**
 * "the 7 tied teams" when the step was applied to everyone with this record; "the 3 teams still tied (X, Y and Z)"
 * when it was applied to a subgroup left tied by an earlier step.
 */
function groupPhrase(s: TieSplit, tied: number, names: ReadonlyMap<string, string>): string {
  const k = s.group.length;
  if (k >= tied) return `the ${k} tied teams`;
  return k <= 4 ? `the ${k} teams still tied (${listNames(s.group, names)})` : `the ${k} teams still tied`;
}

function splitText(s: TieSplit, a: StandingRow, b: StandingRow, tied: number, names: ReadonlyMap<string, string>): string {
  const k = s.group.length;
  const g = groupPhrase(s, tied, names);
  // where a step that doesn't depend on the group was applied (head-to-head names its group itself)
  const among = k > 2 ? ` among ${g}` : "";
  let reason: string;
  switch (s.by) {
    case "H2H": {
      const h = s.h2h;
      if (h?.mode === "SWEEP")
        return s.value > 0 ? `swept the head-to-head games among ${g}` : `${b.team.name} lost every head-to-head game among ${g}`;
      if (k === 2) return `won the head-to-head${h ? ` (${rec(h.record)})` : ""}`;
      return `better head-to-head record${h ? ` (${rec(h.record)} vs ${rec(h.nextRecord)})` : ""} among ${g}`;
    }
    case "POINTS_FOR":
      reason = `more points for (${fmtPts(a.pointsFor)} to ${fmtPts(b.pointsFor)})${among}`;
      break;
    case "POINTS_AGAINST":
      reason = `more points against (${fmtPts(a.pointsAgainst)} to ${fmtPts(b.pointsAgainst)})${among}`;
      break;
    case "DIVISION_RECORD":
      reason = `better division record (${record(a.divWins, a.divLosses, a.divTies)} to ${record(b.divWins, b.divLosses, b.divTies)})${among}`;
      break;
    case "ALL_PLAY":
      reason = `more all-play wins (${a.allPlayWins} to ${b.allPlayWins})${among}`;
      break;
    case "COIN_FLIP":
      reason = `won this season's coin flip${among}`;
      break;
    case "OVERALL_RANK":
      reason = `every division tiebreaker was even${among}, so the overall standings decide (#${a.rank} vs #${b.rank})`;
      break;
    default:
      reason = `every tiebreaker was even${among}; listed first`;
  }
  switch (s.h2hSkipped?.reason) {
    case "EVEN":
      return k === 2 ? `${reason}; they split their head-to-head games (${rec(s.h2hSkipped.record)})` : `${reason}; head-to-head among them was even`;
    case "NONE":
      return k === 2 ? `${reason}; they haven't played each other` : `${reason}; none of them have played each other`;
    case "UNEVEN":
      return `${reason}; head-to-head didn't count: not every pair of them has met equally often, and none beat (or lost to) all the others`;
    default:
      return reason;
  }
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
      const ap = a.divWins + a.divLosses + a.divTies ? (a.divWins + a.divTies * 0.5) / (a.divWins + a.divLosses + a.divTies) : 0;
      const bp = b.divWins + b.divLosses + b.divTies ? (b.divWins + b.divTies * 0.5) / (b.divWins + b.divLosses + b.divTies) : 0;
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
      if (a.coinFlip !== undefined && b.coinFlip !== undefined && a.coinFlip !== b.coinFlip)
        return { favorsA: a.coinFlip > b.coinFlip, text: "won the coin flip", textForB: "won the coin flip" };
    }
  }
  return null;
}
