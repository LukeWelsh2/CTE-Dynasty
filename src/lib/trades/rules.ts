// Pure trade rules: trade window, asset ownership, cooldowns, post-trade roster limits and cap compliance.
// No database access (unit-tested in tests/trades.test.ts); src/lib/trades/validate.ts loads the snapshot.
import type { LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { ordinal } from "@/lib/utils";

export type AssetType = "PLAYER" | "PICK" | "FAAB";

export interface AssetRef {
  type: AssetType;
  playerId?: string | null;
  pickId?: string | null;
  faabAmount?: number | null;
  fromTeamId: string;
  toTeamId: string;
}

export interface TradeInput {
  teamIds: string[];
  assets: AssetRef[];
  /** players each team drops on completion to make room */
  drops: Record<string, string[]>;
}

export const OPEN_STATUSES = ["PROPOSED", "ACCEPTED"] as const;
export const FINAL_STATUSES = ["COMPLETED", "VETOED", "REVERSED"] as const;
export const OFFSEASON_PHASES = ["OFFSEASON", "KEEPER"];

export function assetKey(a: Pick<AssetRef, "type" | "playerId" | "pickId" | "fromTeamId">): string {
  if (a.type === "PLAYER") return `P:${a.playerId}`;
  if (a.type === "PICK") return `K:${a.pickId}`;
  return `F:${a.fromTeamId}`;
}

// ───────────────────────────── Trade window ─────────────────────────────

export interface TradeWindow {
  open: boolean;
  reason: string | null;
  /** informational note, e.g. "Trade deadline: end of week 11 (this week)" */
  note: string | null;
}

export function tradeWindow(settings: LeagueSettings, phase: string, week: number): TradeWindow {
  const t = settings.trades;
  if (!t.enabled) return { open: false, reason: "Trading is disabled in this league.", note: null };
  if (phase === "PLAYOFFS") {
    if (!t.allowDuringPlayoffs) return { open: false, reason: "Trades are closed during the playoffs.", note: null };
    if (settings.playoffs.lockRostersInPlayoffs) return { open: false, reason: "Rosters are locked for the playoffs.", note: null };
    return { open: true, reason: null, note: "Playoff trading is allowed." };
  }
  if (OFFSEASON_PHASES.includes(phase)) {
    if (!t.allowOffseasonTrades) return { open: false, reason: "Offseason trading is closed until the new season.", note: null };
    return { open: true, reason: null, note: "Offseason trading window is open." };
  }
  if (phase === "REGULAR" && t.deadlineWeek !== null && t.deadlineWeek !== undefined) {
    if (week > t.deadlineWeek) return { open: false, reason: `The trade deadline (end of week ${t.deadlineWeek}) has passed.`, note: null };
    const left = t.deadlineWeek - week;
    return { open: true, reason: null, note: left === 0 ? `Trade deadline: end of this week (week ${t.deadlineWeek}).` : `Trade deadline: end of week ${t.deadlineWeek} (${left} week${left === 1 ? "" : "s"} left).` };
  }
  return { open: true, reason: null, note: null };
}

/** Rookie pick seasons that can be traded: [first open draft, first + futurePickYears) */
export function tradablePickSeasons(settings: LeagueSettings, nextDraftSeason: number): number[] {
  return Array.from({ length: Math.max(0, settings.trades.futurePickYears) }, (_, i) => nextDraftSeason + i);
}

export function faabTradingAllowed(settings: LeagueSettings): boolean {
  return settings.trades.allowFaabTrading && settings.waivers.faabTradable && settings.waivers.type === "FAB";
}

export function maxTeams(settings: LeagueSettings): number {
  return settings.trades.allowMultiTeamTrades ? Math.max(2, settings.trades.maxTeamsPerTrade) : 2;
}

// ───────────────────────────── Labels ─────────────────────────────

export function pickAssetLabel(
  pick: { season: number; round: number; pickInRound: number | null; originalTeamId: string },
  fromTeamId: string | null,
  teamName: (id: string) => string,
): string {
  const base = pick.pickInRound ? `${pick.season} ${pick.round}.${String(pick.pickInRound).padStart(2, "0")}` : `${pick.season} ${ordinal(pick.round)}`;
  if (fromTeamId && pick.originalTeamId !== fromTeamId) return `${base} (via ${teamName(pick.originalTeamId)})`;
  return `${base} (${teamName(pick.originalTeamId)})`;
}

export function faabLabel(amount: number): string {
  return `$${amount} FAB`;
}

/** "received A, B; sent C" per team, for Transaction rows and chat posts */
export function tradeSummaryFor(teamId: string, assets: { fromTeamId: string; toTeamId: string; label: string }[]): { received: string[]; sent: string[] } {
  return {
    received: assets.filter((a) => a.toTeamId === teamId).map((a) => a.label),
    sent: assets.filter((a) => a.fromTeamId === teamId).map((a) => a.label),
  };
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "nothing";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ───────────────────────────── Snapshot + checks ─────────────────────────────

export interface SpotLite {
  playerId: string;
  teamId: string;
  status: string;
  salary: number;
  contractYears: number;
  isRookieContract: boolean;
  player: { fullName: string; position: string; injuryStatus: string | null; status: string | null; yearsExp: number | null };
}

export interface PickLite {
  id: string;
  season: number;
  round: number;
  pickInRound: number | null;
  ownerTeamId: string;
  originalTeamId: string;
  playerId: string | null;
}

export interface TeamLite {
  id: string;
  name: string;
  faabBalance: number;
}

export interface TradeSnapshot {
  teams: Map<string, TeamLite>;
  /** roster spots of every team in the trade */
  spots: SpotLite[];
  /** picks referenced by the trade */
  picks: Map<string, PickLite>;
  /** dead money already on the books per team: current season and next season */
  deadMoney: Map<string, { current: number; next: number }>;
  /** players moved by completed trades within the cooldown window */
  recentMoves: { playerId: string; fromTeamId: string; toTeamId: string; completedAt: Date }[];
}

export interface CheckOptions {
  settings: LeagueSettings;
  phase: string;
  week: number;
  season: number;
  nextDraftSeason: number;
  now: Date;
  checkWindow: boolean;
  /** teams whose roster/cap problems are blocking errors (others are warnings they must fix when accepting) */
  strictTeams: Set<string> | "all";
  /** skip roster limit + cap checks (commissioner force) */
  skipRosterChecks?: boolean;
}

export interface TeamImpact {
  teamId: string;
  name: string;
  capEnabled: boolean;
  cap: number;
  capBefore: number;
  capAfter: number;
  nextCap: number;
  nextBefore: number;
  nextAfter: number;
  activeBefore: number;
  activeAfter: number;
  maxActive: number;
  irBefore: number;
  irAfter: number;
  irSlots: number;
  /** extra drops still needed for roster limits */
  dropsNeeded: number;
  drops: string[];
  faabBefore: number;
  faabAfter: number;
  incoming: string[];
  outgoing: string[];
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
  impacts: TeamImpact[];
}

/** Cap hit of a roster spot (mirrors roster.capHit, pure) */
export function spotCapHit(spot: { salary: number; status: string }, settings: LeagueSettings): number {
  if (spot.status === "IR" && !settings.roster.irCountsAgainstCap) return 0;
  if (spot.status === "TAXI") {
    if (settings.roster.taxiCountsAgainstCap) return spot.salary;
    return Math.round((spot.salary * (settings.roster.taxiCapPercent ?? 0)) / 100);
  }
  return spot.salary;
}

export function salaryNextSeason(spot: { salary: number; contractYears: number }, settings: LeagueSettings): number {
  if (spot.contractYears <= 1) return 0;
  const raise = settings.contracts.annualRaisePercent ?? 0;
  return raise ? Math.round(spot.salary * (1 + raise / 100)) : spot.salary;
}

/** Dead money created by dropping a player (mirrors roster-ops.dropPlayerFromTeam) */
export function dropDeadMoney(spot: { salary: number; contractYears: number; isRookieContract: boolean }, settings: LeagueSettings, week: number): { current: number; next: number } {
  const s = settings.salaryCap;
  if (!s.enabled || !s.deadMoney.enabled) return { current: 0, next: 0 };
  if (spot.isRookieContract && s.deadMoney.rookieContractsExempt) return { current: 0, next: 0 };
  if (s.deadMoney.waivedInSeasonBeforeWeek && week < s.deadMoney.waivedInSeasonBeforeWeek) return { current: 0, next: 0 };
  if (spot.salary <= s.minSalary) return { current: 0, next: 0 };
  return {
    current: Math.round((spot.salary * s.deadMoney.currentSeasonPercent) / 100),
    next: spot.contractYears > 1 ? Math.round((spot.salary * s.deadMoney.futureSeasonPercent) / 100) : 0,
  };
}

export function checkTrade(input: TradeInput, snap: TradeSnapshot, opts: CheckOptions): CheckResult {
  const { settings: s } = opts;
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = (id: string) => snap.teams.get(id)?.name ?? "Unknown team";
  const strict = (id: string) => opts.strictTeams === "all" || opts.strictTeams.has(id);

  if (opts.checkWindow) {
    const w = tradeWindow(s, opts.phase, opts.week);
    if (!w.open) errors.push(w.reason!);
  }

  const teamIds = [...new Set(input.teamIds)];
  if (teamIds.length < 2) errors.push("Pick at least one trade partner.");
  if (teamIds.length > maxTeams(s)) errors.push(s.trades.allowMultiTeamTrades ? `Trades can include at most ${maxTeams(s)} teams.` : "Multi-team trades are not allowed in this league.");
  for (const id of teamIds) if (!snap.teams.has(id)) errors.push("One of the teams is not in this league.");
  if (!input.assets.length) errors.push("Add at least one player, pick or FAB to the trade.");

  const seen = new Set<string>();
  const faabOut = new Map<string, number>();
  const pickSeasons = tradablePickSeasons(s, opts.nextDraftSeason);
  const spotBy = new Map(snap.spots.map((sp) => [sp.playerId, sp]));
  const cooldownMs = s.trades.tradeBackCooldownDays * 864e5;

  for (const a of input.assets) {
    if (a.fromTeamId === a.toTeamId) errors.push("An asset can't be sent to the team that already owns it.");
    if (!teamIds.includes(a.fromTeamId) || !teamIds.includes(a.toTeamId)) errors.push("Every asset must move between teams in the trade.");
    const key = assetKey(a);
    if (a.type !== "FAAB" && seen.has(key)) errors.push("The same asset is included twice.");
    seen.add(key);
    if (a.type === "PLAYER") {
      const sp = a.playerId ? spotBy.get(a.playerId) : undefined;
      if (!sp) errors.push("A player in this trade is no longer on a roster.");
      else if (sp.teamId !== a.fromTeamId) errors.push(`${sp.player.fullName} is no longer on ${name(a.fromTeamId)}.`);
      else if (cooldownMs > 0) {
        const back = snap.recentMoves.find((m) => m.playerId === a.playerId && m.fromTeamId === a.toTeamId && m.toTeamId === a.fromTeamId && opts.now.getTime() - m.completedAt.getTime() < cooldownMs);
        if (back) errors.push(`${sp.player.fullName} can't be traded back to ${name(a.toTeamId)} within ${s.trades.tradeBackCooldownDays} days of being acquired from them.`);
      }
    } else if (a.type === "PICK") {
      if (!s.trades.allowDraftPickTrading) errors.push("Draft pick trading is not allowed in this league.");
      const pk = a.pickId ? snap.picks.get(a.pickId) : undefined;
      if (!pk) errors.push("A draft pick in this trade no longer exists.");
      else if (pk.ownerTeamId !== a.fromTeamId) errors.push(`${name(a.fromTeamId)} no longer owns the ${pk.season} ${ordinal(pk.round)}-round pick.`);
      else if (pk.playerId) errors.push(`The ${pk.season} ${ordinal(pk.round)}-round pick has already been used.`);
      else if (!pickSeasons.includes(pk.season)) errors.push(`Only ${pickSeasons[0]}–${pickSeasons[pickSeasons.length - 1]} picks can be traded.`);
    } else if (a.type === "FAAB") {
      if (!faabTradingAllowed(s)) errors.push("FAB can't be traded in this league.");
      const amt = Number(a.faabAmount ?? 0);
      if (!Number.isInteger(amt) || amt < 1) errors.push("FAB amounts must be whole dollars of at least $1.");
      faabOut.set(a.fromTeamId, (faabOut.get(a.fromTeamId) ?? 0) + Math.max(0, amt));
    } else errors.push("Unknown asset type.");
  }
  for (const [teamId, amt] of faabOut) {
    const bal = snap.teams.get(teamId)?.faabBalance ?? 0;
    if (amt > bal) errors.push(`${name(teamId)} only has $${bal} FAB (trade sends $${amt}).`);
  }
  for (const id of teamIds) {
    if (!input.assets.some((a) => a.fromTeamId === id || a.toTeamId === id)) errors.push(`${name(id)} isn't sending or receiving anything.`);
  }

  // post-trade rosters
  const impacts: TeamImpact[] = [];
  const nextCap = s.salaryCap.cap + (s.salaryCap.annualCapIncrease ?? 0);
  for (const teamId of teamIds) {
    const team = snap.teams.get(teamId);
    if (!team) continue;
    const before = snap.spots.filter((sp) => sp.teamId === teamId);
    const outgoing = input.assets.filter((a) => a.type === "PLAYER" && a.fromTeamId === teamId).map((a) => a.playerId!);
    const incomingSpots = input.assets
      .filter((a) => a.type === "PLAYER" && a.toTeamId === teamId)
      .map((a) => spotBy.get(a.playerId!))
      .filter((x): x is SpotLite => !!x)
      .map((sp) => ({ ...sp, teamId, status: sp.status === "TAXI" ? "ACTIVE" : sp.status }));
    const drops = [...new Set(input.drops[teamId] ?? [])];
    for (const d of drops) {
      const sp = spotBy.get(d);
      if (!sp || sp.teamId !== teamId) errors.push(`${name(teamId)} can only drop players on its own roster.`);
      else if (outgoing.includes(d)) errors.push(`${sp.player.fullName} is already being traded away.`);
    }
    const kept = before.filter((sp) => !outgoing.includes(sp.playerId) && !drops.includes(sp.playerId));
    const after = [...kept, ...incomingSpots];
    const count = (list: { status: string }[], st: string) => list.filter((x) => (st === "ACTIVE" ? x.status !== "IR" && x.status !== "TAXI" : x.status === st)).length;
    const activeBefore = count(before, "ACTIVE");
    const activeAfter = count(after, "ACTIVE");
    const irBefore = count(before, "IR");
    const irAfter = count(after, "IR");
    const taxiAfter = count(after, "TAXI");
    const dead = snap.deadMoney.get(teamId) ?? { current: 0, next: 0 };
    const dropDead = drops.reduce(
      (acc, d) => {
        const sp = spotBy.get(d);
        if (!sp) return acc;
        const dm = dropDeadMoney(sp, s, opts.week);
        return { current: acc.current + dm.current, next: acc.next + dm.next };
      },
      { current: 0, next: 0 },
    );
    const capBefore = before.reduce((a, sp) => a + spotCapHit(sp, s), 0) + dead.current;
    const capAfter = after.reduce((a, sp) => a + spotCapHit(sp, s), 0) + dead.current + dropDead.current;
    const nextBefore = before.reduce((a, sp) => a + salaryNextSeason(sp, s), 0) + dead.next;
    const nextAfter = after.reduce((a, sp) => a + salaryNextSeason(sp, s), 0) + dead.next + dropDead.next;
    const maxActive = s.roster.maxActiveRoster;
    const dropsNeeded = activeAfter > maxActive && activeAfter > activeBefore ? activeAfter - Math.max(maxActive, activeBefore) : 0;
    const fIn = input.assets.filter((a) => a.type === "FAAB" && a.toTeamId === teamId).reduce((x, a) => x + Number(a.faabAmount ?? 0), 0);
    const fOut = input.assets.filter((a) => a.type === "FAAB" && a.fromTeamId === teamId).reduce((x, a) => x + Number(a.faabAmount ?? 0), 0);
    impacts.push({
      teamId,
      name: team.name,
      capEnabled: s.salaryCap.enabled,
      cap: s.salaryCap.cap,
      capBefore,
      capAfter,
      nextCap,
      nextBefore,
      nextAfter,
      activeBefore,
      activeAfter,
      maxActive,
      irBefore,
      irAfter,
      irSlots: s.roster.irSlots,
      dropsNeeded,
      drops,
      faabBefore: team.faabBalance,
      faabAfter: team.faabBalance + fIn - fOut,
      incoming: incomingSpots.map((x) => x.playerId),
      outgoing,
    });
    if (opts.skipRosterChecks) continue;

    const problem = (msg: string, fixHint: string) => {
      if (strict(teamId)) errors.push(msg);
      else warnings.push(`${msg} ${fixHint}`);
    };
    if (dropsNeeded > 0) problem(`${team.name} would have ${activeAfter} active players (max ${maxActive}) — drop ${dropsNeeded} more.`, "They'll choose drops when accepting.");
    if (irAfter > s.roster.irSlots && irAfter > irBefore) problem(`${team.name} would have ${irAfter} players on IR (max ${s.roster.irSlots}).`, "They'll need to make room.");
    if (taxiAfter > s.roster.taxiSlots && taxiAfter > count(before, "TAXI")) problem(`${team.name} would have ${taxiAfter} taxi players (max ${s.roster.taxiSlots}).`, "");
    const posBefore = new Map<string, number>();
    const posAfter = new Map<string, number>();
    for (const sp of before) posBefore.set(normalizePosition(sp.player.position), (posBefore.get(normalizePosition(sp.player.position)) ?? 0) + 1);
    for (const sp of after) posAfter.set(normalizePosition(sp.player.position), (posAfter.get(normalizePosition(sp.player.position)) ?? 0) + 1);
    for (const [pos, lim] of Object.entries(s.roster.positionLimits)) {
      const n = posAfter.get(pos) ?? 0;
      if (lim.max !== null && lim.max !== undefined && n > lim.max && n > (posBefore.get(pos) ?? 0)) problem(`${team.name} would have ${n} ${pos}s (max ${lim.max}).`, "They'll need to drop one.");
    }
    if (s.salaryCap.enabled) {
      if (capAfter > s.salaryCap.cap && capAfter > capBefore) {
        const msg = `${team.name} would be at $${capAfter}, $${capAfter - s.salaryCap.cap} over the $${s.salaryCap.cap} cap.`;
        if (s.trades.requireCapCompliance) problem(msg, "They'll need to clear cap space when accepting.");
        else warnings.push(msg);
      }
      if (nextAfter > nextCap && nextAfter > nextBefore) warnings.push(`${team.name} would have $${nextAfter} committed for next season (cap $${nextCap}).`);
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], impacts };
}

// ───────────────────────────── Conflicts ─────────────────────────────

/** Does an open trade include an asset that has moved (players/picks) or FAB a team can no longer afford? */
export function tradeHasStaleAssets(
  assets: AssetRef[],
  state: { playerTeam: Map<string, string | null>; pickOwner: Map<string, { ownerTeamId: string; used: boolean }>; faabBalance: Map<string, number> },
): string | null {
  const faab = new Map<string, number>();
  for (const a of assets) {
    if (a.type === "PLAYER" && a.playerId) {
      if ((state.playerTeam.get(a.playerId) ?? null) !== a.fromTeamId) return "a player in the offer has changed teams";
    } else if (a.type === "PICK" && a.pickId) {
      const p = state.pickOwner.get(a.pickId);
      if (!p || p.ownerTeamId !== a.fromTeamId || p.used) return "a draft pick in the offer has changed hands";
    } else if (a.type === "FAAB") faab.set(a.fromTeamId, (faab.get(a.fromTeamId) ?? 0) + Number(a.faabAmount ?? 0));
  }
  for (const [team, amt] of faab) if ((state.faabBalance.get(team) ?? 0) < amt) return "a team no longer has enough FAB";
  return null;
}

// ───────────────────────────── Votes ─────────────────────────────

export function voteTally(votes: { vote: string }[], required: number) {
  const veto = votes.filter((v) => v.vote === "VETO").length;
  const approve = votes.filter((v) => v.vote === "APPROVE").length;
  return { veto, approve, required, vetoed: veto >= Math.max(1, required) };
}

// ───────────────────────────── Results ─────────────────────────────

/**
 * Fantasy points a received player has produced for his new team since the trade.
 * started = weeks he was in the new team's starting lineup (from `tradeWeek` on, same season, or any week of later seasons).
 */
export function pointsSinceTrade(
  weeks: { season: number; week: number; points: number; startedForTeam: boolean }[],
  trade: { season: number; week: number },
): { started: number; total: number; startedWeeks: number; weeks: number } {
  let started = 0;
  let total = 0;
  let startedWeeks = 0;
  let n = 0;
  for (const w of weeks) {
    const after = w.season > trade.season || (w.season === trade.season && w.week > trade.week);
    const tradeWeekStart = w.season === trade.season && w.week === trade.week && w.startedForTeam;
    if (!after && !tradeWeekStart) continue;
    total += w.points;
    n++;
    if (w.startedForTeam) {
      started += w.points;
      startedWeeks++;
    }
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { started: r(started), total: r(total), startedWeeks, weeks: n };
}
