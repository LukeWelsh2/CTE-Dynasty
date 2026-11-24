// Free-agent acquisition rules evaluated on the server: the quote shown in the add/claim/drop dialogs and
// the validation the server actions repeat before writing.
import "server-only";
import type { Player, Prisma, PrismaClient, RosterSpot } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { isLocked, weekGamesByTeam } from "@/lib/lineup";
import { capHit, validateRoster } from "@/lib/roster";
import { lastWaiverRun, nextWaiverRun } from "@/lib/waiver-schedule";
import {
  ACQUISITION_TX_TYPES,
  acquisitionLimitError,
  acquisitionMode,
  claimUsesFab,
  deadMoneyPreview,
  effectiveInjury,
  isGameLocked,
  minimumBid,
  signingSalary,
  signingYears,
  type AcquisitionMode,
} from "@/lib/players/logic";
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
  fab: { enabled: boolean; min: number; balance: number };
  salaryRule: { equalsBid: boolean; multiplier: number; min: number; max: number | null };
  contractYears: number;
  cap: { enabled: boolean; enforced: boolean; cap: number; committed: number; space: number; deadMoney: number };
  roster: { active: number; max: number; full: boolean };
  dropCandidates: DropCandidate[];
  existingClaim: { id: string; bid: number; dropPlayerId: string | null } | null;
  limits: { weekUsed: number; weekMax: number | null; seasonUsed: number; seasonMax: number | null; error: string | null };
  drop: { deadMoney: { season: number; amount: number }[]; capHit: number; blocked: string | null } | null;
  trade: { allowed: boolean; href: string } | null;
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
export async function dropBlocker(tx: Tx, ctx: LeagueContext, spot: SpotWithPlayer, games?: Awaited<ReturnType<typeof weekGamesByTeam>>): Promise<string | null> {
  const s = ctx.settings;
  if (ctx.league.phase === "PLAYOFFS" && s.playoffs.lockRostersInPlayoffs) return "Rosters are locked for the playoffs.";
  if (s.waivers.dropCooldownHours > 0) {
    const until = spot.acquiredAt.getTime() + s.waivers.dropCooldownHours * 3600_000;
    if (until > Date.now()) return `${spot.player.fullName} was acquired recently and can't be dropped for ${Math.ceil((until - Date.now()) / 3600_000)} more hour(s).`;
  }
  const inLineup = await tx.lineupSlot.findFirst({ where: { teamId: spot.teamId, season: ctx.season, week: ctx.week, playerId: spot.playerId } });
  if (inLineup) {
    const g = games ?? (await weekGamesByTeam(ctx.season, ctx.week));
    if (isLocked(spot.player.team, g, s)) return `${spot.player.fullName} is in your Week ${ctx.week} starting lineup and his game has kicked off, so he can't be dropped until the week is over.`;
  }
  return null;
}

/** Errors a hypothetical roster change would introduce (pre-existing problems are ignored). */
export function newRosterErrors(
  before: { status: string; salary: number; player: Pick<Player, "position" | "injuryStatus" | "status" | "yearsExp" | "fullName"> }[],
  after: { status: string; salary: number; player: Pick<Player, "position" | "injuryStatus" | "status" | "yearsExp" | "fullName"> }[],
  ctx: LeagueContext,
  deadBefore: number,
  deadAfter: number,
): string[] {
  const pre = new Set(validateRoster(before, ctx.settings, { checkCap: true, deadMoney: deadBefore }));
  return validateRoster(after, ctx.settings, { checkCap: true, deadMoney: deadAfter }).filter((e) => !pre.has(e));
}

export interface AcquisitionState {
  player: Player;
  spot: (RosterSpot & { team: { id: string; name: string; abbrev: string } }) | null;
  mode: AcquisitionMode;
  waiverClearsAt: Date | null;
}

export async function acquisitionState(tx: Tx, ctx: LeagueContext, playerId: string, now = new Date()): Promise<AcquisitionState | null> {
  const [player, spot, state, games] = await Promise.all([
    tx.player.findUnique({ where: { id: playerId } }),
    tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId } }, include: { team: { select: { id: true, name: true, abbrev: true } } } }),
    tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId } } }),
    weekGamesByTeam(ctx.season, ctx.week),
  ]);
  if (!player) return null;
  const game = player.team ? games.get(player.team) : undefined;
  const gameLocked = isGameLocked(game, ctx.settings, now, lastWaiverRun(ctx.settings, now));
  const mode = acquisitionMode({
    settings: ctx.settings,
    phase: ctx.league.phase,
    waiverClearsAt: state?.waiverClearsAt ?? null,
    gameStarted: gameLocked,
    now,
    nextRun: (from) => nextWaiverRun(ctx.settings, from),
  });
  return { player, spot, mode, waiverClearsAt: state?.waiverClearsAt ?? null };
}

export async function buildQuote(ctx: LeagueContext, playerId: string): Promise<PlayerQuote | null> {
  const st = await acquisitionState(db, ctx, playerId);
  if (!st) return null;
  const s = ctx.settings;
  const team = ctx.myTeam;
  const games = await weekGamesByTeam(ctx.season, ctx.week);
  const [roster, dead, counts, claim, latest] = await Promise.all([
    team ? db.rosterSpot.findMany({ where: { teamId: team.id }, include: { player: true }, orderBy: [{ salary: "desc" }] }) : Promise.resolve([] as SpotWithPlayer[]),
    team ? teamDeadMoney(db, ctx.league.id, team.id, ctx.season) : Promise.resolve(0),
    team ? acquisitionCounts(db, team.id, ctx.season, ctx.week) : Promise.resolve({ weekUsed: 0, seasonUsed: 0 }),
    team ? db.waiverClaim.findFirst({ where: { teamId: team.id, addPlayerId: playerId, status: "PENDING" } }) : Promise.resolve(null),
    latestInjuryReports([playerId]),
  ]);
  const freshTeam = team ? await db.team.findUnique({ where: { id: team.id }, select: { faabBalance: true } }) : null;
  const committed = roster.reduce((a, r) => a + capHit(r, s), 0) + dead;
  const active = roster.filter((r) => r.status === "ACTIVE").length;
  const lockedIds = new Set<string>();
  const lineup = team ? await db.lineupSlot.findMany({ where: { teamId: team.id, season: ctx.season, week: ctx.week, playerId: { not: null } }, select: { playerId: true } }) : [];
  for (const l of lineup) {
    const r = roster.find((x) => x.playerId === l.playerId);
    if (r && isLocked(r.player.team, games, s)) lockedIds.add(r.playerId);
  }
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
    } else if (st.mode.kind === "blocked") reason = st.mode.reason;
  }

  const blockers: string[] = [];
  if (!team) blockers.push("You don't manage a team in this league.");
  if ((mode === "add" || mode === "claim") && limitErr) blockers.push(limitErr);

  let drop: PlayerQuote["drop"] = null;
  if (mode === "mine" && st.spot) {
    const spot = roster.find((r) => r.playerId === playerId);
    drop = {
      deadMoney: deadMoneyPreview(st.spot, s, ctx.season, ctx.week),
      capHit: capHit(st.spot, s),
      blocked: spot ? await dropBlocker(db, ctx, spot, games) : null,
    };
  }

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
    fab: { enabled: claimUsesFab(s), min: minimumBid(s), balance: freshTeam?.faabBalance ?? 0 },
    salaryRule: { equalsBid: s.waivers.salaryEqualsBid, multiplier: s.waivers.salaryMultiplier || 1, min: s.salaryCap.minSalary, max: s.salaryCap.maxSalary },
    contractYears: signingYears(s),
    cap: { enabled: s.salaryCap.enabled, enforced: s.salaryCap.enabled && s.salaryCap.enforceInSeason, cap: s.salaryCap.cap, committed, space: s.salaryCap.cap - committed, deadMoney: dead },
    roster: { active, max: s.roster.maxActiveRoster, full: active >= s.roster.maxActiveRoster },
    dropCandidates: roster
      .filter((r) => r.playerId !== playerId)
      .map((r) => ({
        id: r.playerId,
        fullName: r.player.fullName,
        position: r.player.position,
        team: r.player.team,
        injuryStatus: r.player.injuryStatus,
        status: r.status,
        salary: r.salary,
        contractYears: r.contractYears,
        deadMoney: deadMoneyPreview(r, s, ctx.season, ctx.week),
        capHit: capHit(r, s),
        locked: lockedIds.has(r.playerId),
      })),
    existingClaim: claim ? { id: claim.id, bid: claim.bidAmount, dropPlayerId: claim.dropPlayerId } : null,
    limits: { weekUsed: counts.weekUsed, weekMax: s.waivers.maxAcquisitionsPerWeek, seasonUsed: counts.seasonUsed, seasonMax: s.waivers.maxAcquisitionsPerSeason, error: limitErr },
    drop,
    trade:
      mode === "owned" && st.spot && team
        ? { allowed: s.trades.enabled, href: `/trades/new?team=${st.spot.teamId}&player=${playerId}` }
        : null,
    blockers,
  };
}

/** Salary for an acquisition given a bid (FAB claims) or none (immediate adds / priority claims) */
export function acquisitionSalary(ctx: LeagueContext, bid: number): number {
  return signingSalary(ctx.settings, bid);
}
