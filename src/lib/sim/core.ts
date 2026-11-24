// Monte Carlo playoff-odds engine (pure, deterministic for a given seed). No database access.
//
// Score model (docs/research/trade-value-and-sim.md §6.2):
//   score[t,w] = μ[t,w] + √q[t,w] · (u[t] + c[w] + ε[t,w])
//   u[t] ~ N(0, τ²)            persistent "our projection of this team is off" (per simulated season)
//   c[w] ~ N(0, shock²)        league-wide high/low scoring week (cancels head-to-head, matters for PF)
//   ε    ~ N(0, σ[t,w]² − shock²)
//   q    = share of the week still to be played (1 for future weeks, < 1 for live weeks)
// Standings use the league's tiebreak chain (mirrors standingsFromMatchups), seeding mirrors playoffSeeds,
// then the bracket is played out with the same score model (multi-week rounds sum their weeks).
import type { LeagueSettings } from "@/lib/settings/schema";
import { advKey, bracketPlan, roundPairings, type BracketPlan } from "@/lib/playoffs/structure";
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
  /** an extra W/L each week vs the league median */
  medianGame: boolean;
  /** weekly high score earns an extra win */
  highScoreBonus: boolean;
  /** weeks of each championship-bracket round */
  roundWeeks: number[][];
}

export interface SimInput {
  /** teams in league order (Team.createdAt asc) — keeps "coin flip" and sort stability identical to the standings */
  teams: SimTeam[];
  /** head-to-head record: key "a|b" → wins/losses of a against b (regular season, final games) */
  h2h: Record<string, { w: number; l: number }>;
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

// ───────── Ranking (mirrors standingsFromMatchups' comparator) ─────────

export interface RankState {
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
  apW: Float64Array;
  h2hW: Int32Array; // n*n wins of i over j
}

function pct(s: RankState, i: number): number {
  const g = s.W[i] + s.L[i] + s.T[i];
  return g ? (s.W[i] + s.T[i] * 0.5) / g : 0;
}

export function makeComparator(s: RankState, tiebreakers: Tiebreaker[]) {
  const p = new Float64Array(s.n);
  const refresh = () => {
    for (let i = 0; i < s.n; i++) p[i] = pct(s, i);
  };
  const cmp = (a: number, b: number): number => {
    if (p[b] !== p[a]) return p[b] - p[a];
    for (const tb of tiebreakers) {
      if (tb === "H2H") {
        const w = s.h2hW[a * s.n + b];
        const l = s.h2hW[b * s.n + a];
        if (w !== l) return l - w;
      } else if (tb === "POINTS_FOR") {
        if (s.PF[b] !== s.PF[a]) return s.PF[b] - s.PF[a];
      } else if (tb === "DIVISION_RECORD") {
        const ap = s.dW[a] + s.dL[a] ? s.dW[a] / (s.dW[a] + s.dL[a]) : 0;
        const bp = s.dW[b] + s.dL[b] ? s.dW[b] / (s.dW[b] + s.dL[b]) : 0;
        if (bp !== ap) return bp - ap;
      } else if (tb === "POINTS_AGAINST") {
        if (s.PA[a] !== s.PA[b]) return s.PA[b] - s.PA[a];
      } else if (tb === "ALL_PLAY") {
        if (s.apW[b] !== s.apW[a]) return s.apW[b] - s.apW[a];
      } else if (tb === "COIN_FLIP") {
        return s.ids[a] < s.ids[b] ? -1 : 1;
      }
    }
    return 0;
  };
  return { cmp, refresh };
}

/**
 * Playoff seeds (team indices by seed) from a ranked order — mirrors playoffSeeds() in @/lib/standings.
 * `order` is the overall standings order; division rank 1 = first team of each division in that order.
 */
export function seedsFromOrder(
  order: number[],
  s: Pick<RankState, "div" | "PF">,
  rules: Pick<SimRules, "playoffTeams" | "seeding" | "wildcardsByPoints" | "divisionWinnersTopSeeds" | "divisionWinnersQualify">,
): number[] {
  const n = rules.playoffTeams;
  const seeds: number[] = [];
  const taken = new Uint8Array(order.length > 0 ? Math.max(...order) + 1 : 0);
  if (rules.divisionWinnersTopSeeds) {
    const seen = new Set<number>();
    for (const i of order) {
      const d = s.div[i];
      if (d < 0 || seen.has(d)) continue;
      seen.add(d);
      seeds.push(i);
      taken[i] = 1;
    }
  }
  const byPoints = rules.wildcardsByPoints ?? 0;
  const recordSpots = Math.max(0, n - seeds.length - byPoints);
  let rest = order.filter((i) => !taken[i]);
  if (rules.seeding === "POINTS_FOR") rest = [...rest].sort((a, b) => s.PF[b] - s.PF[a]);
  for (const i of rest.slice(0, recordSpots)) {
    seeds.push(i);
    taken[i] = 1;
  }
  const remaining = order.filter((i) => !taken[i]).sort((a, b) => s.PF[b] - s.PF[a]);
  for (const i of remaining.slice(0, byPoints)) seeds.push(i);
  const out = seeds.slice(0, n);
  if (rules.divisionWinnersQualify && !rules.divisionWinnersTopSeeds) {
    // mirrors leagueSeeds() in @/lib/playoffs/seeding
    const winners: number[] = [];
    const seen = new Set<number>();
    for (const i of order) {
      const d = s.div[i];
      if (d < 0 || seen.has(d)) continue;
      seen.add(d);
      winners.push(i);
    }
    const missing = winners.filter((w) => !out.includes(w));
    if (missing.length) {
      for (const w of missing) {
        if (out.length >= n) {
          let idx = -1;
          for (let k = out.length - 1; k >= 0; k--) if (!winners.includes(out[k])) (idx = k), (k = -1);
          if (idx < 0) break;
          out.splice(idx, 1);
        }
        out.push(w);
      }
      if (rules.seeding === "RECORD" && !byPoints) {
        const pos = new Map(order.map((i, k) => [i, k]));
        out.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
      }
    }
  }
  return out.slice(0, n);
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

  // divisions → indices
  const divNames = [...new Set(teams.map((t) => t.division).filter((d): d is string => !!d))];
  const divIdx = new Int32Array(n);
  teams.forEach((t, i) => (divIdx[i] = t.division ? divNames.indexOf(t.division) : -1));

  // base state
  const base = {
    W: Float64Array.from(teams, (t) => t.wins),
    L: Float64Array.from(teams, (t) => t.losses),
    T: Float64Array.from(teams, (t) => t.ties),
    PF: Float64Array.from(teams, (t) => t.pointsFor),
    PA: Float64Array.from(teams, (t) => t.pointsAgainst),
    dW: Float64Array.from(teams, (t) => t.divWins),
    dL: Float64Array.from(teams, (t) => t.divLosses),
    apW: Float64Array.from(teams, (t) => t.allPlayWins),
    h2hW: new Int32Array(n * n),
  };
  for (const [k, v] of Object.entries(input.h2h)) {
    const [a, b] = k.split("|");
    const ia = idx.get(a!);
    const ib = idx.get(b!);
    if (ia === undefined || ib === undefined) continue;
    base.h2hW[ia * n + ib] = v.w;
  }
  const s: RankState = {
    n,
    ids,
    div: divIdx,
    W: new Float64Array(n),
    L: new Float64Array(n),
    T: new Float64Array(n),
    PF: new Float64Array(n),
    PA: new Float64Array(n),
    dW: new Float64Array(n),
    dL: new Float64Array(n),
    apW: new Float64Array(n),
    h2hW: new Int32Array(n * n),
  };
  const { cmp, refresh } = makeComparator(s, rules.tiebreakers);

  // schedule by week
  const weeks = [...new Set(input.games.map((g) => g.week))].sort((a, b) => a - b);
  const gamesByWeek = weeks.map((w) =>
    input.games
      .filter((g) => g.week === w)
      .map((g) => [idx.get(g.home), idx.get(g.away)] as const)
      .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined),
  );
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
  const playsAllPlay = rules.tiebreakers.includes("ALL_PLAY");

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
  const order = Array.from({ length: n }, (_, i) => i);
  const sortedScores = new Float64Array(n);

  for (let sim = 0; sim < sims; sim++) {
    s.W.set(base.W);
    s.L.set(base.L);
    s.T.set(base.T);
    s.PF.set(base.PF);
    s.PA.set(base.PA);
    s.dW.set(base.dW);
    s.dL.set(base.dL);
    s.apW.set(base.apW);
    s.h2hW.set(base.h2hW);
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
        }
      }
      if (playsAllPlay || rules.medianGame || rules.highScoreBonus) {
        sortedScores.set(scores);
        sortedScores.sort();
        if (playsAllPlay) {
          // wins in all-play = number of teams with a strictly lower score
          for (let i = 0; i < n; i++) {
            let lo = 0;
            for (let j = 0; j < n; j++) if (scores[j] < scores[i]) lo++;
            s.apW[i] += lo;
          }
        }
        if (rules.medianGame && n > 1) {
          const median = (sortedScores[Math.floor((n - 1) / 2)] + sortedScores[Math.ceil((n - 1) / 2)]) / 2;
          for (let i = 0; i < n; i++) {
            if (scores[i] > median) s.W[i]++;
            else if (scores[i] < median) s.L[i]++;
          }
        }
        if (rules.highScoreBonus && n > 0) {
          let top = 0;
          for (let i = 1; i < n; i++) if (scores[i] > scores[top]) top = i;
          s.W[top]++;
        }
      }
    }

    // standings + seeds
    let seeds: number[];
    if (fixedSeeds) seeds = fixedSeeds;
    else {
      refresh();
      for (let i = 0; i < n; i++) order[i] = i;
      order.sort(cmp);
      seeds = seedsFromOrder(order, s, rules);
      first[order[0]]++;
      last[order[n - 1]]++;
      const seenDiv = new Set<number>();
      for (const i of order) {
        const d = divIdx[i];
        if (d >= 0 && !seenDiv.has(d)) {
          seenDiv.add(d);
          divWin[i]++;
        }
      }
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
export function rankAndSeed(teams: SimTeam[], h2h: SimInput["h2h"], rules: Omit<SimRules, "roundWeeks" | "medianGame" | "highScoreBonus" | "reseed">): { order: string[]; seeds: string[] } {
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
    apW: Float64Array.from(teams, (t) => t.allPlayWins),
    h2hW: new Int32Array(n * n),
  };
  for (const [k, v] of Object.entries(h2h)) {
    const [a, b] = k.split("|");
    const ia = idx.get(a!);
    const ib = idx.get(b!);
    if (ia !== undefined && ib !== undefined) s.h2hW[ia * n + ib] = v.w;
  }
  const { cmp, refresh } = makeComparator(s, rules.tiebreakers);
  refresh();
  const order = Array.from({ length: n }, (_, i) => i).sort(cmp);
  const seeds = seedsFromOrder(order, s, { ...rules, playoffTeams: Math.min(rules.playoffTeams, n) });
  return { order: order.map((i) => ids[i]!), seeds: seeds.map((i) => ids[i]!) };
}
