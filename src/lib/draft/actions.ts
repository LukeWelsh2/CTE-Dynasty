"use server";
// Server actions for the draft center, rookie draft room, salary auction room and big board.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner, assertLeagueMember, assertTeamManager, type LeagueContext } from "@/lib/league";
import { DraftError, emit } from "@/lib/draft/shared";
import { createRookieDraft, applyRookieOrder, makeRookiePick, undoLastRookiePick } from "@/lib/draft/rookie";
import { applyProxyBids, createAuctionDraft, nominatePlayer, placeBid, setAuctionOrder, undoLastLot, auctionNominationOrder } from "@/lib/draft/auction";
import { completeDraft, deleteDraft, pauseDraft, rescheduleDraft, resumeDraft, startDraft } from "@/lib/draft/lifecycle";
import { computeRookieOrder } from "@/lib/draft/order";
import { clearLottery, runLottery } from "@/lib/draft/lottery";
import { importLeagueRankings, saveBigBoard } from "@/lib/draft/board";
import { auctionRules } from "@/lib/draft/data";
import { zonedLocalToUtc } from "@/lib/draft/time";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.string().min(1).max(64);

function fail(e: unknown): ActionResult {
  if (e instanceof DraftError) return { ok: false, error: e.message };
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
  const msg = (e as Error)?.message ?? "Something went wrong";
  if (/Unique constraint/i.test(msg)) return { ok: false, error: "That change conflicts with another one that just happened — refresh and try again." };
  console.error("[draft action]", e);
  return { ok: false, error: msg };
}

function revalidateDraft() {
  for (const p of ["/draft", "/draft/rookie", "/draft/auction", "/draft/results", "/draft/board", "/draft/lottery"]) revalidatePath(p);
}

async function draftInLeague(ctx: LeagueContext, draftId: string) {
  const d = await db.draft.findUnique({ where: { id: draftId } });
  if (!d || d.leagueId !== ctx.league.id) throw new DraftError("Draft not found");
  return d;
}

/** Team the actor is acting for: their own team, or (commissioner) any team in the league. */
async function actingTeam(ctx: LeagueContext, teamId: string | null | undefined): Promise<string> {
  const target = teamId || ctx.myTeam?.id;
  if (!target) throw new DraftError("You don't manage a team in this league.");
  if (target !== ctx.myTeam?.id) await assertTeamManager(target, true);
  return target;
}

// ───────────────────────────── Rookie room ─────────────────────────────

const pickSchema = z.object({ draftId: id, playerId: id, expectedIndex: z.number().int().min(0).optional() });

export async function makePickAction(input: z.input<typeof pickSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = pickSchema.parse(input);
    await draftInLeague(ctx, v.draftId);
    const r = await makeRookiePick({ draftId: v.draftId, playerId: v.playerId, actorTeamId: ctx.myTeam?.id ?? null, actorId: ctx.user.id, isCommish: ctx.isCommish, expectedIndex: v.expectedIndex });
    revalidateDraft();
    return { ok: true, message: `Drafted ${r.player.fullName}` };
  } catch (e) {
    return fail(e);
  }
}

const queueSchema = z.object({ draftId: id, playerId: id, maxBid: z.number().int().min(0).max(100000).nullable().optional() });

export async function queueAddAction(input: z.input<typeof queueSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = queueSchema.parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    const teamId = await actingTeam(ctx, null);
    const player = await db.player.findUnique({ where: { id: v.playerId }, select: { fullName: true } });
    if (!player) throw new DraftError("Player not found");
    const count = await db.draftQueueEntry.count({ where: { draftId: d.id, teamId } });
    await db.draftQueueEntry.upsert({
      where: { draftId_teamId_playerId: { draftId: d.id, teamId, playerId: v.playerId } },
      create: { draftId: d.id, teamId, playerId: v.playerId, rank: count + 1, maxBid: v.maxBid ?? null },
      update: v.maxBid !== undefined ? { maxBid: v.maxBid } : {},
    });
    emit(d.id, "draft.queue", { teamId });
    return { ok: true, message: d.type === "AUCTION" ? `${player.fullName} added to your targets` : `${player.fullName} added to your queue` };
  } catch (e) {
    return fail(e);
  }
}

export async function queueRemoveAction(input: { draftId: string; playerId: string }): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = z.object({ draftId: id, playerId: id }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    const teamId = await actingTeam(ctx, null);
    await db.draftQueueEntry.deleteMany({ where: { draftId: d.id, teamId, playerId: v.playerId } });
    const rest = await db.draftQueueEntry.findMany({ where: { draftId: d.id, teamId }, orderBy: { rank: "asc" } });
    await db.$transaction(rest.map((r, i) => db.draftQueueEntry.update({ where: { id: r.id }, data: { rank: i + 1 } })));
    emit(d.id, "draft.queue", { teamId });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function queueReorderAction(input: { draftId: string; playerIds: string[] }): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = z.object({ draftId: id, playerIds: z.array(id).max(500) }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    const teamId = await actingTeam(ctx, null);
    const rows = await db.draftQueueEntry.findMany({ where: { draftId: d.id, teamId } });
    const pos = (pid: string) => {
      const i = v.playerIds.indexOf(pid);
      return i === -1 ? 10_000 : i;
    };
    const sorted = [...rows].sort((a, b) => pos(a.playerId) - pos(b.playerId) || a.rank - b.rank);
    await db.$transaction(sorted.map((r, i) => db.draftQueueEntry.update({ where: { id: r.id }, data: { rank: i + 1 } })));
    emit(d.id, "draft.queue", { teamId });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setMaxBidAction(input: { draftId: string; playerId: string; maxBid: number | null }): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = z.object({ draftId: id, playerId: id, maxBid: z.number().int().min(0).max(100000).nullable() }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    if (d.type !== "AUCTION") throw new DraftError("Max bids only apply to auctions.");
    const teamId = await actingTeam(ctx, null);
    const count = await db.draftQueueEntry.count({ where: { draftId: d.id, teamId } });
    await db.draftQueueEntry.upsert({
      where: { draftId_teamId_playerId: { draftId: d.id, teamId, playerId: v.playerId } },
      create: { draftId: d.id, teamId, playerId: v.playerId, rank: count + 1, maxBid: v.maxBid || null },
      update: { maxBid: v.maxBid || null },
    });
    // a new ceiling may immediately out-bid the current leader on the open lot
    const open = await db.auctionLot.findFirst({ where: { draftId: d.id, status: "OPEN", playerId: v.playerId } });
    if (open && v.maxBid) await applyProxyBids(open.id, ctx.settings, auctionRules(d, ctx.settings));
    emit(d.id, "draft.queue", { teamId });
    return { ok: true, message: v.maxBid ? `Auto-bid up to $${v.maxBid}` : "Auto-bid cleared" };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Auction room ─────────────────────────────

const nominateSchema = z.object({ draftId: id, playerId: id, openingBid: z.number().int().min(0).max(100000), years: z.number().int().min(1).max(10).nullable().optional() });

export async function nominateAction(input: z.input<typeof nominateSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = nominateSchema.parse(input);
    await draftInLeague(ctx, v.draftId);
    // always nominates for the team whose turn it is (commissioners may do it on their behalf)
    await nominatePlayer({ draftId: v.draftId, playerId: v.playerId, openingBid: v.openingBid, years: v.years ?? null, actorTeamId: ctx.myTeam?.id ?? null, actorId: ctx.user.id, isCommish: ctx.isCommish });
    return { ok: true, message: "Nominated" };
  } catch (e) {
    return fail(e);
  }
}

const bidSchema = z.object({ draftId: id, lotId: id, amount: z.number().int().min(1).max(100000), years: z.number().int().min(1).max(10).nullable().optional(), teamId: id.nullable().optional() });

export async function bidAction(input: z.input<typeof bidSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = bidSchema.parse(input);
    await draftInLeague(ctx, v.draftId);
    const teamId = await actingTeam(ctx, v.teamId);
    const r = await placeBid({ draftId: v.draftId, lotId: v.lotId, teamId, amount: v.amount, years: v.years ?? null, actorId: ctx.user.id });
    if (teamId !== ctx.myTeam?.id) {
      await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "draft.bid_on_behalf", targetType: "Draft", targetId: v.draftId, details: { lotId: v.lotId, teamId, amount: v.amount } } });
    }
    return { ok: true, message: r.leaderTeamId === teamId ? `You're the high bidder at $${r.amount}` : `Outbid by an auto-bid — now $${r.amount}` };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Commissioner ─────────────────────────────

const localTime = z.string().max(40).optional().nullable();

function parseStart(ctx: LeagueContext, local: string | null | undefined): Date | null {
  if (!local) return null;
  const d = zonedLocalToUtc(local, ctx.settings.general.timezone);
  if (!d) throw new DraftError("Invalid start time");
  if (d.getTime() < Date.now() - 60_000) throw new DraftError("Pick a start time in the future, or leave it blank and start the draft manually.");
  return d;
}

export async function createRookieDraftAction(input: { season: number; startTime?: string | null }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ season: z.number().int().min(2000).max(2100), startTime: localTime }).parse(input);
    if (v.season < ctx.league.season) throw new DraftError("That season has passed.");
    const d = await createRookieDraft({ leagueId: ctx.league.id, season: v.season, startTime: parseStart(ctx, v.startTime), actorId: ctx.user.id });
    revalidateDraft();
    return { ok: true, message: `${d.name} created` };
  } catch (e) {
    return fail(e);
  }
}

export async function createAuctionDraftAction(input: { name: string; kind: "STARTUP" | "FREE_AGENT"; season: number; nominationOrder: "RANDOM" | "REVERSE_STANDINGS" | "CUSTOM"; startTime?: string | null }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z
      .object({
        name: z.string().trim().min(3, "Give the auction a name").max(60),
        kind: z.enum(["STARTUP", "FREE_AGENT"]),
        season: z.number().int().min(2000).max(2100),
        nominationOrder: z.enum(["RANDOM", "REVERSE_STANDINGS", "CUSTOM"]),
        startTime: localTime,
      })
      .parse(input);
    if (v.season < ctx.league.season) throw new DraftError("That season has passed.");
    const d = await createAuctionDraft({ leagueId: ctx.league.id, season: v.season, name: v.name, kind: v.kind, nominationOrder: v.nominationOrder, startTime: parseStart(ctx, v.startTime), actorId: ctx.user.id });
    revalidateDraft();
    return { ok: true, message: `${d.name} created` };
  } catch (e) {
    return fail(e);
  }
}

type Lifecycle = "start" | "pause" | "resume" | "complete" | "delete" | "undo";

export async function draftControlAction(input: { draftId: string; op: Lifecycle }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ draftId: id, op: z.enum(["start", "pause", "resume", "complete", "delete", "undo"]) }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    let message = "";
    if (v.op === "start") {
      await startDraft(d.id, ctx.user.id);
      message = `${d.name} is live`;
    } else if (v.op === "pause") {
      await pauseDraft(d.id, ctx.user.id);
      message = "Draft paused";
    } else if (v.op === "resume") {
      await resumeDraft(d.id, ctx.user.id);
      message = "Draft resumed";
    } else if (v.op === "complete") {
      await completeDraft(d.id, ctx.user.id);
      message = "Draft marked complete";
    } else if (v.op === "delete") {
      await deleteDraft(d.id, ctx.user.id);
      message = `${d.name} deleted`;
    } else {
      if (d.type === "AUCTION") {
        const lot = await undoLastLot(d.id, ctx.user.id);
        message = `Undid ${lot.status === "OPEN" ? "the open nomination" : "the last sale"}`;
      } else {
        const sel = await undoLastRookiePick(d.id, ctx.user.id);
        message = `Undid pick #${sel.overall} (${sel.player.fullName})`;
      }
    }
    revalidateDraft();
    revalidatePath("/team");
    return { ok: true, message };
  } catch (e) {
    return fail(e);
  }
}

export async function rescheduleDraftAction(input: { draftId: string; startTime: string | null }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ draftId: id, startTime: localTime }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    await rescheduleDraft(d.id, parseStart(ctx, v.startTime), ctx.user.id);
    revalidateDraft();
    return { ok: true, message: v.startTime ? "Start time saved" : "Start time cleared" };
  } catch (e) {
    return fail(e);
  }
}

export async function setDraftOrderAction(input: { draftId: string; teamIds: string[] }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ draftId: id, teamIds: z.array(id).min(1).max(64) }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    if (d.status === "COMPLETE") throw new DraftError("The draft is complete.");
    if (d.type === "AUCTION") await setAuctionOrder(d.id, v.teamIds, ctx.user.id);
    else {
      if (d.status !== "SCHEDULED") throw new DraftError("The order can only change before the draft starts.");
      await applyRookieOrder(d.id, v.teamIds, { manual: true, settings: ctx.settings });
      await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "draft.order", targetType: "Draft", targetId: d.id, details: { teamIds: v.teamIds, manual: true } } });
    }
    revalidateDraft();
    return { ok: true, message: "Draft order saved" };
  } catch (e) {
    return fail(e);
  }
}

/** Recompute the order from the league settings (rookie: standings/lottery; auction: nomination order rule). */
export async function resetDraftOrderAction(input: { draftId: string }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ draftId: id }).parse(input);
    const d = await draftInLeague(ctx, v.draftId);
    if (d.status !== "SCHEDULED") throw new DraftError("The order can only be reset before the draft starts.");
    if (d.type === "AUCTION") {
      const order = await auctionNominationOrder(ctx.league.id, d.season, auctionRules(d, ctx.settings).nominationOrder, ctx.settings);
      await setAuctionOrder(d.id, order, ctx.user.id);
    } else {
      const order = await computeRookieOrder(ctx.league.id, d.season, ctx.settings);
      await applyRookieOrder(d.id, order.rows.map((r) => r.teamId), { manual: false, settings: ctx.settings });
      await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "draft.order_reset", targetType: "Draft", targetId: d.id, details: { basis: order.status } } });
    }
    revalidateDraft();
    return { ok: true, message: "Order reset from league settings" };
  } catch (e) {
    return fail(e);
  }
}

export async function runLotteryAction(input: { season: number }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ season: z.number().int().min(2000).max(2100) }).parse(input);
    await runLottery(ctx.league.id, v.season, ctx.user.id);
    revalidateDraft();
    return { ok: true, message: "Lottery drawn" };
  } catch (e) {
    return fail(e);
  }
}

export async function clearLotteryAction(input: { season: number }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ season: z.number().int().min(2000).max(2100) }).parse(input);
    await clearLottery(ctx.league.id, v.season, ctx.user.id);
    revalidateDraft();
    return { ok: true, message: "Lottery cleared" };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Big board ─────────────────────────────

const boardSchema = z.object({
  classYear: z.number().int().min(2000).max(2100),
  entries: z.array(z.object({ playerId: id, note: z.string().max(280).nullable().optional() })).max(400),
  tierBreaks: z.array(id).max(400),
});

export async function saveBigBoardAction(input: z.input<typeof boardSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = boardSchema.parse(input);
    const teamId = await actingTeam(ctx, null);
    const n = await saveBigBoard({ leagueId: ctx.league.id, teamId, classYear: v.classYear, entries: v.entries, tierBreaks: v.tierBreaks });
    revalidatePath("/draft/board");
    return { ok: true, message: `Board saved (${n} players)` };
  } catch (e) {
    return fail(e);
  }
}

export async function importRankingsAction(input: { classYear: number; mode: "replace" | "append" }): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = z.object({ classYear: z.number().int().min(2000).max(2100), mode: z.enum(["replace", "append"]) }).parse(input);
    const teamId = await actingTeam(ctx, null);
    const n = await importLeagueRankings({ leagueId: ctx.league.id, teamId, classYear: v.classYear, mode: v.mode });
    if (!n) return { ok: false, error: "There are no league rankings for this class yet." };
    revalidatePath("/draft/board");
    return { ok: true, message: `Imported league rankings (${n} players)` };
  } catch (e) {
    return fail(e);
  }
}
