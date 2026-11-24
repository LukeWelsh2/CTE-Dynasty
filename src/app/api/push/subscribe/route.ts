import { z } from "zod";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const schema = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

export async function POST(req: Request) {
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad subscription", { status: 400 });
  const { endpoint, keys } = parsed.data;
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers.get("user-agent")?.slice(0, 300) },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (body.endpoint) await db.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
  else await db.pushSubscription.deleteMany({ where: { userId: user.id } });
  return Response.json({ ok: true });
}
