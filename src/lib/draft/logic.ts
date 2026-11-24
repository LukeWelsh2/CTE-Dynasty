// Pure draft logic (no database access) shared by the rookie draft, the salary auction and the clock.
// Everything here is unit-tested in tests/draft.test.ts.
import type { LeagueSettings } from "@/lib/settings/schema";

export type RookieStyle = "LINEAR" | "SNAKE";
export type RookieOrderMethod = LeagueSettings["draft"]["rookie"]["orderMethod"];

// ───────────────────────────── Labels ─────────────────────────────

/** "1.04" */
export function roundPickLabel(round: number, pickInRound: number | null | undefined): string {
  if (!pickInRound) return `R${round}`;
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
}

// ───────────────────────────── Rookie draft order ─────────────────────────────

/** Pick number within a round for the team holding draft slot `slot` (1-based). */
export function pickInRoundFor(slot: number, round: number, teamCount: number, style: RookieStyle): number {
  if (style === "SNAKE" && round % 2 === 0) return teamCount - slot + 1;
  return slot;
}

export interface PickAssetInput {
  id: string;
  round: number;
  originalTeamId: string;
}

export interface NumberedPick {
  id: string;
  round: number;
  pickInRound: number;
  overall: number;
  originalTeamId: string;
}

/**
 * Number every pick of a draft from the slot order of the original teams (worst team first).
 * Teams missing from `teamOrder` are appended (stable, by id) so nothing is ever left unnumbered.
 */
export function assignPickNumbers(picks: PickAssetInput[], teamOrder: string[], style: RookieStyle, rounds: number): NumberedPick[] {
  const order = [...teamOrder];
  for (const id of [...new Set(picks.map((p) => p.originalTeamId))].sort()) if (!order.includes(id)) order.push(id);
  const slotOf = new Map(order.map((id, i) => [id, i + 1]));
  const n = order.length;
  const out: NumberedPick[] = [];
  for (const p of picks) {
    if (p.round < 1 || p.round > rounds) continue;
    const slot = slotOf.get(p.originalTeamId)!;
    const pickInRound = pickInRoundFor(slot, p.round, n, style);
    out.push({ id: p.id, round: p.round, pickInRound, overall: (p.round - 1) * n + pickInRound, originalTeamId: p.originalTeamId });
  }
  return out.sort((a, b) => a.overall - b.overall);
}

export interface OrderTeamInput {
  teamId: string;
  /** regular-season standings rank, 1 = best */
  rank: number;
  pointsFor: number;
  potentialPoints: number;
  madePlayoffs: boolean;
  /** final playoff finish (1 = champion) or projected finish from the seed; null for non-playoff teams */
  playoffFinish: number | null;
}

export interface OrderSlot {
  teamId: string;
  slot: number;
  group: "LOTTERY" | "NON_PLAYOFF" | "PLAYOFF" | "ALL";
  /** human readable basis, e.g. "Lottery winner (12.5%)", "Reverse PF: 1,204.3" */
  basis: string;
}

export interface ComposeOrderInput {
  teams: OrderTeamInput[];
  method: RookieOrderMethod;
  playoffTeamsByFinish: boolean;
  lotteryTeams: number;
  /** drawn lottery order (team ids, first = pick 1) when the lottery has been run */
  lotteryResult?: string[] | null;
}

const fmt1 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function metricSort(method: RookieOrderMethod) {
  return (a: OrderTeamInput, b: OrderTeamInput) => {
    if (method === "REVERSE_MAX_PF") return a.pointsFor - b.pointsFor || b.rank - a.rank;
    if (method === "REVERSE_POTENTIAL_POINTS") return a.potentialPoints - b.potentialPoints || b.rank - a.rank;
    return b.rank - a.rank; // REVERSE_STANDINGS and LOTTERY: worst record first
  };
}

function metricLabel(method: RookieOrderMethod, t: OrderTeamInput): string {
  if (method === "REVERSE_MAX_PF") return `${fmt1(t.pointsFor)} PF`;
  if (method === "REVERSE_POTENTIAL_POINTS") return `${fmt1(t.potentialPoints)} potential pts`;
  return `${ordinalRank(t.rank)} in standings`;
}

function ordinalRank(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Rookie draft slot order (pick 1 first) from season results.
 * - playoffTeamsByFinish: non-playoff teams first (by method), then playoff teams by reverse finish (champion last)
 * - LOTTERY: the worst `lotteryTeams` (reverse standings) draw for the top picks; the rest follow in reverse standings
 */
export function composeRookieOrder(input: ComposeOrderInput): OrderSlot[] {
  const { method, playoffTeamsByFinish } = input;
  const sorter = metricSort(method);
  const nonPlayoff = input.teams.filter((t) => !playoffTeamsByFinish || !t.madePlayoffs).sort(sorter);
  const playoff = playoffTeamsByFinish
    ? input.teams.filter((t) => t.madePlayoffs).sort((a, b) => (b.playoffFinish ?? 99) - (a.playoffFinish ?? 99) || b.rank - a.rank)
    : [];
  const out: OrderSlot[] = [];
  const push = (t: OrderTeamInput, group: OrderSlot["group"], basis: string) => out.push({ teamId: t.teamId, slot: out.length + 1, group, basis });

  if (method === "LOTTERY") {
    const pool = [...nonPlayoff, ...playoff];
    const drawn = input.lotteryResult?.filter((id) => pool.some((t) => t.teamId === id)) ?? null;
    let lotteryPool: OrderTeamInput[];
    if (drawn && drawn.length) {
      // an official draw is authoritative even if the standings moved afterwards
      lotteryPool = drawn.map((id) => pool.find((t) => t.teamId === id)!);
      const seeds = [...lotteryPool].sort((a, b) => pool.indexOf(a) - pool.indexOf(b));
      lotteryPool.forEach((t, i) => {
        const seed = seeds.indexOf(t) + 1;
        push(t, "LOTTERY", i + 1 === seed ? `Lottery: kept #${seed} slot` : `Lottery: ${seed > i + 1 ? "jumped" : "fell"} from #${seed}`);
      });
    } else {
      const n = Math.max(0, Math.min(input.lotteryTeams, pool.length));
      lotteryPool = pool.slice(0, n);
      lotteryPool.forEach((t, i) => push(t, "LOTTERY", `Lottery seed #${i + 1} · ${metricLabel("REVERSE_STANDINGS", t)}`));
    }
    for (const t of pool.filter((x) => !lotteryPool.includes(x))) {
      if (playoffTeamsByFinish && t.madePlayoffs) push(t, "PLAYOFF", playoffBasis(t));
      else push(t, playoffTeamsByFinish ? "NON_PLAYOFF" : "ALL", metricLabel("REVERSE_STANDINGS", t));
    }
    return out;
  }

  for (const t of nonPlayoff) push(t, playoffTeamsByFinish ? "NON_PLAYOFF" : "ALL", metricLabel(method, t));
  for (const t of playoff) push(t, "PLAYOFF", playoffBasis(t));
  return out;
}

function playoffBasis(t: OrderTeamInput): string {
  if (t.playoffFinish === 1) return "Champion";
  if (t.playoffFinish === 2) return "Runner-up";
  return t.playoffFinish ? `Playoffs · ${ordinalRank(t.playoffFinish)} place` : "Playoff team";
}

// ───────────────────────────── Lottery ─────────────────────────────

/** Odds per team (worst first). Missing odds repeat the last value; all-zero odds fall back to equal weights. */
export function normalizeOdds(teamCount: number, odds: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < teamCount; i++) out.push(Math.max(0, odds[i] ?? odds[odds.length - 1] ?? 1));
  const total = out.reduce((a, b) => a + b, 0);
  if (total <= 0) return out.map(() => 1 / Math.max(1, teamCount));
  return out.map((o) => o / total);
}

/** Weighted draw without replacement: returns the drawn order of team ids (pick 1 first). */
export function drawLottery(teamIds: string[], odds: number[], rand: () => number): string[] {
  const weights = normalizeOdds(teamIds.length, odds);
  const remaining = teamIds.map((id, i) => ({ id, w: weights[i] }));
  const out: string[] = [];
  while (remaining.length) {
    const total = remaining.reduce((a, r) => a + r.w, 0);
    let x = rand() * total;
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      x -= remaining[i].w;
      if (x < 0) {
        idx = i;
        break;
      }
    }
    if (total <= 0) idx = 0;
    out.push(remaining[idx].id);
    remaining.splice(idx, 1);
  }
  return out;
}

/** Exact probability matrix: result[i][k] = chance team i (worst first) lands pick k+1. Subset DP, fine up to ~16 teams. */
export function lotteryProbabilities(teamCount: number, odds: number[]): number[][] {
  const n = Math.min(teamCount, 16);
  const w = normalizeOdds(n, odds);
  const result = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const prob = new Float64Array(1 << n);
  prob[0] = 1;
  for (let mask = 0; mask < 1 << n; mask++) {
    const p = prob[mask];
    if (!p) continue;
    let remainingWeight = 0;
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) drawn++;
      else remainingWeight += w[i];
    }
    if (drawn === n) continue;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const q = remainingWeight > 0 ? (p * w[i]) / remainingWeight : p / (n - drawn);
      result[i][drawn] += q;
      prob[mask | (1 << i)] += q;
    }
  }
  return result;
}

/** Small deterministic PRNG (mulberry32) for reproducible lottery draws from a stored seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── Rookie picks ─────────────────────────────

/** Salary for a rookie pick from settings.contracts.rookieScale (falls back to the league minimum). */
export function rookieSalary(scale: Record<string, number[]>, round: number, pickInRound: number, minSalary: number): number {
  const v = scale[String(round)]?.[pickInRound - 1];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.max(minSalary, Math.round(v)) : minSalary;
}

/** First player id from the ordered sources that is still available. */
export function pickFromSources(sources: string[][], available: Set<string>): string | null {
  for (const list of sources) for (const id of list) if (available.has(id)) return id;
  return null;
}

/** Autopick source chain per settings.draft.rookie.autopickSource. The team's queue always comes first. */
export function autopickChain(source: LeagueSettings["draft"]["rookie"]["autopickSource"]): ("QUEUE" | "BIG_BOARD" | "LEAGUE_RANKINGS" | "ADP")[] {
  if (source === "BIG_BOARD") return ["QUEUE", "BIG_BOARD", "LEAGUE_RANKINGS", "ADP"];
  if (source === "LEAGUE_RANKINGS") return ["QUEUE", "LEAGUE_RANKINGS", "ADP"];
  return ["QUEUE", "ADP"];
}

// ───────────────────────────── Auction math ─────────────────────────────

export function openRosterSpots(input: { rosterSpotsToFill: number; wonInDraft: number; maxActiveRoster: number; activeCount: number }): number {
  return Math.max(0, Math.min(input.rosterSpotsToFill - input.wonInDraft, input.maxActiveRoster - input.activeCount));
}

export interface MaxBidInput {
  budget: number;
  spent: number;
  /** cap room (null when the salary cap is disabled) */
  capSpace: number | null;
  openSpots: number;
  minBid: number;
  rule: "BUDGET_MINUS_OPEN_SLOTS" | "BUDGET";
  maxSalary?: number | null;
}

/** remaining = min(budget − spent, cap space); maxBid reserves minBid for every other open spot. */
export function maxBidFor(input: MaxBidInput): { remaining: number; maxBid: number } {
  const auctionLeft = input.budget - input.spent;
  const remaining = Math.max(0, input.capSpace === null ? auctionLeft : Math.min(auctionLeft, input.capSpace));
  if (input.openSpots <= 0) return { remaining, maxBid: 0 };
  let maxBid = input.rule === "BUDGET_MINUS_OPEN_SLOTS" ? remaining - (input.openSpots - 1) * input.minBid : remaining;
  if (input.maxSalary !== null && input.maxSalary !== undefined && input.maxSalary > 0) maxBid = Math.min(maxBid, input.maxSalary);
  return { remaining, maxBid: Math.max(0, maxBid) };
}

export function minNextBid(currentBid: number, increment: number): number {
  return currentBid + Math.max(1, increment);
}

/** After a bid the lot closes no sooner than `resetSeconds` from now. */
export function extendEndsAt(endsAt: Date | null, now: Date, resetSeconds: number): Date {
  const floor = now.getTime() + resetSeconds * 1000;
  return new Date(Math.max(endsAt?.getTime() ?? 0, floor));
}

export interface ProxyCap {
  teamId: string;
  /** effective ceiling: min(proxy max bid, team max bid) */
  cap: number;
  /** tie-breaker: lower wins (e.g. when the proxy was set) */
  priority: number;
}

export interface ProxyResolution {
  price: number;
  leaderTeamId: string;
  bids: { teamId: string; amount: number }[];
}

/**
 * eBay-style proxy resolution. The current leader defends up to its own proxy cap; the strongest challenger
 * bids up to its cap. Returns the new price/leader and the automatic bids to record (in order).
 */
export function resolveProxyBids(input: { price: number; leaderTeamId: string; increment: number; caps: ProxyCap[] }): ProxyResolution {
  const inc = Math.max(1, input.increment);
  let price = input.price;
  let leader = input.leaderTeamId;
  const bids: { teamId: string; amount: number }[] = [];
  const capOf = (teamId: string) => input.caps.find((c) => c.teamId === teamId);
  for (let guard = 0; guard < 100; guard++) {
    const leaderCap = Math.max(price, capOf(leader)?.cap ?? price);
    const challengers = input.caps
      .filter((c) => c.teamId !== leader && c.cap >= price + inc)
      .sort((a, b) => b.cap - a.cap || a.priority - b.priority);
    const ch = challengers[0];
    if (!ch) break;
    const leaderPriority = capOf(leader)?.priority ?? -1;
    const challengerWins = ch.cap > leaderCap || (ch.cap === leaderCap && ch.priority < leaderPriority && leaderCap > price);
    if (challengerWins) {
      const newPrice = Math.min(ch.cap, Math.max(price + inc, leaderCap + inc));
      if (leaderCap > price) bids.push({ teamId: leader, amount: leaderCap });
      bids.push({ teamId: ch.teamId, amount: newPrice });
      price = newPrice;
      leader = ch.teamId;
    } else {
      // leader holds: price climbs to just above the challenger (never above the leader's cap)
      const newPrice = Math.min(leaderCap, ch.cap + inc);
      bids.push({ teamId: ch.teamId, amount: ch.cap });
      if (newPrice > price) bids.push({ teamId: leader, amount: newPrice });
      price = Math.max(price, newPrice);
      break;
    }
  }
  return { price, leaderTeamId: leader, bids };
}

/** Next team (from index `from`, wrapping) that may nominate. Returns the absolute index used. */
export function nextNominator(order: string[], from: number, canNominate: (teamId: string) => boolean): { index: number; teamId: string } | null {
  if (!order.length) return null;
  for (let k = 0; k < order.length; k++) {
    const idx = from + k;
    const teamId = order[idx % order.length];
    if (canNominate(teamId)) return { index: idx, teamId };
  }
  return null;
}

/** Largest index ≤ before whose team is `teamId` (used to hand a voided nomination back). */
export function lastIndexOfTeam(order: string[], before: number, teamId: string): number {
  for (let k = before; k >= 0; k--) if (order[k % order.length] === teamId) return k;
  return Math.max(0, before);
}

export function clampYears(years: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(years)));
}

/** Fisher–Yates shuffle with an injectable random source. */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Move an item in a list (used by queue / board reordering). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const a = [...list];
  if (from < 0 || from >= a.length) return a;
  const [x] = a.splice(from, 1);
  a.splice(Math.max(0, Math.min(a.length, to)), 0, x);
  return a;
}
