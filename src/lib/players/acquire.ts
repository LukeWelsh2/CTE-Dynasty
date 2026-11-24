// Free-agent acquisition rules evaluated on the server: the quote shown in the add/claim/drop dialogs and
// the validation the server actions repeat before writing.
import "server-only";
import type { NflGame, Player, Prisma, PrismaClient, RosterSpot } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { isLocked, weekGamesByTeam } from "@/lib/lineup";
import { activeRosterLimit, capCheck, capHit, capLimitLabel, rosterChangeProblems, type CapEnforcement } from "@/lib/roster";
import { lastWaiverRun, nextWaiverRun } from "@/lib/waiver-schedule";
import {
  ACQUISITION_TX_TYPES,
  AUCTION_POOL_REASON,
  acquisitionLimitError,
  acquisitionMode,
  auctionPoolDetail,
  bidStep,
  claimUsesFab,
  deadMoneyPreview,
  effectiveInjury,
  freeAgentGameLocked,
  isUndroppable,
  minimumBid,
  pendingClaimLimitError,
  readdCooldownUntil,
  signingSalary,
  signingYears,
  type AcquisitionMode,
} from "@/lib/players/logic";
import { auctionPoolFor, eliminationStatuses, previousWeekGames, readdReason, teamAddBlockFrom, teamTradeWindow } from "@/lib/players/context";
import { latestInjuryReports } from "@/lib/players/injury-data";
import { fmtDateTime } from "@/lib/players/format";

type Tx = Prisma.TransactionClient | PrismaClient;
type SpotWithPlayer = RosterSpot & { player: Player };

export interface DropCandidate {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  status: string;
  salary: number;
  contractYears: number;
  deadMoney: { season: number; amount: number }[];
  /** salary currently counted against the cap (IR / taxi may be exempt) */
  capHit: number;
  locked: boolean;
  /** why he can't be dropped (locked lineup, undroppable list) */
  lockReason: string | null;
}

export interface PlayerQuote {
  season: number;
  player: { id: string; fullName: string; position: string; team: string | null; injuryStatus: string | null };
  hasTeam: boolean;
  owner: { teamId: string; name: string; abbrev: string; isMine: boolean; salary: number; contractYears: number; status: string } | null;
  mode: "add" | "claim" | "blocked" | "mine" | "owned";
  reason: string | null;
  processAt: string | null;
  /** processAt formatted in the league time zone */
  processAtLabel: string | null;
  fab: { enabled: boolean; min: number; step: number; balance: number; pendingBids: number };
  salaryRule: { equalsBid: boolean; multiplier: number; min: number; max: number | null };
  contractYears: number;
  /**
   * The cap as the add/claim action enforces it. `cap` / `space` are measured against the ceiling the action checks
   * (capLimit: the hard cap, or cap + max overage for a soft cap) while it is enforced, else against the league cap.
   */
  cap: {
    enabled: boolean;
    /** over-ceiling moves are refused right now (capEnforcement BLOCK with a ceiling) */
    enforced: boolean;
    cap: number;
    committed: number;
    space: number;
    deadMoney: number;
    /** salaryCap.cap itself */
    leagueCap: number;
    /** the ceiling (null = none: a soft cap without a max overage) */
    limit: number | null;
    /** "cap" / "soft-cap limit" */
    limitLabel: string;
    /** BLOCK / WARN / OFF for the league phase (WARN: over-cap moves go through with a warning) */
    mode: CapEnforcement;
  };
  /** active roster vs the limit the action enforces (activeRosterLimit for the league phase) */
  roster: { active: number; max: number; full: boolean };
  dropCandidates: DropCandidate[];
  existingClaim: { id: string; bid: number; dropPlayerId: string | null } | null;
  limits: { weekUsed: number; weekMax: number | null; seasonUsed: number; seasonMax: number | null; error: string | null };
  /** real-money fee per add (settings.waivers.addDropFee), 0 = none */
  addFee: number;
  /** hours a dropped player spends on waivers (settings.waivers.waiverPeriodHours) */
  waiverHours: number;
  drop: { deadMoney: { season: number; amount: number }[]; capHit: number; blocked: string | null } | null;
  trade: { allowed: boolean; reason: string | null; href: string } | null;
  blockers: string[];
}

/** Current-season dead money a team carries (from LeaguePlayerState.deadCap) */
export async function teamDeadMoney(tx: Tx, leagueId: string, teamId: string, season: number): Promise<number> {
  const states = await tx.leaguePlayerState.findMany({ where: { leagueId }, select: { deadCap: true } });
  let total = 0;
  for (const s of states) for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) if (d.teamId === teamId && d.season === season) total += d.amount;
  return total;
}

export async function acquisitionCounts(tx: Tx, teamId: string, season: number, week: number) {
  const [weekUsed, seasonUsed] = await Promise.all([
    tx.transaction.count({ where: { teamId, season, week, type: { in: ACQUISITION_TX_TYPES } } }),
    tx.transaction.count({ where: { teamId, season, type: { in: ACQUISITION_TX_TYPES } } }),
  ]);
  return { weekUsed, seasonUsed };
}

/** Why a rostered player of mine can't be dropped right now (null = droppable) */
export async function dropBlocker(tx: Tx, ctx: LeagueContext, spot: SpotWithPlayer, games?: Map<string, NflGame>): Promise<string | null> {
  const s = ctx.settings;
  if (ctx.league.phase === "PLAYOFFS" && s.playoffs.lockRostersInPlayoffs) return "Rosters are locked for the playoffs.";
  if (isUndroppable(s, spot.playerId)) return `${spot.player.fullName} is on the league's undroppable list.`;
  const inLineup = await tx.lineupSlot.findFirst({ where: { teamId: spot.teamId, season: ctx.season, week: ctx.week, playerId: spot.playerId } });
  if (inLineup) {
    const g = games ?? (await weekGamesByTeam(ctx.season, ctx.week));
    if (isLocked(spot.player.team, g, s)) return `${spot.player.fullName} is in your Week ${ctx.week} starting lineup and his game has kicked off, so he can't be dropped until the week is over.`;
  }
  return null;
}

type CheckRoster = { status: string; salary: number; player: Pick<Player, "position" | "injuryStatus" | "status" | "yearsExp" | "fullName"> }[];

/**
 * Problems a hypothetical roster change would introduce (@/lib/roster rosterChangeProblems for the league phase):
 * errors block the move, warnings (the cap in WARN mode) go into the success message. Roster limits use
 * activeRosterLimit and the cap uses capCheck — the same rules the waiver run, trades and the auction apply.
 */
export function newRosterProblems(before: CheckRoster, after: CheckRoster, ctx: LeagueContext, deadBefore: number, deadAfter: number, now = new Date()): { errors: string[]; warnings: string[] } {
  return rosterChangeProblems(before, after, ctx.settings, { phase: ctx.league.phase, now, deadBefore, deadAfter });
}

/** Blocking errors a hypothetical roster change would introduce (newRosterProblems errors). */
export function newRosterErrors(before: CheckRoster, after: CheckRoster, ctx: LeagueContext, deadBefore: number, deadAfter: number): string[] {
  return newRosterProblems(before, after, ctx, deadBefore, deadAfter).errors;
}

export interface AcquisitionState {
  player: Player;
  spot: (RosterSpot & { team: { id: string; name: string; abbrev: string } }) | null;
  mode: AcquisitionMode;
  waiverClearsAt: Date | null;
  /** held for the auction pool (settings.keepers.releasedPlayersReturnTo) */
  auctionPool: boolean;
  /** championship status per team while an elimination rule applies (null otherwise) */
  statuses: Awaited<ReturnType<typeof eliminationStatuses>>;
}

export async function acquisitionState(tx: Tx, ctx: LeagueContext, playerId: string, now = new Date()): Promise<AcquisitionState | null> {
  const [player, spot, state, games, prevGames, statuses, pool] = await Promise.all([
    tx.player.findUnique({ where: { id: playerId } }),
    tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId } }, include: { team: { select: { id: true, name: true, abbrev: true } } } }),
    tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId } } }),
    weekGamesByTeam(ctx.season, ctx.week),
    previousWeekGames(ctx),
    eliminationStatuses(ctx),
    auctionPoolFor(ctx, [playerId]),
  ]);
  if (!player) return null;
  const gameLocked = freeAgentGameLocked(player.team, ctx.settings, games, prevGames, now, lastWaiverRun(ctx.settings, now));
  const readd = readdCooldownUntil(ctx.settings, state, ctx.myTeam?.id, now);
  const auctionPool = !spot && pool.has(playerId);
  const mode = acquisitionMode({
    settings: ctx.settings,
    phase: ctx.league.phase,
    blockedReason: teamAddBlockFrom(ctx, statuses) ?? (auctionPool ? AUCTION_POOL_REASON : null) ?? (readd ? readdReason(readd, ctx.settings.general.timezone) : null),
    waiverClearsAt: state?.waiverClearsAt ?? null,
    gameStarted: gameLocked,
    now,
    nextRun: (from) => nextWaiverRun(ctx.settings, from),
  });
  return { player, spot, mode, waiverClearsAt: state?.waiverClearsAt ?? null, auctionPool, statuses };
}

export async function buildQuote(ctx: LeagueContext, playerId: string): Promise<PlayerQuote | null> {
  const st = await acquisitionState(db, ctx, playerId);
  if (!st) return null;
  const s = ctx.settings;
  const team = ctx.myTeam;
  const [games, roster, dead, counts, claims, latest, freshTeam, lineup] = await Promise.all([
    weekGamesByTeam(ctx.season, ctx.week),
    team ? db.rosterSpot.findMany({ where: { teamId: team.id }, include: { player: true }, orderBy: [{ salary: "desc" }] }) : Promise.resolve([] as SpotWithPlayer[]),
    team ? teamDeadMoney(db, ctx.league.id, team.id, ctx.season) : Promise.resolve(0),
    team ? acquisitionCounts(db, team.id, ctx.season, ctx.week) : Promise.resolve({ weekUsed: 0, seasonUsed: 0 }),
    team ? db.waiverClaim.findMany({ where: { teamId: team.id, status: "PENDING" }, select: { id: true, addPlayerId: true, bidAmount: true, dropPlayerId: true } }) : Promise.resolve([]),
    latestInjuryReports([playerId]),
    team ? db.team.findUnique({ where: { id: team.id }, select: { faabBalance: true } }) : Promise.resolve(null),
    team ? db.lineupSlot.findMany({ where: { teamId: team.id, season: ctx.season, week: ctx.week, playerId: { not: null } }, select: { playerId: true } }) : Promise.resolve([]),
  ]);
  const claim = claims.find((c) => c.addPlayerId === playerId) ?? null;
  const committed = roster.reduce((a, r) => a + capHit(r, s), 0) + dead;
  const active = roster.filter((r) => r.status === "ACTIVE").length;
  // the same ceiling, enforcement mode and active-roster limit acquirePlayerAction applies
  const capRule = capCheck(committed, s, { phase: ctx.league.phase });
  const capShown = capRule.enforced && capRule.limit !== null ? capRule.limit : s.salaryCap.cap;
  const maxActive = activeRosterLimit(s, { phase: ctx.league.phase });
  const starters = new Set(lineup.map((l) => l.playerId));
  const lockReason = (r: SpotWithPlayer): string | null => {
    if (isUndroppable(s, r.playerId)) return "On the league's undroppable list";
    if (starters.has(r.playerId) && isLocked(r.player.team, games, s)) return "In your locked lineup";
    return null;
  };
  const injury = effectiveInjury(st.player, latest.get(playerId));
  const limitErr = acquisitionLimitError(s, counts.weekUsed, counts.seasonUsed);

  let mode: PlayerQuote["mode"];
  let reason: string | null = null;
  let processAt: string | null = null;
  if (st.spot) mode = st.spot.teamId === team?.id ? "mine" : "owned";
  else {
    mode = st.mode.kind;
    if (st.mode.kind === "claim") {
      reason = st.mode.reason;
      processAt = st.mode.processAt.toISOString();
    } else if (st.mode.kind === "blocked") reason = st.mode.reason === AUCTION_POOL_REASON ? auctionPoolDetail(ctx.season) : st.mode.reason;
  }

  const blockers: string[] = [];
  if (!team) blockers.push("You don't manage a team in this league.");
  if ((mode === "add" || mode === "claim") && limitErr) blockers.push(limitErr);
  if (mode === "claim" && !claim) {
    const pendingErr = pendingClaimLimitError(s, claims.length);
    if (pendingErr) blockers.push(pendingErr);
  }

  let drop: PlayerQuote["drop"] = null;
  if (mode === "mine" && st.spot) {
    const spot = roster.find((r) => r.playerId === playerId);
    drop = {
      deadMoney: deadMoneyPreview(st.spot, s, ctx.season, ctx.week, ctx.league.phase),
      capHit: capHit(st.spot, s),
      blocked: spot ? await dropBlocker(db, ctx, spot, games) : null,
    };
  }
  const tw = st.spot && team && st.spot.teamId !== team.id ? teamTradeWindow(ctx, st.statuses, [{ id: st.spot.teamId, name: st.spot.team.name }]) : null;
  const tradeBlock = tw ? (tw.open ? tw.blockedTeams.get(st.spot!.teamId) ?? null : tw.reason) : null;

  return {
    season: ctx.season,
    player: { id: st.player.id, fullName: st.player.fullName, position: st.player.position, team: st.player.team, injuryStatus: injury.status },
    hasTeam: !!team,
    owner: st.spot
      ? { teamId: st.spot.teamId, name: st.spot.team.name, abbrev: st.spot.team.abbrev, isMine: st.spot.teamId === team?.id, salary: st.spot.salary, contractYears: st.spot.contractYears, status: st.spot.status }
      : null,
    mode,
    reason,
    processAt,
    processAtLabel: processAt ? fmtDateTime(processAt, s.general.timezone) : null,
    fab: {
      enabled: claimUsesFab(s),
      min: minimumBid(s),
      step: bidStep(s),
      balance: freshTeam?.faabBalance ?? 0,
      pendingBids: claims.filter((c) => c.addPlayerId !== playerId).reduce((a, c) => a + c.bidAmount, 0),
    },
    salaryRule: { equalsBid: s.waivers.salaryEqualsBid, multiplier: s.waivers.salaryMultiplier || 1, min: s.salaryCap.minSalary, max: s.salaryCap.maxSalary },
    contractYears: signingYears(s),
    cap: {
      enabled: s.salaryCap.enabled,
      enforced: s.salaryCap.enabled && capRule.enforced,
      cap: capShown,
      committed,
      space: capShown - committed,
      deadMoney: dead,
      leagueCap: s.salaryCap.cap,
      limit: capRule.limit,
      limitLabel: capLimitLabel(s),
      mode: capRule.mode,
    },
    roster: { active, max: maxActive, full: active >= maxActive },
    dropCandidates: roster
      .filter((r) => r.playerId !== playerId)
      .map((r) => {
        const why = lockReason(r);
        return {
          id: r.playerId,
          fullName: r.player.fullName,
          position: r.player.position,
          team: r.player.team,
          injuryStatus: r.player.injuryStatus,
          status: r.status,
          salary: r.salary,
          contractYears: r.contractYears,
          deadMoney: deadMoneyPreview(r, s, ctx.season, ctx.week, ctx.league.phase),
          capHit: capHit(r, s),
          locked: !!why,
          lockReason: why,
        };
      }),
    existingClaim: claim ? { id: claim.id, bid: claim.bidAmount, dropPlayerId: claim.dropPlayerId } : null,
    limits: { weekUsed: counts.weekUsed, weekMax: s.waivers.maxAcquisitionsPerWeek, seasonUsed: counts.seasonUsed, seasonMax: s.waivers.maxAcquisitionsPerSeason, error: limitErr },
    addFee: s.waivers.addDropFee ?? 0,
    waiverHours: s.waivers.waiverPeriodHours,
    drop,
    trade: mode === "owned" && st.spot && team ? { allowed: !tradeBlock, reason: tradeBlock, href: `/trades/new?team=${st.spot.teamId}&player=${playerId}` } : null,
    blockers,
  };
}
