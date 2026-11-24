"use server";
// Trade server actions: propose / counter / accept / reject / cancel / vote, commissioner review tools
// (approve, veto, force-complete, reverse, cancel) and trade block entries.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCommissioner, assertLeagueMember, type LeagueContext } from "@/lib/league";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { firstOpenDraftSeason } from "@/lib/picks";
import { validateTrade } from "@/lib/trades/validate";
import { assetKey, canVoteOnTrade, faabLabel, pickAssetLabel, reviewHours, tradablePickSeasons, voteTally, type AssetRef } from "@/lib/trades/rules";
import {
  commissionerTeamIds,
  completeTrade,
  coReviewerUserIds,
  loadTrade,
  notifyReview,
  notifyTeams,
  publishTradeEvent,
  reverseTrade,
  reviewRouteForTrade,
  tradeHeadline,
  tradeAssetRefs,
  transitionTrade,
  vetoTrade,
  type LeagueState,
  type LoadedTrade,
} from "@/lib/trades/execute";

export type ActionResult = { ok: true; message?: string; tradeId?: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(64);
const assetSchema = z.object({
  type: z.enum(["PLAYER", "PICK", "FAAB"]),
  playerId: id.nullish(),
  pickId: id.nullish(),
  faabAmount: z.number().int().min(1).max(100_000).nullish(),
  retainPercent: z.number().int().min(0).max(100).nullish(),
  fromTeamId: id,
  toTeamId: id,
});
const proposeSchema = z.object({
  proposerTeamId: id,
  teamIds: z.array(id).min(2).max(6),
  assets: z.array(assetSchema).min(1, "Add at least one asset").max(40),
  drops: z.array(id).max(15).default([]),
  message: z.string().trim().max(1000).optional(),
  counterOf: id.nullish(),
});
const noteSchema = z.string().trim().max(500).optional();

function fail(e: unknown): ActionResult {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
  return { ok: false, error: (e as Error).message || "Something went wrong" };
}

function stateOf(ctx: LeagueContext): LeagueState {
  return { leagueId: ctx.league.id, season: ctx.season, phase: ctx.league.phase, week: ctx.week, settings: ctx.settings, name: ctx.league.name };
}

function revalidateTrades(tradeId?: string) {
  revalidatePath("/trades");
  revalidatePath("/trades/history");
  revalidatePath("/commissioner/trades");
  if (tradeId) revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/team");
  revalidatePath("/transactions");
}

async function audit(ctx: LeagueContext, action: string, tradeId: string, details: Record<string, unknown>) {
  await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action, targetType: "trade", targetId: tradeId, details: details as Prisma.InputJsonValue } });
}

/** Order-independent fingerprint of a trade's assets (duplicate-offer guard). */
function assetSignature(assets: Pick<AssetRef, "type" | "playerId" | "pickId" | "faabAmount" | "fromTeamId" | "toTeamId" | "retainPercent">[]): string {
  return assets
    .map((a) => `${assetKey(a)}>${a.toTeamId}${a.type === "FAAB" ? `:${a.faabAmount ?? 0}` : ""}${a.retainPercent ? `:r${a.retainPercent}` : ""}`)
    .sort()
    .join("|");
}

/**
 * A commissioner approving / forcing / reversing a trade that includes their own team (site admins included —
 * the rule is about the conflict of interest): allowed when settings.trades.commissionerTradesReviewedBy is
 * NONE (it's audit-logged); with CO_COMMISSIONER (or settings.commissioner.ownTeamActionsRequireCoCommish)
 * another commissioner outside the trade must do it when one exists; with LEAGUE_VOTE the league vote decides
 * whether the commissioner's own trade goes through (a reversal then needs a co-commissioner if there is one).
 */
async function ownTradeBlock(ctx: LeagueContext, trade: LoadedTrade, action: "approve" | "reverse"): Promise<string | null> {
  if (!ctx.myTeam || !trade.teams.some((t) => t.teamId === ctx.myTeam!.id)) return null;
  const route = ctx.settings.trades.commissionerTradesReviewedBy ?? "NONE";
  if (route === "NONE" && !ctx.settings.commissioner.ownTeamActionsRequireCoCommish) return null;
  if (action === "approve" && route === "LEAGUE_VOTE" && (await commissionerTeamIds(ctx.league.id)).has(ctx.myTeam.id))
    return "Trades involving the commissioner's team are decided by a league vote, so you can't push your own trade through.";
  const others = (await coReviewerUserIds(trade)).filter((u) => u !== ctx.user.id);
  if (others.length) return `League rules require a co-commissioner to ${action === "approve" ? "review" : "reverse"} trades that include your own team.`;
  return null;
}

// ───────────────────────────── Propose / counter ─────────────────────────────

export async function proposeTradeAction(raw: z.input<typeof proposeSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const input = proposeSchema.parse(raw);
    if (!ctx.myTeam || ctx.myTeam.id !== input.proposerTeamId) return { ok: false, error: "You can only propose trades for your own team." };
    const proposer = ctx.myTeam.id;
    const teamIds = [...new Set([proposer, ...input.teamIds])];
    const assets: AssetRef[] = input.assets.map((a) => ({
      ...a,
      playerId: a.playerId ?? null,
      pickId: a.pickId ?? null,
      faabAmount: a.faabAmount ?? null,
      retainPercent: a.type === "PLAYER" && a.retainPercent ? a.retainPercent : null,
    }));
    const retention = Object.fromEntries(assets.filter((a) => a.type === "PLAYER" && a.playerId && a.retainPercent).map((a) => [a.playerId!, a.retainPercent!]));

    let parent: Awaited<ReturnType<typeof loadTrade>> = null;
    if (input.counterOf) {
      parent = await loadTrade(input.counterOf);
      if (!parent || parent.leagueId !== ctx.league.id) return { ok: false, error: "The trade you're countering no longer exists." };
      if (parent.status !== "PROPOSED") return { ok: false, error: `That offer is ${parent.status.toLowerCase()} and can't be countered.` };
      if (parent.proposerTeamId === proposer || !parent.teams.some((t) => t.teamId === proposer)) return { ok: false, error: "Only a team receiving an offer can counter it." };
    }

    const state = stateOf(ctx);
    const check = await validateTrade(db, state, { teamIds, assets, drops: { [proposer]: input.drops } }, { checkWindow: true, strictTeams: new Set([proposer]) });
    if (check.errors.length) return { ok: false, error: check.errors.join(" ") };

    // double-submit / duplicate guard: the same open offer to the same teams
    const sig = assetSignature(assets);
    const open = await db.trade.findMany({ where: { leagueId: ctx.league.id, proposerTeamId: proposer, status: "PROPOSED" }, include: { assets: true, teams: { select: { teamId: true } } } });
    const dup = open.find((t) => t.teams.length === teamIds.length && t.teams.every((x) => teamIds.includes(x.teamId)) && assetSignature(tradeAssetRefs(t)) === sig);
    if (dup) return { ok: false, error: "You already have this exact offer out — withdraw it first or change the deal." };

    // human-readable snapshots
    const pickIds = assets.filter((a) => a.type === "PICK").map((a) => a.pickId!);
    const [teams, picks] = await Promise.all([
      db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true } }),
      pickIds.length ? db.draftPick.findMany({ where: { id: { in: pickIds } } }) : Promise.resolve([]),
    ]);
    const teamName = (tid: string) => teams.find((t) => t.id === tid)?.name ?? "?";
    const spotBy = new Map(check.snapshot.spots.map((s) => [s.playerId, s]));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(1, ctx.settings.trades.offerExpirationHours) * 3600_000);

    const trade = await db.$transaction(async (tx) => {
      if (parent) {
        const res = await tx.trade.updateMany({ where: { id: parent.id, status: "PROPOSED" }, data: { status: "COUNTERED", resolutionNote: "Countered" } });
        if (res.count !== 1) throw new Error("That offer is no longer open.");
        await tx.tradeTeam.update({ where: { tradeId_teamId: { tradeId: parent.id, teamId: proposer } }, data: { respondedAt: now } });
      }
      return tx.trade.create({
        data: {
          leagueId: ctx.league.id,
          season: ctx.season,
          week: ctx.week,
          proposerTeamId: proposer,
          status: "PROPOSED",
          message: input.message || null,
          ...(Object.keys(retention).length ? { valuation: { terms: { retention } } as Prisma.InputJsonValue } : {}),
          parentTradeId: parent?.id ?? null,
          expiresAt,
          teams: { create: teamIds.map((t) => ({ teamId: t, accepted: t === proposer, respondedAt: t === proposer ? now : null, dropPlayerIds: t === proposer ? input.drops : [] })) },
          assets: {
            create: assets.map((a) => {
              const sp = a.playerId ? spotBy.get(a.playerId) : undefined;
              const pk = a.pickId ? picks.find((p) => p.id === a.pickId) : undefined;
              return {
                fromTeamId: a.fromTeamId,
                toTeamId: a.toTeamId,
                type: a.type,
                playerId: a.type === "PLAYER" ? a.playerId : null,
                pickId: a.type === "PICK" ? a.pickId : null,
                faabAmount: a.type === "FAAB" ? a.faabAmount : null,
                salary: sp?.salary ?? null,
                contractYears: sp?.contractYears ?? null,
                label: a.type === "PLAYER" ? sp?.player.fullName ?? "Player" : a.type === "PICK" && pk ? pickAssetLabel(pk, a.fromTeamId, teamName) : faabLabel(a.faabAmount ?? 0),
              };
            }),
          },
        },
      });
    });

    const full = await loadTrade(trade.id);
    if (full) {
      const partners = teamIds.filter((t) => t !== proposer);
      await notifyTeams(full, partners, "TRADE_PROPOSED", parent ? `Counter offer from ${ctx.myTeam.name}` : `Trade offer from ${ctx.myTeam.name}`, `${tradeHeadline(full)}${input.message ? ` — "${input.message}"` : ""}`);
    }
    publishTradeEvent(ctx.league.id, trade.id, "PROPOSED");
    if (parent) publishTradeEvent(ctx.league.id, parent.id, "COUNTERED");
    revalidateTrades(trade.id);
    return { ok: true, tradeId: trade.id, message: parent ? "Counter offer sent." : "Trade offer sent." };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Respond ─────────────────────────────

export async function acceptTradeAction(tradeId: string, dropIds: string[] = []): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const drops = z.array(id).max(15).parse(dropIds);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    const me = ctx.myTeam ? trade.teams.find((t) => t.teamId === ctx.myTeam!.id) : undefined;
    if (!me) return { ok: false, error: "Only teams in this trade can accept it." };
    if (trade.status !== "PROPOSED") return { ok: false, error: `This trade is ${trade.status.toLowerCase()}.` };
    if (me.accepted) return { ok: false, error: "You already accepted this trade." };
    if (trade.expiresAt && trade.expiresAt < new Date()) {
      await transitionTrade(trade.id, ["PROPOSED"], { status: "EXPIRED", resolutionNote: "Offer expired" });
      revalidateTrades(trade.id);
      return { ok: false, error: "This offer has expired." };
    }
    const state = stateOf(ctx);
    const allDrops = Object.fromEntries(trade.teams.map((t) => [t.teamId, t.teamId === me.teamId ? drops : t.dropPlayerIds]));
    const refs = tradeAssetRefs(trade);
    const check = await validateTrade(db, state, { teamIds: trade.teams.map((t) => t.teamId), assets: refs, drops: allDrops }, { checkWindow: true, strictTeams: new Set([me.teamId]) });
    if (check.errors.length) return { ok: false, error: check.errors.join(" ") };

    const now = new Date();
    const updated = await db.$transaction(async (tx) => {
      // status-guarded update = row lock: concurrent accepts by different teams serialize here, so exactly one
      // of them sees every team accepted and moves the trade forward
      const lock = await tx.trade.updateMany({ where: { id: trade.id, status: "PROPOSED" }, data: { updatedAt: now } });
      if (lock.count !== 1) throw new Error("This trade is no longer open.");
      await tx.tradeTeam.update({ where: { tradeId_teamId: { tradeId: trade.id, teamId: me.teamId } }, data: { accepted: true, respondedAt: now, dropPlayerIds: drops } });
      return tx.tradeTeam.findMany({ where: { tradeId: trade.id } });
    });
    const pending = updated.filter((t) => !t.accepted).map((t) => t.teamId);
    const full = (await loadTrade(trade.id))!;
    if (pending.length) {
      await notifyTeams(full, [trade.proposerTeamId], "TRADE_ACCEPTED", `${ctx.myTeam!.name} accepted your trade`, `Still waiting on ${pending.map((p) => full.teams.find((t) => t.teamId === p)?.team.name).join(", ")}.`);
      publishTradeEvent(ctx.league.id, trade.id, "PROPOSED");
      revalidateTrades(trade.id);
      return { ok: true, message: "Accepted — waiting on the other teams." };
    }

    const route = await reviewRouteForTrade(trade, ctx.settings);
    if (route === "NONE") {
      const res = await completeTrade(trade.id, { actorId: ctx.user.id });
      if (!res.ok) {
        await db.tradeTeam.update({ where: { tradeId_teamId: { tradeId: trade.id, teamId: me.teamId } }, data: { accepted: false, dropPlayerIds: [] } });
        revalidateTrades(trade.id);
        return res.code === "LOCKED" ? { ok: false, error: `${res.error} Accept it again once the week's games are final.` } : res;
      }
      revalidateTrades(trade.id);
      return { ok: true, message: "Trade accepted and processed." };
    }
    const hours = reviewHours(ctx.settings);
    const reviewEndsAt = route === "LEAGUE_VOTE" ? new Date(now.getTime() + hours * 3600_000) : null;
    const moved = await transitionTrade(trade.id, ["PROPOSED"], { status: "ACCEPTED", acceptedAt: now, reviewEndsAt });
    if (!moved) return { ok: false, error: "This trade is no longer open." };
    const waiting = route === "COMMISSIONER" ? "commissioner approval" : route === "CO_COMMISSIONER" ? "co-commissioner approval" : null;
    await notifyTeams(full, full.teams.map((t) => t.teamId).filter((t) => t !== me.teamId), "TRADE_ACCEPTED", `${ctx.myTeam!.name} accepted the trade`, waiting ? `It's now waiting for ${waiting}.` : `League review is open for ${hours} hours.`);
    await notifyReview(full, state, route, reviewEndsAt);
    publishTradeEvent(ctx.league.id, trade.id, "ACCEPTED");
    revalidateTrades(trade.id);
    return { ok: true, message: waiting ? `Accepted — awaiting ${waiting}.` : "Accepted — the league review period has started." };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectTradeAction(tradeId: string, note?: string): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const n = noteSchema.parse(note);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    const me = ctx.myTeam ? trade.teams.find((t) => t.teamId === ctx.myTeam!.id) : undefined;
    if (!me || me.teamId === trade.proposerTeamId) return { ok: false, error: "Only teams receiving this offer can reject it." };
    const ok = await transitionTrade(trade.id, ["PROPOSED"], { status: "REJECTED", resolutionNote: n || `Rejected by ${ctx.myTeam!.name}` });
    if (!ok) return { ok: false, error: "This trade is no longer open." };
    await db.tradeTeam.update({ where: { tradeId_teamId: { tradeId: trade.id, teamId: me.teamId } }, data: { respondedAt: new Date(), accepted: false } });
    await notifyTeams(trade, [trade.proposerTeamId], "TRADE_REJECTED", `${ctx.myTeam!.name} rejected your trade`, `${tradeHeadline(trade)}${n ? ` — "${n}"` : ""}`);
    publishTradeEvent(ctx.league.id, trade.id, "REJECTED");
    revalidateTrades(trade.id);
    return { ok: true, message: "Trade rejected." };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelTradeAction(tradeId: string): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    if (ctx.myTeam?.id !== trade.proposerTeamId) return { ok: false, error: "Only the team that proposed this trade can cancel it." };
    const ok = await transitionTrade(trade.id, ["PROPOSED"], { status: "CANCELLED", resolutionNote: `Withdrawn by ${ctx.myTeam.name}` });
    if (!ok) return { ok: false, error: "This trade can no longer be cancelled." };
    await notifyTeams(trade, trade.teams.map((t) => t.teamId).filter((t) => t !== trade.proposerTeamId), "TRADE_CANCELLED", `${ctx.myTeam.name} withdrew their offer`, tradeHeadline(trade));
    publishTradeEvent(ctx.league.id, trade.id, "CANCELLED");
    revalidateTrades(trade.id);
    return { ok: true, message: "Offer withdrawn." };
  } catch (e) {
    return fail(e);
  }
}

export async function voteTradeAction(tradeId: string, vote: "APPROVE" | "VETO"): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const v = z.enum(["APPROVE", "VETO"]).parse(vote);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    if (!ctx.myTeam) return { ok: false, error: "You need a team to vote." };
    if (!canVoteOnTrade(ctx.settings, trade.teams.map((t) => t.teamId), ctx.myTeam.id)) return { ok: false, error: "Teams in the trade can't vote on it." };
    if (trade.status !== "ACCEPTED" || !trade.reviewEndsAt) return { ok: false, error: "This trade isn't open for a league vote." };
    if (trade.reviewEndsAt < new Date()) return { ok: false, error: "The review period has ended." };
    await db.tradeVote.upsert({ where: { tradeId_teamId: { tradeId: trade.id, teamId: ctx.myTeam.id } }, create: { tradeId: trade.id, teamId: ctx.myTeam.id, vote: v }, update: { vote: v, createdAt: new Date() } });
    const votes = await db.tradeVote.findMany({ where: { tradeId: trade.id } });
    const tally = voteTally(votes, ctx.settings.trades.vetoVotesRequired);
    if (tally.vetoed) {
      const r = await vetoTrade(trade.id, { byCommissioner: false, note: `Vetoed by league vote (${tally.veto} vetoes)` });
      revalidateTrades(trade.id);
      return r.ok ? { ok: true, message: "Your veto was the deciding vote — trade vetoed." } : r;
    }
    publishTradeEvent(ctx.league.id, trade.id, "ACCEPTED");
    revalidateTrades(trade.id);
    return { ok: true, message: v === "VETO" ? `Veto recorded (${tally.veto}/${tally.required}).` : "Approval recorded." };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Commissioner ─────────────────────────────

export async function commishApproveTradeAction(tradeId: string, note?: string): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const n = noteSchema.parse(note);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    if (trade.status !== "ACCEPTED" && !(trade.status === "PROPOSED" && trade.teams.every((t) => t.accepted))) return { ok: false, error: "Only trades every team has accepted can be approved. Use force-complete otherwise." };
    const blocked = await ownTradeBlock(ctx, trade, "approve");
    if (blocked) return { ok: false, error: blocked };
    const res = await completeTrade(trade.id, { actorId: ctx.user.id, resolvedById: ctx.user.id, note: n || "Approved by the commissioner" });
    if (!res.ok) return res;
    await audit(ctx, "trade.approve", trade.id, { note: n ?? null, headline: tradeHeadline(trade), ownTrade: !!ctx.myTeam && trade.teams.some((t) => t.teamId === ctx.myTeam!.id) });
    revalidateTrades(trade.id);
    return { ok: true, message: "Trade approved and processed." };
  } catch (e) {
    return fail(e);
  }
}

export async function commishVetoTradeAction(tradeId: string, note?: string): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const n = noteSchema.parse(note);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    const res = await vetoTrade(trade.id, { actorId: ctx.user.id, note: n || "Vetoed by the commissioner", byCommissioner: true });
    if (!res.ok) return res;
    await audit(ctx, "trade.veto", trade.id, { note: n ?? null, headline: tradeHeadline(trade) });
    revalidateTrades(trade.id);
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function commishForceCompleteAction(tradeId: string, note?: string, skipRosterChecks = false): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const n = noteSchema.parse(note);
    const skip = z.boolean().parse(skipRosterChecks);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    const blocked = await ownTradeBlock(ctx, trade, "approve");
    if (blocked) return { ok: false, error: blocked };
    const res = await completeTrade(trade.id, { actorId: ctx.user.id, resolvedById: ctx.user.id, note: n || "Force-completed by the commissioner", force: true, skipRosterChecks: skip });
    if (!res.ok) return res;
    await audit(ctx, "trade.force_complete", trade.id, { note: n ?? null, skipRosterChecks: skip, previousStatus: trade.status, headline: tradeHeadline(trade) });
    revalidateTrades(trade.id);
    return { ok: true, message: "Trade force-completed." };
  } catch (e) {
    return fail(e);
  }
}

export async function commishReverseTradeAction(tradeId: string, note?: string): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const n = noteSchema.parse(note);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    const blocked = await ownTradeBlock(ctx, trade, "reverse");
    if (blocked) return { ok: false, error: blocked };
    const res = await reverseTrade(trade.id, { actorId: ctx.user.id, note: n || null });
    revalidateTrades(trade.id);
    return res;
  } catch (e) {
    return fail(e);
  }
}

export async function commishCancelTradeAction(tradeId: string, note?: string): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const n = noteSchema.parse(note);
    const trade = await loadTrade(id.parse(tradeId));
    if (!trade || trade.leagueId !== ctx.league.id) return { ok: false, error: "Trade not found." };
    const ok = await transitionTrade(trade.id, ["PROPOSED", "ACCEPTED"], { status: "CANCELLED", resolvedById: ctx.user.id, resolutionNote: n || "Cancelled by the commissioner" });
    if (!ok) return { ok: false, error: "This trade is no longer open." };
    await audit(ctx, "trade.cancel", trade.id, { note: n ?? null, previousStatus: trade.status, headline: tradeHeadline(trade) });
    await notifyTeams(trade, trade.teams.map((t) => t.teamId), "TRADE_CANCELLED", "Trade cancelled by the commissioner", `${tradeHeadline(trade)}${n ? ` — ${n}` : ""}`);
    publishTradeEvent(ctx.league.id, trade.id, "CANCELLED");
    revalidateTrades(trade.id);
    return { ok: true, message: "Trade cancelled." };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Trade block ─────────────────────────────

const blockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("OFFERING"), playerId: id.nullish(), pickId: id.nullish(), note: z.string().trim().max(280).optional() }),
  z.object({ kind: z.literal("SEEKING"), position: z.string().trim().min(1).max(8), note: z.string().trim().max(280).optional() }),
]);

export async function addBlockEntryAction(raw: z.input<typeof blockSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    if (!ctx.settings.trades.showTradeBlock) return { ok: false, error: "The trade block is turned off in this league." };
    if (!ctx.myTeam) return { ok: false, error: "You need a team to use the trade block." };
    const input = blockSchema.parse(raw);
    const teamId = ctx.myTeam.id;
    const leagueId = ctx.league.id;
    if (input.kind === "OFFERING") {
      if (!!input.playerId === !!input.pickId) return { ok: false, error: "Choose a player or a draft pick to shop." };
      if (input.playerId) {
        const spot = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId, playerId: input.playerId } } });
        if (!spot || spot.teamId !== teamId) return { ok: false, error: "That player isn't on your roster." };
      } else {
        const pick = await db.draftPick.findUnique({ where: { id: input.pickId! } });
        const seasons = tradablePickSeasons(ctx.settings, firstOpenDraftSeason(ctx.season, ctx.league.phase));
        if (!pick || pick.leagueId !== leagueId || pick.ownerTeamId !== teamId || pick.playerId || pick.usedAt) return { ok: false, error: "You don't own that pick." };
        if (!ctx.settings.trades.allowDraftPickTrading || !seasons.includes(pick.season)) return { ok: false, error: "That pick can't be traded." };
      }
      const existing = await db.tradeBlockEntry.findFirst({ where: { leagueId, teamId, kind: "OFFERING", ...(input.playerId ? { playerId: input.playerId } : { pickId: input.pickId! }) } });
      if (existing) await db.tradeBlockEntry.update({ where: { id: existing.id }, data: { note: input.note || null } });
      else await db.tradeBlockEntry.create({ data: { leagueId, teamId, kind: "OFFERING", playerId: input.playerId ?? null, pickId: input.pickId ?? null, note: input.note || null } });
    } else {
      const pos = input.position.toUpperCase() === "PICKS" ? "PICKS" : normalizePosition(input.position);
      const allowed = new Set([...ctx.settings.roster.slots.flatMap((s) => s.eligible), "PICKS"]);
      if (!allowed.has(pos)) return { ok: false, error: "Pick a position your league uses." };
      const existing = await db.tradeBlockEntry.findFirst({ where: { leagueId, teamId, kind: "SEEKING", position: pos } });
      if (existing) await db.tradeBlockEntry.update({ where: { id: existing.id }, data: { note: input.note || null } });
      else await db.tradeBlockEntry.create({ data: { leagueId, teamId, kind: "SEEKING", position: pos, note: input.note || null } });
    }
    revalidatePath("/trades/block");
    return { ok: true, message: input.kind === "OFFERING" ? "Added to your trade block." : "Need added." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeBlockEntryAction(entryId: string): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const entry = await db.tradeBlockEntry.findUnique({ where: { id: id.parse(entryId) } });
    if (!entry || entry.leagueId !== ctx.league.id) return { ok: false, error: "Entry not found." };
    if (entry.teamId !== ctx.myTeam?.id && !ctx.isCommish) return { ok: false, error: "You can only edit your own trade block." };
    await db.tradeBlockEntry.delete({ where: { id: entry.id } });
    if (entry.teamId !== ctx.myTeam?.id) await audit(ctx, "trade.block_remove", entry.id, { teamId: entry.teamId });
    revalidatePath("/trades/block");
    return { ok: true, message: "Removed from the trade block." };
  } catch (e) {
    return fail(e);
  }
}
