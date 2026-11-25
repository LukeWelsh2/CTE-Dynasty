"use client";
// Channel list (public channels + direct messages with unread counts) and the "new direct message" picker.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Hash, Loader2, Megaphone, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/client";
import { Avatar, Button, TeamLogo } from "@/components/ui/core";
import type { ChannelSummary, ChatMember } from "@/lib/chat/format";
import { cn } from "@/lib/utils";

function UnreadBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="numeral ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-live px-1.5 text-[11px] font-bold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function ChannelList({
  channels,
  activeId,
  meId,
  members,
  onNewDm,
  onNavigate,
}: {
  channels: ChannelSummary[];
  activeId: string;
  meId: string;
  members: Map<string, ChatMember>;
  onNewDm: () => void;
  onNavigate?: () => void;
}) {
  const pub = channels.filter((c) => c.type !== "DM");
  const dms = channels.filter((c) => c.type === "DM");
  const item = (c: ChannelSummary, icon: React.ReactNode) => {
    const active = c.id === activeId;
    return (
      <Link
        key={c.id}
        href={`/chat/${c.slug}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[15px] md:min-h-9 md:text-sm",
          active ? "bg-brand-600/[0.08] font-semibold text-brand-700 dark:bg-brand-400/15 dark:text-brand-300" : "text-ink hover:bg-sunken",
          !active && c.unread > 0 && "font-semibold",
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{c.name}</span>
        {!active && <UnreadBadge n={c.unread} />}
      </Link>
    );
  };
  return (
    <nav aria-label="Chat channels" className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-2">
        <div>
          <div className="eyebrow px-2.5 pb-1 pt-1">Channels</div>
          <div className="space-y-0.5">
            {pub.map((c) =>
              item(
                c,
                c.type === "ANNOUNCEMENTS" ? <Megaphone size={15} className="shrink-0 opacity-70" /> : <Hash size={15} className="shrink-0 opacity-70" />,
              ),
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between pb-0.5 pl-2.5">
            <span className="eyebrow">Direct messages</span>
            <button
              type="button"
              onClick={onNewDm}
              className="flex h-10 w-10 items-center justify-center rounded-full text-brand-600 hover:bg-sunken md:h-8 md:w-8 dark:text-brand-400"
              aria-label="New direct message"
              title="New direct message"
            >
              <Plus size={18} />
            </button>
          </div>
          {dms.length === 0 ? (
            <button
              type="button"
              onClick={onNewDm}
              className="flex min-h-11 w-full items-center gap-2 rounded-control px-2.5 text-left text-[15px] font-semibold text-brand-600 hover:bg-sunken md:text-sm dark:text-brand-400"
            >
              <Plus size={16} /> New message
            </button>
          ) : (
            <div className="space-y-0.5">
              {dms.map((c) => {
                const others = c.memberIds.filter((id) => id !== meId);
                const first = members.get(others[0] ?? "");
                return item(
                  c,
                  others.length > 1 ? (
                    <span className="numeral flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-bold text-muted ring-1 ring-line">
                      {others.length}
                    </span>
                  ) : (
                    <Avatar name={first?.displayName ?? c.name} src={first?.avatarUrl} size={24} />
                  ),
                );
              })}
            </div>
          )}
        </div>
      </div>
      <Link
        href="/settings/notifications"
        onClick={onNavigate}
        className="flex min-h-12 items-center gap-2 border-t border-line/70 px-4 text-[13px] font-medium text-muted hover:text-ink"
      >
        <Bell size={15} /> Mention &amp; DM alerts
      </Link>
    </nav>
  );
}

export function NewDmModal({ open, onClose, members, meId }: { open: boolean; onClose: () => void; members: ChatMember[]; meId: string }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return members
      .filter((m) => m.userId !== meId)
      .filter((m) => !s || m.displayName.toLowerCase().includes(s) || m.name.toLowerCase().includes(s) || (m.team?.name.toLowerCase().includes(s) ?? false));
  }, [members, meId, q]);
  const start = async () => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/dm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userIds: picked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not start the conversation");
      onClose();
      setPicked([]);
      router.push(`/chat/${data.slug}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New direct message"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked.length || busy} onClick={() => void start()}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {picked.length > 1 ? `Start group chat (${picked.length})` : "Start chat"}
          </Button>
        </>
      }
    >
      <label className="relative block">
        <span className="sr-only">Search managers</span>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search managers or teams" className="input pl-9" autoFocus />
      </label>
      <p className="mt-2 text-[13px] text-muted">One manager for a private chat, several for a group. Only people in it can read it.</p>
      <ul className="mt-2 max-h-[50vh] divide-y divide-line/70 overflow-y-auto rounded-card ring-1 ring-line/70">
        {list.map((m) => {
          const on = picked.includes(m.userId);
          return (
            <li key={m.userId}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.userId) : [...p, m.userId]))}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken",
                  on && "bg-brand-600/[0.06] dark:bg-brand-400/10",
                )}
              >
                <Avatar name={m.displayName} src={m.avatarUrl} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold sm:text-sm">{m.displayName}</span>
                  {m.team && (
                    <span className="flex items-center gap-1 truncate text-[13px] text-muted">
                      <TeamLogo team={m.team} size={14} /> {m.team.name}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-brand-600 bg-brand-600 text-white" : "border-line",
                  )}
                >
                  {on && <Check size={13} />}
                </span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No managers match “{q}”.</li>}
      </ul>
    </Modal>
  );
}
