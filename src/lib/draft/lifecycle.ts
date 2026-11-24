// Draft lifecycle shared by rookie drafts and auctions: start, pause, resume, complete, reschedule, delete.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lockRules, rookieDeadline, rookiePause, rookieRules, auctionRules } from "@/lib/draft/data";
import { clockTimeBetween } from "@/lib/draft/time";
import { skippedIndexes } from "@/lib/draft/logic";
import { DraftError, audit, draftOrderIds, emit, loadDraft } from "@/lib/draft/shared";
import { announceOnClock, notifyDraftLive } from "@/lib/draft/rookie";

type Obj = Record<string, unknown>;

/** SCHEDULED → LIVE. Locks the league's current draft settings into the draft. Idempotent (conditional update). */
export async function startDraft(draftId: string, actorId: string | null): Promise<boolean> {
  const draft = await loadDraft(draftId);
  if (draft.status !== "SCHEDULED") throw new DraftError("Only a scheduled draft can be started.");
  const order = draftOrderIds(draft);
  if (!order.length) throw new DraftError("The draft has no order yet.");
  const settings = draft.settingsResolved;
  const locked = lockRules(draft.settings, settings, draft.type === "AUCTION" ? "AUCTION" : "ROOKIE");
  const now = new Date();
  let deadline: Date | null;
  if (draft.type === "AUCTION") {
    deadline = new Date(now.getTime() + auctionRules({ settings: locked as Prisma.JsonValue }, settings).nominationSeconds * 1000);
  } else {
    deadline = rookieDeadline(now, rookieRules({ settings: locked as Prisma.JsonValue }, settings), settings);
  }
  // first pick that hasn't been used (a draft is always started from its first open pick)
  const upd = await db.draft.updateMany({
    where: { id: draftId, status: "SCHEDULED" },
    data: { status: "LIVE", settings: locked, pickDeadline: deadline, startTime: draft.startTime && draft.startTime <= now ? draft.startTime : now },
  });
  if (upd.count !== 1) return false;
  await audit(draft.leagueId, actorId, "draft.start", draftId, { name: draft.name, auto: !actorId });
  emit(draftId, "draft.status", { status: "LIVE", message: `${draft.name} is live` });
  notifyDraftLive(draft);
  if (draft.type === "ROOKIE") await announceOnClock(draftId);
  else emit(draftId, "draft.clock", { currentIndex: draft.currentIndex, teamId: order[draft.currentIndex % order.length] ?? null, deadline: deadline?.toISOString() ?? null });
  return true;
}

/** LIVE → PAUSED, remembering the time left on the clock / open lot. */
export async function pauseDraft(draftId: string, actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.status !== "LIVE") throw new DraftError("Only a live draft can be paused.");
  const now = Date.now();
  // remaining running clock (a rookie clock that pauses overnight doesn't count the paused hours)
  const pause = draft.type === "ROOKIE" ? rookiePause(rookieRules(draft, draft.settingsResolved), draft.settingsResolved) : null;
  let remaining: number | null = draft.pickDeadline ? Math.max(5_000, clockTimeBetween(new Date(now), draft.pickDeadline, pause)) : null;
  const open = draft.type === "AUCTION" ? await db.auctionLot.findFirst({ where: { draftId, status: "OPEN" } }) : null;
  if (open?.endsAt) remaining = Math.max(5_000, open.endsAt.getTime() - now);
  const upd = await db.draft.updateMany({
    where: { id: draftId, status: "LIVE" },
    data: { status: "PAUSED", pickDeadline: null, settings: { ...((draft.settings ?? {}) as Obj), pausedRemainingMs: remaining } as Prisma.InputJsonValue },
  });
  if (!upd.count) throw new DraftError("The draft state changed — try again.");
  if (open) await db.auctionLot.update({ where: { id: open.id }, data: { endsAt: null } });
  await audit(draft.leagueId, actorId, "draft.pause", draftId);
  emit(draftId, "draft.status", { status: "PAUSED", message: "The commissioner paused the draft" });
}

/** PAUSED → LIVE, restoring the remaining time. */
export async function resumeDraft(draftId: string, actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.status !== "PAUSED") throw new DraftError("Only a paused draft can be resumed.");
  const settings = draft.settingsResolved;
  const s = (draft.settings ?? {}) as Obj;
  const now = new Date();
  const open = draft.type === "AUCTION" ? await db.auctionLot.findFirst({ where: { draftId, status: "OPEN" } }) : null;
  let remaining = typeof s.pausedRemainingMs === "number" ? s.pausedRemainingMs : null;
  const order = draftOrderIds(draft);
  let until: Date | null = null;
  let complete = false;
  if (draft.type === "AUCTION") {
    const r = auctionRules(draft, settings);
    remaining ??= (open ? r.bidSeconds : r.nominationSeconds) * 1000;
    if (open) remaining = Math.max(remaining, r.resetSecondsOnBid * 1000);
    until = new Date(now.getTime() + remaining);
  } else {
    const r = rookieRules(draft, settings);
    if (draft.currentIndex >= order.length) {
      // the regular order is done: finished unless skipped picks are still to be made (no clock for those)
      const used = await db.draftSelection.findMany({ where: { draftId }, select: { pickId: true } });
      complete = skippedIndexes(order, draft.currentIndex, new Set(used.map((u) => u.pickId).filter((x): x is string => !!x))).length === 0;
    } else {
      until = rookieDeadline(now, r, settings, remaining);
    }
  }
  const upd = await db.draft.updateMany({
    where: { id: draftId, status: "PAUSED" },
    data: complete
      ? { status: "COMPLETE", completedAt: now, pickDeadline: null }
      : { status: "LIVE", pickDeadline: open ? null : until, settings: { ...s, pausedRemainingMs: null } as Prisma.InputJsonValue },
  });
  if (!upd.count) throw new DraftError("The draft state changed — try again.");
  if (open && until) await db.auctionLot.update({ where: { id: open.id }, data: { endsAt: until } });
  await audit(draft.leagueId, actorId, "draft.resume", draftId);
  emit(draftId, "draft.status", { status: complete ? "COMPLETE" : "LIVE", message: complete ? `${draft.name} is complete` : "The draft has resumed" });
  if (!complete && draft.type === "ROOKIE" && draft.currentIndex < order.length) await announceOnClock(draftId);
}

/** Commissioner: end the draft now (remaining rookie picks stay unused). */
export async function completeDraft(draftId: string, actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.status === "COMPLETE") throw new DraftError("The draft is already complete.");
  if (draft.status === "SCHEDULED") throw new DraftError("Start the draft first, or delete it.");
  if (draft.type === "AUCTION") {
    const open = await db.auctionLot.count({ where: { draftId, status: "OPEN" } });
    if (open) throw new DraftError("Let the player on the block finish (or undo it) before ending the auction.");
  }
  await db.draft.update({ where: { id: draftId }, data: { status: "COMPLETE", completedAt: new Date(), pickDeadline: null } });
  await audit(draft.leagueId, actorId, "draft.complete", draftId);
  emit(draftId, "draft.status", { status: "COMPLETE", message: `${draft.name} was ended by the commissioner` });
}

/** Commissioner: change the scheduled start (or clear it). */
export async function rescheduleDraft(draftId: string, startTime: Date | null, actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.status !== "SCHEDULED") throw new DraftError("Only a scheduled draft can be rescheduled.");
  if (startTime && startTime.getTime() < Date.now() - 60_000) throw new DraftError("Pick a start time in the future (or start the draft now).");
  await db.draft.update({ where: { id: draftId }, data: { startTime } });
  await audit(draft.leagueId, actorId, "draft.schedule", draftId, { startTime: startTime?.toISOString() ?? null });
  emit(draftId, "draft.status", { status: "SCHEDULED" });
}

/** Commissioner: delete a draft that has no picks / sales. Rookie pick numbering for that season is cleared. */
export async function deleteDraft(draftId: string, actorId: string | null) {
  const draft = await loadDraft(draftId);
  const [selections, sold] = await Promise.all([db.draftSelection.count({ where: { draftId } }), db.auctionLot.count({ where: { draftId, status: { in: ["SOLD", "OPEN"] } } })]);
  if (selections || sold) throw new DraftError("Undo every pick / sale before deleting this draft.");
  if (draft.status === "COMPLETE" && draft.type === "AUCTION") throw new DraftError("Completed auctions are kept as league history.");
  await db.$transaction(async (tx) => {
    if (draft.type === "ROOKIE") {
      await tx.draftPick.updateMany({ where: { leagueId: draft.leagueId, season: draft.season, playerId: null }, data: { pickInRound: null, overall: null } });
    }
    await tx.draft.delete({ where: { id: draftId } });
  });
  await audit(draft.leagueId, actorId, "draft.delete", draftId, { name: draft.name, type: draft.type, season: draft.season });
  emit(draftId, "draft.status", { status: "DELETED", message: `${draft.name} was deleted` });
}
