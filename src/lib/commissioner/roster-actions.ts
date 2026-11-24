"use server";
// Commissioner roster tools: inline contract / status edits, force add, force drop (with or without dead
// money), move a player between teams, FAB adjustments, draft pick ownership, dead money forgiveness.
// Each change writes a Transaction (type COMMISSIONER) + AuditLog and can notify the affected manager.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addPlayerToTeam, adjustFaab, broadcastTransaction, dropPlayerFromTeam, movePlayer } from "@/lib/roster-ops";
import { isLocked, weekGamesByTeam } from "@/lib/lineup";
import { validateRoster } from "@/lib/roster";
import { pickShortLabel } from "@/lib/picks";
import type { LeagueContext } from "@/lib/league";
import { assertNotOwnTeam, audit, fail, idSchema, leagueTeam, notifyTeam, requireCommish, type ActionResult } from "@/lib/commissioner/server";
import { contractWarnings, forgiveEntries } from "@/lib/commissioner/roster-logic";

type Tx = Prisma.TransactionClient;

function revalidateRosters(teamIds: (string | null | undefined)[] = []) {
  revalidatePath("/commissioner/rosters");
  revalidatePath("/commissioner");
  revalidatePath("/team");
  revalidatePath("/transactions");
  for (const id of teamIds) if (id) revalidatePath(`/teams/${id}`);
}

const playerLabel = (p: { fullName: string; position: string; team: string | null }) => `${p.fullName} (${p.position}${p.team ? ` ${p.team}` : ""})`;

/** First week a player's lineup slot can still change (his game this week may already be locked). */
async function firstEditableWeek(ctx: LeagueContext, nflTeam: string | null) {
  const games = await weekGamesByTeam(ctx.season, ctx.week);
  return isLocked(nflTeam, games, ctx.settings) ? ctx.week + 1 : ctx.week;
}

async function commishTx(tx: Tx, ctx: LeagueContext, data: { teamId: string | null; relatedTeamId?: string | null; playerId?: string | null; description: string; salary?: number | null; faabAmount?: number | null; details?: Record<string, unknown> }) {
  return tx.transaction.create({
    data: {
      leagueId: ctx.league.id,
      season: ctx.season,
      week: ctx.week,
      type: "COMMISSIONER",
      teamId: data.teamId,
      relatedTeamId: data.relatedTeamId ?? null,
      playerId: data.playerId ?? null,
      salary: data.salary ?? null,
      faabAmount: data.faabAmount ?? null,
      description: data.description,
      details: (data.details ?? {}) as Prisma.InputJsonValue,
      createdById: ctx.user.id,
    },
  });
}

async function rosterProblems(ctx: LeagueContext, teamId: string): Promise<string[]> {
  const [spots, states] = await Promise.all([
    db.rosterSpot.findMany({ where: { teamId }, include: { player: true } }),
    db.leaguePlayerState.findMany({ where: { leagueId: ctx.league.id }, select: { deadCap: true } }),
  ]);
  let dead = 0;
  for (const s of states) for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) if (d.teamId === teamId && d.season === ctx.season) dead += d.amount;
  return validateRoster(spots, ctx.settings, { checkCap: ctx.settings.salaryCap.enabled, deadMoney: dead });
}

function withWarnings(msg: string, warnings: string[]) {
  return warnings.length ? `${msg} Heads up: ${warnings.slice(0, 3).join(" ")}` : msg;
}

const spotSchema = z.object({
  spotId: idSchema,
  salary: z.number().int("Salaries are whole dollars").min(0).max(100_000),
  contractYears: z.number().int().min(1, "Contracts need at least 1 year").max(15),
  status: z.enum(["ACTIVE", "IR", "TAXI"]),
  isRookieContract: z.boolean(),
  isFranchiseTagged: z.boolean(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export async function updateRosterSpot(raw: z.input<typeof spotSchema>): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = spotSchema.parse(raw);
    const spot = await db.rosterSpot.findUnique({ where: { id: input.spotId }, include: { player: true, team: { select: { id: true, name: true } } } });
    if (!spot || spot.leagueId !== ctx.league.id) return { ok: false, error: "Roster spot not found." };
    assertNotOwnTeam(ctx, spot.teamId);
    const changes: string[] = [];
    if (spot.salary !== input.salary) changes.push(`salary $${spot.salary} → $${input.salary}`);
    if (spot.contractYears !== input.contractYears) changes.push(`${spot.contractYears} → ${input.contractYears} yrs`);
    if (spot.status !== input.status) changes.push(`${spot.status} → ${input.status}`);
    if (spot.isRookieContract !== input.isRookieContract) changes.push(input.isRookieContract ? "rookie contract" : "no longer a rookie contract");
    if (spot.isFranchiseTagged !== input.isFranchiseTagged) changes.push(input.isFranchiseTagged ? "franchise tagged" : "tag removed");
    if (input.notes !== undefined && (spot.notes ?? null) !== (input.notes || null)) changes.push("notes");
    if (!changes.length) return { ok: true, message: "No changes." };
    const fromWeek = input.status !== "ACTIVE" && spot.status === "ACTIVE" ? await firstEditableWeek(ctx, spot.player.team) : null;
    const description = `Commissioner edited ${playerLabel(spot.player)} on ${spot.team.name}: ${changes.join(", ")}`;
    const t = await db.$transaction(async (tx) => {
      await tx.rosterSpot.update({
        where: { id: spot.id },
        data: {
          salary: input.salary,
          contractYears: input.contractYears,
          status: input.status,
          isRookieContract: input.isRookieContract,
          isFranchiseTagged: input.isFranchiseTagged,
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        },
      });
      if (fromWeek !== null) await tx.lineupSlot.updateMany({ where: { teamId: spot.teamId, playerId: spot.playerId, season: ctx.season, week: { gte: fromWeek } }, data: { playerId: null } });
      const tr = await commishTx(tx, ctx, { teamId: spot.teamId, playerId: spot.playerId, salary: input.salary, description, details: { changes } });
      await audit(tx, ctx, "roster.update", { targetType: "rosterSpot", targetId: spot.id, details: { summary: `${spot.player.fullName} (${spot.team.name}): ${changes.join(", ")}`, team: spot.team.name } });
      return tr;
    });
    broadcastTransaction(ctx.league.id, t);
    await notifyTeam(ctx, spot.teamId, "Commissioner roster change", description);
    revalidateRosters([spot.teamId]);
    return { ok: true, message: withWarnings(`${spot.player.fullName} updated.`, [...contractWarnings(input, ctx.settings), ...(await rosterProblems(ctx, spot.teamId))]) };
  } catch (e) {
    return fail(e);
  }
}

const addSchema = z.object({
  teamId: idSchema,
  playerId: idSchema,
  salary: z.number().int("Salaries are whole dollars").min(0).max(100_000),
  contractYears: z.number().int().min(1).max(15),
  status: z.enum(["ACTIVE", "IR", "TAXI"]).default("ACTIVE"),
  isRookieContract: z.boolean().default(false),
});

export async function forceAddPlayer(raw: z.input<typeof addSchema>): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = addSchema.parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    assertNotOwnTeam(ctx, team.id);
    const existing = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId: input.playerId } }, include: { team: { select: { name: true } } } });
    if (existing) return { ok: false, error: `That player is on ${existing.team.name}. Use Move instead.` };
    const res = await db.$transaction(async (tx) => {
      const r = await addPlayerToTeam(tx, {
        leagueId: ctx.league.id,
        teamId: team.id,
        playerId: input.playerId,
        season: ctx.season,
        week: ctx.week,
        salary: input.salary,
        contractYears: input.contractYears,
        via: "COMMISSIONER",
        status: input.status,
        isRookieContract: input.isRookieContract,
        actorId: ctx.user.id,
        txType: "COMMISSIONER",
        details: { commissioner: true },
      });
      const description = `Commissioner added ${playerLabel(r.player)} to ${team.name}: $${input.salary}, ${input.contractYears} yr${input.contractYears === 1 ? "" : "s"}${input.status !== "ACTIVE" ? ` (${input.status})` : ""}`;
      const t = await tx.transaction.update({ where: { id: r.transaction.id }, data: { description } });
      // a commissioner add clears any pending waiver claims on the player
      await tx.waiverClaim.updateMany({ where: { leagueId: ctx.league.id, addPlayerId: input.playerId, status: "PENDING" }, data: { status: "INVALID", resultNote: "Player added by the commissioner" } });
      await audit(tx, ctx, "roster.force_add", { targetType: "player", targetId: input.playerId, details: { summary: description, team: team.name, player: r.player.fullName } });
      return { t, description, player: r.player };
    });
    broadcastTransaction(ctx.league.id, res.t);
    await notifyTeam(ctx, team.id, "Commissioner added a player", res.description);
    revalidateRosters([team.id]);
    return { ok: true, message: withWarnings(`${res.player.fullName} added to ${team.name}.`, [...contractWarnings(input, ctx.settings), ...(await rosterProblems(ctx, team.id))]) };
  } catch (e) {
    return fail(e);
  }
}

const dropSchema = z.object({ teamId: idSchema, playerId: idSchema, deadMoney: z.boolean(), toWaivers: z.boolean().default(true) });

export async function forceDropPlayer(raw: z.input<typeof dropSchema>): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = dropSchema.parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    assertNotOwnTeam(ctx, team.id);
    const res = await db.$transaction(async (tx) => {
      const r = await dropPlayerFromTeam(tx, {
        leagueId: ctx.league.id,
        teamId: team.id,
        playerId: input.playerId,
        season: ctx.season,
        week: ctx.week,
        settings: ctx.settings,
        actorId: ctx.user.id,
        noPenalty: !input.deadMoney,
        toWaivers: input.toWaivers,
        txType: "COMMISSIONER",
      });
      const dead = r.deadMoney.reduce((a, d) => a + d.amount, 0);
      const description = `Commissioner dropped ${playerLabel(r.spot.player)} from ${team.name}${dead ? ` — $${dead} dead money` : input.deadMoney ? "" : " (no dead money)"}${input.toWaivers ? "" : "; straight to free agency"}`;
      const t = await tx.transaction.update({ where: { id: r.transaction.id }, data: { description } });
      await audit(tx, ctx, "roster.force_drop", { targetType: "player", targetId: input.playerId, details: { summary: description, team: team.name, player: r.spot.player.fullName, deadMoney: r.deadMoney } });
      return { t, description, name: r.spot.player.fullName };
    });
    broadcastTransaction(ctx.league.id, res.t);
    await notifyTeam(ctx, team.id, "Commissioner dropped a player", res.description);
    revalidateRosters([team.id]);
    return { ok: true, message: `${res.name} dropped from ${team.name}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function movePlayerToTeam(raw: { playerId: string; toTeamId: string; keepStatus?: boolean }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z.object({ playerId: idSchema, toTeamId: idSchema }).parse(raw);
    const to = await leagueTeam(ctx, input.toTeamId);
    const spot = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId: input.playerId } }, include: { player: true, team: { select: { id: true, name: true } } } });
    if (!spot) return { ok: false, error: "That player isn't rostered." };
    if (spot.teamId === to.id) return { ok: false, error: `Already on ${to.name}.` };
    assertNotOwnTeam(ctx, spot.teamId);
    assertNotOwnTeam(ctx, to.id);
    const description = `Commissioner moved ${playerLabel(spot.player)} from ${spot.team.name} to ${to.name} ($${spot.salary}, ${spot.contractYears} yr${spot.contractYears === 1 ? "" : "s"})`;
    const t = await db.$transaction(async (tx) => {
      await movePlayer(tx, { leagueId: ctx.league.id, playerId: input.playerId, toTeamId: to.id, season: ctx.season, week: ctx.week });
      await tx.rosterSpot.update({ where: { id: spot.id }, data: { acquiredVia: "COMMISSIONER" } });
      const tr = await commishTx(tx, ctx, { teamId: to.id, relatedTeamId: spot.teamId, playerId: spot.playerId, salary: spot.salary, description });
      await audit(tx, ctx, "roster.move", { targetType: "player", targetId: spot.playerId, details: { summary: description, player: spot.player.fullName } });
      return tr;
    });
    broadcastTransaction(ctx.league.id, t);
    await notifyTeam(ctx, spot.teamId, "Commissioner moved a player", description);
    await notifyTeam(ctx, to.id, "Commissioner moved a player", description);
    revalidateRosters([spot.teamId, to.id]);
    return { ok: true, message: withWarnings(`${spot.player.fullName} moved to ${to.name}.`, await rosterProblems(ctx, to.id)) };
  } catch (e) {
    return fail(e);
  }
}

export async function adjustTeamFaab(raw: { teamId: string; amount: number; note: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z
      .object({
        teamId: idSchema,
        amount: z.number().int("FAB changes are whole dollars").min(-100_000).max(100_000).refine((n) => n !== 0, "Enter a non-zero amount"),
        note: z.string().trim().min(3, "Add a short reason").max(200),
      })
      .parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    assertNotOwnTeam(ctx, team.id);
    const ledger = await db.faabLedger.aggregate({ where: { teamId: team.id, season: ctx.season }, _sum: { amount: true } });
    const balance = ledger._sum.amount ?? team.faabBalance;
    if (balance + input.amount < 0) return { ok: false, error: `${team.name} only has $${balance} FAB.` };
    const description = `Commissioner ${input.amount > 0 ? "added" : "removed"} $${Math.abs(input.amount)} FAB ${input.amount > 0 ? "to" : "from"} ${team.name}: ${input.note}`;
    const t = await db.$transaction(async (tx) => {
      const tr = await commishTx(tx, ctx, { teamId: team.id, faabAmount: input.amount, description, details: { note: input.note } });
      await adjustFaab(tx, { leagueId: ctx.league.id, teamId: team.id, season: ctx.season, amount: input.amount, reason: "COMMISSIONER", refType: "TRANSACTION", refId: tr.id });
      await audit(tx, ctx, "faab.adjust", { targetType: "team", targetId: team.id, details: { summary: description, team: team.name, amount: input.amount, note: input.note } });
      return tr;
    });
    broadcastTransaction(ctx.league.id, t);
    await notifyTeam(ctx, team.id, "FAB adjusted by the commissioner", description, "/waivers");
    revalidateRosters([team.id]);
    revalidatePath("/waivers");
    return { ok: true, message: `${team.name} FAB: $${balance} → $${balance + input.amount}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function changePickOwner(raw: { pickId: string; toTeamId: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z.object({ pickId: idSchema, toTeamId: idSchema }).parse(raw);
    const pick = await db.draftPick.findUnique({ where: { id: input.pickId }, include: { ownerTeam: { select: { id: true, name: true } }, originalTeam: { select: { name: true } } } });
    if (!pick || pick.leagueId !== ctx.league.id) return { ok: false, error: "Pick not found." };
    if (pick.playerId || pick.usedAt) return { ok: false, error: "That pick has already been used." };
    const to = await leagueTeam(ctx, input.toTeamId);
    if (pick.ownerTeamId === to.id) return { ok: true, message: "No change." };
    assertNotOwnTeam(ctx, pick.ownerTeamId);
    assertNotOwnTeam(ctx, to.id);
    const label = `${pickShortLabel(pick)} (${pick.originalTeam.name})`;
    const description = `Commissioner moved the ${label} pick from ${pick.ownerTeam.name} to ${to.name}`;
    const t = await db.$transaction(async (tx) => {
      await tx.draftPick.update({ where: { id: pick.id }, data: { ownerTeamId: to.id } });
      const tr = await commishTx(tx, ctx, { teamId: to.id, relatedTeamId: pick.ownerTeamId, description, details: { pickId: pick.id } });
      await audit(tx, ctx, "pick.owner", { targetType: "pick", targetId: pick.id, details: { summary: description } });
      return tr;
    });
    broadcastTransaction(ctx.league.id, t);
    await notifyTeam(ctx, pick.ownerTeamId, "Draft pick moved by the commissioner", description, "/team/picks");
    await notifyTeam(ctx, to.id, "Draft pick moved by the commissioner", description, "/team/picks");
    revalidateRosters([pick.ownerTeamId, to.id]);
    revalidatePath("/team/picks");
    return { ok: true, message: `${label} now belongs to ${to.name}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function forgiveDeadMoney(raw: { playerId: string; teamId: string; season: number | null }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z.object({ playerId: idSchema, teamId: idSchema, season: z.number().int().min(2000).max(2100).nullable() }).parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    assertNotOwnTeam(ctx, team.id);
    const state = await db.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId: input.playerId } }, include: { player: true } });
    if (!state) return { ok: false, error: "No dead money found." };
    const { kept, removed, amount } = forgiveEntries((state.deadCap as { teamId: string; season: number; amount: number }[]) ?? [], team.id, input.season);
    if (!removed.length) return { ok: false, error: "No dead money found." };
    const description = `Commissioner forgave $${amount} dead money for ${state.player.fullName} on ${team.name}${input.season ? ` (${input.season})` : ""}`;
    const t = await db.$transaction(async (tx) => {
      await tx.leaguePlayerState.update({ where: { id: state.id }, data: { deadCap: kept } });
      const tr = await commishTx(tx, ctx, { teamId: team.id, playerId: input.playerId, description, details: { removed } });
      await audit(tx, ctx, "roster.dead_money_forgive", { targetType: "player", targetId: input.playerId, details: { summary: description, removed } });
      return tr;
    });
    broadcastTransaction(ctx.league.id, t);
    await notifyTeam(ctx, team.id, "Dead money forgiven", description, "/team/contracts");
    revalidateRosters([team.id]);
    return { ok: true, message: `$${amount} of dead money removed from ${team.name}'s cap.` };
  } catch (e) {
    return fail(e);
  }
}
