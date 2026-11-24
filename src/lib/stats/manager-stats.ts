// Manager statistics: pure, unit-tested helpers (records, head-to-head, all-play/luck, lineup efficiency,
// historical rosters, streaks, records book). Database loading lives in ./load.ts.
//
// Games vs weeks. A playoff round can span several NFL weeks (settings.playoffs.weeksPerRound, championshipWeeks):
// each week is its own Matchup row, but it is ONE game, decided on the combined score (the bracket's result, which
// every week's row carries once the game is final). gamesFromMatchups returns one GameRow per side per GAME; a
// multi-week game carries its weeks in `legs` and enters the stats only once all of its weeks are final.
//  - per game (results): W-L-T records, playoff records, head-to-head (games, record, margin, last game, streak),
//    win / loss streaks, biggest blowouts and closest games (by the game's combined margin), titles.
//  - per week (scoring): highest / lowest single-week score, best / worst weeks, weekly scoring vs the league,
//    average score per week, highest combined score in a week, weekly high scores, all-play and luck.
//    weekRows() expands games into one row per week for these.
import { bracketKindOf, localSlot } from "@/lib/playoffs/structure";

export type Result = "W" | "L" | "T";

export interface MatchupLike {
  id: string;
  season: number;
  week: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  status: string;
  winnerTeamId: string | null;
  isPlayoff: boolean;
  isConsolation: boolean;
  isChampionship: boolean;
  label?: string | null;
  /** playoff bracket position: the weeks of one bracket game share it */
  bracketRound?: number | null;
  bracketSlot?: number | null;
}

/** One side's score in one week of a game (a multi-week playoff game has one per week). */
export interface GameLeg {
  matchupId: string;
  week: number;
  pf: number;
  pa: number;
}

/** One team's side of a final game (or, from weekRows, of one week of it) */
export interface GameRow {
  /** the game's first week's matchup (a week row: that week's matchup) */
  matchupId: string;
  season: number;
  /** the game's first week (a week row: that week) */
  week: number;
  /** NFL weeks the game spans (one for a single-week game) */
  weeks: number[];
  /** this side's score each week of the game */
  legs: GameLeg[];
  /** a week row of a multi-week game: which week of the game (1-based); null for whole games and single-week games */
  leg: number | null;
  teamId: string;
  ownerKey: string;
  oppTeamId: string;
  oppOwnerKey: string;
  /** points for / against: the game's combined score (a week row: that week's) */
  pf: number;
  pa: number;
  /** the game's result (a week row of a multi-week game carries the result of the whole game) */
  result: Result;
  isPlayoff: boolean;
  isConsolation: boolean;
  isChampionship: boolean;
  label: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Result for the home (or away) side. A recorded winner wins ties on the scoreboard (bench-points tiebreakers etc.). */
export function resultFor(m: Pick<MatchupLike, "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore" | "winnerTeamId">, side: "home" | "away"): Result {
  const me = side === "home" ? m.homeTeamId : m.awayTeamId;
  const opp = side === "home" ? m.awayTeamId : m.homeTeamId;
  if (m.winnerTeamId && m.winnerTeamId === me) return "W";
  if (m.winnerTeamId && m.winnerTeamId === opp) return "L";
  const a = side === "home" ? m.homeScore : m.awayScore;
  const b = side === "home" ? m.awayScore : m.homeScore;
  return a > b ? "W" : a < b ? "L" : "T";
}

/** Owner key for a team in a season — the manager's user id when known, otherwise a stable team key. */
export type OwnerOf = (teamId: string, season: number) => string | null;

export function ownerKey(ownerOf: OwnerOf, teamId: string, season: number): string {
  return ownerOf(teamId, season) ?? `team:${teamId}`;
}

/**
 * Bracket game a playoff row belongs to (season + bracket kind + round + slot); null outside the bracket (no
 * bracketRound). Grouped exactly like @/lib/playoffs/bracket bracketGames, so stats and the bracket agree on games.
 */
export function playoffGameKey(m: Pick<MatchupLike, "season" | "isPlayoff" | "isConsolation" | "bracketRound" | "bracketSlot">): string | null {
  if (!m.isPlayoff || m.bracketRound == null) return null;
  const kind = bracketKindOf({ isPlayoff: m.isPlayoff, isConsolation: m.isConsolation, bracketSlot: m.bracketSlot ?? null });
  return kind ? `${m.season}|${kind}|${m.bracketRound}|${localSlot(kind, m.bracketSlot ?? null)}` : null;
}

/**
 * Two GameRows per final game with both teams (byes and unfinished games are skipped), sorted chronologically.
 * The weeks of a multi-week playoff game (rows sharing a bracket position) become one game: combined points, the
 * result every week's row carries (the bracket's: combined score, ties by the playoff tiebreakers), or the combined
 * score when the weeks disagree (older rows). Pass every playoff row of a season, whatever its status, so a game
 * still being played is left out until all of its weeks are final.
 */
export function gamesFromMatchups(matchups: MatchupLike[], ownerOf: OwnerOf): GameRow[] {
  const groups = new Map<string, MatchupLike[]>();
  const singles: MatchupLike[][] = [];
  for (const m of matchups) {
    const k = playoffGameKey(m);
    if (!k) singles.push([m]);
    else (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }
  const out: GameRow[] = [];
  for (const legs of [...singles, ...groups.values()]) {
    legs.sort((a, b) => a.week - b.week);
    const first = legs[0]!;
    const home = first.homeTeamId;
    const away = first.awayTeamId;
    if (!home || !away || legs.some((r) => r.status !== "FINAL" || !r.homeTeamId || !r.awayTeamId)) continue;
    // every week oriented to the first week's home team
    const scores = legs.map((r) => (r.homeTeamId === home ? { id: r.id, week: r.week, h: r.homeScore, a: r.awayScore } : { id: r.id, week: r.week, h: r.awayScore, a: r.homeScore }));
    const hs = r2(scores.reduce((x, s) => x + s.h, 0));
    const as = r2(scores.reduce((x, s) => x + s.a, 0));
    const stored = first.winnerTeamId && legs.every((r) => r.winnerTeamId === first.winnerTeamId) ? first.winnerTeamId : null;
    const game = { homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, winnerTeamId: stored };
    for (const side of ["home", "away"] as const) {
      const teamId = side === "home" ? home : away;
      const oppTeamId = side === "home" ? away : home;
      out.push({
        matchupId: first.id,
        season: first.season,
        week: first.week,
        weeks: scores.map((s) => s.week),
        legs: scores.map((s) => ({ matchupId: s.id, week: s.week, pf: side === "home" ? s.h : s.a, pa: side === "home" ? s.a : s.h })),
        leg: null,
        teamId,
        ownerKey: ownerKey(ownerOf, teamId, first.season),
        oppTeamId,
        oppOwnerKey: ownerKey(ownerOf, oppTeamId, first.season),
        pf: side === "home" ? hs : as,
        pa: side === "home" ? as : hs,
        result: resultFor(game, side),
        isPlayoff: first.isPlayoff,
        isConsolation: first.isConsolation,
        isChampionship: legs.some((r) => r.isChampionship),
        label: first.label ? first.label.replace(/ \(Wk \d+ of \d+\)$/, "") : null,
      });
    }
  }
  return out.sort((a, b) => a.season - b.season || a.week - b.week || a.matchupId.localeCompare(b.matchupId) || a.teamId.localeCompare(b.teamId));
}

/**
 * One row per week: a multi-week game becomes one row per week (that week's matchup and score, `leg` = its week of
 * the game, the whole game's result); single-week games are returned as they are. For per-week scoring stats.
 */
export function weekRows(games: GameRow[]): GameRow[] {
  const out: GameRow[] = [];
  for (const g of games) {
    if (g.legs.length <= 1) {
      out.push(g);
      continue;
    }
    g.legs.forEach((l, i) => out.push({ ...g, matchupId: l.matchupId, week: l.week, legs: [l], leg: i + 1, pf: l.pf, pa: l.pa }));
  }
  return out;
}

/** "Wk 15", or "Wks 15–16" for a multi-week game (a week row: "Wk 15 (1 of 2)"). */
export function gameWeekLabel(g: Pick<GameRow, "week" | "weeks" | "leg">): string {
  if (g.leg !== null && g.weeks.length > 1) return `Wk ${g.week} (${g.leg} of ${g.weeks.length})`;
  return g.weeks.length > 1 ? `Wks ${g.weeks[0]}–${g.weeks[g.weeks.length - 1]}` : `Wk ${g.week}`;
}

export interface RecordSummary {
  /** games (a multi-week playoff game counts once) */
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  pf: number;
  pa: number;
  /** weeks played (a two-week game is two) */
  weeks: number;
  /** average score per week */
  avgPf: number;
  avgPa: number;
  /** highest / lowest single-week score (a week row) */
  high: GameRow | null;
  low: GameRow | null;
}

export function winPct(wins: number, losses: number, ties: number): number {
  const g = wins + losses + ties;
  return g ? (wins + ties * 0.5) / g : 0;
}

/** Record per game, points totals, and per-week averages / high / low. */
export function summarizeGames(games: GameRow[]): RecordSummary {
  let wins = 0,
    losses = 0,
    ties = 0,
    pf = 0,
    pa = 0;
  for (const g of games) {
    if (g.result === "W") wins++;
    else if (g.result === "L") losses++;
    else ties++;
    pf += g.pf;
    pa += g.pa;
  }
  let high: GameRow | null = null;
  let low: GameRow | null = null;
  const weeks = weekRows(games);
  for (const w of weeks) {
    if (!high || w.pf > high.pf) high = w;
    if (!low || w.pf < low.pf) low = w;
  }
  const n = weeks.length;
  return { games: games.length, wins, losses, ties, pct: winPct(wins, losses, ties), pf: r2(pf), pa: r2(pa), weeks: n, avgPf: n ? r2(pf / n) : 0, avgPa: n ? r2(pa / n) : 0, high, low };
}

export interface H2HRow {
  oppKey: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  pf: number;
  pa: number;
  avgMargin: number;
  playoffWins: number;
  playoffLosses: number;
  last: GameRow | null;
  streak: string;
}

/** Head-to-head record against every opponent (by owner key) from one manager's games (a multi-week game counts once). */
export function headToHead(games: GameRow[]): H2HRow[] {
  const by = new Map<string, GameRow[]>();
  for (const g of games) {
    if (!by.has(g.oppOwnerKey)) by.set(g.oppOwnerKey, []);
    by.get(g.oppOwnerKey)!.push(g);
  }
  const rows: H2HRow[] = [];
  for (const [oppKey, list] of by) {
    const s = summarizeGames(list);
    const results = list.map((g) => g.result);
    const cur = currentStreak(results);
    rows.push({
      oppKey,
      games: s.games,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      pct: s.pct,
      pf: s.pf,
      pa: s.pa,
      avgMargin: s.games ? r2((s.pf - s.pa) / s.games) : 0,
      playoffWins: list.filter((g) => g.isPlayoff && !g.isConsolation && g.result === "W").length,
      playoffLosses: list.filter((g) => g.isPlayoff && !g.isConsolation && g.result === "L").length,
      last: list[list.length - 1] ?? null,
      streak: cur ? `${cur.kind}${cur.length}` : "",
    });
  }
  return rows.sort((a, b) => b.games - a.games || b.pct - a.pct || a.oppKey.localeCompare(b.oppKey));
}

export interface AllPlayRow {
  key: string;
  wins: number;
  losses: number;
  ties: number;
  weeks: number;
  pct: number;
  /** wins expected against a random opponent each week: Σ allPlayWins_w / (N − 1) */
  expectedWins: number;
}

/**
 * All-play record from weekly score lists. `weeks` is a list of weeks, each a list of { key, pts } (one per
 * team that played). Ties count half a win in expected wins.
 */
export function allPlay(weeks: { key: string; pts: number }[][]): Map<string, AllPlayRow> {
  const out = new Map<string, AllPlayRow>();
  for (const scores of weeks) {
    const n = scores.length;
    if (n < 2) continue;
    for (const s of scores) {
      let w = 0,
        l = 0,
        t = 0;
      for (const o of scores) {
        if (o === s) continue;
        if (s.pts > o.pts) w++;
        else if (s.pts < o.pts) l++;
        else t++;
      }
      const row = out.get(s.key) ?? { key: s.key, wins: 0, losses: 0, ties: 0, weeks: 0, pct: 0, expectedWins: 0 };
      row.wins += w;
      row.losses += l;
      row.ties += t;
      row.weeks += 1;
      row.expectedWins += (w + t * 0.5) / (n - 1);
      out.set(s.key, row);
    }
  }
  for (const row of out.values()) {
    row.pct = winPct(row.wins, row.losses, row.ties);
    row.expectedWins = r2(row.expectedWins);
  }
  return out;
}

/** Weekly score lists (regular-season head-to-head games only — always one week each) keyed by team id. */
export function weeklyScores(games: GameRow[], keyOf: (g: GameRow) => string = (g) => g.teamId): { key: string; pts: number }[][] {
  const by = new Map<string, { key: string; pts: number }[]>();
  for (const g of games) {
    if (g.isPlayoff) continue;
    const k = `${g.season}:${g.week}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push({ key: keyOf(g), pts: g.pf });
  }
  return [...by.values()];
}

/** Luck index = actual head-to-head wins (ties = ½) − all-play expected wins. Positive = lucky. */
export function luckIndex(wins: number, ties: number, expectedWins: number): number {
  return r2(wins + ties * 0.5 - expectedWins);
}

/** 1-based rank of `value` in `values` (higher is better unless `asc`). Ties share the better rank. */
export function rankOf(values: number[], value: number, asc = false): number {
  return values.filter((v) => (asc ? v < value : v > value)).length + 1;
}

export interface WeekEfficiency {
  season: number;
  week: number;
  actual: number;
  optimal: number;
  efficiency: number; // 0..1
  benchLeft: number;
  /** players the optimal lineup would have started instead */
  missed: { playerId: string; points: number }[];
}

/** Lineup efficiency = actual starter points / optimal points (1 when optimal ≤ 0). */
export function efficiency(actual: number, optimal: number): { efficiency: number; benchLeft: number } {
  const opt = Math.max(optimal, actual);
  if (opt <= 0) return { efficiency: 1, benchLeft: 0 };
  return { efficiency: Math.max(0, Math.min(1, actual / opt)), benchLeft: r2(Math.max(0, opt - actual)) };
}

export type LineupOptimizer = (players: { id: string; position: string }[], value: Map<string, number>) => { playerId: string | null }[];

/**
 * Efficiency for one team-week: starters (as set) vs the hindsight-optimal lineup from every player who could
 * have started (`candidates` ∪ starters), using actual points.
 */
export function weekEfficiency(
  season: number,
  week: number,
  starterIds: string[],
  candidates: { id: string; position: string }[],
  points: Map<string, number>,
  optimize: LineupOptimizer,
): WeekEfficiency {
  const pool = new Map(candidates.map((c) => [c.id, c]));
  const starters = starterIds.filter(Boolean);
  const actual = r2(starters.reduce((a, id) => a + (points.get(id) ?? 0), 0));
  const best = optimize([...pool.values()], points).map((s) => s.playerId).filter((x): x is string => !!x);
  const optimal = r2(best.reduce((a, id) => a + (points.get(id) ?? 0), 0));
  const set = new Set(starters);
  const missed = best.filter((id) => !set.has(id)).map((id) => ({ playerId: id, points: points.get(id) ?? 0 })).sort((a, b) => b.points - a.points);
  const e = efficiency(actual, optimal);
  return { season, week, actual, optimal: Math.max(optimal, actual), efficiency: e.efficiency, benchLeft: e.benchLeft, missed };
}

export function streaks(results: Result[]): { longestWin: number; longestLoss: number } {
  let lw = 0,
    ll = 0,
    cw = 0,
    cl = 0;
  for (const r of results) {
    if (r === "W") {
      cw++;
      cl = 0;
    } else if (r === "L") {
      cl++;
      cw = 0;
    } else {
      cw = 0;
      cl = 0;
    }
    lw = Math.max(lw, cw);
    ll = Math.max(ll, cl);
  }
  return { longestWin: lw, longestLoss: ll };
}

export function currentStreak(results: Result[]): { kind: Result; length: number } | null {
  if (!results.length) return null;
  const kind = results[results.length - 1];
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === kind; i--) n++;
  return { kind, length: n };
}

/** Top / bottom single-week scores (each week of a multi-week game is its own score). */
export function bestAndWorst(games: GameRow[], n = 5): { best: GameRow[]; worst: GameRow[] } {
  const sorted = weekRows(games).sort((a, b) => b.pf - a.pf || a.season - b.season || a.week - b.week);
  return { best: sorted.slice(0, n), worst: [...sorted].reverse().slice(0, n) };
}

/**
 * Team's weekly scores next to the league average of the same week (all teams that played). One entry per week: a
 * week of a multi-week playoff game shows that week's score with the whole game's result (`leg` / `legs` say which
 * week of the game it was).
 */
export function weeklyVsLeague(
  teamGames: GameRow[],
  seasonGames: GameRow[],
): { season: number; week: number; pts: number; leagueAvg: number; opp: number; result: Result; oppTeamId: string; isPlayoff: boolean; leg: number | null; legs: number }[] {
  const sums = new Map<string, { s: number; n: number }>();
  for (const g of weekRows(seasonGames)) {
    const k = `${g.season}:${g.week}`;
    const e = sums.get(k) ?? { s: 0, n: 0 };
    e.s += g.pf;
    e.n += 1;
    sums.set(k, e);
  }
  return weekRows(teamGames).map((g) => {
    const e = sums.get(`${g.season}:${g.week}`);
    return { season: g.season, week: g.week, pts: g.pf, leagueAvg: e && e.n ? r2(e.s / e.n) : g.pf, opp: g.pa, result: g.result, oppTeamId: g.oppTeamId, isPlayoff: g.isPlayoff, leg: g.leg, legs: g.weeks.length };
  });
}

// ───────────────────────────── Historical rosters ─────────────────────────────

/** A player joining (or leaving) a team. `week` is the league week of the move. */
export interface RosterEvent {
  at: number;
  week: number;
  playerId: string;
  joined: boolean;
}

const JOIN_TYPES = new Set(["ADD", "WAIVER", "AUCTION", "ROOKIE_DRAFT", "DRAFT", "KEEPER", "FREE_AGENT"]);

export interface TxLike {
  id: string;
  type: string;
  week: number;
  season: number;
  createdAt: Date | string;
  teamId: string | null;
  playerId: string | null;
  tradeId: string | null;
  description: string;
  details: unknown;
}

export interface TradeAssetLike {
  type: string;
  playerId: string | null;
  fromTeamId: string;
  toTeamId: string;
}

/** Roster join/leave events for one team in one season, from Transaction rows (+ trade assets). */
export function rosterEventsFor(teamId: string, season: number, txs: TxLike[], assetsByTrade: Map<string, TradeAssetLike[]>): RosterEvent[] {
  const out: RosterEvent[] = [];
  for (const t of txs) {
    if (t.teamId !== teamId || t.season !== season) continue;
    const at = new Date(t.createdAt).getTime();
    if (t.type === "TRADE" && t.tradeId) {
      const reversal = !!(t.details && typeof t.details === "object" && (t.details as Record<string, unknown>).reversal);
      for (const a of assetsByTrade.get(t.tradeId) ?? []) {
        if (a.type !== "PLAYER" || !a.playerId) continue;
        const incoming = reversal ? a.fromTeamId === teamId : a.toTeamId === teamId;
        const outgoing = reversal ? a.toTeamId === teamId : a.fromTeamId === teamId;
        if (incoming) out.push({ at, week: t.week, playerId: a.playerId, joined: true });
        else if (outgoing) out.push({ at, week: t.week, playerId: a.playerId, joined: false });
      }
      continue;
    }
    if (!t.playerId) continue;
    if (JOIN_TYPES.has(t.type)) out.push({ at, week: t.week, playerId: t.playerId, joined: true });
    else if (t.type === "DROP") out.push({ at, week: t.week, playerId: t.playerId, joined: false });
    else if (t.type === "COMMISSIONER") {
      if (/^(added|restored|assigned|signed)/i.test(t.description)) out.push({ at, week: t.week, playerId: t.playerId, joined: true });
      else if (/^(dropped|removed|released|cut)/i.test(t.description)) out.push({ at, week: t.week, playerId: t.playerId, joined: false });
    }
  }
  return out;
}

/**
 * Roster as it stood at the end of `week`: start from the current roster and undo (newest first) every move
 * made in a later week.
 */
export function rosterAtWeekEnd(current: Iterable<string>, events: RosterEvent[], week: number): Set<string> {
  const set = new Set(current);
  const later = events.filter((e) => e.week > week).sort((a, b) => b.at - a.at);
  for (const e of later) {
    if (e.joined) set.delete(e.playerId);
    else set.add(e.playerId);
  }
  return set;
}

export interface StatusEvent {
  at: number;
  week: number;
  playerId: string;
  type: string; // IR | TAXI | ACTIVATE
}

/** Players stashed on IR / taxi at the end of `week` (undoing later status moves). */
export function inactiveAtWeekEnd(currentInactive: Iterable<string>, events: StatusEvent[], week: number): Set<string> {
  const set = new Set(currentInactive);
  const later = events.filter((e) => e.week > week).sort((a, b) => b.at - a.at);
  for (const e of later) {
    if (e.type === "IR" || e.type === "TAXI") set.delete(e.playerId);
    else if (e.type === "ACTIVATE") set.add(e.playerId);
  }
  return set;
}

// ───────────────────────────── Salary ─────────────────────────────

export interface SalarySlice {
  position: string;
  salary: number;
  capHit: number;
  count: number;
  share: number; // of total salary
}

export function salaryByPosition(spots: { position: string; salary: number; capHit: number }[], order: string[] = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]): SalarySlice[] {
  const by = new Map<string, SalarySlice>();
  let total = 0;
  for (const s of spots) {
    const e = by.get(s.position) ?? { position: s.position, salary: 0, capHit: 0, count: 0, share: 0 };
    e.salary += s.salary;
    e.capHit += s.capHit;
    e.count += 1;
    total += s.salary;
    by.set(s.position, e);
  }
  const rank = (p: string) => {
    const i = order.indexOf(p);
    return i === -1 ? order.length : i;
  };
  return [...by.values()].map((e) => ({ ...e, share: total ? e.salary / total : 0 })).sort((a, b) => rank(a.position) - rank(b.position) || b.salary - a.salary);
}

// ───────────────────────────── Records book ─────────────────────────────

export interface GameRecord {
  game: GameRow;
  value: number;
}

/**
 * Records book across every final game. Scoring records are per week (highest / lowest single-week score, highest
 * combined score in a week); result records are per game (biggest blowouts and closest games, by the combined margin
 * of a multi-week playoff game, which counts once).
 */
export function recordsBook(games: GameRow[], n = 5) {
  // the winner's side of every game (either side of a tie)
  const byGame = new Map<string, GameRow>();
  for (const g of games) if (g.result === "W" || (g.result === "T" && !byGame.has(g.matchupId))) byGame.set(g.matchupId, g);
  const decided = [...byGame.values()];
  const weeks = weekRows(games);
  const scoreSort = [...weeks].sort((a, b) => b.pf - a.pf || a.season - b.season || a.week - b.week);
  const decidedWeeks = weekRows(decided);
  return {
    highest: scoreSort.slice(0, n).map((g) => ({ game: g, value: g.pf })),
    lowest: [...scoreSort].reverse().slice(0, n).map((g) => ({ game: g, value: g.pf })),
    blowouts: [...decided].sort((a, b) => b.pf - b.pa - (a.pf - a.pa)).slice(0, n).map((g) => ({ game: g, value: r2(g.pf - g.pa) })),
    closest: [...decided]
      .filter((g) => g.pf + g.pa > 0)
      .sort((a, b) => Math.abs(a.pf - a.pa) - Math.abs(b.pf - b.pa) || b.pf + b.pa - (a.pf + a.pa))
      .slice(0, n)
      .map((g) => ({ game: g, value: r2(Math.abs(g.pf - g.pa)) })),
    highestCombined: [...decidedWeeks].sort((a, b) => b.pf + b.pa - (a.pf + a.pa)).slice(0, n).map((g) => ({ game: g, value: r2(g.pf + g.pa) })),
  };
}

/** Longest winning (and losing) streaks per owner across seasons, in chronological order (one result per game). Consolation games excluded. */
export function streakRecords(games: GameRow[], n = 5): { owner: string; length: number; from: GameRow; to: GameRow; kind: "W" | "L" }[] {
  const by = new Map<string, GameRow[]>();
  for (const g of games) {
    if (g.isConsolation) continue;
    if (!by.has(g.ownerKey)) by.set(g.ownerKey, []);
    by.get(g.ownerKey)!.push(g);
  }
  const out: { owner: string; length: number; from: GameRow; to: GameRow; kind: "W" | "L" }[] = [];
  for (const [owner, list] of by) {
    list.sort((a, b) => a.season - b.season || a.week - b.week);
    for (const kind of ["W", "L"] as const) {
      let best: { length: number; from: GameRow; to: GameRow } | null = null;
      let start = -1;
      for (let i = 0; i <= list.length; i++) {
        const hit = i < list.length && list[i].result === kind;
        if (hit && start === -1) start = i;
        if (!hit && start !== -1) {
          const len = i - start;
          if (!best || len > best.length) best = { length: len, from: list[start], to: list[i - 1] };
          start = -1;
        }
      }
      if (best) out.push({ owner, kind, ...best });
    }
  }
  return out.sort((a, b) => b.length - a.length || a.from.season - b.from.season).slice(0, n * 2);
}

export interface SeasonTotal {
  ownerKey: string;
  teamId: string;
  teamName: string;
  season: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** Most / fewest points for in a single (regular) season */
export function seasonPointRecords(rows: SeasonTotal[], n = 5) {
  const played = rows.filter((r) => r.wins + r.losses + r.ties > 0);
  const sorted = [...played].sort((a, b) => b.pointsFor - a.pointsFor);
  return { most: sorted.slice(0, n), fewest: [...sorted].reverse().slice(0, n), bestRecord: [...played].sort((a, b) => winPct(b.wins, b.losses, b.ties) - winPct(a.wins, a.losses, a.ties) || b.pointsFor - a.pointsFor).slice(0, n) };
}
