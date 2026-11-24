// Which draft a room page shows when no ?id= is given.
import type { Draft, DraftType } from "@prisma/client";
import { db } from "@/lib/db";
import { advanceDraft, draftNeedsTick } from "@/lib/draft/tick";

const RANK: Record<string, number> = { LIVE: 0, PAUSED: 1, SCHEDULED: 2, COMPLETE: 3 };

/** Live/paused first, then the next scheduled one, then the most recently completed. */
export async function pickRoomDraft(leagueId: string, type: DraftType, id?: string | null): Promise<{ draft: Draft | null; all: Draft[] }> {
  const all = await db.draft.findMany({ where: { leagueId, type }, orderBy: [{ season: "desc" }, { createdAt: "desc" }] });
  let draft = (id && all.find((d) => d.id === id)) || null;
  if (!draft) {
    draft =
      [...all].sort((a, b) => {
        const r = RANK[a.status] - RANK[b.status];
        if (r) return r;
        if (a.status === "SCHEDULED") return a.season - b.season;
        return (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0) || b.season - a.season;
      })[0] ?? null;
  }
  if (draft && (await draftNeedsTick(draft.id))) {
    await advanceDraft(draft.id).catch((e) => console.error("[draft] advance", e));
    draft = (await db.draft.findUnique({ where: { id: draft.id } })) ?? draft;
  }
  return { draft, all };
}
