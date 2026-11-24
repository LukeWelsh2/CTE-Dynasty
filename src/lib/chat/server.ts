// League chat: server-side loaders (channels + unread counts, message pages, system-card enrichment).
import "server-only";
import crypto from "node:crypto";
import { Prisma, type ChatChannel, type ChatMessage, type ChatReaction } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_CHANNELS, ensureDefaultChannels } from "@/lib/chat-system";
import {
  PAGE_SIZE,
  dmSlugFor,
  dmTitle,
  groupReactions,
  plainText,
  sortChannels,
  type CardPlayer,
  type CardTeam,
  type ChannelSummary,
  type ChatCard,
  type ChatKind,
  type ChatMember,
  type ChatMessageDTO,
  type ReplyPreview,
} from "@/lib/chat/format";

export const DEFAULT_CHANNEL_ORDER = DEFAULT_CHANNELS.map((c) => c.slug);

const teamSelect = { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } as const;
const playerSelect = { id: true, fullName: true, position: true, team: true } as const;

export function sha(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function dmSlug(memberIds: string[]) {
  return dmSlugFor(memberIds, sha);
}

/** Every manager in the league with display name, avatar and team (for author headers + mentions). */
export async function chatMembers(leagueId: string): Promise<ChatMember[]> {
  const members = await db.leagueMember.findMany({
    where: { leagueId },
    include: { user: { select: { id: true, name: true, avatarUrl: true, profile: { select: { displayName: true } } } }, team: { select: teamSelect } },
    orderBy: { joinedAt: "asc" },
  });
  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    displayName: m.user.profile?.displayName?.trim() || m.user.name,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
    team: m.team,
  }));
}

/** Channels visible to a user (public + their DMs) with unread counts. */
export async function userChannels(leagueId: string, userId: string, members?: ChatMember[]): Promise<ChannelSummary[]> {
  let channels = await db.chatChannel.findMany({
    where: { leagueId, OR: [{ type: { not: "DM" } }, { memberIds: { has: userId } }] },
  });
  if (!DEFAULT_CHANNEL_ORDER.every((slug) => channels.some((c) => c.slug === slug))) {
    await ensureDefaultChannels(leagueId);
    channels = await db.chatChannel.findMany({ where: { leagueId, OR: [{ type: { not: "DM" } }, { memberIds: { has: userId } }] } });
  }
  const ids = channels.map((c) => c.id);
  const [unreadRows, lastRows] = ids.length
    ? await Promise.all([
        db.$queryRaw<{ channelId: string; n: number }[]>(Prisma.sql`
          SELECT m."channelId" AS "channelId", COUNT(*)::int AS n
          FROM "ChatMessage" m
          LEFT JOIN "ChatReadState" r ON r."channelId" = m."channelId" AND r."userId" = ${userId}
          WHERE m."channelId" IN (${Prisma.join(ids)})
            AND m."deletedAt" IS NULL
            AND (m."userId" IS NULL OR m."userId" <> ${userId})
            AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
          GROUP BY m."channelId"`),
        db.chatMessage.groupBy({ by: ["channelId"], where: { channelId: { in: ids } }, _max: { createdAt: true } }),
      ])
    : [[], []];
  const unread = new Map(unreadRows.map((r) => [r.channelId, Number(r.n)]));
  const last = new Map(lastRows.map((r) => [r.channelId, r._max.createdAt?.toISOString() ?? null]));
  const roster = members ?? (await chatMembers(leagueId));
  const nameOf = (id: string) => roster.find((m) => m.userId === id)?.displayName;
  return sortChannels(
    channels.map((c) => summarize(c, userId, nameOf, unread.get(c.id) ?? 0, last.get(c.id) ?? null)),
    DEFAULT_CHANNEL_ORDER,
  );
}

export function summarize(c: ChatChannel, userId: string, nameOf: (id: string) => string | undefined, unread = 0, lastMessageAt: string | null = null): ChannelSummary {
  return {
    id: c.id,
    slug: c.slug,
    name: c.type === "DM" ? dmTitle(c.memberIds, userId, nameOf) : c.name,
    topic: c.topic,
    type: c.type,
    memberIds: c.memberIds,
    unread,
    lastMessageAt,
  };
}

export interface ChannelAccess {
  channel: ChatChannel;
  role: string;
  isCommish: boolean;
}

/** Load a channel if the user may see it (league member; DM member for DMs). */
export async function channelForUser(userId: string, channelId: string, isSiteAdmin = false): Promise<ChannelAccess | null> {
  const channel = await db.chatChannel.findUnique({ where: { id: channelId } });
  if (!channel) return null;
  const member = await db.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: channel.leagueId, userId } }, select: { role: true } });
  if (!member) return null;
  if (channel.type === "DM" && !channel.memberIds.includes(userId)) return null;
  return { channel, role: member.role, isCommish: member.role === "COMMISSIONER" || member.role === "CO_COMMISSIONER" || isSiteAdmin };
}

type MessageRow = ChatMessage & { reactions: ChatReaction[] };

function toDTO(m: MessageRow, replyTo: ReplyPreview | null, card: ChatCard | null): ChatMessageDTO {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    channelId: m.channelId,
    userId: m.userId,
    kind: m.kind as ChatKind,
    body: deleted ? "" : m.body,
    data: deleted ? null : ((m.data as Record<string, unknown> | null) ?? null),
    replyTo,
    replyToId: m.replyToId,
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    reactions: deleted ? [] : groupReactions(m.reactions),
    card: deleted ? null : card,
  };
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Build structured cards for TRADE / TRANSACTION / SCORE system messages (batched lookups). */
async function buildCards(rows: MessageRow[]): Promise<Map<string, ChatCard>> {
  const sys = rows.filter((r) => !r.deletedAt && r.kind !== "USER" && r.data && typeof r.data === "object");
  const out = new Map<string, ChatCard>();
  if (!sys.length) return out;
  const data = (r: MessageRow) => r.data as Record<string, unknown>;
  const tradeIds = new Set<string>();
  const txIds = new Set<string>();
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const r of sys) {
    const d = data(r);
    if (r.kind === "TRADE" && str(d.tradeId)) tradeIds.add(d.tradeId as string);
    if (r.kind === "TRANSACTION" || r.kind === "SCORE") {
      if (str(d.transactionId)) txIds.add(d.transactionId as string);
      for (const k of ["playerId", "dropPlayerId"]) if (str(d[k])) playerIds.add(d[k] as string);
      if (str(d.teamId)) teamIds.add(d.teamId as string);
    }
  }
  const [trades, txs] = await Promise.all([
    tradeIds.size
      ? db.trade.findMany({
          where: { id: { in: [...tradeIds] } },
          select: {
            id: true,
            status: true,
            teams: { select: { team: { select: teamSelect } } },
            assets: { select: { type: true, toTeamId: true, fromTeamId: true, label: true, faabAmount: true, player: { select: playerSelect } } },
          },
        })
      : [],
    txIds.size ? db.transaction.findMany({ where: { id: { in: [...txIds] } }, select: { id: true, type: true, teamId: true, playerId: true } }) : [],
  ]);
  for (const t of txs) {
    if (t.playerId) playerIds.add(t.playerId);
    if (t.teamId) teamIds.add(t.teamId);
  }
  const [players, teams] = await Promise.all([
    playerIds.size ? db.player.findMany({ where: { id: { in: [...playerIds] } }, select: playerSelect }) : [],
    teamIds.size ? db.team.findMany({ where: { id: { in: [...teamIds] } }, select: teamSelect }) : [],
  ]);
  const tradeById = new Map(trades.map((t) => [t.id, t]));
  const txById = new Map(txs.map((t) => [t.id, t]));
  const playerById = new Map<string, CardPlayer>(players.map((p) => [p.id, p]));
  const teamById = new Map<string, CardTeam>(teams.map((t) => [t.id, t]));

  for (const r of sys) {
    const d = data(r);
    const url = str(d.url);
    if (r.kind === "TRADE") {
      const trade = tradeById.get(d.tradeId as string);
      if (!trade) continue;
      const reversal = /^trade reversed/i.test(r.body);
      out.set(r.id, {
        type: "trade",
        tradeId: trade.id,
        url: url ?? `/trades/${trade.id}`,
        status: trade.status,
        sides: trade.teams.map(({ team }) => ({
          team,
          received: trade.assets
            .filter((a) => (reversal ? a.fromTeamId === team.id : a.toTeamId === team.id))
            .map((a) => ({
              kind: a.type,
              player: a.player ?? null,
              label: a.type === "PLAYER" ? a.player?.fullName ?? a.label ?? "Player" : a.type === "FAAB" ? `$${a.faabAmount ?? 0} FAB` : a.label ?? "Draft pick",
            })),
        })),
      });
    } else if (r.kind === "TRANSACTION" || r.kind === "SCORE") {
      const tx = str(d.transactionId) ? txById.get(d.transactionId as string) : undefined;
      const team = teamById.get((str(d.teamId) ?? tx?.teamId ?? "") as string) ?? null;
      const mainPlayer = playerById.get((str(d.playerId) ?? tx?.playerId ?? "") as string) ?? null;
      if (r.kind === "SCORE") {
        out.set(r.id, { type: "score", url, team, player: mainPlayer, points: typeof d.points === "number" ? d.points : null });
        continue;
      }
      const isDrop = tx?.type === "DROP";
      const dropped = str(d.dropPlayerId) ? playerById.get(d.dropPlayerId as string) ?? null : isDrop ? mainPlayer : null;
      if (!team && !mainPlayer && !dropped) continue;
      out.set(r.id, { type: "transaction", url: url ?? (team ? `/teams/${team.id}` : null), team, added: isDrop ? null : mainPlayer, dropped, txType: tx?.type ?? null });
    }
  }
  return out;
}

async function replyPreviews(rows: MessageRow[]): Promise<Map<string, ReplyPreview>> {
  const ids = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const parents = await db.chatMessage.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, body: true, deletedAt: true } });
  return new Map(parents.map((p) => [p.id, { id: p.id, userId: p.userId, body: p.deletedAt ? "" : plainText(p.body, 160), deleted: !!p.deletedAt }]));
}

export async function toDTOs(rows: MessageRow[]): Promise<ChatMessageDTO[]> {
  const [cards, replies] = await Promise.all([buildCards(rows), replyPreviews(rows)]);
  return rows.map((r) => toDTO(r, r.replyToId ? replies.get(r.replyToId) ?? null : null, cards.get(r.id) ?? null));
}

/** A page of messages, oldest first. `before` = id of the oldest message already loaded. */
export async function loadMessages(channelId: string, opts: { before?: string | null; limit?: number } = {}): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), 100);
  let cursorWhere: Prisma.ChatMessageWhereInput = {};
  if (opts.before) {
    const anchor = await db.chatMessage.findUnique({ where: { id: opts.before }, select: { createdAt: true, id: true, channelId: true } });
    if (!anchor || anchor.channelId !== channelId) return { messages: [], hasMore: false };
    cursorWhere = { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] };
  }
  const rows = await db.chatMessage.findMany({
    where: { channelId, ...cursorWhere },
    include: { reactions: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return { messages: await toDTOs(page), hasMore };
}

export async function messageDTO(id: string): Promise<ChatMessageDTO | null> {
  const row = await db.chatMessage.findUnique({ where: { id }, include: { reactions: true } });
  if (!row) return null;
  return (await toDTOs([row]))[0] ?? null;
}

export async function markRead(channelId: string, userId: string, at = new Date()) {
  await db.chatReadState.upsert({
    where: { channelId_userId: { channelId, userId } },
    create: { channelId, userId, lastReadAt: at },
    update: { lastReadAt: at },
  });
}

/** Total unread across every channel a user can see in a league. */
export async function totalUnread(leagueId: string, userId: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS n
    FROM "ChatMessage" m
    JOIN "ChatChannel" c ON c.id = m."channelId"
    LEFT JOIN "ChatReadState" r ON r."channelId" = m."channelId" AND r."userId" = ${userId}
    WHERE c."leagueId" = ${leagueId}
      AND (c.type <> 'DM' OR ${userId} = ANY(c."memberIds"))
      AND m."deletedAt" IS NULL
      AND (m."userId" IS NULL OR m."userId" <> ${userId})
      AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")`);
  return Number(rows[0]?.n ?? 0);
}
