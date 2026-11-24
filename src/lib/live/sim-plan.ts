// Pure live-game simulation planner (demos / offseason testing).
// Builds a coherent, seeded plan for a whole NFL week: team scoring drives (TDs, FGs, XPs) assigned to
// real rostered players by their projections, plus per-player volume (carries, targets, completions).
// `simulateAt(plan, t)` returns absolute cumulative stat lines + game clocks at simulation second t,
// so every tick is reproducible and idempotent.
import type { StatMap } from "@/lib/scoring/engine";
import { normalizePosition } from "@/lib/settings/stat-catalog";

export const GAME_SECONDS = 3600;
/** Kickoff windows (Thu / Sun early / Sun late / SNF / MNF) start this many simulated seconds apart */
export const SLOT_GAP_SECONDS = 1200;

export interface SimPlayerInput {
  id: string;
  position: string;
  team: string;
  proj: StatMap | null;
}

export interface SimGameInput {
  id: string;
  homeTeam: string;
  awayTeam: string;
  spread: number | null;
  overUnder: number | null;
  startTime: string | Date;
}

/** One play: t = game second (0-3600); s = stat increments (keys ending in `_lng` are maxima) */
export interface SimPlay {
  t: number;
  p: string;
  s: StatMap;
}

export interface SimScore {
  t: number;
  team: string;
  pts: number;
  /** touchdowns put the scoring team in the red zone just before */
  td: boolean;
}

export interface SimGamePlan {
  id: string;
  homeTeam: string;
  awayTeam: string;
  /** simulation second at which this game kicks off */
  offset: number;
  scores: SimScore[];
}

export interface SimPlan {
  seed: number;
  totalSeconds: number;
  games: SimGamePlan[];
  /** playerId -> gameId */
  playerGame: Record<string, string>;
  /** DEF playerId -> final yards allowed */
  ydsAllowed: Record<string, number>;
  /** DEF playerId -> opponent NFL team (whose points it allows) */
  defOpponent: Record<string, string>;
  plays: SimPlay[];
}

export interface SimGameState {
  id: string;
  elapsed: number;
  state: "pre" | "in" | "post";
  period: number | null;
  clock: string | null;
  statusDetail: string | null;
  homeScore: number;
  awayScore: number;
  possession: string | null;
  redZone: boolean;
}

// ───────────── seeded randomness ─────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-Math.min(lambda, 30));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L && k < 60);
  return k - 1;
}

function pickWeighted<T>(rand: () => number, items: { item: T | null; w: number }[]): T | null {
  const total = items.reduce((a, x) => a + Math.max(0, x.w), 0);
  if (total <= 0) return null;
  let r = rand() * total;
  for (const x of items) {
    r -= Math.max(0, x.w);
    if (r <= 0) return x.item;
  }
  return items[items.length - 1]!.item;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Turn relative play sizes into whole yards that add up to `target` (calibrates volume to projections). */
export function scaleYards(raw: number[], target: number, floor: number): number[] {
  const total = raw.reduce((a, x) => a + x, 0);
  if (!raw.length || total <= 0) return raw.map(() => 0);
  const out = raw.map((x) => Math.max(floor, Math.round((x / total) * target)));
  // fix rounding drift on the largest play so totals match exactly
  const drift = Math.round(target) - out.reduce((a, x) => a + x, 0);
  if (drift) {
    const i = out.indexOf(Math.max(...out));
    out[i] = Math.max(floor, out[i]! + drift);
  }
  return out;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const playTime = (rand: () => number) => Math.round(20 + rand() * (GAME_SECONDS - 30));

function tdLength(rand: () => number, kind: "rush" | "pass"): number {
  const r = rand();
  if (kind === "rush") {
    if (r < 0.68) return 1 + Math.floor(rand() * 8);
    if (r < 0.92) return 9 + Math.floor(rand() * 22);
    return 31 + Math.floor(rand() * 55);
  }
  if (r < 0.45) return 1 + Math.floor(rand() * 10);
  if (r < 0.82) return 11 + Math.floor(rand() * 20);
  return 31 + Math.floor(rand() * 50);
}

function longTdFlags(prefix: "rush" | "rec" | "pass", yards: number): StatMap {
  const s: StatMap = {};
  if (yards >= 40) s[`${prefix}_td_40p`] = 1;
  if (yards >= 50) s[`${prefix}_td_50p`] = 1;
  return s;
}

function fgBucket(dist: number, made: boolean): string {
  const p = made ? "fgm" : "fgmiss";
  if (dist < 20) return `${p}_0_19`;
  if (dist < 30) return `${p}_20_29`;
  if (dist < 40) return `${p}_30_39`;
  if (dist < 50) return `${p}_40_49`;
  if (dist < 60) return `${p}_50_59`;
  return made ? "fgm_60p" : "fgmiss_50_59";
}

/** Implied team points from the betting line (home spread: negative = home favored). */
export function impliedPoints(game: Pick<SimGameInput, "spread" | "overUnder">): { home: number; away: number } {
  const ou = game.overUnder && game.overUnder > 20 ? game.overUnder : 44;
  const spread = game.spread ?? -1.5;
  return { home: ou / 2 - spread / 2, away: ou / 2 + spread / 2 };
}

/** Kickoff-window offsets: games sharing a start time kick off together; windows are staggered. */
export function slotOffsets(games: SimGameInput[]): Map<string, number> {
  const times = [...new Set(games.map((g) => new Date(g.startTime).getTime()))].sort((a, b) => a - b);
  const out = new Map<string, number>();
  for (const g of games) out.set(g.id, times.indexOf(new Date(g.startTime).getTime()) * SLOT_GAP_SECONDS);
  return out;
}

function defaultProj(pos: string): Required<Record<"rush_att" | "rush_yd" | "rush_td" | "rec_tgt" | "rec" | "rec_yd" | "rec_td", number>> {
  switch (pos) {
    case "QB":
      return { rush_att: 3, rush_yd: 14, rush_td: 0.12, rec_tgt: 0, rec: 0, rec_yd: 0, rec_td: 0 };
    case "RB":
      return { rush_att: 11, rush_yd: 46, rush_td: 0.35, rec_tgt: 3, rec: 2.3, rec_yd: 18, rec_td: 0.08 };
    case "TE":
      return { rush_att: 0, rush_yd: 0, rush_td: 0, rec_tgt: 4.5, rec: 3.2, rec_yd: 33, rec_td: 0.25 };
    default:
      return { rush_att: 0.2, rush_yd: 1, rush_td: 0.01, rec_tgt: 6, rec: 3.9, rec_yd: 48, rec_td: 0.3 };
  }
}

function projOf(p: SimPlayerInput, key: keyof ReturnType<typeof defaultProj>): number {
  const v = p.proj?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : defaultProj(normalizePosition(p.position))[key];
}

/** Build the plan for a week's games and the players to simulate. */
export function buildSimPlan(games: SimGameInput[], players: SimPlayerInput[], seed: number): SimPlan {
  const rand = mulberry32(seed);
  const offsets = slotOffsets(games);
  const plays: SimPlay[] = [];
  const playerGame: Record<string, string> = {};
  const ydsAllowed: Record<string, number> = {};
  const defOpponent: Record<string, string> = {};
  const gamePlans: SimGamePlan[] = [];
  const byTeam = new Map<string, SimPlayerInput[]>();
  for (const p of players) {
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team)!.push(p);
  }

  for (const g of games) {
    const implied = impliedPoints(g);
    const scores: SimScore[] = [];
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? g.homeTeam : g.awayTeam;
      const opp = side === "home" ? g.awayTeam : g.homeTeam;
      const pts = side === "home" ? implied.home : implied.away;
      const roster = byTeam.get(team) ?? [];
      for (const p of roster) playerGame[p.id] = g.id;
      const pos = (p: SimPlayerInput) => normalizePosition(p.position);
      const qbs = roster.filter((p) => pos(p) === "QB").sort((a, b) => num(b.proj?.pass_att) - num(a.proj?.pass_att));
      // the starter is the QB projected to throw; without projections fall back to the first one
      const qb: SimPlayerInput | null = qbs.find((q) => num(q.proj?.pass_att) >= 5) ?? (qbs.length > 0 && qbs.every((q) => !q.proj) ? qbs[0]! : null);
      const kicker = roster.find((p) => pos(p) === "K") ?? null;
      const dst = roster.find((p) => pos(p) === "DEF") ?? null;
      const receivers = roster.filter((p) => ["WR", "TE", "RB"].includes(pos(p)));
      const rushers = roster.filter((p) => pos(p) === "RB" || (qb && p.id === qb.id));

      // ── scoring drives
      const tds = poisson(rand, pts * 0.1);
      const fgs = poisson(rand, pts * 0.095);
      for (let i = 0; i < tds; i++) {
        const t = playTime(rand);
        const r = rand();
        if (r < 0.04) {
          if (dst) plays.push({ t, p: dst.id, s: rand() < 0.7 ? { def_td: 1 } : { def_st_td: 1 } });
        } else if (r < 0.42) {
          const L = tdLength(rand, "rush");
          const weights = rushers.map((p) => ({ item: p, w: Math.max(0.02, projOf(p, "rush_td")) }));
          const rusher = pickWeighted(rand, [...weights, { item: null, w: Math.max(0.2, 0.85 - weights.reduce((a, x) => a + x.w, 0)) }]);
          if (rusher) plays.push({ t, p: rusher.id, s: { rush_att: 1, rush_yd: L, rush_td: 1, rush_td_lng: L, rush_lng: L, ...longTdFlags("rush", L) } });
        } else {
          const L = tdLength(rand, "pass");
          if (qb) plays.push({ t, p: qb.id, s: { pass_att: 1, pass_cmp: 1, pass_yd: L, pass_td: 1, pass_td_lng: L, pass_lng: L, ...longTdFlags("pass", L) } });
          const weights = receivers.map((p) => ({ item: p, w: Math.max(0.03, projOf(p, "rec_td")) }));
          const rec = pickWeighted(rand, [...weights, { item: null, w: Math.max(0.3, 1.35 - weights.reduce((a, x) => a + x.w, 0)) }]);
          if (rec) plays.push({ t, p: rec.id, s: { rec_tgt: 1, rec: 1, rec_yd: L, rec_td: 1, rec_td_lng: L, rec_lng: L, ...longTdFlags("rec", L) } });
        }
        const xpGood = rand() < 0.94;
        if (kicker) plays.push({ t, p: kicker.id, s: xpGood ? { xpa: 1, xpm: 1 } : { xpa: 1, xpmiss: 1 } });
        scores.push({ t, team, pts: xpGood ? 7 : 6, td: true });
      }
      for (let i = 0; i < fgs; i++) {
        const t = playTime(rand);
        const dist = Math.round(clamp(39 + gauss(rand) * 9.5, 19, 64));
        const pMake = dist < 40 ? 0.94 : dist < 50 ? 0.82 : dist < 60 ? 0.66 : 0.45;
        const made = rand() < pMake;
        if (kicker) {
          const s: StatMap = made ? { fga: 1, fgm: 1, fgm_yds: dist, fgm_lng: dist, [fgBucket(dist, true)]: 1 } : { fga: 1, fgmiss: 1, [fgBucket(dist, false)]: 1 };
          if (made && dist >= 50) s.fgm_50p = 1;
          plays.push({ t, p: kicker.id, s });
        }
        if (made) scores.push({ t, team, pts: 3, td: false });
      }

      // ── volume (non-scoring) plays
      for (const p of roster) {
        const position = pos(p);
        const m = Math.exp(gauss(rand) * 0.35 - 0.06);
        // yards already produced by this player's scoring plays (projections include them)
        const tdYards = (key: string) => plays.filter((x) => x.p === p.id).reduce((a, x) => a + num(x.s[key]), 0);
        if (position === "QB") {
          if (!qb || p.id !== qb.id) continue; // backups dress but don't play
          const att = Math.round((num(p.proj?.pass_att) || 32) * (0.85 + 0.3 * rand()));
          const cmpRate = clamp(num(p.proj?.pass_cmp) / Math.max(1, num(p.proj?.pass_att)) || 0.64, 0.5, 0.76);
          const tdComps = plays.filter((x) => x.p === p.id && x.s.pass_td).length;
          const ints = poisson(rand, num(p.proj?.pass_int) || 0.75);
          const comps = Math.max(0, Math.round(att * cmpRate) - tdComps);
          const incs = Math.max(0, att - comps - tdComps - ints);
          // QB volume is steadier than skill players': narrower multiplier
          const target = Math.max(0, (num(p.proj?.pass_yd) || 225) * Math.exp(gauss(rand) * 0.22 - 0.02) - tdYards("pass_yd"));
          const raw = Array.from({ length: comps }, () => (rand() < 0.06 ? 25 + rand() * 40 : Math.exp(gauss(rand) * 0.6)));
          for (const y of scaleYards(raw, target, -3)) plays.push({ t: playTime(rand), p: p.id, s: { pass_att: 1, pass_cmp: 1, pass_yd: y, pass_lng: y } });
          for (let i = 0; i < incs; i++) plays.push({ t: playTime(rand), p: p.id, s: { pass_att: 1, pass_inc: 1 } });
          for (let i = 0; i < ints; i++) plays.push({ t: playTime(rand), p: p.id, s: { pass_att: 1, pass_int: 1 } });
        }
        if (position === "QB" || position === "RB" || (position === "WR" && projOf(p, "rush_att") >= 0.5)) {
          const projAtt = projOf(p, "rush_att");
          const carries = Math.round(projAtt * (0.7 + 0.6 * rand()));
          const target = Math.max(0, projOf(p, "rush_yd") * m - tdYards("rush_yd"));
          const raw = Array.from({ length: carries }, () => (rand() < 0.035 ? 15 + rand() * 45 : Math.max(0.2, 1 + gauss(rand) * 0.8)));
          const yards = scaleYards(raw, target, -4);
          for (let i = 0; i < yards.length; ) {
            const k = Math.min(yards.length - i, 1 + Math.floor(rand() * 3));
            const chunk = yards.slice(i, i + k);
            i += k;
            plays.push({ t: playTime(rand), p: p.id, s: { rush_att: k, rush_yd: chunk.reduce((a, y) => a + y, 0), rush_lng: Math.max(...chunk) } });
          }
        }
        if (position === "RB" || position === "WR" || position === "TE") {
          const tgt = Math.round(projOf(p, "rec_tgt") * (0.7 + 0.6 * rand()));
          const catchRate = clamp(projOf(p, "rec") / Math.max(0.5, projOf(p, "rec_tgt")) || 0.7, 0.4, 0.92);
          const caught = Array.from({ length: tgt }, () => rand() < catchRate);
          const target = Math.max(0, projOf(p, "rec_yd") * m - tdYards("rec_yd"));
          const raw = caught.filter(Boolean).map(() => (rand() < 0.05 ? 25 + rand() * 40 : Math.exp(gauss(rand) * 0.55)));
          const yards = scaleYards(raw, target, -2);
          let j = 0;
          for (const c of caught) {
            if (c) {
              const y = yards[j++]!;
              plays.push({ t: playTime(rand), p: p.id, s: { rec_tgt: 1, rec: 1, rec_yd: y, rec_lng: y } });
            } else plays.push({ t: playTime(rand), p: p.id, s: { rec_tgt: 1 } });
          }
        }
        if (["QB", "RB", "WR", "TE"].includes(position) && rand() < (position === "QB" ? 0.07 : 0.04)) {
          plays.push({ t: playTime(rand), p: p.id, s: { fum: 1, fum_lost: 1 } });
        }
        if (position === "DEF") {
          defOpponent[p.id] = opp;
          const oppPts = side === "home" ? implied.away : implied.home;
          ydsAllowed[p.id] = Math.round(clamp(330 * Math.sqrt(oppPts / 22) + gauss(rand) * 55, 140, 560));
          const sacks = poisson(rand, num(p.proj?.sack) || 2.4);
          const ints = poisson(rand, num(p.proj?.int) || 0.8);
          const frs = poisson(rand, num(p.proj?.fum_rec) || 0.55);
          for (let i = 0; i < sacks; i++) plays.push({ t: playTime(rand), p: p.id, s: { sack: 1 } });
          for (let i = 0; i < ints; i++) plays.push({ t: playTime(rand), p: p.id, s: { int: 1 } });
          for (let i = 0; i < frs; i++) plays.push({ t: playTime(rand), p: p.id, s: { fum_rec: 1 } });
          if (rand() < 0.02) {
            const t = playTime(rand);
            plays.push({ t, p: p.id, s: { safe: 1 } });
            scores.push({ t, team, pts: 2, td: false });
          }
        }
      }
    }
    scores.sort((a, b) => a.t - b.t);
    gamePlans.push({ id: g.id, homeTeam: g.homeTeam, awayTeam: g.awayTeam, offset: offsets.get(g.id) ?? 0, scores });
  }
  plays.sort((a, b) => a.t - b.t);
  const maxOffset = gamePlans.reduce((a, g) => Math.max(a, g.offset), 0);
  return { seed, totalSeconds: maxOffset + GAME_SECONDS, games: gamePlans, playerGame, ydsAllowed, defOpponent, plays };
}

const ORD = ["", "1st", "2nd", "3rd", "4th"];

/** Game clock / score / possession for a game plan at simulation second `simTime`. */
export function gameStateAt(g: SimGamePlan, simTime: number): SimGameState {
  const e = simTime - g.offset;
  if (e <= 0) return { id: g.id, elapsed: 0, state: "pre", period: null, clock: null, statusDetail: null, homeScore: 0, awayScore: 0, possession: null, redZone: false };
  const elapsed = Math.min(GAME_SECONDS, e);
  let homeScore = 0;
  let awayScore = 0;
  for (const s of g.scores) {
    if (s.t > elapsed) break;
    if (s.team === g.homeTeam) homeScore += s.pts;
    else awayScore += s.pts;
  }
  if (elapsed >= GAME_SECONDS) {
    return { id: g.id, elapsed, state: "post", period: 4, clock: "0:00", statusDetail: "Final", homeScore, awayScore, possession: null, redZone: false };
  }
  const period = Math.min(4, Math.floor(elapsed / 900) + 1);
  const left = period * 900 - elapsed;
  const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
  const next = g.scores.find((s) => s.t > elapsed);
  let possession: string;
  let redZone = false;
  if (next && next.t - elapsed <= 240) {
    possession = next.team;
    redZone = next.td && next.t - elapsed <= 80;
  } else possession = Math.floor(elapsed / 330) % 2 === 0 ? g.awayTeam : g.homeTeam;
  const statusDetail = elapsed === 1800 ? "Halftime" : `${clock} - ${ORD[period]}`;
  return { id: g.id, elapsed, state: "in", period, clock, statusDetail, homeScore, awayScore, possession, redZone };
}

/** Absolute cumulative stats for every simulated player whose game has kicked off by `simTime`. */
export function simulateAt(plan: SimPlan, simTime: number): { stats: Map<string, StatMap>; games: Map<string, SimGameState> } {
  const games = new Map(plan.games.map((g) => [g.id, gameStateAt(g, simTime)]));
  const stats = new Map<string, StatMap>();
  for (const [pid, gid] of Object.entries(plan.playerGame)) {
    const gs = games.get(gid);
    if (!gs || gs.state === "pre") continue;
    const s: StatMap = { gp: 1, gms_active: 1 };
    const opp = plan.defOpponent[pid];
    if (opp) {
      s.pts_allow = opp === plan.games.find((g) => g.id === gid)!.homeTeam ? gs.homeScore : gs.awayScore;
      s.yds_allow = Math.round((plan.ydsAllowed[pid] ?? 0) * Math.min(1, gs.elapsed / GAME_SECONDS));
    }
    stats.set(pid, s);
  }
  for (const play of plan.plays) {
    const gid = plan.playerGame[play.p];
    const gs = gid ? games.get(gid) : undefined;
    if (!gs || gs.state === "pre" || play.t > gs.elapsed) continue;
    const s = stats.get(play.p)!;
    for (const [k, v] of Object.entries(play.s)) {
      if (k.endsWith("_lng")) s[k] = k in s ? Math.max(s[k]!, v) : v;
      else s[k] = (s[k] ?? 0) + v;
    }
  }
  return { stats, games };
}

/** Number of ticks a plan needs at a given speed (simulated seconds per tick). */
export function totalSteps(plan: Pick<SimPlan, "totalSeconds">, secondsPerTick: number): number {
  return Math.ceil(plan.totalSeconds / Math.max(1, secondsPerTick));
}
