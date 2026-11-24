// POST /api/chat/messages/:id/reactions { emoji } → toggle the current user's reaction
import { db } from "@/lib/db";
import { reactSchema, toggleReactionFor } from "@/lib/chat/service";
import { jsonError, readJson, withChannel } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const m = messageId.length <= 64 ? await db.chatMessage.findUnique({ where: { id: messageId }, select: { channelId: true } }) : null;
  if (!m) return jsonError("Message not found", 404);
  return withChannel(m.channelId, async (user, access) => {
    const { emoji } = reactSchema.parse(await readJson(req));
    return Response.json({ ok: true, ...(await toggleReactionFor(user, access, messageId, emoji)) });
  });
}
