// GET /api/draft/<id>/state — live room state for the signed-in league member.
// Advances the draft clock lazily (expired lots / picks / scheduled starts) so rooms keep moving even
// when the background scheduler is disabled or lagging; every advance step is idempotent.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLeagueContextOrNull } from "@/lib/league";
import { advanceDraft, draftNeedsTick } from "@/lib/draft/tick";
import { getAuctionRoomState, getRookieRoomState } from "@/lib/draft/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const draft = await db.draft.findUnique({ where: { id }, select: { id: true, leagueId: true, type: true } });
  if (!draft || draft.leagueId !== ctx.league.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (await draftNeedsTick(id)) {
    try {
      await advanceDraft(id);
    } catch (e) {
      console.error("[draft state] advance failed", e);
    }
  }
  const viewer = { teamId: ctx.myTeam?.id ?? null, isCommish: ctx.isCommish };
  const state = draft.type === "AUCTION" ? await getAuctionRoomState(id, viewer) : await getRookieRoomState(id, viewer);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
}
