// Pure playoff bracket structure: seeded single-elimination plans, byes, (re)seeding, labels, weeks,
// side brackets (3rd place, consolation, toilet bowl) and final placement. Shared by the real bracket
// (bracket.ts) and the Monte Carlo simulation (sim/core.ts). No database access.
import type { LeagueSettings } from "@/lib/settings/schema";

export type BracketKind = "WINNERS" | "THIRD" | "PLACEMENT" | "CONSOLATION" | "TOILET";

/** Matchup.bracketSlot = base + slot (slots are 1-based within a round). */
export const SLOT_BASE: Record<BracketKind, number> = { WINNERS: 0, THIRD: 100, CONSOLATION: 200, TOILET: 300, PLACEMENT: 400 };

export const BRACKET_TITLES: Record<BracketKind, string> = {
  WINNERS: "Championship bracket",
  THIRD: "3rd place game",
  PLACEMENT: "Placement games",
  CONSOLATION: "Consolation bracket",
  TOILET: "Toilet Bowl",
};

export function bracketKindOf(m: { isPlayoff: boolean; isConsolation: boolean; bracketSlot: number | null }): BracketKind | null {
  if (!m.isPlayoff) return null;
  const s = m.bracketSlot ?? 0;
  if (!m.isConsolation) return "WINNERS";
  if (s >= SLOT_BASE.PLACEMENT) return "PLACEMENT";
  if (s >= SLOT_BASE.TOILET) return "TOILET";
  if (s >= SLOT_BASE.CONSOLATION) return "CONSOLATION";
  return "THIRD";
}

export function localSlot(kind: BracketKind, bracketSlot: number | null): number {
  return (bracketSlot ?? 1) - SLOT_BASE[kind];
}

export interface BracketPlan {
  /** number of teams in the bracket */
  teams: number;
  /** bracket size (next power of two) */
  size: number;
  rounds: number;
  /** first-round byes (go to the top seeds) */
  byes: number;
  /** seed at each bracket position (1-based seeds; values > teams are empty = bye) */
  positions: number[];
}

/** Standard seeded positions for a power-of-two bracket: 8 → [1,8,4,5,2,7,3,6]. */
export function seedPositions(size: number): number[] {
  let pos = [1];
  while (pos.length < size) {
    const n = pos.length * 2;
    pos = pos.flatMap((s) => [s, n + 1 - s]);
  }
  return pos;
}

export function bracketPlan(teams: number): BracketPlan {
  const n = Math.max(0, Math.floor(teams));
  if (n < 2) return { teams: n, size: n, rounds: 0, byes: 0, positions: n === 1 ? [1] : [] };
  let size = 1;
  while (size < n) size *= 2;
  return { teams: n, size, rounds: Math.round(Math.log2(size)), byes: size - n, positions: seedPositions(size) };
}

export interface Pairing {
  slot: number;
  /** local seeds; null = empty (bye) */
  home: number | null;
  away: number | null;
}

const key = (round: number, slot: number) => `${round}:${slot}`;
export const advKey = key;

/**
 * Pairings for a round. `advancers` maps "round:slot" → the local seed that advanced from that game
 * (winner, or loser for a losers-advance bracket). Returns null when an earlier game is undecided.
 * Round 1 includes bye pairings (one side null). With reseed, later rounds pair best remaining seed vs worst.
 */
export function roundPairings(plan: BracketPlan, round: number, reseed: boolean, advancers: ReadonlyMap<string, number>): Pairing[] | null {
  if (round < 1 || round > plan.rounds) return null;
  if (round === 1) {
    const out: Pairing[] = [];
    for (let s = 1; s <= plan.size / 2; s++) {
      const a = plan.positions[2 * s - 2]!;
      const b = plan.positions[2 * s - 1]!;
      const sa = a <= plan.teams ? a : null;
      const sb = b <= plan.teams ? b : null;
      const [home, away] = sa !== null && sb !== null ? (sa < sb ? [sa, sb] : [sb, sa]) : [sa ?? sb, null];
      out.push({ slot: s, home, away });
    }
    return out;
  }
  const prev = roundPairings(plan, round - 1, reseed, advancers);
  if (!prev) return null;
  const adv: (number | null)[] = [];
  for (const p of prev) {
    if (p.home !== null && p.away !== null) {
      const w = advancers.get(key(round - 1, p.slot));
      if (w === undefined) return null;
      adv.push(w);
    } else adv.push(p.home ?? p.away);
  }
  const out: Pairing[] = [];
  if (reseed) {
    const alive = adv.filter((x): x is number => x !== null).sort((a, b) => a - b);
    const games = plan.size / 2 ** round;
    for (let s = 1; s <= games; s++) {
      const hi = alive[s - 1] ?? null;
      const lo = alive[alive.length - s] ?? null;
      out.push(hi !== null && lo !== null && hi !== lo ? { slot: s, home: hi, away: lo } : { slot: s, home: hi ?? lo, away: null });
    }
    return out;
  }
  for (let s = 1; s <= adv.length / 2; s++) {
    const a = adv[2 * s - 2] ?? null;
    const b = adv[2 * s - 1] ?? null;
    if (a !== null && b !== null) out.push(a < b ? { slot: s, home: a, away: b } : { slot: s, home: b, away: a });
    else out.push({ slot: s, home: a ?? b, away: null });
  }
  return out;
}

/** The seed left standing after the final (null until decided). */
export function bracketWinner(plan: BracketPlan, reseed: boolean, advancers: ReadonlyMap<string, number>): number | null {
  if (plan.rounds === 0) return plan.teams === 1 ? 1 : null;
  const last = roundPairings(plan, plan.rounds, reseed, advancers);
  if (!last || !last[0]) return null;
  const g = last[0];
  if (g.home !== null && g.away !== null) return advancers.get(key(plan.rounds, g.slot)) ?? null;
  return g.home ?? g.away;
}

// ───────── Labels & weeks ─────────

export function roundLabel(kind: BracketKind, round: number, rounds: number): string {
  const fromEnd = rounds - round;
  const generic = fromEnd === 0 ? "Final" : fromEnd === 1 ? "Semifinal" : fromEnd === 2 ? "Quarterfinal" : `Round of ${2 ** (fromEnd + 1)}`;
  switch (kind) {
    case "WINNERS":
      return fromEnd === 0 ? "Championship" : generic;
    case "THIRD":
      return "3rd Place";
    case "PLACEMENT":
      return fromEnd === 0 ? "5th Place" : "Placement Semifinal";
    case "CONSOLATION":
      return `Consolation ${generic}`;
    case "TOILET":
      return fromEnd === 0 ? "Toilet Bowl" : fromEnd === 1 ? "Toilet Bowl Semifinal" : `Toilet Bowl Round ${round}`;
  }
}

/** Short column heading for a round of the championship bracket ("Quarterfinals", "Semifinals", "Championship"). */
export function roundHeading(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Championship";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round of ${2 ** (fromEnd + 1)}`;
}

export interface PlayoffSchedule {
  plan: BracketPlan;
  /** NFL weeks for each round of the championship bracket (index 0 = round 1). Multi-week rounds sum scores. */
  roundWeeks: number[][];
  firstWeek: number;
  lastWeek: number;
}

/**
 * Weeks per round follow settings.playoffs.startWeek / weeksPerRound; the championship spans
 * weeksPerRound + championshipWeeks − 1 weeks (consistent with lastFantasyWeek()).
 */
export function playoffSchedule(settings: LeagueSettings, teamCount?: number): PlayoffSchedule {
  const p = settings.playoffs;
  const n = Math.max(0, Math.min(p.teams, teamCount ?? p.teams));
  const plan = bracketPlan(n);
  const wpr = Math.max(1, p.weeksPerRound);
  const cw = Math.max(1, p.championshipWeeks);
  const roundWeeks: number[][] = [];
  for (let r = 1; r <= plan.rounds; r++) {
    const start = p.startWeek + (r - 1) * wpr;
    const len = r === plan.rounds ? wpr + cw - 1 : wpr;
    roundWeeks.push(Array.from({ length: len }, (_, i) => start + i));
  }
  const all = roundWeeks.flat();
  return { plan, roundWeeks, firstWeek: all[0] ?? p.startWeek, lastWeek: all[all.length - 1] ?? p.startWeek };
}

export function weekRangeLabel(weeks: number[]): string {
  if (!weeks.length) return "";
  return weeks.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
}

// ───────── Side brackets ─────────

export interface SideBracketPlan {
  kind: "CONSOLATION" | "TOILET";
  /** team ids in local seed order (local seed = index + 1). Consolation: best first. Toilet bowl: worst first. */
  teamIds: string[];
  plan: BracketPlan;
  /** championship-bracket round in which this bracket's round 1 is played, minus 1 */
  offset: number;
}

/**
 * Split the teams that missed the playoffs into consolation / toilet-bowl pools. `nonPlayoff` is ordered
 * best → worst (regular-season rank). When both are enabled the better half plays the consolation bracket
 * and the worse half the toilet bowl. Pools are capped so every side bracket finishes with the championship.
 */
export function sideBrackets(nonPlayoff: string[], mainRounds: number, opts: { consolation: boolean; toilet: boolean }): SideBracketPlan[] {
  if (mainRounds < 1 || nonPlayoff.length < 2) return [];
  const cap = 2 ** mainRounds;
  const out: SideBracketPlan[] = [];
  let consPool: string[] = [];
  let toiletPool: string[] = [];
  if (opts.consolation && opts.toilet) {
    const half = Math.ceil(nonPlayoff.length / 2);
    consPool = nonPlayoff.slice(0, half);
    toiletPool = nonPlayoff.slice(half);
  } else if (opts.consolation) consPool = nonPlayoff;
  else if (opts.toilet) toiletPool = nonPlayoff;
  consPool = consPool.slice(0, cap);
  toiletPool = toiletPool.slice(Math.max(0, toiletPool.length - cap));
  if (consPool.length >= 2) {
    const plan = bracketPlan(consPool.length);
    out.push({ kind: "CONSOLATION", teamIds: consPool, plan, offset: mainRounds - plan.rounds });
  }
  if (toiletPool.length >= 2) {
    const plan = bracketPlan(toiletPool.length);
    out.push({ kind: "TOILET", teamIds: [...toiletPool].reverse(), plan, offset: mainRounds - plan.rounds });
  }
  return out;
}

// ───────── Placement games (5th / 7th place) ─────────

export type PlacementGame = "FIFTH" | "SEVENTH";

export interface PlacementShape {
  /** teams in the pool: the playoff teams knocked out in the round before the semifinals (places 5..4+size) */
  size: number;
  /** placement rounds (1 or 2) */
  rounds: number;
  /** championship-bracket rounds played before placement round 1 (placement round r = global round offset + r) */
  offset: number;
  fifth: boolean;
  seventh: boolean;
}

/** Real (non-bye) games in a championship-bracket round — structural, independent of results. */
export function realGamesInRound(plan: BracketPlan, round: number): number {
  if (round < 1 || round > plan.rounds) return 0;
  return round === 1 ? plan.size / 2 - plan.byes : plan.size / 2 ** round;
}

/**
 * Placement games (settings.playoffs.placementGames) among teams eliminated in the round before the semifinals.
 * 2 teams: one 5th place game (championship week). 3 teams: a semifinal (top team has a bye) then the 5th place game.
 * 4 teams: placement semifinals, then the 5th place game (winners) and/or the 7th place game (losers).
 * The 7th place game needs a 4-team pool (8+ playoff teams). Null when there is nothing to play.
 */
export function placementShape(plan: BracketPlan, games: readonly PlacementGame[] | undefined): PlacementShape | null {
  if (!games?.length || plan.rounds < 3) return null;
  const size = realGamesInRound(plan, plan.rounds - 2);
  const fifth = games.includes("FIFTH");
  const seventh = games.includes("SEVENTH") && size >= 4;
  if (size < 2 || (!fifth && !seventh)) return null;
  if (size === 2) return fifth ? { size, rounds: 1, offset: plan.rounds - 1, fifth, seventh: false } : null;
  if (size === 3) return fifth ? { size, rounds: 2, offset: plan.rounds - 2, fifth, seventh: false } : null;
  return { size: 4, rounds: 2, offset: plan.rounds - 2, fifth, seventh };
}

/**
 * Placement pairings for a round (local seeds: 1 = best playoff seed in the pool). `advancers` maps
 * "round:slot" → winning local seed. Null while an earlier placement game is undecided.
 */
export function placementPairings(shape: PlacementShape, round: number, advancers: ReadonlyMap<string, number>): Pairing[] | null {
  if (round < 1 || round > shape.rounds) return null;
  if (round === 1) {
    if (shape.size === 2) return [{ slot: 1, home: 1, away: 2 }];
    if (shape.size === 3) return [{ slot: 1, home: 2, away: 3 }];
    return [
      { slot: 1, home: 1, away: 4 },
      { slot: 2, home: 2, away: 3 },
    ];
  }
  if (shape.size === 3) {
    const w = advancers.get(key(1, 1));
    return w === undefined ? null : [{ slot: 1, home: 1, away: w }];
  }
  const r1 = placementPairings(shape, 1, advancers)!;
  const res = r1.map((p) => {
    const w = advancers.get(key(1, p.slot));
    return w === undefined ? null : { w, l: w === p.home ? p.away! : p.home! };
  });
  if (res.some((x) => x === null)) return null;
  const [a, b] = res as { w: number; l: number }[];
  const out: Pairing[] = [];
  if (shape.fifth) out.push({ slot: 1, home: Math.min(a!.w, b!.w), away: Math.max(a!.w, b!.w) });
  if (shape.seventh) out.push({ slot: 2, home: Math.min(a!.l, b!.l), away: Math.max(a!.l, b!.l) });
  return out;
}

export function placementLabel(shape: PlacementShape, round: number, slot: number): string {
  if (round === shape.rounds) return slot === 2 ? "7th Place" : "5th Place";
  return shape.size === 3 ? "5th Place Semifinal" : "Placement Semifinal";
}

/** Pool order (local seeds, best finish first) once every placement game is decided; null before. */
export function placementOrder(shape: PlacementShape, advancers: ReadonlyMap<string, number>): number[] | null {
  const pairs = (r: number) => placementPairings(shape, r, advancers);
  const result = (r: number, p: Pairing) => {
    const w = advancers.get(key(r, p.slot));
    return w === undefined ? null : { w, l: w === p.home ? p.away! : p.home! };
  };
  if (shape.size === 2) {
    const r = result(1, pairs(1)![0]!);
    return r ? [r.w, r.l] : null;
  }
  if (shape.size === 3) {
    const semi = result(1, pairs(1)![0]!);
    const fin = pairs(2);
    if (!semi || !fin) return null;
    const f = result(2, fin[0]!);
    return f ? [f.w, f.l, semi.l] : null;
  }
  const r1 = pairs(1)!.map((p) => result(1, p));
  const r2 = pairs(2);
  if (r1.some((x) => !x) || !r2) return null;
  const winners = r1.map((x) => x!.w).sort((a, b) => a - b);
  const losers = r1.map((x) => x!.l).sort((a, b) => a - b);
  let top = winners;
  let bottom = losers;
  for (const p of r2) {
    const r = result(2, p);
    if (!r) return null;
    if (p.slot === 1) top = [r.w, r.l];
    else bottom = [r.w, r.l];
  }
  return [...top, ...bottom];
}

// ───────── Final placement ─────────

export interface PlacementInput {
  /** playoff teams in seed order */
  playoffTeams: string[];
  champion: string;
  /** championship-bracket round each non-champion playoff team was eliminated in */
  eliminatedRound: ReadonlyMap<string, number>;
  thirdPlace?: { winner: string; loser: string } | null;
  /** placement games: finishing order of the teams knocked out before the semifinals (5th, 6th, ...) */
  placement?: string[] | null;
  consolation?: { teamIds: string[]; winner: string; eliminatedRound: ReadonlyMap<string, number> } | null;
  /** toilet bowl: `last` lost the final; escapedRound = round in which each other team won its way out */
  toilet?: { teamIds: string[]; last: string; escapedRound: ReadonlyMap<string, number> } | null;
  /** regular-season rank for every team (tiebreak within a finishing group) */
  rankOf: ReadonlyMap<string, number>;
  /** every team, any order */
  allTeams: string[];
}

/** Final standings 1st..last from playoff results. */
export function finalPlacement(i: PlacementInput): string[] {
  const rank = (id: string) => i.rankOf.get(id) ?? 999;
  const seedOf = new Map(i.playoffTeams.map((id, k) => [id, k + 1]));
  const out: string[] = [i.champion];
  const done = new Set(out);
  const third = i.thirdPlace;
  const rest = i.playoffTeams.filter((id) => !done.has(id));
  // runner-up (lost in the final) first, then 3rd place game, then by elimination round, seed
  rest.sort((a, b) => (i.eliminatedRound.get(b) ?? 0) - (i.eliminatedRound.get(a) ?? 0) || (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99));
  if (i.placement?.length) {
    const inPool = new Set(i.placement.filter((id) => rest.includes(id)));
    const slots = rest.map((id, k) => (inPool.has(id) ? k : -1)).filter((k) => k >= 0);
    const ordered = i.placement.filter((id) => inPool.has(id));
    slots.forEach((pos, j) => (rest[pos] = ordered[j]!));
  }
  const maxRound = Math.max(0, ...[...i.eliminatedRound.values()]);
  for (const id of rest.filter((x) => (i.eliminatedRound.get(x) ?? 0) === maxRound)) if (!done.has(id)) (out.push(id), done.add(id));
  if (third) for (const id of [third.winner, third.loser]) if (!done.has(id)) (out.push(id), done.add(id));
  for (const id of rest) if (!done.has(id)) (out.push(id), done.add(id));

  const cons = i.consolation;
  const toilet = i.toilet;
  const toiletSet = new Set(toilet?.teamIds ?? []);
  if (cons) {
    const group = [...cons.teamIds].sort((a, b) => {
      if (a === cons.winner) return -1;
      if (b === cons.winner) return 1;
      return (cons.eliminatedRound.get(b) ?? 0) - (cons.eliminatedRound.get(a) ?? 0) || rank(a) - rank(b);
    });
    for (const id of group) if (!done.has(id)) (out.push(id), done.add(id));
  }
  const others = i.allTeams.filter((id) => !done.has(id) && !toiletSet.has(id)).sort((a, b) => rank(a) - rank(b));
  for (const id of others) (out.push(id), done.add(id));
  if (toilet) {
    const group = toilet.teamIds.filter((id) => id !== toilet.last).sort((a, b) => (toilet.escapedRound.get(a) ?? 99) - (toilet.escapedRound.get(b) ?? 99) || rank(a) - rank(b));
    for (const id of [...group, toilet.last]) if (!done.has(id)) (out.push(id), done.add(id));
  }
  for (const id of i.allTeams) if (!done.has(id)) (out.push(id), done.add(id));
  return out;
}

// ───────── Tied playoff games ─────────

export type PlayoffTiebreaker = "BENCH_POINTS" | "HIGHER_SEED" | "HIGHEST_STARTER" | "COIN_FLIP";

export interface TiedGame {
  /** stable key for the deterministic coin flip */
  key: string;
  homeTeamId: string;
  awayTeamId: string;
  homeSeed: number | null;
  awaySeed: number | null;
  /** [home, away] summed over the game's weeks, when known */
  bench?: [number, number] | null;
  highestStarter?: [number, number] | null;
}

/** Winner of a tied playoff game using settings.standings.playoffMatchupTiebreakers (in order). */
export function resolvePlayoffTie(chain: readonly PlayoffTiebreaker[], g: TiedGame, coin: (key: string) => number): string {
  for (const tb of chain) {
    if (tb === "BENCH_POINTS" && g.bench && g.bench[0] !== g.bench[1]) return g.bench[0] > g.bench[1] ? g.homeTeamId : g.awayTeamId;
    if (tb === "HIGHEST_STARTER" && g.highestStarter && g.highestStarter[0] !== g.highestStarter[1])
      return g.highestStarter[0] > g.highestStarter[1] ? g.homeTeamId : g.awayTeamId;
    if (tb === "HIGHER_SEED" && g.homeSeed !== null && g.awaySeed !== null && g.homeSeed !== g.awaySeed) return g.homeSeed < g.awaySeed ? g.homeTeamId : g.awayTeamId;
    if (tb === "COIN_FLIP") return coin(g.key) % 2 === 0 ? g.homeTeamId : g.awayTeamId;
  }
  return (g.homeSeed ?? 99) <= (g.awaySeed ?? 99) ? g.homeTeamId : g.awayTeamId;
}

/** Last place by settings.niche.lastPlaceDeterminedBy (default: toilet-bowl loser = order from finalPlacement). */
export function applyLastPlaceRule(
  order: string[],
  rule: "TOILET_BOWL_LOSER" | "REGULAR_SEASON_RECORD" | "POINTS_FOR" | undefined,
  info: { rankOf: ReadonlyMap<string, number>; pointsFor: ReadonlyMap<string, number>; playoffTeams: readonly string[] },
): string[] {
  if (!rule || rule === "TOILET_BOWL_LOSER" || order.length < 2) return order;
  const pool = order.filter((id) => !info.playoffTeams.includes(id));
  if (!pool.length) return order;
  const last =
    rule === "REGULAR_SEASON_RECORD"
      ? [...pool].sort((a, b) => (info.rankOf.get(b) ?? 0) - (info.rankOf.get(a) ?? 0))[0]!
      : [...pool].sort((a, b) => (info.pointsFor.get(a) ?? 0) - (info.pointsFor.get(b) ?? 0))[0]!;
  return [...order.filter((id) => id !== last), last];
}
