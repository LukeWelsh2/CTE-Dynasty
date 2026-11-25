"use client";
// Live league chat: channel sidebar, day-grouped message list (load older on scroll up), composer,
// reactions, replies, edits, typing indicator and optimistic sends. Live via SSE topic chat:<channelId>.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, Hash, Loader2, Megaphone, Menu, MessageCircle, SquarePen, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, chipClass } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { useLiveEvents, type LiveEvent } from "@/lib/realtime/client";
import {
  continuesPrevious,
  groupByDay,
  normalizeMessage,
  plainText,
  sortChannels,
  toggleReaction,
  upsertMessage,
  type ChannelSummary,
  type ChatMember,
  type ChatMessageDTO,
  type MentionTarget,
  type ReactionGroup,
} from "@/lib/chat/format";
import { cn } from "@/lib/utils";
import { MessageRow, type MessageActions } from "./chat-message";
import { ChannelList, NewDmModal } from "./chat-sidebar";
import { Composer, type ComposerHandle } from "./chat-composer";

interface Props {
  me: { id: string; isCommish: boolean };
  tz: string;
  channels: ChannelSummary[];
  channelOrder: string[];
  activeId: string;
  initial: { messages: ChatMessageDTO[]; hasMore: boolean };
  members: ChatMember[];
}

type FeedFilter = "all" | "trades" | "moves" | "notes";
const FEED_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trades", label: "Trades" },
  { key: "moves", label: "Adds & drops" },
  { key: "notes", label: "League notes" },
];

function newNonce() {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || data.ok === false)
    return {
      ...data,
      ok: false,
      error: data.error ?? `Request failed (${res.status})`,
    };
  return { ...data, ok: true };
}

/**
 * Size the chat to the viewport. Phones: fixed from under the page header to the bottom of the screen, with room
 * reserved for the floating tab bar (the composer sits right above it); while the on-screen keyboard is open the
 * box ends at the top of the keyboard instead (iOS and Android Chrome shrink only the visual viewport). Desktop:
 * flows in the page at the window height.
 */
function useChatBox(anchor: React.RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState<{
    mobile: boolean;
    top: number;
    bottom: number;
    reserve: number;
    height: number;
  } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = anchor.current;
      if (!el) return;
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      const vv = window.visualViewport;
      const vh = vv?.height ?? window.innerHeight;
      if (mobile) {
        const keyboard = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
        if (keyboard > 80) {
          // keep the channel header in view if the browser panned the visual viewport to the field
          const top = Math.max(docTop, vv?.offsetTop ?? 0);
          setBox({
            mobile,
            top,
            bottom: keyboard,
            reserve: 0,
            height: Math.max(200, vh - top),
          });
        } else {
          const nav = document.querySelector<HTMLElement>(".tabbar-float");
          const shown = !!nav && getComputedStyle(nav).display !== "none";
          const reserve = shown ? Math.max(0, window.innerHeight - nav!.getBoundingClientRect().top) + 6 : 0;
          setBox({
            mobile,
            top: docTop,
            bottom: 0,
            reserve,
            height: Math.max(320, vh - docTop),
          });
        }
      } else {
        setBox({
          mobile,
          top: docTop,
          bottom: 0,
          reserve: 0,
          height: Math.max(480, vh - docTop - 20),
        });
      }
    };
    window.scrollTo(0, 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [anchor]);
  return box;
}

export function ChatApp({ me, tz, channels: initialChannels, channelOrder, activeId, initial, members }: Props) {
  const [channels, setChannels] = useState(initialChannels);
  const [messages, setMessages] = useState<ChatMessageDTO[]>(initial.messages);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessageDTO | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [newBelow, setNewBelow] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");

  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const nearBottom = useRef(true);
  const pendingScroll = useRef<{ kind: "bottom" } | { kind: "preserve"; height: number; top: number } | null>({ kind: "bottom" });
  const lastTypingSent = useRef(0);
  const lastReadSent = useRef(0);
  const box = useChatBox(anchorRef);

  const active = channels.find((c) => c.id === activeId)!;
  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);
  const memberName = useCallback((id: string) => memberMap.get(id)?.displayName ?? "Former manager", [memberMap]);
  const mentionTargets: MentionTarget[] = useMemo(
    () =>
      members.map((m) => ({
        userId: m.userId,
        names: [m.displayName, m.name],
      })),
    [members],
  );
  const isFeed = active.type === "ANNOUNCEMENTS";
  const canPost = !isFeed || me.isCommish;

  // ── read state ──
  const markRead = useCallback(
    (force = false) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastReadSent.current < 3000) return;
      lastReadSent.current = now;
      void fetch(`/api/chat/channels/${activeId}/read`, {
        method: "POST",
      }).catch(() => {});
    },
    [activeId],
  );
  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && markRead(true);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [markRead]);

  // ── scrolling ──
  useLayoutEffect(() => {
    const el = listRef.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    if (p.kind === "bottom") el.scrollTop = el.scrollHeight;
    else el.scrollTop = el.scrollHeight - p.height + p.top;
    pendingScroll.current = null;
  }, [messages, box?.height]);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewBelow(0);
  };

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore) return;
    const oldest = messages.find((m) => !m.pending && !m.failed);
    if (!oldest) return;
    setLoadingOlder(true);
    const res = await api<{ messages: ChatMessageDTO[]; hasMore: boolean }>(`/api/chat/channels/${activeId}/messages?before=${encodeURIComponent(oldest.id)}`);
    setLoadingOlder(false);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't load older messages");
      return;
    }
    const el = listRef.current;
    if (el)
      pendingScroll.current = {
        kind: "preserve",
        height: el.scrollHeight,
        top: el.scrollTop,
      };
    setHasMore(res.hasMore);
    setMessages((list) => {
      let next = list;
      for (const m of res.messages) next = upsertMessage(next, m);
      return next;
    });
  }, [activeId, hasMore, loadingOlder, messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom.current && newBelow) setNewBelow(0);
    if (el.scrollTop < 160 && hasMore && !loadingOlder) void loadOlder();
  };

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const appendLive = useCallback((msg: ChatMessageDTO, opts: { own?: boolean } = {}) => {
    const cur = messagesRef.current;
    const known = cur.some((m) => m.id === msg.id || (!!msg.nonce && m.id === `tmp-${msg.nonce}`));
    if (!known) {
      if (nearBottom.current || opts.own) pendingScroll.current = { kind: "bottom" };
      else setNewBelow((n) => n + 1);
    }
    setMessages((list) => {
      const without = msg.nonce ? list.filter((m) => m.id !== `tmp-${msg.nonce}`) : list;
      return upsertMessage(without, {
        ...msg,
        pending: false,
        failed: false,
      });
    });
  }, []);

  // ── live events ──
  const subscribedIds = useMemo(() => {
    const others = channels.filter((c) => c.id !== activeId).slice(0, 20);
    return [activeId, ...others.map((c) => c.id)];
  }, [channels, activeId]);
  const topicList = useMemo(() => [...subscribedIds.map((id) => `chat:${id}`), `user:${me.id}`], [subscribedIds, me.id]);

  // the stream can deliver the same user-topic event more than once (e.g. after a reconnect): count each message once
  const seenActivity = useRef(new Set<string>());
  useLiveEvents(topicList, (e: LiveEvent) => {
    if (e.topic === `user:${me.id}`) {
      if (e.type !== "chat.activity") return;
      const d = e.data as { channel: ChannelSummary; messageId?: string };
      if (!d?.channel || subscribedIds.includes(d.channel.id)) return;
      if (d.messageId) {
        if (seenActivity.current.has(d.messageId)) return;
        seenActivity.current.add(d.messageId);
      }
      setChannels((list) =>
        sortChannels(
          [
            ...list.filter((c) => c.id !== d.channel.id),
            {
              ...d.channel,
              unread: (list.find((c) => c.id === d.channel.id)?.unread ?? 0) + 1,
            },
          ],
          channelOrder,
        ),
      );
      return;
    }
    const channelId = e.topic.slice(5);
    if (channelId !== activeId) {
      if (e.type === "chat.message") {
        const m = normalizeMessage(e.data);
        if (!m || m.userId === me.id) return;
        setChannels((list) => list.map((c) => (c.id === channelId ? { ...c, unread: c.unread + 1, lastMessageAt: m.createdAt } : c)));
      }
      return;
    }
    switch (e.type) {
      case "chat.message": {
        const m = normalizeMessage(e.data);
        if (!m) return;
        appendLive(m, { own: m.userId === me.id });
        setTyping((t) => {
          if (!m.userId || !t[m.userId]) return t;
          const n = { ...t };
          delete n[m.userId];
          return n;
        });
        if (m.kind !== "USER" && !m.card && m.data && (m.data.tradeId || m.data.playerId || m.data.transactionId)) {
          void api<{ message: ChatMessageDTO }>(`/api/chat/messages/${m.id}`).then(
            (r) => r.ok && r.message && setMessages((list) => upsertMessage(list, r.message)),
          );
        }
        if (m.userId !== me.id) markRead();
        break;
      }
      case "chat.edit": {
        const m = normalizeMessage(e.data);
        if (m) setMessages((list) => (list.some((x) => x.id === m.id) ? upsertMessage(list, m) : list));
        break;
      }
      case "chat.delete": {
        const d = e.data as { id: string; deletedAt: string };
        setMessages((list) =>
          list.map((m) =>
            m.id === d.id
              ? {
                  ...m,
                  deletedAt: d.deletedAt,
                  body: "",
                  reactions: [],
                  card: null,
                }
              : m,
          ),
        );
        break;
      }
      case "chat.reaction": {
        const d = e.data as { messageId: string; reactions: ReactionGroup[] };
        setMessages((list) => list.map((m) => (m.id === d.messageId ? { ...m, reactions: d.reactions } : m)));
        break;
      }
      case "chat.typing": {
        const d = e.data as { userId: string; name: string };
        if (d.userId === me.id) return;
        setTyping((t) => ({
          ...t,
          [d.userId]: { name: d.name, until: Date.now() + 5000 },
        }));
        break;
      }
    }
  });

  useEffect(() => {
    if (!Object.keys(typing).length) return;
    const t = setInterval(() => {
      const now = Date.now();
      setTyping((cur) => {
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [typing]);

  // ── actions ──
  const send = useCallback(
    async (body: string, retryOf?: ChatMessageDTO): Promise<boolean> => {
      const nonce = newNonce();
      const reply = retryOf
        ? retryOf.replyTo
        : replyTo
          ? {
              id: replyTo.id,
              userId: replyTo.userId,
              body: plainText(replyTo.body, 160),
              deleted: false,
            }
          : null;
      const temp: ChatMessageDTO = {
        id: `tmp-${nonce}`,
        channelId: activeId,
        userId: me.id,
        kind: "USER",
        body,
        data: null,
        replyTo: reply,
        replyToId: reply?.id ?? null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        reactions: [],
        card: null,
        pending: true,
      };
      setMessages((list) => [...list.filter((m) => m.id !== retryOf?.id), temp]);
      pendingScroll.current = { kind: "bottom" };
      setReplyTo(null);
      const res = await api<{ message: ChatMessageDTO }>(`/api/chat/channels/${activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body, replyToId: reply?.id ?? null, nonce }),
      });
      if (!res.ok || !res.message) {
        setMessages((list) => list.map((m) => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
        toast.error(res.error ?? "Message not sent");
        return true;
      }
      appendLive(res.message, { own: true });
      return true;
    },
    [activeId, me.id, replyTo, appendLive],
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  const onTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 3000) return;
    lastTypingSent.current = now;
    void fetch(`/api/chat/channels/${activeId}/typing`, {
      method: "POST",
    }).catch(() => {});
  }, [activeId]);

  const actions: MessageActions = useMemo(
    () => ({
      onReply: (m) => {
        setReplyTo(m);
        setSelectedId(null);
        composerRef.current?.focus();
      },
      onEditSave: async (m, body) => {
        const res = await api<{ message: ChatMessageDTO }>(`/api/chat/messages/${m.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
        if (!res.ok) {
          toast.error(res.error ?? "Couldn't save your edit");
          return false;
        }
        if (res.message) setMessages((list) => upsertMessage(list, res.message));
        return true;
      },
      onDelete: async (m) => {
        const own = m.userId === me.id;
        if (!window.confirm(own ? "Delete this message?" : "Delete this message as commissioner? This is recorded in the audit log.")) return;
        setMessages((list) =>
          list.map((x) =>
            x.id === m.id
              ? {
                  ...x,
                  deletedAt: new Date().toISOString(),
                  body: "",
                  reactions: [],
                  card: null,
                }
              : x,
          ),
        );
        setSelectedId(null);
        const res = await api(`/api/chat/messages/${m.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
          toast.error(res.error ?? "Couldn't delete the message");
        }
      },
      onReact: async (m, emoji) => {
        setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions: toggleReaction(x.reactions, emoji, me.id) } : x)));
        const res = await api<{ reactions: ReactionGroup[] }>(`/api/chat/messages/${m.id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) });
        if (!res.ok) {
          setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions: toggleReaction(x.reactions, emoji, me.id) } : x)));
          toast.error(res.error ?? "Couldn't react");
        } else if (res.reactions) setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, reactions: res.reactions } : x)));
      },
      onRetry: (m) => void sendRef.current(m.body, m),
      onDiscard: (m) => setMessages((list) => list.filter((x) => x.id !== m.id)),
      onJumpTo: (id) => {
        const el = document.getElementById(`msg-${id}`);
        if (!el) {
          toast.message("That message is further back — scroll up to load older messages.");
          return;
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashId(id);
        setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1700);
      },
      onSelect: (id) => setSelectedId(id),
    }),
    [me.id],
  );

  const editLast = useCallback(() => {
    const last = [...messages].reverse().find((m) => m.userId === me.id && m.kind === "USER" && !m.deletedAt && !m.pending && !m.failed);
    if (last) setEditingId(last.id);
  }, [messages, me.id]);

  // ── derived ──
  const visible = useMemo(() => {
    if (!isFeed || filter === "all") return messages;
    return messages.filter((m) =>
      filter === "trades" ? m.kind === "TRADE" : filter === "moves" ? m.kind === "TRANSACTION" : m.kind === "SYSTEM" || m.kind === "USER" || m.kind === "SCORE",
    );
  }, [messages, isFeed, filter]);
  const days = useMemo(() => groupByDay(visible, tz), [visible, tz]);
  const typingNames = Object.values(typing).map((t) => t.name);
  const dmOthers = active.type === "DM" ? active.memberIds.filter((id) => id !== me.id) : [];
  const placeholder = active.type === "DM" ? `Message ${active.name}` : `Message #${active.name}`;
  const totalUnreadElsewhere = channels.filter((c) => c.id !== activeId).reduce((a, c) => a + c.unread, 0);

  const style: React.CSSProperties | undefined = box
    ? box.mobile
      ? {
          position: "fixed",
          left: 0,
          right: 0,
          top: box.top,
          bottom: box.bottom,
          height: "auto",
          zIndex: 20,
          paddingBottom: box.reserve,
        }
      : { height: box.height }
    : undefined;

  const feedFilters = (cls: string) => (
    <ScrollRow className={cls} role="group" aria-label="Filter feed" snap={false}>
      {FEED_FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          aria-pressed={filter === f.key}
          data-active={filter === f.key || undefined}
          onClick={() => setFilter(f.key)}
          className={chipClass(filter === f.key, "md")}
        >
          {f.label}
        </button>
      ))}
    </ScrollRow>
  );

  return (
    <>
      <div ref={anchorRef} aria-hidden className="h-0" />
      <div
        style={style}
        className={cn(
          "flex h-[calc(100dvh-210px)] min-h-[320px] overflow-hidden bg-panel md:rounded-card md:shadow-card",
          box?.mobile && "border-t border-line/70",
        )}
      >
        <aside className="hidden w-64 shrink-0 border-r border-line/70 md:block">
          <div className="flex h-14 items-center gap-2 border-b border-line/70 px-4">
            <MessageCircle size={17} className="text-brand-600 dark:text-brand-400" aria-hidden />
            <span className="text-[17px] font-bold tracking-[-0.01em]">Chat</span>
          </div>
          <div className="h-[calc(100%-3.5rem)]">
            <ChannelList channels={channels} activeId={activeId} meId={me.id} members={memberMap} onNewDm={() => setDmOpen(true)} />
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col" aria-label={`${active.name} conversation`}>
          <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line/70 pl-1.5 pr-2 md:pl-4 md:pr-4">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-sunken active:bg-sunken md:hidden"
              aria-label={totalUnreadElsewhere > 0 ? `Channels (${totalUnreadElsewhere} unread elsewhere)` : "Channels"}
            >
              <Menu size={20} />
              {totalUnreadElsewhere > 0 && (
                <span className="numeral absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-live px-1 text-[11px] font-bold leading-none text-white ring-2 ring-panel">
                  {totalUnreadElsewhere > 9 ? "9+" : totalUnreadElsewhere}
                </span>
              )}
            </button>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted" aria-hidden>
              {active.type === "DM" ? (
                dmOthers.length === 1 ? (
                  <Avatar name={active.name} src={memberMap.get(dmOthers[0])?.avatarUrl} size={30} />
                ) : (
                  <Users size={19} />
                )
              ) : active.type === "ANNOUNCEMENTS" ? (
                <Megaphone size={19} />
              ) : (
                <Hash size={19} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-bold leading-6 tracking-[-0.01em]" title={active.name}>
                {active.name}
              </h1>
              <p className="truncate text-[13px] leading-[18px] text-muted">
                {active.type === "DM" ? (
                  <>
                    Private ·{" "}
                    {dmOthers.map((id, i) => (
                      <span key={id}>
                        {i > 0 && ", "}
                        <Link href={`/managers/${id}`} className="hover:text-ink hover:underline">
                          {memberName(id)}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : (
                  active.topic
                )}
              </p>
            </div>
            {isFeed && feedFilters("hidden shrink-0 gap-1.5 lg:flex")}
            <button
              type="button"
              onClick={() => setDmOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-brand-600 transition-colors hover:bg-sunken active:bg-sunken md:hidden dark:text-brand-400"
              aria-label="New direct message"
              title="New direct message"
            >
              <SquarePen size={19} />
            </button>
          </header>
          {isFeed && feedFilters("shrink-0 gap-2 border-b border-line/70 px-3 py-2 lg:hidden")}

          <div className="relative min-h-0 flex-1">
            <div
              ref={listRef}
              onScroll={onScroll}
              className="scroll-thin h-full overflow-y-auto overscroll-contain pb-3"
              aria-live="polite"
              aria-relevant="additions"
            >
              {hasMore ? (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-brand-600 hover:bg-sunken disabled:text-muted dark:text-brand-400"
                  >
                    {loadingOlder && <Loader2 size={14} className="animate-spin" />}
                    {loadingOlder ? "Loading older messages…" : "Load older messages"}
                  </button>
                </div>
              ) : (
                <div className="px-4 pb-1 pt-5">
                  <div className="text-[17px] font-bold tracking-[-0.01em]">{active.type === "DM" ? active.name : `#${active.name}`}</div>
                  <p className="max-w-[70ch] text-[13px] text-muted">
                    {active.type === "DM"
                      ? "Start of your private conversation."
                      : isFeed
                        ? "Every trade, claim, add and drop posts here automatically."
                        : `Start of #${active.name}.`}
                  </p>
                </div>
              )}
              {visible.length === 0 && (
                <div className="px-4 py-10 text-center text-[15px] text-muted">
                  {isFeed ? (
                    filter !== "all" ? (
                      "Nothing of this type in the loaded history."
                    ) : (
                      <>
                        No league moves yet.{" "}
                        <Link href="/transactions" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                          Transaction log
                        </Link>
                      </>
                    )
                  ) : active.type === "DM" ? (
                    "No messages yet — say hello."
                  ) : (
                    "No messages yet — say something!"
                  )}
                </div>
              )}
              {days.map((d) => (
                <div key={d.key}>
                  <div className="mx-4 mt-4 h-px bg-line/70" aria-hidden />
                  <div className="pointer-events-none sticky top-1.5 z-[5] -mt-3 mb-1 flex justify-center">
                    <span className="rounded-full bg-panel px-3 py-0.5 text-[12px] font-semibold text-muted shadow-card">{d.label}</span>
                  </div>
                  {d.items.map((m, i) => (
                    <MessageRow
                      key={m.id}
                      msg={m}
                      author={m.userId ? memberMap.get(m.userId) : undefined}
                      replyAuthor={m.replyTo ? (m.replyTo.userId ? memberName(m.replyTo.userId) : "League Office") : undefined}
                      showHeader={!continuesPrevious(d.items[i - 1], m)}
                      meId={me.id}
                      canModerate={me.isCommish}
                      mentions={mentionTargets}
                      memberName={memberName}
                      tz={tz}
                      selected={selectedId === m.id}
                      editing={editingId === m.id}
                      flash={flashId === m.id}
                      setEditing={setEditingId}
                      actions={actions}
                    />
                  ))}
                </div>
              ))}
            </div>
            {newBelow > 0 && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="absolute bottom-3 left-1/2 z-10 inline-flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-[13px] font-semibold text-white shadow-pop hover:bg-brand-700"
              >
                <ArrowDown size={14} /> {newBelow} new message
                {newBelow === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {typingNames.length > 0 && (
            <div className="shrink-0 px-4 pb-0.5 text-[12px] leading-4 text-muted" aria-live="polite">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex gap-0.5" aria-hidden>
                  <span className="h-1 w-1 animate-pulseDot rounded-full bg-muted" />
                  <span className="h-1 w-1 animate-pulseDot rounded-full bg-muted [animation-delay:200ms]" />
                  <span className="h-1 w-1 animate-pulseDot rounded-full bg-muted [animation-delay:400ms]" />
                </span>
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing…`
                  : typingNames.length === 2
                    ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                    : "Several managers are typing…"}
              </span>
            </div>
          )}
          <Composer
            ref={composerRef}
            placeholder={placeholder}
            disabled={!canPost}
            disabledReason="Automatic feed of league moves — react here, talk in #general."
            members={active.type === "DM" ? members.filter((m) => active.memberIds.includes(m.userId)) : members}
            meId={me.id}
            canMentionEveryone={me.isCommish && active.type !== "DM"}
            replyTo={replyTo}
            replyAuthor={replyTo ? (replyTo.userId ? memberName(replyTo.userId) : "League Office") : undefined}
            onCancelReply={() => setReplyTo(null)}
            onSend={(b) => send(b)}
            onTyping={onTyping}
            onEditLast={editLast}
          />
        </section>
      </div>

      {drawer && (
        <div className="scrim animate-backdrop fixed inset-0 z-[110] md:hidden" onClick={() => setDrawer(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chat channels"
            className="flex h-full w-[86%] max-w-[340px] flex-col bg-raised pt-[env(safe-area-inset-top)] shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line/70 pl-4 pr-2">
              <span className="text-[17px] font-bold tracking-[-0.01em]">Chat</span>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-sunken"
                aria-label="Close channel list"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/[0.06] dark:bg-white/10">
                  <X size={16} strokeWidth={2.4} />
                </span>
              </button>
            </div>
            <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
              <ChannelList
                channels={channels}
                activeId={activeId}
                meId={me.id}
                members={memberMap}
                onNavigate={() => setDrawer(false)}
                onNewDm={() => {
                  setDrawer(false);
                  setDmOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      )}
      <NewDmModal open={dmOpen} onClose={() => setDmOpen(false)} members={members} meId={me.id} />
    </>
  );
}
