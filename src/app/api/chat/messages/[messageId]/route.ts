// GET    /api/chat/messages/:id          → one message (with system card) — used for live system posts
// PATCH  /api/chat/messages/:id { body } → edit own message
// DELETE /api/chat/messages/:id          → delete own message (commissioners: any message)
import { db } from "@/lib/db";
import { messageDTO } from "@/lib/chat/server";
import { deleteMessage, editMessage, editSchema } from "@/lib/chat/service";
import { jsonError, readJson, withChannel } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

async function channelOf(messageId: string) {
  if (!messageId || messageId.length > 64) return null;
  const m = await db.chatMessage.findUnique({ where: { id: messageId }, select: { channelId: true } });
  return m?.channelId ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const channelId = await channelOf(messageId);
  if (!channelId) return jsonError("Message not found", 404);
  return withChannel(channelId, async () => Response.json({ ok: true, message: await messageDTO(messageId) }));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const channelId = await channelOf(messageId);
  if (!channelId) return jsonError("Message not found", 404);
  return withChannel(channelId, async (user, access) => {
    const { body } = editSchema.parse(await readJson(req));
    return Response.json({ ok: true, message: await editMessage(user, access, messageId, body) });
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const channelId = await channelOf(messageId);
  if (!channelId) return jsonError("Message not found", 404);
  return withChannel(channelId, async (user, access) => Response.json({ ok: true, ...(await deleteMessage(user, access, messageId)) }));
}
