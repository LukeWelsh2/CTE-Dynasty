"use client";
// One chat message row: author header, reply quote, markdown-lite body or system card, reactions, actions.
import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, CornerUpLeft, Loader2, Pencil, RotateCcw, SmilePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, TeamLogo } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { CHAT_EMOJIS, MAX_MESSAGE_LENGTH, plainText, timeLabel, type ChatMember, type ChatMessageDTO, type MentionTarget } from "@/lib/chat/format";
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

/** True below the md breakpoint (phones): message actions open as a bottom sheet instead of a hover toolbar. */
function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
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
    <div
      ref={ref}
      role="menu"
      aria-label="Add reaction"
      className={cn("z-30 grid grid-cols-6 gap-0.5 rounded-xl bg-raised p-1.5 shadow-pop ring-1 ring-line/70", className)}
    >
      {CHAT_EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          role="menuitem"
          aria-label={`React ${e}`}
          onClick={() => onPick(e)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-sunken"
        >
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
        className="input min-h-10 resize-none py-2"
        rows={1}
      />
      <div className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !value.trim()}
          className="inline-flex min-h-10 items-center rounded-control bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 disabled:opacity-50 sm:min-h-8 sm:px-3"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-10 items-center rounded-control px-3 font-semibold text-ink hover:bg-sunken sm:min-h-8"
        >
          Cancel
        </button>
        <span className="hidden sm:inline">Enter to save · Esc to cancel</span>
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

function MessageRowInner({
  msg,
  author,
  replyAuthor,
  showHeader,
  meId,
  canModerate,
  mentions,
  memberName,
  tz,
  selected,
  editing,
  flash,
  setEditing,
  actions,
}: Props) {
  const [picker, setPicker] = useState(false);
  const phone = useIsPhone();
  const isUser = msg.kind === "USER";
  const own = !!msg.userId && msg.userId === meId;
  const deleted = !!msg.deletedAt;
  const temp = msg.pending || msg.failed;
  const canDelete = !deleted && !temp && (own || canModerate);
  const canEdit = own && isUser && !deleted && !temp;
  const canAct = !deleted && !temp && !editing;
  const name = isUser ? (author?.displayName ?? "Former manager") : "League Office";
  const time = timeLabel(msg.createdAt, tz);
  const fullTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(msg.createdAt));
  const isCommish = isUser && (author?.role === "COMMISSIONER" || author?.role === "CO_COMMISSIONER");
  const closeSheet = () => actions.onSelect(null);

  return (
    <div
      id={`msg-${msg.id}`}
      className={cn(
        "group relative flex gap-3 px-3 py-1 sm:px-4",
        showHeader && "mt-2",
        !deleted && "md:hover:bg-sunken/60",
        selected && "bg-sunken/70",
        flash && "animate-flash",
        msg.pending && "opacity-60",
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,textarea,input")) return;
        if (!canAct && !selected) return;
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
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold tracking-[-0.01em] text-white"
              aria-hidden
            >
              CTE
            </span>
          )
        ) : (
          <time
            dateTime={msg.createdAt}
            title={fullTime}
            className="hidden pt-0.5 text-right text-[11px] leading-5 text-muted opacity-0 group-hover:opacity-100 md:block"
          >
            {time.replace(/\s?[AP]M$/, "")}
          </time>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex min-w-0 items-baseline gap-x-1.5">
            {isUser && author ? (
              <Link
                href={`/managers/${author.userId}`}
                className="min-w-0 truncate text-[15px] font-semibold leading-5 text-ink hover:underline sm:text-sm"
                title={name}
              >
                {name}
              </Link>
            ) : (
              <span className="truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{name}</span>
            )}
            {isUser && author?.team && (
              <Link
                href={`/teams/${author.team.id}`}
                className="inline-flex shrink-0 items-center gap-1 self-center text-[12px] font-semibold text-muted hover:text-ink"
                title={author.team.name}
              >
                <TeamLogo team={author.team} size={14} className="rounded-[3px]" />
                {author.team.abbrev}
              </Link>
            )}
            {isCommish && (
              <span
                className="shrink-0 self-center rounded-[4px] bg-brand-600/[0.08] px-1 text-[11px] font-semibold leading-4 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
                title={author?.role === "COMMISSIONER" ? "Commissioner" : "Co-commissioner"}
              >
                Commish
              </span>
            )}
            <time dateTime={msg.createdAt} title={fullTime} className="numeral shrink-0 whitespace-nowrap text-[12px] text-muted">
              {time}
            </time>
          </div>
        )}

        {msg.replyTo && !deleted && (
          <button
            type="button"
            onClick={() => actions.onJumpTo(msg.replyTo!.id)}
            className="my-1 flex min-h-8 max-w-full items-center gap-1.5 rounded-control bg-sunken px-2 text-left text-[13px] text-muted shadow-[inset_2px_0_0_rgb(var(--c-accent))] hover:text-ink"
          >
            <CornerUpLeft size={13} className="shrink-0" aria-hidden />
            <span className="shrink-0 font-semibold text-ink">{replyAuthor ?? "Message"}</span>
            <span className="truncate">{msg.replyTo.deleted ? "deleted message" : msg.replyTo.body}</span>
          </button>
        )}

        {deleted ? (
          <p className="text-[15px] italic text-muted sm:text-sm">This message was deleted.</p>
        ) : editing ? (
          <EditBox initial={msg.body} onSave={(b) => actions.onEditSave(msg, b)} onCancel={() => setEditing(null)} />
        ) : isUser ? (
          <div className="text-[15px] leading-[22px] text-ink sm:text-[14px] sm:leading-relaxed">
            <RichText text={msg.body} mentions={mentions} meId={meId} />
            {msg.editedAt && (
              <span
                className="ml-1 text-[12px] text-muted"
                title={`Edited ${new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(msg.editedAt))}`}
              >
                (edited)
              </span>
            )}
          </div>
        ) : (
          <SystemMessageBody msg={msg} />
        )}

        {msg.failed && (
          <div className="mt-0.5 flex items-center gap-1 text-[13px] text-loss">
            <span className="mr-1">Not sent.</span>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 font-semibold hover:bg-sunken"
              onClick={() => actions.onRetry(msg)}
            >
              <RotateCcw size={13} /> Retry
            </button>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 hover:bg-sunken"
              onClick={() => actions.onDiscard(msg)}
            >
              <X size={13} /> Discard
            </button>
          </div>
        )}
        {msg.pending && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
            <Loader2 size={12} className="animate-spin" /> Sending…
          </div>
        )}

        {!deleted && msg.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    "numeral inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold transition-colors sm:h-7 sm:px-2",
                    mine
                      ? "bg-brand-600/[0.08] text-brand-700 shadow-[inset_0_0_0_1px_rgb(var(--c-accent)/0.45)] dark:bg-brand-400/15 dark:text-brand-300"
                      : "bg-sunken text-muted hover:text-ink",
                  )}
                >
                  <span className="text-[15px] leading-none">{r.emoji}</span>
                  {r.userIds.length}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => (phone ? actions.onSelect(msg.id) : setPicker(true))}
              aria-label="Add reaction"
              className="inline-flex h-8 w-9 items-center justify-center rounded-full bg-sunken text-muted hover:text-ink sm:h-7 sm:w-8"
            >
              <SmilePlus size={15} />
            </button>
          </div>
        )}
      </div>

      {canAct && !phone && (
        <div
          className={cn(
            "absolute -top-3 right-3 z-10 items-center gap-0.5 rounded-control bg-raised p-0.5 shadow-raised ring-1 ring-line/70",
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
      {picker && !phone && (
        <EmojiPicker
          className="absolute right-3 top-6"
          onClose={() => setPicker(false)}
          onPick={(e) => {
            setPicker(false);
            actions.onReact(msg, e);
          }}
        />
      )}
      {phone && selected && canAct && (
        // portal events bubble through React parents: keep taps inside the sheet away from the row's toggle
        <span className="contents" onClick={(e) => e.stopPropagation()}>
          <Modal open onClose={closeSheet} title={<span className="block truncate">{name}</span>} size="sm">
            {(isUser ? msg.body : "") && <p className="-mt-1 mb-3 line-clamp-2 text-[13px] text-muted">{plainText(msg.body, 160)}</p>}
            <div className="grid grid-cols-6 gap-1" role="group" aria-label="React">
              {CHAT_EMOJIS.map((e) => {
                const mine = msg.reactions.some((r) => r.emoji === e && r.userIds.includes(meId));
                return (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={mine}
                    aria-label={`React ${e}`}
                    onClick={() => {
                      closeSheet();
                      actions.onReact(msg, e);
                    }}
                    className={cn(
                      "flex h-12 items-center justify-center rounded-xl text-[24px] transition-colors active:scale-95",
                      mine ? "bg-brand-600/[0.1] dark:bg-brand-400/20" : "hover:bg-sunken active:bg-sunken",
                    )}
                  >
                    {e}
                  </button>
                );
              })}
            </div>
            <ul className="mt-3 divide-y divide-line/70 overflow-hidden rounded-card bg-sunken/60">
              <SheetAction icon={<CornerUpLeft size={18} />} label="Reply" onClick={() => actions.onReply(msg)} />
              {(isUser || !!msg.body) && (
                <SheetAction
                  icon={<Copy size={17} />}
                  label="Copy text"
                  onClick={() => {
                    closeSheet();
                    void navigator.clipboard?.writeText(msg.body).then(
                      () => toast.success("Copied"),
                      () => toast.error("Couldn't copy"),
                    );
                  }}
                />
              )}
              {canEdit && (
                <SheetAction
                  icon={<Pencil size={17} />}
                  label="Edit"
                  onClick={() => {
                    closeSheet();
                    setEditing(msg.id);
                  }}
                />
              )}
              {canDelete && (
                <SheetAction icon={<Trash2 size={17} />} label={own ? "Delete" : "Delete as commissioner"} danger onClick={() => actions.onDelete(msg)} />
              )}
            </ul>
          </Modal>
        </span>
      )}
    </div>
  );
}

function SheetAction({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn("flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] font-semibold active:bg-sunken", danger ? "text-loss" : "text-ink")}
      >
        <span className={cn("shrink-0", danger ? "text-loss" : "text-muted")}>{icon}</span>
        {label}
      </button>
    </li>
  );
}

function ToolButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("flex h-8 w-8 items-center justify-center rounded-[6px] text-muted hover:bg-sunken", danger ? "hover:text-loss" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}

export const MessageRow = memo(MessageRowInner);
