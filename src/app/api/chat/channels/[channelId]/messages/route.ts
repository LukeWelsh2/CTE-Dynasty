// GET  /api/chat/channels/:channelId/messages?before=<messageId>  → older page (oldest first)
// POST /api/chat/channels/:channelId/messages { body, replyToId?, nonce? } → send
import { loadMessages, markRead } from "@/lib/chat/server";
import { sendMessage, sendSchema } from "@/lib/chat/service";
import { readJson, withChannel } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return withChannel(channelId, async () => {
    const url = new URL(req.url);
    const before = url.searchParams.get("before");
    const page = await loadMessages(channelId, { before: before && before.length <= 64 ? before : null });
    return Response.json({ ok: true, ...page });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return withChannel(channelId, async (user, access) => {
    const input = sendSchema.parse(await readJson(req));
    const message = await sendMessage(user, access, input);
    await markRead(channelId, user.id, new Date(message.createdAt));
    return Response.json({ ok: true, message });
  });
}
