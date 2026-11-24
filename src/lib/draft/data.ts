// Shared draft data helpers (server): ADP, eligibility filters, league roster/cap snapshots, draft rules.
import type { Draft, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { capHit } from "@/lib/roster";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { median } from "@/lib/draft/logic";

const IDP_RAW = ["DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "DB", "CB", "S", "SS", "FS"];

/** Raw Player.position values that can be drafted in this league. */
export function draftablePositions(settings: LeagueSettings, opts: { includeDef?: boolean } = {}): string[] {
  const base = ["QB", "RB", "WR", "TE", "K"];
  if (opts.includeDef !== false) base.push("DEF");
  if (settings.roster.idpEnabled) base.push(...IDP_RAW);
  return base;
}

/** Raw Player.position values behind a fantasy position (IDP groups map to several). */
export function rawPositionsFor(fantasyPos: string): string[] {
  const p = fantasyPos.toUpperCase();
  if (p === "DL") return ["DL", "DE", "DT", "NT"];
  if (p === "LB") return ["LB", "ILB", "OLB", "MLB"];
  if (p === "DB") return ["DB", "CB", "S", "SS", "FS"];
  return [p];
}

/** Position filter chips for room UIs (fantasy positions present in the league's slots). */
export function positionFilters(settings: LeagueSettings, opts: { includeDef?: boolean } = {}): string[] {
  const set = new Set<string>();
  for (const s of settings.roster.slots) for (const p of s.eligible) set.add(normalizePosition(p));
  const order = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
  return order.filter((p) => set.has(p) && (opts.includeDef !== false || p !== "DEF"));
}

// ───────────────────────────── ADP ─────────────────────────────

const g = globalThis as unknown as { __cteAdp?: Map<number, { at: number; map: Map<string, number> }> };

/** Median dynasty ADP (Sleeper adp_dd_ppr) across the projection weeks of the latest season ≤ `season`. Cached 10 min. */
export async function getAdpMap(season: number): Promise<Map<string, number>> {
  g.__cteAdp ??= new Map();
  const hit = g.__cteAdp.get(season);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.map;
  const latest = await db.playerWeekProjection.findFirst({ where: { season: { lte: season } }, orderBy: { season: "desc" }, select: { season: true } });
  const map = new Map<string, number>();
  if (latest) {
    const rows = await db.playerWeekProjection.findMany({
      where: { season: latest.season, stats: { path: ["adp_dd_ppr"], lt: 999 } },
      select: { playerId: true, stats: true },
    });
    const by = new Map<string, number[]>();
    for (const r of rows) {
      const v = (r.stats as Record<string, number>).adp_dd_ppr;
      if (typeof v !== "number" || v <= 0) continue;
      const list = by.get(r.playerId) ?? [];
      list.push(v);
      by.set(r.playerId, list);
    }
    for (const [id, vals] of by) {
      const m = median(vals);
      if (m !== null) map.set(id, Math.round(m * 10) / 10);
    }
  }
  g.__cteAdp.set(season, { at: Date.now(), map });
  return map;
}

// ───────────────────────────── Eligibility ─────────────────────────────

/** Rookie-draft eligible players (not rostered in the league). */
export function rookieEligibleWhere(
  leagueId: string,
  draftSeason: number,
  settings: LeagueSettings,
  eligibility: LeagueSettings["draft"]["rookie"]["eligibility"],
): Prisma.PlayerWhereInput {
  const rookie: Prisma.PlayerWhereInput[] = [
    { rookieYear: draftSeason },
    { yearsExp: 0, active: true, OR: [{ rookieYear: null }, { rookieYear: { gte: draftSeason - 1 } }] },
  ];
  const or: Prisma.PlayerWhereInput[] = eligibility === "ROOKIES_AND_FREE_AGENTS" ? [...rookie, { active: true, team: { not: null } }] : rookie;
  return {
    position: { in: draftablePositions(settings, { includeDef: eligibility === "ROOKIES_AND_FREE_AGENTS" }) },
    OR: or,
    rosterSpots: { none: { leagueId } },
  };
}

/** Auction pool: any un-rostered, active, draftable player. */
export function auctionEligibleWhere(leagueId: string, settings: LeagueSettings): Prisma.PlayerWhereInput {
  return {
    position: { in: draftablePositions(settings) },
    active: true,
    rosterSpots: { none: { leagueId } },
  };
}

export function isRookieFor(p: { rookieYear: number | null; yearsExp: number | null }, season: number): boolean {
  return p.rookieYear === season || p.yearsExp === 0;
}

// ───────────────────────────── League roster / cap snapshot ─────────────────────────────

export interface TeamRosterSnapshot {
  teamId: string;
  active: number;
  ir: number;
  taxi: number;
  total: number;
  committed: number;
  deadMoney: number;
  capSpace: number;
  byPosition: Record<string, number>;
}

/** One pass over every roster spot + dead money in the league (no per-team queries). */
export async function leagueRosterSnapshot(leagueId: string, season: number, settings: LeagueSettings): Promise<Map<string, TeamRosterSnapshot>> {
  const [teams, spots, states] = await Promise.all([
    db.team.findMany({ where: { leagueId }, select: { id: true } }),
    db.rosterSpot.findMany({ where: { leagueId }, select: { teamId: true, status: true, salary: true, player: { select: { position: true } } } }),
    db.leaguePlayerState.findMany({ where: { leagueId, NOT: { deadCap: { equals: [] } } }, select: { deadCap: true } }),
  ]);
  const out = new Map<string, TeamRosterSnapshot>();
  for (const t of teams) out.set(t.id, { teamId: t.id, active: 0, ir: 0, taxi: 0, total: 0, committed: 0, deadMoney: 0, capSpace: settings.salaryCap.cap, byPosition: {} });
  for (const s of spots) {
    const row = out.get(s.teamId);
    if (!row) continue;
    if (s.status === "IR") row.ir++;
    else if (s.status === "TAXI") row.taxi++;
    else row.active++;
    row.total++;
    row.committed += capHit(s, settings);
    const pos = normalizePosition(s.player.position);
    row.byPosition[pos] = (row.byPosition[pos] ?? 0) + 1;
  }
  for (const st of states) {
    for (const d of (st.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) {
      const row = out.get(d.teamId);
      if (row && d.season === season) row.deadMoney += d.amount;
    }
  }
  for (const row of out.values()) row.capSpace = settings.salaryCap.cap - row.committed - row.deadMoney;
  return out;
}

// ───────────────────────────── Per-draft rules ─────────────────────────────

export interface RookieDraftRules {
  kind: "ROOKIE";
  rounds: number;
  style: "LINEAR" | "SNAKE";
  pickTimerMinutes: number;
  eligibility: LeagueSettings["draft"]["rookie"]["eligibility"];
  autopickSource: LeagueSettings["draft"]["rookie"]["autopickSource"];
  orderMethod: LeagueSettings["draft"]["rookie"]["orderMethod"];
  teamOrder: string[];
  manualOrder: boolean;
  pausedRemainingMs: number | null;
  lockedAt: string | null;
}

export interface AuctionDraftRules {
  kind: "STARTUP" | "FREE_AGENT";
  budget: number;
  minBid: number;
  bidIncrement: number;
  nominationSeconds: number;
  bidSeconds: number;
  resetSecondsOnBid: number;
  nominationOrder: LeagueSettings["draft"]["auction"]["nominationOrder"];
  maxBidRule: LeagueSettings["draft"]["auction"]["maxBidRule"];
  rosterSpotsToFill: number;
  contractYearsMode: LeagueSettings["draft"]["auction"]["contractYearsMode"];
  fixedContractYears: number;
  pausedRemainingMs: number | null;
  lockedAt: string | null;
}

type Obj = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d);

/**
 * Draft rules: league settings until the draft starts (so commissioner edits apply), then the snapshot
 * stored on Draft.settings at start (so a live draft never changes under the managers).
 */
export function rookieRules(draft: Pick<Draft, "settings">, settings: LeagueSettings): RookieDraftRules {
  const s = (draft.settings ?? {}) as Obj;
  const live = settings.draft.rookie;
  const locked = typeof s.lockedAt === "string";
  return {
    kind: "ROOKIE",
    rounds: locked ? num(s.rounds, live.rounds) : live.rounds,
    style: locked ? str(s.style, ["LINEAR", "SNAKE"] as const, live.style) : live.style,
    pickTimerMinutes: locked ? num(s.pickTimerMinutes, live.pickTimerMinutes) : live.pickTimerMinutes,
    eligibility: locked ? str(s.eligibility, ["ROOKIES_ONLY", "ROOKIES_AND_FREE_AGENTS"] as const, live.eligibility) : live.eligibility,
    autopickSource: locked ? str(s.autopickSource, ["BIG_BOARD", "LEAGUE_RANKINGS", "ADP"] as const, live.autopickSource) : live.autopickSource,
    orderMethod: str(s.orderMethod, ["REVERSE_STANDINGS", "REVERSE_MAX_PF", "LOTTERY", "REVERSE_POTENTIAL_POINTS"] as const, live.orderMethod),
    teamOrder: Array.isArray(s.teamOrder) ? (s.teamOrder as unknown[]).filter((x): x is string => typeof x === "string") : [],
    manualOrder: s.manualOrder === true,
    pausedRemainingMs: typeof s.pausedRemainingMs === "number" ? s.pausedRemainingMs : null,
    lockedAt: locked ? (s.lockedAt as string) : null,
  };
}

export function auctionRules(draft: Pick<Draft, "settings">, settings: LeagueSettings): AuctionDraftRules {
  const s = (draft.settings ?? {}) as Obj;
  const live = settings.draft.auction;
  const locked = typeof s.lockedAt === "string";
  const pick = <K extends keyof typeof live>(k: K): (typeof live)[K] => (locked && s[k] !== undefined ? (s[k] as (typeof live)[K]) : live[k]);
  return {
    kind: s.kind === "FREE_AGENT" ? "FREE_AGENT" : "STARTUP",
    budget: num(pick("budget"), live.budget),
    minBid: Math.max(0, num(pick("minBid"), live.minBid)),
    bidIncrement: Math.max(1, num(pick("bidIncrement"), live.bidIncrement)),
    nominationSeconds: Math.max(5, num(pick("nominationSeconds"), live.nominationSeconds)),
    bidSeconds: Math.max(5, num(pick("bidSeconds"), live.bidSeconds)),
    resetSecondsOnBid: Math.max(1, num(pick("resetSecondsOnBid"), live.resetSecondsOnBid)),
    nominationOrder: str(s.nominationOrder ?? live.nominationOrder, ["RANDOM", "REVERSE_STANDINGS", "CUSTOM"] as const, live.nominationOrder),
    maxBidRule: str(pick("maxBidRule"), ["BUDGET_MINUS_OPEN_SLOTS", "BUDGET"] as const, live.maxBidRule),
    rosterSpotsToFill: Math.max(1, num(pick("rosterSpotsToFill"), live.rosterSpotsToFill)),
    contractYearsMode: str(pick("contractYearsMode"), ["WINNER_CHOOSES", "FIXED"] as const, live.contractYearsMode),
    fixedContractYears: Math.max(1, num(pick("fixedContractYears"), live.fixedContractYears)),
    pausedRemainingMs: typeof s.pausedRemainingMs === "number" ? s.pausedRemainingMs : null,
    lockedAt: locked ? (s.lockedAt as string) : null,
  };
}

/** Snapshot of the league's current draft settings, written to Draft.settings when the draft starts. */
export function lockRules(draftSettings: unknown, settings: LeagueSettings, type: "ROOKIE" | "AUCTION"): Prisma.InputJsonValue {
  const s = { ...((draftSettings ?? {}) as Obj) };
  const live = type === "ROOKIE" ? settings.draft.rookie : settings.draft.auction;
  return { ...live, ...s, ...(type === "ROOKIE" ? pickRookie(settings) : pickAuction(settings, s)), lockedAt: new Date().toISOString() } as Prisma.InputJsonValue;
}

function pickRookie(settings: LeagueSettings) {
  const r = settings.draft.rookie;
  return { rounds: r.rounds, style: r.style, pickTimerMinutes: r.pickTimerMinutes, eligibility: r.eligibility, autopickSource: r.autopickSource };
}

function pickAuction(settings: LeagueSettings, s: Obj) {
  const a = settings.draft.auction;
  return {
    budget: a.budget,
    minBid: a.minBid,
    bidIncrement: a.bidIncrement,
    nominationSeconds: a.nominationSeconds,
    bidSeconds: a.bidSeconds,
    resetSecondsOnBid: a.resetSecondsOnBid,
    nominationOrder: (s.nominationOrder as string) ?? a.nominationOrder,
    maxBidRule: a.maxBidRule,
    rosterSpotsToFill: a.rosterSpotsToFill,
    contractYearsMode: a.contractYearsMode,
    fixedContractYears: a.fixedContractYears,
  };
}

/** Contract-year choices for an auction lot. */
export function auctionYearOptions(rules: AuctionDraftRules, settings: LeagueSettings): number[] {
  if (rules.contractYearsMode === "FIXED" || !settings.contracts.enabled) return [rules.fixedContractYears];
  const out: number[] = [];
  for (let y = settings.contracts.minYears; y <= settings.contracts.maxYears; y++) out.push(y);
  return out.length ? out : [rules.fixedContractYears];
}

/** Fantasy week to stamp on draft transactions (0 for off-season / future-season drafts). */
export function draftTxWeek(league: { season: number; phase: string }, draftSeason: number, currentWeek: number): number {
  if (draftSeason !== league.season) return 0;
  return league.phase === "REGULAR" || league.phase === "PLAYOFFS" ? currentWeek : 0;
}
