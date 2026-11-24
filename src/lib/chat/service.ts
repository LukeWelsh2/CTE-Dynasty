// League chat mutations used by the /api/chat route handlers: send, edit, delete, react, typing, DMs.
// Every function receives an already-authorized ChannelAccess (see channelForUser).
import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";
import { notify } from "@/lib/notify";
import type { SessionUser } from "@/lib/auth/session";
import { CHAT_EMOJIS, MAX_MESSAGE_LENGTH, extractMentions, groupReactions, plainText, type ChatMember, type ChatMessageDTO } from "@/lib/chat/format";
import { chatMembers, dmSlug, messageDTO, summarize, toDTOs, type ChannelAccess } from "@/lib/chat/server";
import { RateLimiter, sharedLimiter } from "@/lib/chat/rate-limit";

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}

const sendLimiter = () => sharedLimiter("chat.send", () => new RateLimiter(1000, { count: 12, windowMs: 30_000 }));
const typingLimiter = () => sharedLimiter("chat.typing", () => new RateLimiter(1500));
const reactLimiter = () => sharedLimiter("chat.react", () => new RateLimiter(150, { count: 30, windowMs: 20_000 }));
const dmNotifyLimiter = () => sharedLimiter("chat.dmNotify", () => new RateLimiter(2 * 60_000));

/** Remove control characters (keep newlines / tabs) and squeeze runs of blank lines. */
export function cleanBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export const bodySchema = z
  .string({ message: "Message is required" })
  .transform(cleanBody)
  .pipe(z.string().min(1, "Message can't be empty").max(MAX_MESSAGE_LENGTH, `Messages are limited to ${MAX_MESSAGE_LENGTH} characters`));

export const sendSchema = z.object({
  body: bodySchema,
  replyToId: z.string().min(1).max(64).nullish(),
  nonce: z.string().max(64).nullish(),
});

export const editSchema = z.object({ body: bodySchema });
export const reactSchema = z.object({ emoji: z.enum(CHAT_EMOJIS as unknown as [string, ...string[]], { message: "Unsupported reaction" }) });
export const dmSchema = z.object({ userIds: z.array(z.string().min(1).max(64)).min(1, "Pick at least one manager").max(11) });

function displayNameOf(members: ChatMember[], userId: string, fallback: string) {
  return members.find((m) => m.userId === userId)?.displayName ?? fallback;
}

export async function sendMessage(user: SessionUser, access: ChannelAccess, input: z.infer<typeof sendSchema>): Promise<ChatMessageDTO> {
  const { channel, isCommish } = access;
  if (channel.type === "ANNOUNCEMENTS" && !isCommish) throw new ChatError("This channel is an automatic league feed — only the commissioner can post here.", 403);
  const rl = sendLimiter().check(user.id);
  if (!rl.ok) throw new ChatError("You're sending messages too fast — wait a second.", 429, rl.retryAfterMs);

  if (input.replyToId) {
    const parent = await db.chatMessage.findUnique({ where: { id: input.replyToId }, select: { channelId: true, deletedAt: true } });
    if (!parent || parent.channelId !== channel.id) throw new ChatError("The message you're replying to is no longer available.");
    if (parent.deletedAt) throw new ChatError("You can't reply to a deleted message.");
  }
  const row = await db.chatMessage.create({
    data: { channelId: channel.id, userId: user.id, kind: "USER", body: input.body, replyToId: input.replyToId ?? null },
    include: { reactions: true },
  });
  const [dto] = await toDTOs([row]);
  publish(topics.chat(channel.id), "chat.message", { ...dto, nonce: input.nonce ?? null });

  // notifications run after the response is ready; failures never block chat
  void fanOut(user, access, dto).catch((e) => console.error("[chat] notify failed", e));
  return { ...dto, nonce: input.nonce ?? null };
}

async function fanOut(user: SessionUser, access: ChannelAccess, msg: ChatMessageDTO) {
  const { channel, isCommish } = access;
  const members = await chatMembers(channel.leagueId);
  const author = displayNameOf(members, user.id, user.name);
  const audience = channel.type === "DM" ? members.filter((m) => channel.memberIds.includes(m.userId)) : members;
  const others = audience.map((m) => m.userId).filter((id) => id !== user.id);
  const url = `/chat/${channel.slug}`;
  const preview = plainText(msg.body, 180);
  const mentions = extractMentions(msg.body, audience.map((m) => ({ userId: m.userId, names: [m.displayName, m.name] })));
  const mentioned = new Set(mentions.userIds.filter((id) => id !== user.id && others.includes(id)));
  if (mentions.everyone && isCommish && channel.type !== "DM") for (const id of others) mentioned.add(id);

  const where = channel.type === "DM" ? "a direct message" : `#${channel.name}`;
  if (mentioned.size) {
    await notify({
      userIds: [...mentioned],
      leagueId: channel.leagueId,
      type: "CHAT_MENTION",
      title: mentions.everyone && isCommish ? `${author} posted to everyone in ${where}` : `${author} mentioned you in ${where}`,
      body: preview,
      url,
      data: { channelId: channel.id, messageId: msg.id },
    });
  }
  if (channel.type === "DM") {
    const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName;
    for (const id of others) {
      publish(topics.user(id), "chat.activity", { channel: summarize(channel, id, nameOf, 1, msg.createdAt), messageId: msg.id, fromUserId: user.id });
    }
    const dmTargets = others.filter((id) => !mentioned.has(id) && dmNotifyLimiter().check(`${channel.id}:${id}`).ok);
    if (dmTargets.length)
      await notify({
        userIds: dmTargets,
        leagueId: channel.leagueId,
        type: "CHAT_MENTION",
        title: `New message from ${author}`,
        body: preview,
        url,
        data: { channelId: channel.id, messageId: msg.id, dm: true },
      });
  } else {
    // "Every chat message" preference (off by default) — everyone not already notified above
    const rest = others.filter((id) => !mentioned.has(id));
    if (rest.length)
      await notify({ userIds: rest, leagueId: channel.leagueId, type: "CHAT_MESSAGE", title: `${author} in #${channel.name}`, body: preview, url, data: { channelId: channel.id, messageId: msg.id } });
  }
}

export async function editMessage(user: SessionUser, access: ChannelAccess, messageId: string, body: string): Promise<ChatMessageDTO> {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.channelId !== access.channel.id) throw new ChatError("Message not found", 404);
  if (msg.userId !== user.id || msg.kind !== "USER") throw new ChatError("You can only edit your own messages.", 403);
  if (msg.deletedAt) throw new ChatError("That message was deleted.");
  if (msg.body === body) return (await messageDTO(msg.id))!;
  await db.chatMessage.update({ where: { id: msg.id }, data: { body, editedAt: new Date() } });
  const dto = (await messageDTO(msg.id))!;
  publish(topics.chat(access.channel.id), "chat.edit", dto);
  return dto;
}

export async function deleteMessage(user: SessionUser, access: ChannelAccess, messageId: string) {
  const msg = await db.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.channelId !== access.channel.id) throw new ChatError("Message not found", 404);
  if (msg.deletedAt) return { id: msg.id };
  const own = msg.userId === user.id;
  if (!own && !access.isCommish) throw new ChatError("You can only delete your own messages.", 403);
  await db.$transaction(async (tx) => {
    await tx.chatReaction.deleteMany({ where: { messageId: msg.id } });
    await tx.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date(), body: "", data: undefined } });
    if (!own) {
      await tx.auditLog.create({
        data: {
          leagueId: access.channel.leagueId,
          actorId: user.id,
          action: "chat.delete_message",
          targetType: "chatMessage",
          targetId: msg.id,
          details: { channel: access.channel.slug, authorId: msg.userId, kind: msg.kind, body: msg.body.slice(0, 2000), createdAt: msg.createdAt.toISOString() } as Prisma.InputJsonValue,
        },
      });
    }
  });
  publish(topics.chat(access.channel.id), "chat.delete", { id: msg.id, deletedAt: new Date().toISOString() });
  return { id: msg.id };
}

export async function toggleReactionFor(user: SessionUser, access: ChannelAccess, messageId: string, emoji: string) {
  const rl = reactLimiter().check(user.id);
  if (!rl.ok) throw new ChatError("Slow down a little.", 429, rl.retryAfterMs);
  const msg = await db.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, channelId: true, deletedAt: true } });
  if (!msg || msg.channelId !== access.channel.id || msg.deletedAt) throw new ChatError("Message not found", 404);
  const removed = await db.chatReaction.deleteMany({ where: { messageId, userId: user.id, emoji } });
  if (!removed.count) await db.chatReaction.create({ data: { messageId, userId: user.id, emoji } }).catch(() => null);
  const rows = await db.chatReaction.findMany({ where: { messageId }, orderBy: { createdAt: "asc" } });
  const reactions = groupReactions(rows);
  publish(topics.chat(access.channel.id), "chat.reaction", { messageId, reactions });
  return { messageId, reactions };
}

export async function typing(user: SessionUser, access: ChannelAccess) {
  if (!typingLimiter().check(`${user.id}:${access.channel.id}`).ok) return;
  const profile = await db.managerProfile.findUnique({ where: { userId: user.id }, select: { displayName: true } });
  publish(topics.chat(access.channel.id), "chat.typing", { userId: user.id, name: profile?.displayName?.trim() || user.name });
}

/** Find or create the DM channel for the current user plus `userIds` (same league only). */
export async function openDm(user: SessionUser, leagueId: string, userIds: string[]) {
  const ids = [...new Set([user.id, ...userIds])];
  if (ids.length < 2) throw new ChatError("Pick at least one other manager.");
  const members = await db.leagueMember.findMany({ where: { leagueId, userId: { in: ids } }, select: { userId: true, user: { select: { name: true } } } });
  if (members.length !== ids.length) throw new ChatError("Direct messages are limited to managers in this league.", 403);
  const sorted = [...ids].sort();
  const slug = dmSlug(sorted);
  const name = members
    .filter((m) => m.userId !== user.id)
    .map((m) => m.user.name)
    .join(", ")
    .slice(0, 120);
  const channel = await db.chatChannel.upsert({
    where: { leagueId_slug: { leagueId, slug } },
    create: { leagueId, slug, name, type: "DM", memberIds: sorted, topic: "Direct message" },
    update: {},
  });
  return channel;
}
