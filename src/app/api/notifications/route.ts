import { db } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const notifications = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 });
  return Response.json({ notifications });
}

/** Mark read: { ids: string[] } or { all: true } */
export async function POST(req: Request) {
  const user = await getApiUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean };
  await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  return Response.json({ ok: true });
}
