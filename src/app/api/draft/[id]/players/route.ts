// GET /api/draft/<id>/players?q=name&pos=WR — search the draft's eligible player pool.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getLeagueContextOrNull } from "@/lib/league";
import { searchDraftPlayers } from "@/lib/draft/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const draft = await db.draft.findUnique({ where: { id }, select: { leagueId: true } });
  if (!draft || draft.leagueId !== ctx.league.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);
  const pos = url.searchParams.get("pos");
  const players = await searchDraftPlayers(id, q, pos && /^[A-Z]{1,4}$/.test(pos) ? pos : null, { teamId: ctx.myTeam?.id ?? null, isCommish: ctx.isCommish });
  return NextResponse.json({ players }, { headers: { "cache-control": "no-store" } });
}
