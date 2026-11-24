// Server-Sent Events endpoint. GET /api/stream?topics=league:abc,chat:def
// Only topics the signed-in user is allowed to see are subscribed.
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";
import { subscribe, type LiveEvent } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function allowedTopics(userId: string, requested: string[]): Promise<string[]> {
  const memberships = await db.leagueMember.findMany({ where: { userId }, select: { leagueId: true } });
  const leagueIds = new Set(memberships.map((m) => m.leagueId));
  const out: string[] = [];
  for (const t of requested) {
    const [kind, id] = t.split(":");
    if (!id) continue;
    if (kind === "user" && id === userId) out.push(t);
    else if (kind === "league" && leagueIds.has(id)) out.push(t);
    else if (kind === "chat") {
      const ch = await db.chatChannel.findUnique({ where: { id }, select: { leagueId: true, type: true, memberIds: true } });
      if (ch && leagueIds.has(ch.leagueId) && (ch.type !== "DM" || ch.memberIds.includes(userId))) out.push(t);
    } else if (kind === "draft") {
      const d = await db.draft.findUnique({ where: { id }, select: { leagueId: true } });
      if (d && leagueIds.has(d.leagueId)) out.push(t);
    }
  }
  return out;
}

export async function GET(req: Request) {
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const requested = (url.searchParams.get("topics") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25);
  const topicList = await allowedTopics(user.id, [...requested, `user:${user.id}`]);

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ topics: topicList })}\n\n`);
      const unsub = subscribe(topicList, (e: LiveEvent) => send(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => send(`: ping ${Date.now()}\n\n`), 20_000);
      cleanup = () => {
        clearInterval(ping);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
