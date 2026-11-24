// Pure waiver / FAB award engine (no database access — safe for tests and the client).
//
// Rules implemented (documented on /waivers):
//  • FAB (blind bidding): the highest valid bid for a player wins. Equal bids are broken by
//    settings.waivers.tiebreaker (PRIORITY → current waiver order, WORST_RECORD → reverse standings,
//    EARLIEST_CLAIM → claim time), then waiver order, then claim time.
//  • PRIORITY / FREE_FOR_ALL: the claiming team highest in the waiver order wins; the winner moves to the
//    back of the order (rolling) for the rest of the run.
//  • Each team's own claim order is respected: a team's claim is only awarded once every claim it ranked
//    higher is resolved or currently losing to another team. Earlier wins spend FAB, use the declared drop
//    player and fill roster spots, which can make later claims invalid.
//  • Every claim is validated at the moment it is processed: FAB balance ≥ bid, roster room after the drop,
//    cap space for the signing salary, drop player still rostered (and not in a locked lineup), acquisition
//    limits and the player still being available. A claim short only of cap space or a position spot waits
//    while another of the team's claims (with a drop) could still win and make room.
import { deadMoneyCharges, isPreseasonPhase } from "@/lib/roster-rules";
import type { LeagueSettings } from "@/lib/settings/schema";

export type WaiverMode = "FAB" | "PRIORITY";

export interface EngineRosterPlayer {
  playerId: string;
  name: string;
  position: string; // fantasy position (normalized)
  status: string; // ACTIVE | IR | TAXI
  /** salary currently counted against the cap */
  capHit: number;
  /** current-season dead money created if this player is dropped */
  deadIfDropped: number;
}

export interface EngineTeam {
  id: string;
  name: string;
  faab: number;
  /** cap committed this season incl. dead money */
  committed: number;
  roster: EngineRosterPlayer[];
  acquisitionsWeek: number;
  acquisitionsSeason: number;
}

export interface EngineClaim {
  id: string;
  teamId: string;
  playerId: string;
  playerName: string;
  position: string; // fantasy position of the player being claimed
  dropPlayerId: string | null;
  bid: number;
  /** team's own ordering (1 = most wanted) */
  priority: number;
  createdAt: Date;
}

export interface EngineRules {
  mode: WaiverMode;
  tiebreaker: "PRIORITY" | "WORST_RECORD" | "EARLIEST_CLAIM";
  minBid: number;
  maxActiveRoster: number;
  positionMax: Record<string, number | null>;
  capEnforced: boolean;
  cap: number;
  maxPerWeek: number | null;
  maxPerSeason: number | null;
  /** salary a winning bid signs for */
  salaryForBid: (bid: number) => number;
  /** most claims one team can win in a single run (null = no limit) */
  maxWonPerRun?: number | null;
  /** players that can't be dropped (commissioner list) */
  undroppable?: string[];
  /** winners move to the back of the order (rolling); false freezes the order during the run */
  rotate?: boolean;
  /** include the winning bid in losing teams' notes */
  revealWinningBid?: boolean;
}

export interface WaiverRunInput {
  rules: EngineRules;
  teams: EngineTeam[];
  claims: EngineClaim[];
  /** waiver order at the start of the run: team ids, first = highest priority */
  priorityOrder: string[];
  /** team ids worst record → best (WORST_RECORD tiebreaker) */
  recordOrder?: string[];
  /** every player currently on a roster in the league */
  rosteredPlayerIds: Iterable<string>;
  /** rostered players that can't be dropped right now (locked lineup) */
  lockedPlayerIds?: Iterable<string>;
  /** teams that can't win claims this run → reason (e.g. eliminated from the playoffs) */
  blockedTeams?: Map<string, string>;
  /** players that can't be claimed this run → reason (e.g. held for the auction pool) */
  blockedPlayers?: Map<string, string>;
}

export type ClaimOutcome = "WON" | "LOST" | "INVALID";

export interface ClaimResult {
  claimId: string;
  status: ClaimOutcome;
  note: string;
}

export interface AwardDecision {
  kind: "award";
  claimId: string;
  teamId: string;
  playerId: string;
  dropPlayerId: string | null;
  bid: number;
  salary: number;
  /** another claim tied the winning bid and the tiebreaker decided it */
  decidedByTiebreak: boolean;
  /** competing claims that lose to this award (INVALID when the claim couldn't be processed at that moment) */
  losers: { claimId: string; teamId: string; bid: number; status: "LOST" | "INVALID"; note: string }[];
}

export interface InvalidDecision {
  kind: "invalid";
  claimId: string;
  reason: string;
}

export type WaiverDecision = AwardDecision | InvalidDecision;

interface TeamState extends EngineTeam {
  rosterMap: Map<string, EngineRosterPlayer>;
  active: number;
  positions: Map<string, number>;
  /** drop players already used by this team's won claims: playerId → claimed player name */
  droppedFor: Map<string, string>;
  wonThisRun: number;
}

export interface WaiverRunState {
  rules: EngineRules;
  teams: Map<string, TeamState>;
  claims: EngineClaim[];
  pending: Set<string>;
  results: Map<string, ClaimResult>;
  order: string[];
  recordRank: Map<string, number>;
  rostered: Set<string>;
  locked: Set<string>;
  undroppable: Set<string>;
  blocked: Map<string, string>;
  blockedPlayers: Map<string, string>;
  awards: AwardDecision[];
  /** player id → team that won him in this run */
  wonBy: Map<string, string>;
}

// ───────────────────────────── Settings → rules ─────────────────────────────

/** Salary a waiver signing carries (mirrors the claim dialog on the players page). */
export function waiverSigningSalary(settings: LeagueSettings, bid: number): number {
  const min = settings.salaryCap.minSalary;
  let s = settings.waivers.salaryEqualsBid && settings.waivers.type === "FAB" ? Math.round(bid * (settings.waivers.salaryMultiplier || 1)) : min;
  s = Math.max(min, s);
  if (settings.salaryCap.maxSalary !== null && settings.salaryCap.maxSalary !== undefined) s = Math.min(settings.salaryCap.maxSalary, s);
  return s;
}

/** Contract years for a waiver signing */
export function waiverContractYears(settings: LeagueSettings): number {
  if (!settings.contracts.enabled) return 1;
  const y = settings.waivers.signedContractYears || settings.contracts.defaultFreeAgentYears || 1;
  return Math.max(Math.max(1, settings.contracts.minYears), Math.min(settings.contracts.maxYears, y));
}

/** Lowest legal FAB bid */
export function waiverMinBid(settings: LeagueSettings): number {
  return settings.waivers.allowZeroBids ? Math.max(0, settings.waivers.minBid) : Math.max(1, settings.waivers.minBid);
}

/** Current-season dead money created by releasing a contract (the shared formula dropPlayerFromTeam uses). */
export function currentSeasonDeadMoney(spot: { salary: number; isRookieContract?: boolean }, settings: LeagueSettings, week: number, phase?: string | null): number {
  return deadMoneyCharges({ ...spot, contractYears: 1 }, settings, 0, week, { preseason: isPreseasonPhase(phase) })[0]?.amount ?? 0;
}

export function waiverMode(settings: LeagueSettings): WaiverMode {
  return settings.waivers.type === "FAB" ? "FAB" : "PRIORITY";
}

export function rulesFromSettings(settings: LeagueSettings, opts: { rotate?: boolean } = {}): EngineRules {
  const positionMax: Record<string, number | null> = {};
  for (const [pos, lim] of Object.entries(settings.roster.positionLimits ?? {})) positionMax[pos] = lim?.max ?? null;
  return {
    mode: waiverMode(settings),
    tiebreaker: settings.waivers.tiebreaker,
    minBid: settings.waivers.type === "FAB" ? waiverMinBid(settings) : 0,
    maxActiveRoster: settings.roster.maxActiveRoster,
    positionMax,
    capEnforced: settings.salaryCap.enabled && settings.salaryCap.enforceInSeason,
    cap: settings.salaryCap.cap,
    maxPerWeek: settings.waivers.maxAcquisitionsPerWeek ?? null,
    maxPerSeason: settings.waivers.maxAcquisitionsPerSeason ?? null,
    salaryForBid: (bid) => waiverSigningSalary(settings, bid),
    maxWonPerRun: settings.waivers.maxClaimsWonPerRun ?? null,
    undroppable: settings.waivers.undroppablePlayerIds ?? [],
    rotate: opts.rotate ?? true,
    revealWinningBid: (settings.waivers.revealBids ?? "ALL_BIDS") !== "NONE",
  };
}

/** May a viewer see a processed claim's bid? (settings.waivers.revealBids; own bids and the commissioner always) */
export function bidVisible(settings: LeagueSettings, claim: { teamId: string; won: boolean }, viewer: { teamId: string | null; isCommish: boolean }): boolean {
  if (viewer.isCommish || (viewer.teamId && viewer.teamId === claim.teamId)) return true;
  const mode = settings.waivers.revealBids ?? "ALL_BIDS";
  if (mode === "ALL_BIDS") return true;
  if (mode === "WINNING_ONLY") return claim.won;
  return false;
}

export const TIEBREAKER_LABEL: Record<EngineRules["tiebreaker"], string> = {
  PRIORITY: "waiver priority",
  WORST_RECORD: "worse record",
  EARLIEST_CLAIM: "earlier claim",
};

// ───────────────────────────── Engine ─────────────────────────────

export function createWaiverRun(input: WaiverRunInput): WaiverRunState {
  const teams = new Map<string, TeamState>();
  for (const t of input.teams) {
    const rosterMap = new Map(t.roster.map((r) => [r.playerId, { ...r }]));
    const positions = new Map<string, number>();
    let active = 0;
    for (const r of t.roster) {
      if (r.status !== "IR" && r.status !== "TAXI") active++;
      positions.set(r.position, (positions.get(r.position) ?? 0) + 1);
    }
    teams.set(t.id, { ...t, roster: [...t.roster], rosterMap, active, positions, droppedFor: new Map(), wonThisRun: 0 });
  }
  // waiver order: given order first, then any team missing from it (stable)
  const order = [...new Set([...input.priorityOrder.filter((id) => teams.has(id)), ...input.teams.map((t) => t.id)])];
  const recordRank = new Map<string, number>();
  (input.recordOrder ?? order).forEach((id, i) => recordRank.set(id, i));
  const claims = input.claims.filter((c) => teams.has(c.teamId)).map((c) => ({ ...c, bid: input.rules.mode === "FAB" ? c.bid : 0 }));
  return {
    rules: input.rules,
    teams,
    claims,
    pending: new Set(claims.map((c) => c.id)),
    results: new Map(),
    order,
    recordRank,
    rostered: new Set(input.rosteredPlayerIds),
    locked: new Set(input.lockedPlayerIds ?? []),
    undroppable: new Set(input.rules.undroppable ?? []),
    blocked: input.blockedTeams ?? new Map(),
    blockedPlayers: input.blockedPlayers ?? new Map(),
    awards: [],
    wonBy: new Map(),
  };
}

function orderIndex(state: WaiverRunState, teamId: string): number {
  const i = state.order.indexOf(teamId);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Negative when claim a beats claim b for the same player. */
export function compareClaims(state: WaiverRunState, a: EngineClaim, b: EngineClaim): number {
  const { rules } = state;
  if (rules.mode === "FAB") {
    if (a.bid !== b.bid) return b.bid - a.bid;
    if (rules.tiebreaker === "WORST_RECORD") {
      const d = (state.recordRank.get(a.teamId) ?? 999) - (state.recordRank.get(b.teamId) ?? 999);
      if (d) return d;
    } else if (rules.tiebreaker === "EARLIEST_CLAIM") {
      const d = a.createdAt.getTime() - b.createdAt.getTime();
      if (d) return d;
    }
  }
  const p = orderIndex(state, a.teamId) - orderIndex(state, b.teamId);
  if (p) return p;
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  if (t) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function teamClaimOrder(a: EngineClaim, b: EngineClaim): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  if (t) return t;
  return a.id < b.id ? -1 : 1;
}

/** A reason a claim can't be processed right now. `fixable` problems (cap space, a position limit) can go away
 * when another of the team's claims wins first and releases its drop player. */
export interface ClaimCheck {
  reason: string;
  fixable: boolean;
}

/** Why a pending claim can't be processed right now (null = valid). */
export function claimCheck(state: WaiverRunState, claim: EngineClaim): ClaimCheck | null {
  const hard = (reason: string): ClaimCheck => ({ reason, fixable: false });
  const team = state.teams.get(claim.teamId);
  if (!team) return hard("Team not found.");
  const { rules } = state;
  const blocked = state.blocked.get(claim.teamId);
  if (blocked) return hard(blocked);
  const playerBlocked = state.blockedPlayers.get(claim.playerId);
  if (playerBlocked) return hard(playerBlocked);
  if (team.rosterMap.has(claim.playerId)) return hard(`${claim.playerName} is already on your roster.`);
  if (state.rostered.has(claim.playerId)) return hard(`${claim.playerName} is no longer available.`);
  if (rules.mode === "FAB") {
    if (claim.bid < rules.minBid) return hard(`Bid below the league minimum of $${rules.minBid}.`);
    if (claim.bid > team.faab) return hard(`Not enough FAB: $${team.faab} left for a $${claim.bid} bid.`);
  }
  if (rules.maxPerWeek !== null && team.acquisitionsWeek >= rules.maxPerWeek) return hard(`Weekly acquisition limit reached (${team.acquisitionsWeek}/${rules.maxPerWeek}).`);
  if (rules.maxPerSeason !== null && team.acquisitionsSeason >= rules.maxPerSeason) return hard(`Season acquisition limit reached (${team.acquisitionsSeason}/${rules.maxPerSeason}).`);
  if (rules.maxWonPerRun !== null && rules.maxWonPerRun !== undefined && team.wonThisRun >= rules.maxWonPerRun)
    return hard(`You already won the maximum of ${rules.maxWonPerRun} claim${rules.maxWonPerRun === 1 ? "" : "s"} in this run.`);

  let drop: EngineRosterPlayer | null = null;
  if (claim.dropPlayerId) {
    drop = team.rosterMap.get(claim.dropPlayerId) ?? null;
    if (!drop) {
      const usedFor = team.droppedFor.get(claim.dropPlayerId);
      return hard(usedFor ? `Your drop player was already released for your claim on ${usedFor}.` : "Your drop player is no longer on your roster.");
    }
    if (state.locked.has(drop.playerId)) return hard(`${drop.name} is in a locked lineup and can't be dropped.`);
    if (state.undroppable.has(drop.playerId)) return hard(`${drop.name} is on the league's undroppable list.`);
  }
  const activeAfter = team.active - (drop && drop.status !== "IR" && drop.status !== "TAXI" ? 1 : 0) + 1;
  if (activeAfter > rules.maxActiveRoster && activeAfter > team.active) return hard(`Roster full (${team.active}/${rules.maxActiveRoster} active) — add a drop player to this claim.`);
  const max = rules.positionMax[claim.position];
  if (max !== null && max !== undefined) {
    const now = team.positions.get(claim.position) ?? 0;
    const after = now + 1 - (drop && drop.position === claim.position ? 1 : 0);
    if (after > max && after > now) return { reason: `Too many ${claim.position}s (max ${max}).`, fixable: true };
  }
  if (rules.capEnforced) {
    const salary = rules.salaryForBid(claim.bid);
    const after = team.committed + salary - (drop ? drop.capHit - drop.deadIfDropped : 0);
    if (after > rules.cap && after > team.committed) return { reason: `Signing for $${salary} would put you at $${after}, over the $${rules.cap} cap.`, fixable: true };
  }
  return null;
}

/** Why a pending claim can't be processed right now (null = valid). */
export function claimProblem(state: WaiverRunState, claim: EngineClaim): string | null {
  return claimCheck(state, claim)?.reason ?? null;
}

function loserNote(state: WaiverRunState, winner: EngineClaim, loser: EngineClaim): string {
  const team = state.teams.get(winner.teamId)?.name ?? "another team";
  if (state.rules.mode === "FAB") {
    const reveal = state.rules.revealWinningBid !== false;
    const tb = TIEBREAKER_LABEL[state.rules.tiebreaker];
    if (loser.bid < winner.bid) return reveal ? `Outbid: $${winner.bid} by ${team}` : `Outbid by ${team}`;
    return reveal ? `Tied at $${winner.bid} — ${team} won the tiebreaker (${tb})` : `Tied — ${team} won the tiebreaker (${tb})`;
  }
  return `Claimed by ${team} (higher waiver priority)`;
}

/**
 * The next thing that happens in the run, or null when every claim is resolved.
 *
 * Claims that can't be processed are resolved as INVALID first — except a claim held back only by cap space or
 * a position limit while the same team still has a valid claim with a drop player: that claim may win first and
 * make room, so it waits. A player whose best claim is waiting isn't awarded to anyone until that claim is
 * settled; if nothing else can be awarded, the first waiting claim (team order) is invalid.
 */
export function nextDecision(state: WaiverRunState): WaiverDecision | null {
  const pending = state.claims.filter((c) => state.pending.has(c.id));
  if (!pending.length) return null;
  const checks = new Map(pending.map((c) => [c.id, claimCheck(state, c)]));
  const valid = pending.filter((c) => !checks.get(c.id));
  const canWait = (c: EngineClaim) => !!checks.get(c.id)?.fixable && valid.some((v) => v.teamId === c.teamId && v.id !== c.id && !!v.dropPlayerId);

  // 1. claims that can no longer be processed are resolved first (team order, then claim order)
  const byTeamOrder = [...pending].sort((a, b) => orderIndex(state, a.teamId) - orderIndex(state, b.teamId) || teamClaimOrder(a, b));
  for (const c of byTeamOrder) {
    const chk = checks.get(c.id);
    if (chk && !canWait(c)) return { kind: "invalid", claimId: c.id, reason: chk.reason };
  }
  const waiting = pending.filter((c) => !!checks.get(c.id));

  // 2. the leading valid claim for each player; a player a waiting claim would win is on hold
  const leaders = new Map<string, EngineClaim>();
  for (const c of valid) {
    const cur = leaders.get(c.playerId);
    if (!cur || compareClaims(state, c, cur) < 0) leaders.set(c.playerId, c);
  }
  const onHold = new Set<string>();
  for (const w of waiting) {
    const lead = leaders.get(w.playerId);
    if (!lead || compareClaims(state, w, lead) < 0) onHold.add(w.playerId);
  }
  const leaderIds = new Set([...leaders.values()].map((c) => c.id));

  // 3. each team's highest-ranked claim that is currently leading (its higher-ranked claims are all losing);
  //    a team whose top leading claim is on hold waits for it
  const byTeam = new Map<string, EngineClaim[]>();
  for (const c of valid) {
    if (!byTeam.has(c.teamId)) byTeam.set(c.teamId, []);
    byTeam.get(c.teamId)!.push(c);
  }
  const awardable: EngineClaim[] = [];
  for (const list of byTeam.values()) {
    const first = [...list].sort(teamClaimOrder).find((c) => leaderIds.has(c.id));
    if (first && !onHold.has(first.playerId)) awardable.push(first);
  }
  // 4. award the strongest of those
  awardable.sort((a, b) => compareClaims(state, a, b));
  const win = awardable[0];
  if (!win) {
    // nothing can move while claims wait for room that isn't coming: settle the first waiting claim
    const stuck = byTeamOrder.find((c) => checks.get(c.id));
    return stuck ? { kind: "invalid", claimId: stuck.id, reason: checks.get(stuck.id)!.reason } : null;
  }
  const rivals = pending.filter((c) => c.playerId === win.playerId && c.id !== win.id);
  return {
    kind: "award",
    claimId: win.id,
    teamId: win.teamId,
    playerId: win.playerId,
    dropPlayerId: win.dropPlayerId,
    bid: win.bid,
    salary: state.rules.salaryForBid(win.bid),
    decidedByTiebreak: state.rules.mode === "FAB" && rivals.some((r) => r.bid === win.bid && !checks.get(r.id)),
    losers: rivals.map((r) => {
      const chk = checks.get(r.id);
      return chk
        ? { claimId: r.id, teamId: r.teamId, bid: r.bid, status: "INVALID" as const, note: chk.reason }
        : { claimId: r.id, teamId: r.teamId, bid: r.bid, status: "LOST" as const, note: loserNote(state, win, r) };
    }),
  };
}

/** Apply a decision to the in-memory state (after it was written to the database). */
export function applyDecision(state: WaiverRunState, d: WaiverDecision): void {
  if (d.kind === "invalid") {
    state.pending.delete(d.claimId);
    state.results.set(d.claimId, { claimId: d.claimId, status: "INVALID", note: d.reason });
    return;
  }
  const claim = state.claims.find((c) => c.id === d.claimId);
  const team = state.teams.get(d.teamId);
  if (!claim || !team) return;
  state.pending.delete(d.claimId);
  state.results.set(d.claimId, { claimId: d.claimId, status: "WON", note: state.rules.mode === "FAB" ? `Won for $${d.bid}` : "Claimed" });
  for (const l of d.losers) {
    state.pending.delete(l.claimId);
    state.results.set(l.claimId, { claimId: l.claimId, status: l.status, note: l.note });
  }
  if (state.rules.mode === "FAB") team.faab -= d.bid;
  // roster: drop then add
  if (d.dropPlayerId) {
    const drop = team.rosterMap.get(d.dropPlayerId);
    if (drop) {
      team.rosterMap.delete(drop.playerId);
      team.roster = team.roster.filter((r) => r.playerId !== drop.playerId);
      if (drop.status !== "IR" && drop.status !== "TAXI") team.active--;
      team.positions.set(drop.position, (team.positions.get(drop.position) ?? 1) - 1);
      team.committed += drop.deadIfDropped - drop.capHit;
      team.droppedFor.set(drop.playerId, claim.playerName);
      state.rostered.delete(drop.playerId);
    }
  }
  const added: EngineRosterPlayer = { playerId: claim.playerId, name: claim.playerName, position: claim.position, status: "ACTIVE", capHit: d.salary, deadIfDropped: 0 };
  team.rosterMap.set(added.playerId, added);
  team.roster.push(added);
  team.active++;
  team.positions.set(claim.position, (team.positions.get(claim.position) ?? 0) + 1);
  team.committed += d.salary;
  team.acquisitionsWeek++;
  team.acquisitionsSeason++;
  team.wonThisRun++;
  state.rostered.add(claim.playerId);
  state.wonBy.set(claim.playerId, team.id);
  state.awards.push(d);
  // rolling order: priority-waiver winners (and FAB ties settled by waiver priority) go to the back
  if (state.rules.rotate !== false && (state.rules.mode === "PRIORITY" || (d.decidedByTiebreak && state.rules.tiebreaker === "PRIORITY"))) {
    state.order = [...state.order.filter((id) => id !== team.id), team.id];
  }
}

export interface WaiverRunResult {
  awards: AwardDecision[];
  results: ClaimResult[];
  /** waiver order after the run (before any weekly reset) */
  order: string[];
}

/** Resolve every claim in memory (used by tests and dry-run previews). */
export function resolveWaiverClaims(input: WaiverRunInput): WaiverRunResult {
  const state = createWaiverRun(input);
  let guard = 0;
  for (let d = nextDecision(state); d; d = nextDecision(state)) {
    applyDecision(state, d);
    if (++guard > 100_000) break;
  }
  return { awards: state.awards, results: [...state.results.values()], order: state.order };
}

// ───────────────────────────── Order helpers ─────────────────────────────

/** New priority values (1 = first) for teams in the given order. */
export function priorityValues(order: string[]): Map<string, number> {
  return new Map(order.map((id, i) => [id, i + 1]));
}

/** Reverse standings: worst record gets waiver priority #1. `standings` is best → worst. */
export function reverseStandingsOrder(standingsBestFirst: string[], allTeamIds: string[] = standingsBestFirst): string[] {
  const rev = [...standingsBestFirst].reverse();
  return [...new Set([...rev.filter((id) => allTeamIds.includes(id)), ...allTeamIds])];
}

/** Swap a claim with its neighbour in the team's ordering. Returns the new ordered id list. */
export function moveInOrder(ids: string[], id: string, dir: "up" | "down"): string[] {
  const i = ids.indexOf(id);
  if (i === -1) return ids;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// ───────────────────────────── Run grouping (results page) ─────────────────────────────

export interface RunClaimLike {
  id: string;
  status: string;
  processedAt: Date | null;
  addPlayerId: string;
  bidAmount: number;
  teamId: string;
}

/** Group processed claims into waiver runs (claims sharing a processing time within `windowMs`). */
export function groupRuns<T extends RunClaimLike>(claims: T[], windowMs = 5 * 60_000): { at: Date; claims: T[] }[] {
  const done = claims.filter((c) => c.processedAt && (c.status === "WON" || c.status === "LOST" || c.status === "INVALID"));
  done.sort((a, b) => b.processedAt!.getTime() - a.processedAt!.getTime());
  const runs: { at: Date; claims: T[] }[] = [];
  for (const c of done) {
    const last = runs[runs.length - 1];
    if (last && last.at.getTime() - c.processedAt!.getTime() <= windowMs) last.claims.push(c);
    else runs.push({ at: c.processedAt!, claims: [c] });
  }
  return runs;
}

/** Within a run, group claims by player with the winner first and the rest by bid. */
export function groupByPlayer<T extends RunClaimLike>(claims: T[]): { playerId: string; winner: T | null; others: T[] }[] {
  const m = new Map<string, T[]>();
  for (const c of claims) {
    if (!m.has(c.addPlayerId)) m.set(c.addPlayerId, []);
    m.get(c.addPlayerId)!.push(c);
  }
  const out = [...m.entries()].map(([playerId, list]) => {
    const winner = list.find((c) => c.status === "WON") ?? null;
    const others = list.filter((c) => c !== winner).sort((a, b) => b.bidAmount - a.bidAmount);
    return { playerId, winner, others };
  });
  out.sort((a, b) => (b.winner ? 1 : 0) - (a.winner ? 1 : 0) || (b.winner?.bidAmount ?? 0) - (a.winner?.bidAmount ?? 0));
  return out;
}

/** Should a waiver run happen now? (scheduled run newer than the last processed one) */
export function isRunDue(lastScheduled: Date | null, lastProcessed: Date | null): boolean {
  if (!lastScheduled) return false;
  if (!lastProcessed) return true;
  return lastScheduled.getTime() > lastProcessed.getTime();
}
