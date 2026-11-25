"use client";
// Message composer: autosizing textarea, @mention autocomplete, reply bar, Enter to send.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CornerUpLeft, SendHorizonal, X } from "lucide-react";
import { Avatar } from "@/components/ui/core";
import { MAX_MESSAGE_LENGTH, matchMembers, mentionQueryAt, plainText, type ChatMember, type ChatMessageDTO } from "@/lib/chat/format";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  placeholder: string;
  disabled?: boolean;
  disabledReason?: string;
  members: ChatMember[];
  meId: string;
  canMentionEveryone: boolean;
  replyTo: ChatMessageDTO | null;
  replyAuthor?: string;
  onCancelReply: () => void;
  onSend: (body: string) => boolean | Promise<boolean>;
  onTyping: () => void;
  onEditLast: () => void;
}

type Suggestion = { kind: "member"; m: ChatMember } | { kind: "everyone" };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, disabled, disabledReason, members, meId, canMentionEveryone, replyTo, replyAuthor, onCancelReply, onSend, onTyping, onEditLast },
  ref,
) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => ta.current?.focus(),
      setText: (t: string) => setText(t),
    }),
    [],
  );

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(180, el.scrollHeight) + "px";
  }, [text]);

  const query = useMemo(() => mentionQueryAt(text, caret), [text, caret]);
  const suggestions: Suggestion[] = useMemo(() => {
    if (!query || dismissedAt === query.start) return [];
    const list: Suggestion[] = matchMembers(
      members.filter((m) => m.userId !== meId),
      query.query,
      6,
    ).map((m) => ({ kind: "member" as const, m }));
    if (canMentionEveryone && "everyone".startsWith(query.query.toLowerCase())) list.push({ kind: "everyone" });
    return list;
  }, [query, members, meId, canMentionEveryone, dismissedAt]);

  useEffect(() => setHi(0), [query?.query]);

  const insert = (s: Suggestion) => {
    if (!query) return;
    const label = s.kind === "everyone" ? "everyone" : s.m.displayName;
    const before = text.slice(0, query.start);
    const after = text.slice(caret);
    const next = `${before}@${label} ${after.replace(/^\s+/, "")}`;
    const pos = before.length + label.length + 2;
    setText(next);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || disabled) return;
    if (body.length > MAX_MESSAGE_LENGTH) return;
    const prev = text;
    setText("");
    setCaret(0);
    const ok = await onSend(body);
    if (!ok) setText(prev);
    ta.current?.focus();
  };

  const remaining = MAX_MESSAGE_LENGTH - text.length;

  return (
    <div className="relative shrink-0 border-t border-line/70 bg-panel px-3 pb-2 pt-2 sm:px-4">
      {replyTo && (
        <div className="mb-2 flex min-h-10 items-center gap-2 rounded-control bg-sunken pl-2.5 text-[13px] shadow-[inset_3px_0_0_rgb(var(--c-accent))]">
          <CornerUpLeft size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted">Replying to </span>
            <span className="font-semibold">{replyAuthor ?? "message"}</span>
            <span className="text-muted"> · {plainText(replyTo.body, 90)}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
            aria-label="Cancel reply"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention a manager"
          className="absolute bottom-full left-2 right-2 z-30 mb-1 max-h-[min(50vh,320px)] overflow-y-auto rounded-xl bg-raised py-1 shadow-pop ring-1 ring-line/70 sm:left-3 sm:right-auto sm:w-80"
        >
          {suggestions.map((s, i) => (
            <li key={s.kind === "everyone" ? "everyone" : s.m.userId} role="option" aria-selected={i === hi}>
              <button
                type="button"
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(s);
                }}
                className={cn("flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-left text-[15px] sm:min-h-9 sm:text-sm", i === hi && "bg-sunken")}
              >
                {s.kind === "everyone" ? (
                  <>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[13px] font-bold text-white">@</span>
                    <span className="font-semibold">everyone</span>
                    <span className="truncate text-[13px] text-muted">whole league</span>
                  </>
                ) : (
                  <>
                    <Avatar name={s.m.displayName} src={s.m.avatarUrl} size={28} />
                    <span className="truncate font-semibold">{s.m.displayName}</span>
                    {s.m.team && <span className="ml-auto truncate pl-2 text-[13px] text-muted">{s.m.team.name}</span>}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {disabled ? (
        <p className="rounded-control bg-sunken px-3 py-2.5 text-center text-[13px] text-muted">{disabledReason}</p>
      ) : (
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{placeholder}</span>
            <textarea
              ref={ta}
              value={text}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH + 200}
              placeholder={placeholder}
              enterKeyHint="send"
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setDismissedAt(null);
                if (e.target.value.trim()) onTyping();
              }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (suggestions.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHi((h) => (h + 1) % suggestions.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHi((h) => (h - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insert(suggestions[hi] ?? suggestions[0]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDismissedAt(query?.start ?? null);
                    return;
                  }
                }
                if (e.key === "Escape" && replyTo) onCancelReply();
                if (e.key === "ArrowUp" && !text) {
                  e.preventDefault();
                  onEditLast();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="input max-h-[180px] min-h-11 resize-none rounded-[22px] px-4 py-[11px] text-[15px] leading-[20px] sm:min-h-10 sm:py-2.5 sm:text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim() || remaining < 0}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-[background-color,opacity,transform] hover:bg-brand-700 active:scale-95 disabled:opacity-40 sm:h-10 sm:w-10"
          >
            <SendHorizonal size={18} />
          </button>
        </div>
      )}
      {!disabled && (
        <div className={cn("mt-1 items-center justify-between gap-2 text-[12px] text-muted", remaining <= 200 ? "flex" : "hidden sm:flex")}>
          <span className="hidden truncate sm:block">
            <b>**bold**</b> · <i>*italic*</i> · <code>`code`</code> · @ to mention · Enter to send, Shift+Enter for a new line · ↑ edits your last message
          </span>
          <span className={cn("numeral ml-auto", remaining < 0 ? "font-bold text-loss" : remaining > 200 && "invisible")}>{remaining}</span>
        </div>
      )}
    </div>
  );
});
