// Draft clock implementation (see clock.ts): runs every 2s from the job scheduler, and lazily whenever a draft room fetches its state:
// auto-starts scheduled drafts, closes expired auction lots, auto-nominates for timed-out nominators and
// autopicks expired rookie picks. Every step uses conditional updates, so overlapping ticks are harmless.
import { db } from "@/lib/db";
import { closeLot, autoNominate } from "@/lib/draft/auction";
import { autopickExpired } from "@/lib/draft/rookie";
import { startDraft } from "@/lib/draft/lifecycle";
import { DraftError, flushNotifications } from "@/lib/draft/shared";

export async function tickDraftsImpl(): Promise<string> {
  const now = new Date();
  // one cheap indexed-by-status query; nothing to do most of the time
  const drafts = await db.draft.findMany({
    where: { OR: [{ status: "LIVE" }, { status: "SCHEDULED", startTime: { lte: now } }] },
    select: { id: true },
  });
  if (!drafts.length) return "idle";
  const out: string[] = [];
  for (const d of drafts) {
    try {
      const r = await advanceDraft(d.id, now);
      if (r) out.push(r);
    } catch (e) {
      out.push(`draft ${d.id}: ${(e as Error).message}`);
    }
  }
  // one-off CLI runs (npm run job) exit right after; inside the server, sends finish in the background
  if (!process.env.NEXT_RUNTIME) await flushNotifications();
  return out.length ? out.join("; ") : "waiting";
}

/** Advance one draft if any of its deadlines passed. Returns what happened (or null). */
export async function advanceDraft(draftId: string, now = new Date()): Promise<string | null> {
  const draft = await db.draft.findUnique({ where: { id: draftId }, select: { id: true, type: true, status: true, startTime: true, pickDeadline: true } });
  if (!draft) return null;
  if (draft.status === "SCHEDULED") {
    if (!draft.startTime || draft.startTime > now) return null;
    try {
      return (await startDraft(draft.id, null)) ? `started ${draft.id}` : null;
    } catch (e) {
      if (e instanceof DraftError) return null;
      throw e;
    }
  }
  if (draft.status !== "LIVE") return null;
  if (draft.type === "ROOKIE") {
    if (!draft.pickDeadline || draft.pickDeadline > now) return null;
    return autopickExpired(draft.id, now);
  }
  if (draft.type === "AUCTION") {
    const open = await db.auctionLot.findFirst({ where: { draftId: draft.id, status: "OPEN" }, select: { id: true, endsAt: true } });
    if (open) {
      if (!open.endsAt || open.endsAt > now) return null;
      const closed = await closeLot(open.id, now);
      return closed ? `lot ${closed.id} ${closed.status}` : null;
    }
    if (!draft.pickDeadline || draft.pickDeadline > now) return null;
    return autoNominate(draft.id, now);
  }
  return null;
}

/** True when a draft has a deadline that has passed (used by the state endpoint to advance lazily). */
export async function draftNeedsTick(draftId: string, now = new Date()): Promise<boolean> {
  const d = await db.draft.findUnique({ where: { id: draftId }, select: { status: true, type: true, startTime: true, pickDeadline: true } });
  if (!d) return false;
  if (d.status === "SCHEDULED") return !!d.startTime && d.startTime <= now;
  if (d.status !== "LIVE") return false;
  if (d.pickDeadline && d.pickDeadline <= now) return true;
  if (d.type === "AUCTION") {
    const open = await db.auctionLot.findFirst({ where: { draftId, status: "OPEN", endsAt: { lte: now } }, select: { id: true } });
    return !!open;
  }
  return false;
}
