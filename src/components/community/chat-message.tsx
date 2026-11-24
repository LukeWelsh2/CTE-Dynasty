"use client";
// One chat message row: author header, reply quote, markdown-lite body or system card, reactions, actions.
import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CornerUpLeft, Loader2, Pencil, RotateCcw, SmilePlus, Trash2, X } from "lucide-react";
import { Avatar, TeamLogo } from "@/components/ui/core";
import { CHAT_EMOJIS, MAX_MESSAGE_LENGTH, timeLabel, type ChatMember, type ChatMessageDTO, type MentionTarget } from "@/lib/chat/format";
import { cn } from "@/lib/utils";
import { RichText } from "./rich-text";
import { SystemMessageBody } from "./chat-cards";

export interface MessageActions {
  onReply: (m: ChatMessageDTO) => void;
  onEditSave: (m: ChatMessageDTO, body: string) => Promise<boolean>;
  onDelete: (m: ChatMessageDTO) => void;
  onReact: (m: ChatMessageDTO, emoji: string) => void;
  onRetry: (m: ChatMessageDTO) => void;
  onDiscard: (m: ChatMessageDTO) => void;
  onJumpTo: (id: string) => void;
  onSelect: (id: string | null) => void;
}

export function EmojiPicker({ onPick, onClose, className }: { onPick: (e: string) => void; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label="Add reaction" className={cn("z-30 grid grid-cols-6 gap-0.5 rounded-lg border border-line bg-panel p-1.5 shadow-pop", className)}>
      {CHAT_EMOJIS.map((e) => (
        <button key={e} type="button" role="menuitem" aria-label={`React ${e}`} onClick={() => onPick(e)} className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-sunken">
          {e}
        </button>
      ))}
    </div>
  );
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(220, el.scrollHeight) + "px";
  }, [value]);
  const save = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    const ok = await onSave(value);
    setSaving(false);
    if (ok) onCancel();
  };
  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={value}
        maxLength={MAX_MESSAGE_LENGTH}
        aria-label="Edit message"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        className="input min-h-[38px] resize-none py-1.5"
        rows={1}
      />
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        <button type="button" onClick={() => void save()} disabled={saving || !value.trim()} className="font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-300">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="hover:underline">
          Cancel
        </button>
        <span className="hidden sm:inline">· Enter to save, Esc to cancel</span>
      </div>
    </div>
  );
}

interface Props {
  msg: ChatMessageDTO;
  author: ChatMember | undefined;
  replyAuthor: string | undefined;
  showHeader: boolean;
  meId: string;
  canModerate: boolean;
  mentions: MentionTarget[];
  memberName: (id: string) => string;
  tz: string;
  selected: boolean;
  editing: boolean;
  flash: boolean;
  setEditing: (id: string | null) => void;
  actions: MessageActions;
}

function MessageRowInner({ msg, author, replyAuthor, showHeader, meId, canModerate, mentions, memberName, tz, selected, editing, flash, setEditing, actions }: Props) {
  const [picker, setPicker] = useState(false);
  const isUser = msg.kind === "USER";
  const own = !!msg.userId && msg.userId === meId;
  const deleted = !!msg.deletedAt;
  const temp = msg.pending || msg.failed;
  const canDelete = !deleted && !temp && (own || canModerate);
  const canEdit = own && isUser && !deleted && !temp;
  const name = isUser ? author?.displayName ?? "Former manager" : "League Office";
  const time = timeLabel(msg.createdAt, tz);
  const fullTime = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date(msg.createdAt));

  return (
    <div
      id={`msg-${msg.id}`}
      className={cn(
        "group relative flex gap-2.5 px-3 py-0.5 sm:px-4",
        showHeader && "mt-2.5",
        !deleted && "hover:bg-sunken/60",
        selected && "bg-sunken/70",
        flash && "animate-flash",
        msg.pending && "opacity-60",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,textarea,input")) return;
        actions.onSelect(selected ? null : msg.id);
      }}
    >
      <div className="w-9 shrink-0 pt-0.5">
        {showHeader ? (
          isUser ? (
            author ? (
              <Link href={`/managers/${author.userId}`} aria-label={`${name}'s profile`}>
                <Avatar name={name} src={author.avatarUrl} size={36} />
              </Link>
            ) : (
              <Avatar name={name} size={36} />
            )
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-500 font-display text-[11px] font-black text-brand-950" aria-hidden>
              CTE
            </span>
          )
        ) : (
          <time dateTime={msg.createdAt} title={fullTime} className="block pt-0.5 text-right text-[10px] leading-5 text-muted opacity-0 group-hover:opacity-100">
            {time.replace(/\s?[AP]M$/, "")}
          </time>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
            {isUser && author ? (
              <Link href={`/managers/${author.userId}`} className="text-sm font-bold text-ink hover:underline">
                {name}
              </Link>
            ) : (
              <span className="text-sm font-bold text-ink">{name}</span>
            )}
            {isUser && author?.team && (
              <Link href={`/teams/${author.team.id}`} className="inline-flex items-center gap-1 self-center text-[11px] font-semibold text-muted hover:text-ink" title={author.team.name}>
                <TeamLogo team={author.team} size={14} className="rounded-[3px]" />
                {author.team.abbrev}
              </Link>
            )}
            {isUser && (author?.role === "COMMISSIONER" || author?.role === "CO_COMMISSIONER") && (
              <span className="self-center rounded bg-gold-300/30 px-1 text-[9px] font-bold uppercase tracking-wide text-gold-600 dark:text-gold-300">Commish</span>
            )}
            <time dateTime={msg.createdAt} title={fullTime} className="text-[11px] text-muted">
              {time}
            </time>
          </div>
        )}

        {msg.replyTo && !deleted && (
          <button
            type="button"
            onClick={() => actions.onJumpTo(msg.replyTo!.id)}
            className="mb-0.5 mt-0.5 flex max-w-full items-center gap-1.5 rounded border-l-2 border-brand-400 bg-sunken/80 px-2 py-0.5 text-left text-xs text-muted hover:text-ink"
          >
            <CornerUpLeft size={12} className="shrink-0" />
            <span className="shrink-0 font-semibold text-ink">{replyAuthor ?? "Message"}</span>
            <span className="truncate">{msg.replyTo.deleted ? "deleted message" : msg.replyTo.body}</span>
          </button>
        )}

        {deleted ? (
          <p className="text-sm italic text-muted">This message was deleted.</p>
        ) : editing ? (
          <EditBox initial={msg.body} onSave={(b) => actions.onEditSave(msg, b)} onCancel={() => setEditing(null)} />
        ) : isUser ? (
          <div className="text-[14px] leading-relaxed text-ink">
            <RichText text={msg.body} mentions={mentions} meId={meId} />
            {msg.editedAt && (
              <span className="ml-1 text-[10px] text-muted" title={`Edited ${new Date(msg.editedAt).toLocaleString()}`}>
                (edited)
              </span>
            )}
          </div>
        ) : (
          <SystemMessageBody msg={msg} />
        )}

        {msg.failed && (
          <div className="mt-0.5 flex items-center gap-3 text-xs text-loss">
            <span>Not sent.</span>
            <button type="button" className="inline-flex items-center gap-1 font-semibold hover:underline" onClick={() => actions.onRetry(msg)}>
              <RotateCcw size={12} /> Retry
            </button>
            <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => actions.onDiscard(msg)}>
              <X size={12} /> Discard
            </button>
          </div>
        )}
        {msg.pending && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
            <Loader2 size={11} className="animate-spin" /> Sending…
          </div>
        )}

        {!deleted && msg.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {msg.reactions.map((r) => {
              const mine = r.userIds.includes(meId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => actions.onReact(msg, r.emoji)}
                  title={r.userIds.map(memberName).join(", ")}
                  aria-pressed={mine}
                  aria-label={`${r.emoji} ${r.userIds.length} — ${mine ? "remove your reaction" : "react"}`}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors",
                    mine ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/40 dark:text-brand-200" : "border-line bg-panel text-muted hover:border-brand-300",
                  )}
                >
                  <span className="text-sm leading-none">{r.emoji}</span>
                  {r.userIds.length}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPicker(true)}
              aria-label="Add reaction"
              className="inline-flex h-6 items-center rounded-full border border-dashed border-line px-1.5 text-muted hover:text-ink"
            >
              <SmilePlus size={13} />
            </button>
          </div>
        )}
      </div>

      {!deleted && !temp && !editing && (
        <div
          className={cn(
            "absolute -top-3 right-3 z-10 items-center gap-0.5 rounded-md border border-line bg-panel p-0.5 shadow-panel",
            selected ? "flex" : "hidden md:group-hover:flex md:group-focus-within:flex",
          )}
        >
          <ToolButton label="Add reaction" onClick={() => setPicker((p) => !p)}>
            <SmilePlus size={15} />
          </ToolButton>
          <ToolButton label="Reply" onClick={() => actions.onReply(msg)}>
            <CornerUpLeft size={15} />
          </ToolButton>
          {canEdit && (
            <ToolButton label="Edit" onClick={() => setEditing(msg.id)}>
              <Pencil size={14} />
            </ToolButton>
          )}
          {canDelete && (
            <ToolButton label={own ? "Delete" : "Delete (commissioner)"} onClick={() => actions.onDelete(msg)} danger>
              <Trash2 size={14} />
            </ToolButton>
          )}
        </div>
      )}
      {picker && (
        <EmojiPicker
          className="absolute right-3 top-5"
          onClose={() => setPicker(false)}
          onPick={(e) => {
            setPicker(false);
            actions.onReact(msg, e);
          }}
        />
      )}
    </div>
  );
}

function ToolButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("flex h-7 w-7 items-center justify-center rounded text-muted hover:bg-sunken", danger ? "hover:text-loss" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}

export const MessageRow = memo(MessageRowInner);
