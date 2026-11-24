// League history & records — pure helpers on top of ./manager-stats.ts (all-time standings, trophy case,
// season summaries). Unit-tested in tests/manager-stats.test.ts.
import { weekRows, winPct, type GameRow, type SeasonTotal } from "@/lib/stats/manager-stats";

/** One team-season for an owner (archived TeamSeason row or the live current season). */
export interface FinishLike {
  season: number;
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  regularSeasonRank: number | null;
  finalRank: number | null;
  madePlayoffs: boolean;
  champion: boolean;
  runnerUp: boolean;
  inProgress: boolean;
}

export interface AllTimeRow {
  key: string;
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  pf: number;
  pa: number;
  games: number;
  avgPf: number;
  playoffApps: number;
  playoffWins: number;
  playoffLosses: number;
  titles: number;
  runnerUps: number;
  /** finished first in the regular season (completed seasons only) */
  regularSeasonTitles: number;
  bestFinish: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Regular-season record from season finishes, playoff record from championship-bracket games (a multi-week game counts once). */
export function allTimeStandings(finishes: Map<string, FinishLike[]>, games: GameRow[]): AllTimeRow[] {
  const playoff = new Map<string, { w: number; l: number }>();
  for (const g of games) {
    if (!g.isPlayoff || g.isConsolation) continue;
    const e = playoff.get(g.ownerKey) ?? { w: 0, l: 0 };
    if (g.result === "W") e.w++;
    else if (g.result === "L") e.l++;
    playoff.set(g.ownerKey, e);
  }
  const rows: AllTimeRow[] = [];
  for (const [key, list] of finishes) {
    const wins = list.reduce((a, f) => a + f.wins, 0);
    const losses = list.reduce((a, f) => a + f.losses, 0);
    const ties = list.reduce((a, f) => a + f.ties, 0);
    const pf = r2(list.reduce((a, f) => a + f.pointsFor, 0));
    const pa = r2(list.reduce((a, f) => a + f.pointsAgainst, 0));
    const gp = wins + losses + ties;
    const ranks = list.filter((f) => !f.inProgress && f.finalRank).map((f) => f.finalRank!);
    const po = playoff.get(key) ?? { w: 0, l: 0 };
    rows.push({
      key,
      seasons: list.length,
      wins,
      losses,
      ties,
      pct: winPct(wins, losses, ties),
      pf,
      pa,
      games: gp,
      avgPf: gp ? r2(pf / gp) : 0,
      playoffApps: list.filter((f) => f.madePlayoffs).length,
      playoffWins: po.w,
      playoffLosses: po.l,
      titles: list.filter((f) => f.champion).length,
      runnerUps: list.filter((f) => f.runnerUp).length,
      regularSeasonTitles: list.filter((f) => !f.inProgress && f.regularSeasonRank === 1).length,
      bestFinish: ranks.length ? Math.min(...ranks) : null,
    });
  }
  return rows.sort((a, b) => b.titles - a.titles || b.pct - a.pct || b.wins - a.wins || b.pf - a.pf);
}

/** How many regular-season weeks each owner posted the league's top score (ties all count). Playoff weeks don't count. */
export function weeklyTopScores(games: GameRow[]): Map<string, number> {
  const byWeek = new Map<string, GameRow[]>();
  for (const g of games) {
    if (g.isPlayoff) continue;
    const k = `${g.season}:${g.week}`;
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(g);
  }
  const out = new Map<string, number>();
  for (const list of byWeek.values()) {
    const top = Math.max(...list.map((g) => g.pf));
    if (top <= 0) continue;
    for (const g of list) if (g.pf === top) out.set(g.ownerKey, (out.get(g.ownerKey) ?? 0) + 1);
  }
  return out;
}

/** Season totals for the season-records helpers. */
export function seasonTotals(finishes: Map<string, FinishLike[]>): SeasonTotal[] {
  const out: SeasonTotal[] = [];
  for (const [ownerKey, list] of finishes)
    for (const f of list) out.push({ ownerKey, teamId: f.teamId, teamName: f.teamName, season: f.season, wins: f.wins, losses: f.losses, ties: f.ties, pointsFor: f.pointsFor, pointsAgainst: f.pointsAgainst });
  return out;
}

export interface SeasonSummary {
  season: number;
  inProgress: boolean;
  champion: { key: string; teamId: string; teamName: string } | null;
  runnerUp: { key: string; teamId: string; teamName: string } | null;
  /** best regular-season finish (rank 1) */
  topSeed: { key: string; teamId: string; teamName: string; wins: number; losses: number; ties: number } | null;
  /** highest single-week score of the season (a week row) */
  highScore: GameRow | null;
  teams: number;
}

/**
 * Winner / loser of a season's championship from its final game(s). A bracket final is one game however many weeks it
 * spans (settings.playoffs.championshipWeeks): gamesFromMatchups only includes it once every week is final, with the
 * bracket's result (combined score, a tie settled by the playoff tiebreakers). Championship rows outside the bracket
 * (one game per week) are summed per team; a points tie there goes to the team that won the last week.
 * `championshipWeeks` = the minimum number of final weeks before there is a champion.
 */
export function championshipOutcome(seasonGames: GameRow[], championshipWeeks = 1): { winner: GameRow; loser: GameRow } | null {
  const finals = seasonGames.filter((g) => g.isChampionship && !g.isConsolation);
  if (!finals.length) return null;
  const weeks = [...new Set(finals.flatMap((g) => g.weeks))].sort((a, b) => a - b);
  if (weeks.length < Math.max(1, championshipWeeks)) return null;
  const lastWeek = weeks[weeks.length - 1];
  const last = finals.filter((g) => g.weeks.includes(lastWeek));
  const a = last[0];
  if (!a) return null;
  const opp = () => last.find((g) => g.teamId === a.oppTeamId);
  if (finals.filter((g) => g.teamId === a.teamId).length === 1) {
    // one game: its result decides (never a tie for a bracket game)
    if (a.result === "T") return null;
    const other = opp();
    if (!other) return null;
    return a.result === "W" ? { winner: a, loser: other } : { winner: other, loser: a };
  }
  const total = (teamId: string) => finals.filter((g) => g.teamId === teamId).reduce((x, g) => x + g.pf, 0);
  const ta = total(a.teamId);
  const tb = total(a.oppTeamId);
  const aWins = ta > tb || (ta === tb && a.result === "W");
  const winner = aWins ? a : opp();
  const loser = aWins ? opp() : a;
  return winner && loser ? { winner, loser } : null;
}

/**
 * One summary per season (newest first). Champions come from archived finishes, or from the final
 * championship game(s) in the current season (see championshipOutcome).
 */
export function seasonSummaries(finishes: Map<string, FinishLike[]>, games: GameRow[], seasons: number[], championshipWeeks = 1): SeasonSummary[] {
  const bySeason = new Map<number, { key: string; f: FinishLike }[]>();
  for (const [key, list] of finishes) for (const f of list) (bySeason.get(f.season) ?? bySeason.set(f.season, []).get(f.season)!).push({ key, f });
  return [...seasons]
    .sort((a, b) => b - a)
    .map((season) => {
      const rows = bySeason.get(season) ?? [];
      const sg = games.filter((g) => g.season === season);
      const champRow = rows.find((r) => r.f.champion);
      const runnerRow = rows.find((r) => r.f.runnerUp);
      const outcome = championshipOutcome(sg, championshipWeeks);
      const final = outcome?.winner;
      const finalLoser = outcome?.loser;
      const champion = champRow ? { key: champRow.key, teamId: champRow.f.teamId, teamName: champRow.f.teamName } : final ? { key: final.ownerKey, teamId: final.teamId, teamName: rows.find((r) => r.f.teamId === final.teamId)?.f.teamName ?? "" } : null;
      const runnerUp = runnerRow ? { key: runnerRow.key, teamId: runnerRow.f.teamId, teamName: runnerRow.f.teamName } : finalLoser ? { key: finalLoser.ownerKey, teamId: finalLoser.teamId, teamName: rows.find((r) => r.f.teamId === finalLoser.teamId)?.f.teamName ?? "" } : null;
      const top = rows.filter((r) => r.f.regularSeasonRank === 1)[0];
      // the best single week (each week of a multi-week playoff game on its own)
      const highScore = weekRows(sg).sort((a, b) => b.pf - a.pf)[0] ?? null;
      return {
        season,
        inProgress: rows.some((r) => r.f.inProgress) && !champRow && !final,
        champion,
        runnerUp,
        topSeed: top ? { key: top.key, teamId: top.f.teamId, teamName: top.f.teamName, wins: top.f.wins, losses: top.f.losses, ties: top.f.ties } : null,
        highScore,
        teams: rows.length,
      };
    });
}
