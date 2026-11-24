// GET /api/chat/unread → { unread } total unread chat messages for the signed-in user in the active league
import { getLeagueContextOrNull } from "@/lib/league";
import { totalUnread } from "@/lib/chat/server";
import { jsonError } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return jsonError("Sign in required", 401);
  return Response.json({ ok: true, unread: await totalUnread(ctx.league.id, ctx.user.id) });
}
