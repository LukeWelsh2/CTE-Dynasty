// System messages into league chat (trade announcements, transactions, big scoring plays...).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";

export const DEFAULT_CHANNELS = [
  { slug: "general", name: "General", topic: "League-wide chat" },
  { slug: "trash-talk", name: "Trash Talk", topic: "Say it with your chest" },
  { slug: "trades", name: "Trade Talk", topic: "Shop players, float offers" },
  { slug: "transactions", name: "Transactions", topic: "Automatic feed of adds, drops, trades and waivers", type: "ANNOUNCEMENTS" },
];

export async function ensureDefaultChannels(leagueId: string) {
  for (const c of DEFAULT_CHANNELS) {
    await db.chatChannel.upsert({
      where: { leagueId_slug: { leagueId, slug: c.slug } },
      create: { leagueId, slug: c.slug, name: c.name, topic: c.topic, type: c.type ?? "PUBLIC" },
      update: {},
    });
  }
}

/** Post an automated message. kind: SYSTEM | TRADE | TRANSACTION | SCORE */
export async function postSystemMessage(
  leagueId: string,
  body: string,
  opts: { channel?: string; kind?: "SYSTEM" | "TRADE" | "TRANSACTION" | "SCORE"; data?: Record<string, unknown> } = {},
) {
  const slug = opts.channel ?? "transactions";
  let channel = await db.chatChannel.findUnique({ where: { leagueId_slug: { leagueId, slug } } });
  if (!channel) {
    await ensureDefaultChannels(leagueId);
    channel = await db.chatChannel.findUnique({ where: { leagueId_slug: { leagueId, slug } } });
  }
  if (!channel) return null;
  const msg = await db.chatMessage.create({
    data: { channelId: channel.id, kind: opts.kind ?? "SYSTEM", body, data: (opts.data ?? undefined) as Prisma.InputJsonValue | undefined },
    include: { user: { select: { id: true, name: true, avatarUrl: true } }, reactions: true },
  });
  publish(topics.chat(channel.id), "chat.message", msg);
  return msg;
}
