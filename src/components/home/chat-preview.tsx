"use client";
// League chat preview: the last few #general messages, kept live through the chat:<channelId> topic.
import Link from "next/link";
import { useState } from "react";
import { Bot, MessageSquarePlus } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import { Avatar, buttonClass, Panel } from "@/components/ui/core";
import { timeAgo } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
import { previewText } from "./logic";
import type { ChatModule, ChatPreviewMessage } from "./types";

const KEEP = 5;

/** Accepts both the chat module's message DTO and raw system-message rows published by postSystemMessage. */
function toPreview(raw: unknown): ChatPreviewMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.body !== "string") return null;
  if (m.deletedAt) return null;
  const created = typeof m.createdAt === "string" || m.createdAt instanceof Date ? new Date(m.createdAt as string) : new Date();
  return {
    id: m.id,
    userId: typeof m.userId === "string" ? m.userId : null,
    kind: typeof m.kind === "string" ? m.kind : "USER",
    body: m.body,
    createdAt: Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
  };
}

function authorFrom(raw: unknown): { id: string; name: string; avatarUrl: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = (raw as { user?: unknown }).user;
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.name === "string" ? { id: r.id, name: r.name, avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : null } : null;
}

export function ChatPreview({ data, className }: { data: ChatModule; className?: string }) {
  const [messages, setMessages] = useState(data.messages);
  const [authors, setAuthors] = useState(data.authors);
  const [seen, setSeen] = useState(data.messages);
  if (seen !== data.messages) {
    setSeen(data.messages);
    setMessages(data.messages);
  }

  useLiveEvents([data.channelId ? `chat:${data.channelId}` : null], (e) => {
    if (e.type === "chat.message") {
      const msg = toPreview(e.data);
      if (!msg) return;
      const a = authorFrom(e.data);
      if (a) setAuthors((cur) => (cur[a.id] ? cur : { ...cur, [a.id]: { name: a.name, avatarUrl: a.avatarUrl, team: null } }));
      setMessages((cur) => (cur.some((m) => m.id === msg.id) ? cur : [...cur, msg].slice(-KEEP)));
    } else if (e.type === "chat.edit") {
      const msg = toPreview(e.data);
      if (msg) setMessages((cur) => cur.map((m) => (m.id === msg.id ? { ...m, body: msg.body } : m)));
    } else if (e.type === "chat.delete") {
      const id = (e.data as { id?: unknown })?.id;
      if (typeof id === "string") setMessages((cur) => cur.filter((m) => m.id !== id));
    }
  });

  return (
    <Panel
      title={
        <span>
          League Chat <span className="font-sans text-xs font-semibold normal-case tracking-normal text-muted">#{data.channelName.toLowerCase()}</span>
        </span>
      }
      className={className}
      actions={<MoreLink href="/chat">Open chat</MoreLink>}
    >
      {messages.length ? (
        <>
          <ul className="space-y-2.5" aria-live="polite">
            {messages.map((m) => {
              const author = m.userId ? authors[m.userId] : null;
              const system = m.kind !== "USER" || !m.userId;
              const name = system ? "League bot" : author?.name ?? "Former member";
              return (
                <li key={m.id} className="flex items-start gap-2">
                  {system ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-gold-400">
                      <Bot size={15} aria-hidden />
                    </span>
                  ) : (
                    <Avatar name={name} src={author?.avatarUrl} size={28} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-xs font-bold text-ink">{name}</span>
                      {author?.team && !system && (
                        <span className="shrink-0 rounded px-1 text-[9px] font-bold uppercase leading-4 text-white" style={{ background: author.team.primaryColor }}>
                          {author.team.abbrev}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-muted" suppressHydrationWarning>
                        {timeAgo(m.createdAt)}
                      </span>
                    </div>
                    <p className="line-clamp-2 break-words text-[13px] leading-snug text-ink/90">{previewText(m.body, 220)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/chat" className={buttonClass("secondary", "sm", "mt-3 w-full")}>
            <MessageSquarePlus size={14} aria-hidden /> Reply in chat
          </Link>
        </>
      ) : (
        <PanelEmpty
          action={
            <Link href="/chat" className={buttonClass("secondary", "sm")}>
              <MessageSquarePlus size={14} aria-hidden /> Start the conversation
            </Link>
          }
        >
          No messages in #{data.channelName.toLowerCase()} yet.
        </PanelEmpty>
      )}
    </Panel>
  );
}
