// League chat: pure, client-safe helpers (message shapes, markdown-lite tokenizer, @mentions, day grouping).
// Nothing here touches the database so it can be unit tested and used in client components.

export const MAX_MESSAGE_LENGTH = 2000;
export const PAGE_SIZE = 50;

/** Reactions offered in the picker. The server only accepts these. */
export const CHAT_EMOJIS = ["👍", "👎", "😂", "🔥", "💯", "😮", "😢", "😡", "💀", "🏈", "🏆", "🗑️"] as const;

export type ChatKind = "USER" | "SYSTEM" | "TRADE" | "TRANSACTION" | "SCORE";

export interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

export interface ReplyPreview {
  id: string;
  userId: string | null;
  body: string;
  deleted: boolean;
}

/** Player shown on a system card */
export interface CardPlayer {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
}

/** Fantasy team shown on a system card */
export interface CardTeam {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export type ChatCard =
  | {
      type: "trade";
      tradeId: string;
      url: string;
      status: string;
      sides: { team: CardTeam; received: { label: string; player: CardPlayer | null; kind: string }[] }[];
    }
  | { type: "transaction"; url: string | null; team: CardTeam | null; added: CardPlayer | null; dropped: CardPlayer | null; txType: string | null }
  | { type: "score"; url: string | null; team: CardTeam | null; player: CardPlayer | null; points: number | null };

export interface ChatMessageDTO {
  id: string;
  channelId: string;
  userId: string | null;
  kind: ChatKind;
  body: string;
  data: Record<string, unknown> | null;
  replyTo: ReplyPreview | null;
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: ReactionGroup[];
  card: ChatCard | null;
  /** echoed back to the sender so its optimistic copy can be swapped for the real one */
  nonce?: string | null;
  /** client-only flags for optimistic messages */
  pending?: boolean;
  failed?: boolean;
}

export interface ChatMember {
  userId: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  team: CardTeam | null;
}

export interface ChannelSummary {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  type: string; // PUBLIC | DM | ANNOUNCEMENTS
  memberIds: string[];
  unread: number;
  lastMessageAt: string | null;
}

// ───────────────────────────── Reactions / normalisation ─────────────────────────────

/** Group raw reaction rows (one per user+emoji) preserving first-seen emoji order. */
export function groupReactions(rows: { emoji: string; userId: string }[]): ReactionGroup[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!map.has(r.emoji)) {
      map.set(r.emoji, []);
      order.push(r.emoji);
    }
    const list = map.get(r.emoji)!;
    if (!list.includes(r.userId)) list.push(r.userId);
  }
  return order.map((emoji) => ({ emoji, userIds: map.get(emoji)! })).filter((g) => g.userIds.length > 0);
}

/** Toggle one user's reaction in a grouped list (optimistic UI). */
export function toggleReaction(groups: ReactionGroup[], emoji: string, userId: string): ReactionGroup[] {
  const found = groups.find((g) => g.emoji === emoji);
  if (!found) return [...groups, { emoji, userIds: [userId] }];
  return groups
    .map((g) => (g.emoji !== emoji ? g : { emoji, userIds: g.userIds.includes(userId) ? g.userIds.filter((u) => u !== userId) : [...g.userIds, userId] }))
    .filter((g) => g.userIds.length > 0);
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Accept either a ChatMessageDTO or the raw Prisma row that `postSystemMessage` publishes
 * (`{ ..., user, reactions: [{ emoji, userId }] }`) and return a DTO.
 */
export function normalizeMessage(raw: unknown): ChatMessageDTO | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.channelId !== "string") return null;
  const rawReactions = Array.isArray(r.reactions) ? (r.reactions as Record<string, unknown>[]) : [];
  const reactions: ReactionGroup[] =
    rawReactions.length && Array.isArray(rawReactions[0]?.userIds)
      ? (rawReactions as unknown as ReactionGroup[])
      : groupReactions(rawReactions.filter((x) => typeof x.emoji === "string" && typeof x.userId === "string") as { emoji: string; userId: string }[]);
  const kind = (["USER", "SYSTEM", "TRADE", "TRANSACTION", "SCORE"].includes(String(r.kind)) ? r.kind : "SYSTEM") as ChatKind;
  return {
    id: r.id,
    channelId: r.channelId,
    userId: typeof r.userId === "string" ? r.userId : null,
    kind,
    body: typeof r.body === "string" ? r.body : "",
    data: r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : null,
    replyTo: (r.replyTo as ReplyPreview | null | undefined) ?? null,
    replyToId: typeof r.replyToId === "string" ? r.replyToId : null,
    editedAt: iso(r.editedAt),
    deletedAt: iso(r.deletedAt),
    createdAt: iso(r.createdAt) ?? new Date().toISOString(),
    reactions,
    card: (r.card as ChatCard | null | undefined) ?? null,
    nonce: typeof r.nonce === "string" ? r.nonce : null,
  };
}

/** Insert/replace a message keeping chronological order (dedupes by id). */
export function upsertMessage(list: ChatMessageDTO[], msg: ChatMessageDTO): ChatMessageDTO[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) {
    const next = [...list];
    next[i] = { ...next[i], ...msg, card: msg.card ?? next[i].card, replyTo: msg.replyTo ?? next[i].replyTo };
    return next;
  }
  const next = [...list, msg];
  next.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return next;
}

// ───────────────────────────── Markdown-lite ─────────────────────────────

export type RichToken =
  | { t: "text"; v: string }
  | { t: "bold"; c: RichToken[] }
  | { t: "italic"; c: RichToken[] }
  | { t: "strike"; c: RichToken[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; label: string; external: boolean }
  | { t: "mention"; v: string; userId: string | null; everyone: boolean };

export interface MentionTarget {
  userId: string;
  names: string[];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Only http(s) links and same-site relative paths are ever rendered as anchors. */
export function safeHref(href: string): { href: string; external: boolean } | null {
  const h = href.trim();
  if (/^\/(?!\/)[^\s]*$/.test(h)) return { href: h, external: false };
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(h)) return { href: h, external: true };
  return null;
}

const TRAILING_PUNCT = /[.,!?;:'")\]]+$/;

function buildMentionIndex(targets: MentionTarget[]) {
  const byName = new Map<string, string>();
  for (const t of targets) for (const n of t.names) if (n && n.trim()) byName.set(n.trim().toLowerCase(), t.userId);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  return { byName, names };
}

function inlineRegex(names: string[]) {
  const mentionAlt = ["everyone", "league", ...names.map(escapeRegex)].join("|");
  return new RegExp(
    [
      "(`[^`\\n]{1,500}`)", // 1 code
      "(\\*\\*(?=\\S)[\\s\\S]*?\\S\\*\\*)", // 2 bold
      "(~~(?=\\S)[^~\\n]*?\\S~~)", // 3 strike
      "(\\[[^\\]\\n]{1,200}\\]\\([^\\s)]{1,2000}\\))", // 4 [label](url)
      "(https?:\\/\\/[^\\s<>]+)", // 5 bare url
      "(\\*(?=[^\\s*])[^*\\n]*?[^\\s*]\\*|\\*[^\\s*]\\*)", // 6 italic *x*
      "((?<![\\w])_(?=[^\\s_])[^_\\n]*?[^\\s_]_(?![\\w])|(?<![\\w])_[^\\s_]_(?![\\w]))", // 7 italic _x_
      `((?<![\\w@])@(?:${mentionAlt})(?![\\w]))`, // 8 mention
    ].join("|"),
    "gi",
  );
}

function pushText(out: RichToken[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

function parseInline(s: string, idx: { byName: Map<string, string>; names: string[] }, re: RegExp, depth: number): RichToken[] {
  const out: RichToken[] = [];
  if (depth > 3) {
    pushText(out, s);
    return out;
  }
  const rx = new RegExp(re.source, re.flags);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s))) {
    const whole = m[0];
    if (!whole) {
      rx.lastIndex++;
      continue;
    }
    pushText(out, s.slice(last, m.index));
    last = m.index + whole.length;
    if (m[1]) out.push({ t: "code", v: whole.slice(1, -1) });
    else if (m[2]) out.push({ t: "bold", c: parseInline(whole.slice(2, -2), idx, re, depth + 1) });
    else if (m[3]) out.push({ t: "strike", c: parseInline(whole.slice(2, -2), idx, re, depth + 1) });
    else if (m[4]) {
      const close = whole.indexOf("](");
      const label = whole.slice(1, close);
      const safe = safeHref(whole.slice(close + 2, -1));
      if (safe) out.push({ t: "link", href: safe.href, label, external: safe.external });
      else pushText(out, whole);
    } else if (m[5]) {
      let url = whole;
      let trail = "";
      const tm = url.match(TRAILING_PUNCT);
      if (tm) {
        // keep a closing paren that balances one inside the URL (e.g. wikipedia links)
        let t = tm[0];
        if (t.startsWith(")") && (url.match(/\(/g)?.length ?? 0) > (url.slice(0, -t.length).match(/\)/g)?.length ?? 0)) t = t.slice(1);
        if (t) {
          url = url.slice(0, -t.length);
          trail = t;
        }
      }
      const safe = safeHref(url);
      if (safe) out.push({ t: "link", href: safe.href, label: url, external: true });
      else pushText(out, url);
      pushText(out, trail);
    } else if (m[6] || m[7]) out.push({ t: "italic", c: parseInline(whole.slice(1, -1), idx, re, depth + 1) });
    else if (m[8]) {
      const name = whole.slice(1).toLowerCase();
      const everyone = name === "everyone" || name === "league";
      out.push({ t: "mention", v: whole, userId: everyone ? null : idx.byName.get(name) ?? null, everyone });
    } else pushText(out, whole);
  }
  pushText(out, s.slice(last));
  return out;
}

/** Tokenize a chat message. React renders the tokens as text nodes, so the output is always escaped. */
export function parseRichText(text: string, targets: MentionTarget[] = []): RichToken[] {
  const idx = buildMentionIndex(targets);
  return parseInline(text, idx, inlineRegex(idx.names), 0);
}

function walk(tokens: RichToken[], fn: (t: RichToken) => void) {
  for (const t of tokens) {
    fn(t);
    if (t.t === "bold" || t.t === "italic" || t.t === "strike") walk(t.c, fn);
  }
}

/** @mentions in a message: user ids (deduped) and whether @everyone / @league was used. */
export function extractMentions(text: string, targets: MentionTarget[]): { userIds: string[]; everyone: boolean } {
  const ids = new Set<string>();
  let everyone = false;
  walk(parseRichText(text, targets), (t) => {
    if (t.t !== "mention") return;
    if (t.everyone) everyone = true;
    else if (t.userId) ids.add(t.userId);
  });
  return { userIds: [...ids], everyone };
}

/** Plain-text preview (for reply quotes, notifications). */
export function plainText(text: string, max = 140): string {
  const flat = text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/~~([^~]*?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

/**
 * Active @mention query at the caret, for the composer autocomplete. Returns the query text and the
 * index where the "@" starts, or null when the caret is not inside a mention.
 */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|[\s(])@([^\s@]{0,24}(?: [^\s@]{0,24})?)$/);
  if (!m) return null;
  const query = m[1];
  return { query, start: caret - query.length - 1 };
}

/** Rank members for the mention autocomplete. */
export function matchMembers<T extends { displayName: string; name: string; team?: { name: string } | null }>(members: T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, limit);
  const scored: { m: T; s: number }[] = [];
  for (const m of members) {
    const fields = [m.displayName, m.name, m.team?.name ?? ""].map((f) => f.toLowerCase());
    let s = -1;
    if (fields.some((f) => f.startsWith(q))) s = 3;
    else if (fields.some((f) => f.split(/\s+/).some((w) => w.startsWith(q)))) s = 2;
    else if (fields.some((f) => f.includes(q))) s = 1;
    if (s > 0) scored.push({ m, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.m.displayName.localeCompare(b.m.displayName)).slice(0, limit).map((x) => x.m);
}

// ───────────────────────────── Day grouping ─────────────────────────────

/** YYYY-MM-DD of an instant in a time zone */
export function dayKey(date: Date | string, tz: string): string {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function dayLabel(key: string, tz: string, now = new Date()): string {
  const today = dayKey(now, tz);
  const yesterday = dayKey(new Date(now.getTime() - 864e5), tz);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(noonUtc);
}

export function groupByDay<T extends { createdAt: string }>(messages: T[], tz: string, now = new Date()): { key: string; label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = [];
  for (const m of messages) {
    const k = dayKey(m.createdAt, tz);
    let g = out[out.length - 1];
    if (!g || g.key !== k) {
      g = { key: k, label: dayLabel(k, tz, now), items: [] };
      out.push(g);
    }
    g.items.push(m);
  }
  return out;
}

/** Consecutive messages from the same author within 5 minutes share one header. */
export function continuesPrevious(prev: Pick<ChatMessageDTO, "userId" | "kind" | "createdAt"> | undefined, cur: Pick<ChatMessageDTO, "userId" | "kind" | "createdAt" | "replyToId">): boolean {
  if (!prev || prev.kind !== "USER" || cur.kind !== "USER" || !cur.userId || prev.userId !== cur.userId || cur.replyToId) return false;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
}

export function timeLabel(date: string | Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(date));
}

// ───────────────────────────── Channels ─────────────────────────────

/** Deterministic DM slug for a set of members (order-independent). */
export function dmSlugFor(memberIds: string[], hash: (s: string) => string): string {
  const ids = [...new Set(memberIds)].sort();
  return `dm-${hash(ids.join(",")).slice(0, 20)}`;
}

/** Display name for a DM: the other members' names. */
export function dmTitle(memberIds: string[], meId: string, nameOf: (id: string) => string | undefined): string {
  const others = memberIds.filter((id) => id !== meId);
  if (!others.length) return "Notes to self";
  const names = others.map((id) => nameOf(id) ?? "Former manager");
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** Public channels first in a fixed order, then DMs by most recent activity. */
export function sortChannels(channels: ChannelSummary[], defaultOrder: string[]): ChannelSummary[] {
  const rank = (c: ChannelSummary) => {
    const i = defaultOrder.indexOf(c.slug);
    return i === -1 ? defaultOrder.length : i;
  };
  const pub = channels.filter((c) => c.type !== "DM").sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const dms = channels.filter((c) => c.type === "DM").sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  return [...pub, ...dms];
}
