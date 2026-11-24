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

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus(), setText: (t: string) => setText(t) }), []);

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
    <div className="relative border-t border-line bg-panel px-3 pb-2 pt-2 sm:px-4">
      {replyTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-md border-l-2 border-brand-500 bg-sunken px-2 py-1 text-xs">
          <CornerUpLeft size={13} className="shrink-0 text-muted" />
          <span className="shrink-0 text-muted">Replying to</span>
          <span className="shrink-0 font-semibold">{replyAuthor ?? "message"}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{plainText(replyTo.body, 90)}</span>
          <button type="button" onClick={onCancelReply} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Cancel reply">
            <X size={14} />
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Mention a manager" className="absolute bottom-full left-3 right-3 z-30 mb-1 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-pop sm:right-auto sm:w-80">
          {suggestions.map((s, i) => (
            <li key={s.kind === "everyone" ? "everyone" : s.m.userId} role="option" aria-selected={i === hi}>
              <button
                type="button"
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(s);
                }}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === hi && "bg-sunken")}
              >
                {s.kind === "everyone" ? (
                  <>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-500 text-[11px] font-black text-brand-950">@</span>
                    <span className="font-semibold">everyone</span>
                    <span className="text-xs text-muted">notify the whole league</span>
                  </>
                ) : (
                  <>
                    <Avatar name={s.m.displayName} src={s.m.avatarUrl} size={24} />
                    <span className="truncate font-semibold">{s.m.displayName}</span>
                    {s.m.team && <span className="truncate text-xs text-muted">{s.m.team.name}</span>}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {disabled ? (
        <p className="rounded-md bg-sunken px-3 py-2.5 text-center text-sm text-muted">{disabledReason}</p>
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
              className="input max-h-[180px] min-h-[42px] resize-none py-2.5 text-[15px] sm:text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim() || remaining < 0}
            aria-label="Send message"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-md bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-40 dark:bg-brand-600"
          >
            <SendHorizonal size={18} />
          </button>
        </div>
      )}
      {!disabled && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="hidden truncate sm:block">
            <b>**bold**</b> · <i>*italic*</i> · <code>`code`</code> · @ to mention · Enter to send, Shift+Enter for a new line · ↑ edits your last message
          </span>
          <span className={cn("ml-auto tabular-nums", remaining < 0 ? "font-bold text-loss" : remaining > 200 && "invisible")}>{remaining}</span>
        </div>
      )}
    </div>
  );
});
