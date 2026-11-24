// POST /api/chat/channels/:channelId/read → mark the channel read for the current user
import { markRead } from "@/lib/chat/server";
import { withChannel } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return withChannel(channelId, async (user) => {
    await markRead(channelId, user.id);
    return Response.json({ ok: true });
  });
}
