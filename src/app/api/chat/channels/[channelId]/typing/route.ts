// POST /api/chat/channels/:channelId/typing → broadcast an ephemeral "chat.typing" event
import { typing } from "@/lib/chat/service";
import { withChannel } from "@/lib/chat/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return withChannel(channelId, async (user, access) => {
    await typing(user, access);
    return Response.json({ ok: true });
  });
}
