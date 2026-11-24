// Monte Carlo playoff-odds engine (pure, deterministic for a given seed). No database access.
//
// Score model (docs/research/trade-value-and-sim.md §6.2):
//   score[t,w] = μ[t,w] + √q[t,w] · (u[t] + c[w] + ε[t,w])
//   u[t] ~ N(0, τ²)            persistent "our projection of this team is off" (per simulated season)
//   c[w] ~ N(0, shock²)        league-wide high/low scoring week (cancels head-to-head, matters for PF)
//   ε    ~ N(0, σ[t,w]² − shock²)
//   q    = share of the week still to be played (1 for future weeks, < 1 for live weeks)
// Simulated standings are ranked by rankLeague() from @/lib/standings — the exact function the league standings use
// (win pct, then the tiebreaker chain applied to whole tied groups, multi-team head-to-head, deterministic tail) —
// seeding mirrors playoffSeeds, then the bracket is played out with the same score model (multi-week rounds sum
// their weeks). @/lib/standings is imported only for its pure ranking helpers.
import type { LeagueSettings } from "@/lib/settings/schema";
import { advKey, bracketPlan, roundPairings, type BracketPlan } from "@/lib/playoffs/structure";
import { coinFlipDraw, rankLeague, type TieTable } from "@/lib/standings";
import { createRng } from "./rng";

export type Tiebreaker = LeagueSettings["standings"]["tiebreakers"][number];

export interface SimTeam {
  id: string;
  division: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  divWins: number;
  divLosses: number;
  divTies: number;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  /** the season's coin-flip draw (StandingRow.coinFlip); defaults to coinFlipDraw(0, id) */
  coinFlip?: number;
}

export interface SimGame {
  week: number;
  home: string;
  away: string;
}

export interface SimRules {
  playoffTeams: number;
  seeding: "RECORD" | "POINTS_FOR";
  wildcardsByPoints: number;
  divisionWinnersTopSeeds: boolean;
  /** division winners are guaranteed a spot (seeded by record) */
  divisionWinnersQualify?: boolean;
  reseed: boolean;
  tiebreakers: Tiebreaker[];
  /** ranks teams inside a division (settings.standings.divisionTiebreakers; empty = use `tiebreakers`) */
  divisionTiebreakers?: readonly string[];
  /** an extra W/L each week vs the league median */
  medianGame: boolean;
  /** weekly high score earns an extra win */
  highScoreBonus: boolean;
  /** weeks of each championship-bracket round */
  roundWeeks: number[][];
}

export interface SimInput {
  /** teams in league order (Team.createdAt asc); the ranking itself does not depend on this order */
  teams: SimTeam[];
  /** head-to-head record: key "a|b" → wins/losses/ties of a against b (regular season, final games) */
  h2h: Record<string, { w: number; l: number; t?: number }>;
  /** remaining regular-season games */
  games: SimGame[];
  /** expected points per team per week (remaining regular-season and playoff weeks) */
  mean: Record<string, Record<number, number>>;
  /** weekly SD per team per week */
  sd: Record<string, Record<number, number>>;
  /** share (0..1) of a week's variance still to come; default 1 */
  remaining?: Record<string, Record<number, number>>;
  rules: SimRules;
  simulations: number;
  seed: number;
  tau: number;
  commonShockSD: number;
  /** playoffs already under way: fixed seeds (team ids by seed) + decided games ("round:slot" → team id that advanced) */
  bracket?: { seeds: string[]; advanced: Record<string, string> } | null;
  /** week whose result is used for the leverage stat (P(playoffs | win) − P(playoffs | loss)) */
  leverageWeek?: number | null;
  /** fallback weekly mean when a team/week is missing */
  defaultMean?: number;
  defaultSd?: number;
}

export interface TeamOdds {
  teamId: string;
  playoffPct: number;
  byePct: number;
  divisionPct: number;
  finalsPct: number;
  champPct: number;
  /** probability of each seed 1..N */
  seedDist: number[];
  /** mean seed in simulations where the team made the playoffs (null if it never did) */
  avgSeed: number | null;
  projWins: number;
  projLosses: number;
  projTies: number;
  projPF: number;
  /** P(playoffs | win) − P(playoffs | loss) for `leverageWeek` (null when not applicable) */
  leverage: number | null;
  /** probability of finishing the regular season with the most wins/rank 1 */
  firstPct: number;
  /** probability of finishing last in the regular season */
  lastPct: number;
}

export interface SimResult {
  simulations: number;
  seed: number;
  playoffTeams: number;
  byes: number;
  odds: TeamOdds[];
  elapsedMs: number;
}

// ───────── Ranking (shared with the standings: rankLeague from @/lib/standings) ─────────

/** One simulated season's standings state, by team index (league order). */
export interface RankState extends TieTable {
  n: number;
  ids: string[];
  div: Int32Array; // division index, -1 = none
  W: Float64Array;
  L: Float64Array;
  T: Float64Array;
  PF: Float64Array;
  PA: Float64Array;
  dW: Float64Array;
  dL: Float64Array;
  dT: Float64Array;
  apW: Float64Array;
  coin: Float64Array;
  h2hW: Int32Array; // n*n wins of i over j
  h2hT: Int32Array; // n*n tied games between i and j
}

/** Rank state for `teams` with their current records and head-to-head results. */
export function rankStateFrom(teams: readonly SimTeam[], h2h: SimInput["h2h"]): RankState {
  const n = teams.length;
  const ids = teams.map((t) => t.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const divNames = [...new Set(teams.map((t) => t.division).filter((d): d is string => !!d))];
  const s: RankState = {
    n,
    ids,
    div: Int32Array.from(teams, (t) => (t.division ? divNames.indexOf(t.division) : -1)),
    W: Float64Array.from(teams, (t) => t.wins),
    L: Float64Array.from(teams, (t) => t.losses),
    T: Float64Array.from(teams, (t) => t.ties),
    PF: Float64Array.from(teams, (t) => t.pointsFor),
    PA: Float64Array.from(teams, (t) => t.pointsAgainst),
    dW: Float64Array.from(teams, (t) => t.divWins),
    dL: Float64Array.from(teams, (t) => t.divLosses),
    dT: Float64Array.from(teams, (t) => t.divTies),
    apW: Float64Array.from(teams, (t) => t.allPlayWins),
    coin: Float64Array.from(teams, (t) => t.coinFlip ?? coinFlipDraw(0, t.id)),
    h2hW: new Int32Array(n * n),
    h2hT: new Int32Array(n * n),
  };
  for (const [k, v] of Object.entries(h2h)) {
    const [a, b] = k.split("|");
    const ia = idx.get(a!);
    const ib = idx.get(b!);
    if (ia === undefined || ib === undefined) continue;
    s.h2hW[ia * n + ib] = v.w;
    s.h2hT[ia * n + ib] = v.t ?? 0;
  }
  return s;
}

/**
 * Overall order and division winners (team indices, winners in overall order) — exactly the standings' rules:
 * rankLeague() with the overall chain, division ranks with the division chain and then the overall order.
 */
export function rankSeason(s: RankState, tiebreakers: readonly string[], divisionTiebreakers: readonly string[]): { order: number[]; winners: number[] } {
  const { order, divisions } = rankLeague(s, s.div, tiebreakers, divisionTiebreakers);
  const winners = new Set<number>();
  for (const d of divisions) if (d.length) winners.add(d[0]!);
  return { order, winners: winners.size ? order.filter((i) => winners.has(i)) : [] };
}

/**
 * Playoff seeds (team indices by seed) from a ranked order — mirrors playoffSeeds() in @/lib/standings.
 * `order` is the overall standings order; `winners` the division winners in that order.
 */
export function seedsFromOrder(
  order: readonly number[],
  s: Pick<RankState, "PF">,
  rules: Pick<SimRules, "playoffTeams" | "seeding" | "wildcardsByPoints" | "divisionWinnersTopSeeds" | "divisionWinnersQualify">,
  winners: readonly number[],
): number[] {
  const n = rules.playoffTeams;
  const byPoints = rules.wildcardsByPoints ?? 0;
  const byPF = (a: number, b: number) => s.PF[b]! - s.PF[a]!;
  const primary = rules.seeding === "POINTS_FOR" ? [...order].sort(byPF) : order;
  const seeds: number[] = [];
  const taken = new Set<number>();
  const add = (i: number) => {
    seeds.push(i);
    taken.add(i);
  };
  if (rules.divisionWinnersTopSeeds) {
    winners.forEach(add);
    const recordSpots = Math.max(0, n - seeds.length - byPoints);
    primary.filter((i) => !taken.has(i)).slice(0, recordSpots).forEach(add);
  } else if (rules.divisionWinnersQualify && winners.length) {
    const guaranteed = new Set(winners.slice(0, Math.max(0, n)));
    const otherSpots = Math.max(0, n - byPoints - guaranteed.size);
    const others = new Set(primary.filter((i) => !guaranteed.has(i)).slice(0, otherSpots));
    primary.filter((i) => guaranteed.has(i) || others.has(i)).forEach(add);
  } else {
    primary.slice(0, Math.max(0, n - byPoints)).forEach(add);
  }
  const remaining = order.filter((i) => !taken.has(i)).sort(byPF);
  remaining.slice(0, Math.max(0, Math.min(byPoints, n - seeds.length))).forEach(add);
  return seeds.slice(0, Math.max(0, n));
}

// ───────── Simulation ─────────

export function simulatePlayoffOdds(input: SimInput): SimResult {
  const t0 = Date.now();
  const teams = input.teams;
  const n = teams.length;
  const ids = teams.map((t) => t.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const rules = input.rules;
  const N = Math.max(0, Math.min(rules.playoffTeams, n));
  const plan: BracketPlan = bracketPlan(N);
  const byes = plan.byes;
  const sims = Math.max(1, Math.floor(input.simulations));
  const rng = createRng(input.seed);

  // base state (results so far) and the per-simulation working copy
  const base = rankStateFrom(teams, input.h2h);
  const divIdx = base.div;
  const s: RankState = {
    ...base,
    W: new Float64Array(n),
    L: new Float64Array(n),
    T: new Float64Array(n),
    PF: new Float64Array(n),
    PA: new Float64Array(n),
    dW: new Float64Array(n),
    dL: new Float64Array(n),
    dT: new Float64Array(n),
    apW: new Float64Array(n),
    h2hW: new Int32Array(n * n),
    h2hT: new Int32Array(n * n),
  };
  const divChain = rules.divisionTiebreakers?.length ? rules.divisionTiebreakers : rules.tiebreakers;

  // schedule by week
  const weeks = [...new Set(input.games.map((g) => g.week))].sort((a, b) => a - b);
  const gamesByWeek = weeks.map((w) =>
    input.games
      .filter((g) => g.week === w)
      .map((g) => [idx.get(g.home), idx.get(g.away)] as const)
      .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined),
  );
  // teams with a game each week: like the standings, all-play, the median game and the high-score bonus only
  // count teams that played (a team on a bye — odd team counts — gets none of them that week)
  const playersByWeek = gamesByWeek.map((pairs) => Int32Array.from(new Set(pairs.flat())));
  const defMean = input.defaultMean ?? 100;
  const defSd = input.defaultSd ?? 24;
  const shock = Math.max(0, input.commonShockSD);
  const weekParams = (w: number) => {
    const mu = new Float64Array(n);
    const eps = new Float64Array(n);
    const q = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      mu[i] = input.mean[id]?.[w] ?? defMean;
      const sd = input.sd[id]?.[w] ?? defSd;
      eps[i] = Math.sqrt(Math.max(1, sd * sd - shock * shock));
      q[i] = Math.sqrt(Math.max(0, Math.min(1, input.remaining?.[id]?.[w] ?? 1)));
    }
    return { mu, eps, q };
  };
  const regParams = weeks.map(weekParams);
  const roundParams = rules.roundWeeks.map((ws) => ws.map(weekParams));
  const tau = Math.max(0, input.tau);
  // simulated all-play wins matter whenever either chain (overall or division) can reach ALL_PLAY
  const playsAllPlay = rules.tiebreakers.includes("ALL_PLAY") || divChain.includes("ALL_PLAY");

  // fixed bracket (playoffs under way)
  const fixedSeeds = input.bracket ? input.bracket.seeds.map((id) => idx.get(id)).filter((i): i is number => i !== undefined) : null;
  const fixedAdv = new Map<string, number>();
  if (input.bracket && fixedSeeds) {
    const seedOfTeam = new Map(fixedSeeds.map((ti, k) => [ti, k + 1]));
    for (const [k, teamId] of Object.entries(input.bracket.advanced)) {
      const ti = idx.get(teamId);
      const sd = ti !== undefined ? seedOfTeam.get(ti) : undefined;
      if (sd !== undefined) fixedAdv.set(k, sd);
    }
  }

  // tallies
  const seedCount = Array.from({ length: n }, () => new Float64Array(Math.max(1, N)));
  const playoffs = new Float64Array(n);
  const bye = new Float64Array(n);
  const divWin = new Float64Array(n);
  const finals = new Float64Array(n);
  const champ = new Float64Array(n);
  const first = new Float64Array(n);
  const last = new Float64Array(n);
  const sumW = new Float64Array(n);
  const sumL = new Float64Array(n);
  const sumT = new Float64Array(n);
  const sumPF = new Float64Array(n);
  // leverage: [won & in, won, lost & in, lost]
  const levWeekIdx = input.leverageWeek != null ? weeks.indexOf(input.leverageWeek) : -1;
  const lev = Array.from({ length: n }, () => new Float64Array(4));
  const levResult = new Int8Array(n); // 1 win, -1 loss, 0 none

  const u = new Float64Array(n);
  const scores = new Float64Array(n);
  const sortedScores = new Float64Array(n);

  for (let sim = 0; sim < sims; sim++) {
    s.W.set(base.W);
    s.L.set(base.L);
    s.T.set(base.T);
    s.PF.set(base.PF);
    s.PA.set(base.PA);
    s.dW.set(base.dW);
    s.dL.set(base.dL);
    s.dT.set(base.dT);
    s.apW.set(base.apW);
    s.h2hW.set(base.h2hW);
    s.h2hT.set(base.h2hT);
    levResult.fill(0);
    for (let i = 0; i < n; i++) u[i] = rng.normal() * tau;

    for (let wi = 0; wi < weeks.length; wi++) {
      const { mu, eps, q } = regParams[wi];
      const c = rng.normal() * shock;
      for (let i = 0; i < n; i++) scores[i] = mu[i] + q[i] * (u[i] + c + rng.normal() * eps[i]);
      for (const [h, a] of gamesByWeek[wi]) {
        const hs = scores[h];
        const as = scores[a];
        s.PF[h] += hs;
        s.PA[h] += as;
        s.PF[a] += as;
        s.PA[a] += hs;
        const sameDiv = divIdx[h] >= 0 && divIdx[h] === divIdx[a];
        if (hs > as) {
          s.W[h]++;
          s.L[a]++;
          s.h2hW[h * n + a]++;
          if (sameDiv) (s.dW[h]++, s.dL[a]++);
          if (wi === levWeekIdx) (levResult[h] = 1, levResult[a] = -1);
        } else if (as > hs) {
          s.W[a]++;
          s.L[h]++;
          s.h2hW[a * n + h]++;
          if (sameDiv) (s.dW[a]++, s.dL[h]++);
          if (wi === levWeekIdx) (levResult[a] = 1, levResult[h] = -1);
        } else {
          s.T[h]++;
          s.T[a]++;
          s.h2hT[h * n + a]++;
          s.h2hT[a * n + h]++;
          if (sameDiv) (s.dT[h]++, s.dT[a]++);
        }
      }
      const players = playersByWeek[wi];
      const m = players.length;
      if (m > 0 && (playsAllPlay || rules.medianGame || rules.highScoreBonus)) {
        if (playsAllPlay) {
          // wins in all-play = number of teams that played with a strictly lower score
          for (let x = 0; x < m; x++) {
            const i = players[x];
            let lo = 0;
            for (let y = 0; y < m; y++) if (scores[players[y]] < scores[i]) lo++;
            s.apW[i] += lo;
          }
        }
        if (rules.medianGame) {
          for (let x = 0; x < m; x++) sortedScores[x] = scores[players[x]];
          const sorted = sortedScores.subarray(0, m).sort();
          const median = (sorted[Math.floor((m - 1) / 2)] + sorted[Math.ceil((m - 1) / 2)]) / 2;
          for (let x = 0; x < m; x++) {
            const i = players[x];
            if (scores[i] > median) s.W[i]++;
            else if (scores[i] < median) s.L[i]++;
          }
        }
        if (rules.highScoreBonus) {
          let top = players[0];
          for (let x = 1; x < m; x++) if (scores[players[x]] > scores[top]) top = players[x];
          s.W[top]++;
        }
      }
    }

    // standings + seeds
    let seeds: number[];
    if (fixedSeeds) seeds = fixedSeeds;
    else {
      const { order, winners } = rankSeason(s, rules.tiebreakers, divChain);
      seeds = seedsFromOrder(order, s, rules, winners);
      first[order[0]]++;
      last[order[n - 1]]++;
      for (const i of winners) divWin[i]++;
    }
    for (let i = 0; i < n; i++) {
      sumW[i] += s.W[i];
      sumL[i] += s.L[i];
      sumT[i] += s.T[i];
      sumPF[i] += s.PF[i];
    }
    const inPlayoffs = new Uint8Array(n);
    seeds.forEach((ti, k) => {
      inPlayoffs[ti] = 1;
      playoffs[ti]++;
      seedCount[ti][k]++;
      if (k < byes) bye[ti]++;
    });
    if (levWeekIdx >= 0) {
      for (let i = 0; i < n; i++) {
        const r = levResult[i];
        if (r === 1) (lev[i][1]++, inPlayoffs[i] && lev[i][0]++);
        else if (r === -1) (lev[i][3]++, inPlayoffs[i] && lev[i][2]++);
      }
    }

    // bracket
    if (plan.rounds === 0) {
      if (seeds.length === 1) champ[seeds[0]]++;
      continue;
    }
    const adv = new Map<string, number>(fixedAdv);
    for (let r = 1; r <= plan.rounds; r++) {
      const pairs = roundPairings(plan, r, rules.reseed, adv);
      if (!pairs) break;
      const params = roundParams[r - 1] ?? [];
      for (const p of pairs) {
        if (p.home === null || p.away === null) continue;
        const k = advKey(r, p.slot);
        const hi = seeds[p.home - 1];
        const ai = seeds[p.away - 1];
        if (hi === undefined || ai === undefined) continue;
        if (r === plan.rounds) (finals[hi]++, finals[ai]++);
        if (adv.has(k)) continue;
        let hs = 0;
        let as = 0;
        for (const wp of params) {
          hs += wp.mu[hi] + wp.q[hi] * (u[hi] + rng.normal() * wp.eps[hi]);
          as += wp.mu[ai] + wp.q[ai] * (u[ai] + rng.normal() * wp.eps[ai]);
        }
        adv.set(k, hs > as ? p.home : as > hs ? p.away : Math.min(p.home, p.away));
      }
    }
    if (plan.rounds === 1 && seeds.length === 2) {
      // a 2-team "bracket" is just the final — finals counted above
    }
    const lastPairs = roundPairings(plan, plan.rounds, rules.reseed, adv);
    const fin = lastPairs?.[0];
    if (fin) {
      const w = fin.home !== null && fin.away !== null ? adv.get(advKey(plan.rounds, fin.slot)) : fin.home ?? fin.away;
      if (w !== undefined && w !== null) {
        const ti = seeds[w - 1];
        if (ti !== undefined) champ[ti]++;
      }
    }
  }

  const odds: TeamOdds[] = ids.map((id, i) => {
    const made = playoffs[i];
    let seedSum = 0;
    for (let k = 0; k < N; k++) seedSum += (k + 1) * seedCount[i][k];
    const l = lev[i];
    const leverage = levWeekIdx >= 0 && l[1] > 0 && l[3] > 0 ? l[0] / l[1] - l[2] / l[3] : null;
    return {
      teamId: id,
      playoffPct: made / sims,
      byePct: bye[i] / sims,
      divisionPct: fixedSeeds ? 0 : divWin[i] / sims,
      finalsPct: finals[i] / sims,
      champPct: champ[i] / sims,
      seedDist: Array.from(seedCount[i].slice(0, N), (c) => c / sims),
      avgSeed: made > 0 ? seedSum / made : null,
      projWins: sumW[i] / sims,
      projLosses: sumL[i] / sims,
      projTies: sumT[i] / sims,
      projPF: sumPF[i] / sims,
      leverage,
      firstPct: fixedSeeds ? 0 : first[i] / sims,
      lastPct: fixedSeeds ? 0 : last[i] / sims,
    };
  });
  return { simulations: sims, seed: input.seed, playoffTeams: N, byes, odds, elapsedMs: Date.now() - t0 };
}

/** τ by week (persistent team-strength error shrinks as the season goes on; §6.2 defaults). */
export function defaultTau(week: number): number {
  if (week <= 6) return 8;
  if (week <= 11) return 7;
  return 6;
}

/** League-wide weekly common shock SD (§4.5: 9.4–9.8). */
export const COMMON_SHOCK_SD = 9.5;

/** Rank teams and seed them exactly as one simulated season would (used to verify parity with the standings). */
export function rankAndSeed(teams: SimTeam[], h2h: SimInput["h2h"], rules: Omit<SimRules, "roundWeeks" | "medianGame" | "highScoreBonus" | "reseed">): { order: string[]; seeds: string[]; divisionWinners: string[] } {
  const s = rankStateFrom(teams, h2h);
  const divChain = rules.divisionTiebreakers?.length ? rules.divisionTiebreakers : rules.tiebreakers;
  const { order, winners } = rankSeason(s, rules.tiebreakers, divChain);
  const seeds = seedsFromOrder(order, s, { ...rules, playoffTeams: Math.min(rules.playoffTeams, s.n) }, winners);
  return { order: order.map((i) => s.ids[i]!), seeds: seeds.map((i) => s.ids[i]!), divisionWinners: winners.map((i) => s.ids[i]!) };
}
