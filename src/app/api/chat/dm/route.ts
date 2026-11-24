// POST /api/chat/dm { userIds: string[] } → find or create a direct-message channel, returns its slug
import { getLeagueContextOrNull } from "@/lib/league";
import { dmSchema, openDm } from "@/lib/chat/service";
import { handleError, jsonError, readJson } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return jsonError("Sign in required", 401);
  try {
    const { userIds } = dmSchema.parse(await readJson(req));
    const channel = await openDm(ctx.user, ctx.league.id, userIds);
    return Response.json({ ok: true, slug: channel.slug, channelId: channel.id });
  } catch (e) {
    return handleError(e);
  }
}
