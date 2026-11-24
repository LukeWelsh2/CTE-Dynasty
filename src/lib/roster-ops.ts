// Core roster mutations shared by free agency, waivers, trades, drafts, keepers and commissioner tools.
// Every mutation writes a Transaction row and (optionally) posts to league chat + live feed.
import type { AcquisitionType, Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { publish, topics } from "@/lib/realtime/bus";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface AddPlayerInput {
  leagueId: string;
  teamId: string;
  playerId: string;
  season: number;
  week: number;
  salary: number;
  contractYears: number;
  via: AcquisitionType;
  status?: "ACTIVE" | "IR" | "TAXI";
  isRookieContract?: boolean;
  actorId?: string | null;
  txType?: string; // ADD | WAIVER | AUCTION | ROOKIE_DRAFT | KEEPER | COMMISSIONER
  faabAmount?: number | null;
  description?: string;
  details?: Record<string, unknown>;
}

export async function addPlayerToTeam(tx: Tx, input: AddPlayerInput) {
  const player = await tx.player.findUniqueOrThrow({ where: { id: input.playerId } });
  const existing = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } } });
  if (existing) throw new Error(`${player.fullName} is already on a roster.`);
  const spot = await tx.rosterSpot.create({
    data: {
      leagueId: input.leagueId,
      teamId: input.teamId,
      playerId: input.playerId,
      status: input.status ?? "ACTIVE",
      salary: input.salary,
      contractYears: input.contractYears,
      contractStart: input.season,
      isRookieContract: input.isRookieContract ?? false,
      acquiredVia: input.via,
    },
  });
  await tx.leaguePlayerState.upsert({
    where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
    create: { leagueId: input.leagueId, playerId: input.playerId, waiverClearsAt: null },
    update: { waiverClearsAt: null },
  });
  const t = await tx.transaction.create({
    data: {
      leagueId: input.leagueId,
      season: input.season,
      week: input.week,
      type: input.txType ?? "ADD",
      teamId: input.teamId,
      playerId: input.playerId,
      faabAmount: input.faabAmount ?? null,
      salary: input.salary,
      description:
        input.description ??
        `Added ${player.fullName} (${player.position}${player.team ? " " + player.team : ""}) — $${input.salary}, ${input.contractYears} yr${input.contractYears === 1 ? "" : "s"}`,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
      createdById: input.actorId ?? null,
    },
  });
  return { spot, transaction: t, player };
}

export interface DropPlayerInput {
  leagueId: string;
  teamId: string;
  playerId: string;
  season: number;
  week: number;
  settings: LeagueSettings;
  actorId?: string | null;
  /** skip dead money (e.g. commissioner corrections, trades) */
  noPenalty?: boolean;
  /** put the player on waivers for settings.waivers.waiverPeriodHours */
  toWaivers?: boolean;
  txType?: string;
  description?: string;
}

/** Remove a player from a team. Applies dead money per settings and puts the player on waivers. */
export async function dropPlayerFromTeam(tx: Tx, input: DropPlayerInput) {
  const spot = await tx.rosterSpot.findUnique({
    where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
    include: { player: true },
  });
  if (!spot || spot.teamId !== input.teamId) throw new Error("Player is not on this team.");
  await tx.rosterSpot.delete({ where: { id: spot.id } });
  // remove from current & future lineups
  await tx.lineupSlot.updateMany({
    where: { teamId: input.teamId, playerId: input.playerId, season: input.season, week: { gte: input.week } },
    data: { playerId: null },
  });

  const s = input.settings;
  const dead: { teamId: string; season: number; amount: number }[] = [];
  const exempt = spot.isRookieContract && s.salaryCap.deadMoney.rookieContractsExempt;
  const beforeWeekExempt = s.salaryCap.deadMoney.waivedInSeasonBeforeWeek && input.week < s.salaryCap.deadMoney.waivedInSeasonBeforeWeek;
  if (!input.noPenalty && s.salaryCap.enabled && s.salaryCap.deadMoney.enabled && !exempt && !beforeWeekExempt && spot.salary > s.salaryCap.minSalary) {
    const cur = Math.round((spot.salary * s.salaryCap.deadMoney.currentSeasonPercent) / 100);
    if (cur > 0) dead.push({ teamId: input.teamId, season: input.season, amount: cur });
    for (let y = 1; y < spot.contractYears; y++) {
      const fut = Math.round((spot.salary * s.salaryCap.deadMoney.futureSeasonPercent) / 100);
      if (fut > 0) dead.push({ teamId: input.teamId, season: input.season + y, amount: fut });
    }
  }
  const waiverClearsAt = input.toWaivers === false ? null : new Date(Date.now() + s.waivers.waiverPeriodHours * 3600_000);
  const state = await tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } } });
  const prevDead = (state?.deadCap as { teamId: string; season: number; amount: number }[] | undefined) ?? [];
  await tx.leaguePlayerState.upsert({
    where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } },
    create: { leagueId: input.leagueId, playerId: input.playerId, waiverClearsAt, lastDroppedById: input.teamId, lastDroppedAt: new Date(), deadCap: dead },
    update: { waiverClearsAt, lastDroppedById: input.teamId, lastDroppedAt: new Date(), deadCap: [...prevDead, ...dead] },
  });
  const deadTotal = dead.filter((d) => d.season === input.season).reduce((a, d) => a + d.amount, 0);
  const t = await tx.transaction.create({
    data: {
      leagueId: input.leagueId,
      season: input.season,
      week: input.week,
      type: input.txType ?? "DROP",
      teamId: input.teamId,
      playerId: input.playerId,
      salary: spot.salary,
      description:
        input.description ??
        `Dropped ${spot.player.fullName} (${spot.player.position}${spot.player.team ? " " + spot.player.team : ""})${deadTotal ? ` — $${deadTotal} dead money` : ""}`,
      details: { deadMoney: dead } as Prisma.InputJsonValue,
      createdById: input.actorId ?? null,
    },
  });
  return { spot, transaction: t, deadMoney: dead };
}

/** Move a rostered player to another team keeping salary/contract (trades, commissioner moves). */
export async function movePlayer(tx: Tx, input: { leagueId: string; playerId: string; toTeamId: string; season: number; week: number }) {
  const spot = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: input.leagueId, playerId: input.playerId } } });
  if (!spot) throw new Error("Player not rostered");
  await tx.lineupSlot.updateMany({
    where: { teamId: spot.teamId, playerId: input.playerId, season: input.season, week: { gte: input.week } },
    data: { playerId: null },
  });
  return tx.rosterSpot.update({ where: { id: spot.id }, data: { teamId: input.toTeamId, status: spot.status === "TAXI" ? "ACTIVE" : spot.status, acquiredVia: "TRADE", acquiredAt: new Date() } });
}

/** FAB balance changes go through the ledger and update the cached balance. */
export async function adjustFaab(tx: Tx, input: { leagueId: string; teamId: string; season: number; amount: number; reason: string; refType?: string; refId?: string }) {
  await tx.faabLedger.create({ data: { ...input, refType: input.refType ?? null, refId: input.refId ?? null } });
  return tx.team.update({ where: { id: input.teamId }, data: { faabBalance: { increment: input.amount } } });
}

/** Broadcast a transaction to the league live feed (call after the DB transaction commits). */
export function broadcastTransaction(leagueId: string, transaction: { id: string; description: string; type: string; teamId: string | null }) {
  publish(topics.league(leagueId), "transaction", transaction);
}
