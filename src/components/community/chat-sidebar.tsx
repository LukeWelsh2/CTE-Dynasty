"use client";
// Channel list (public channels + direct messages with unread counts) and the "new direct message" picker.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Hash, Loader2, Megaphone, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Avatar, TeamLogo } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import type { ChannelSummary, ChatMember } from "@/lib/chat/format";
import { cn } from "@/lib/utils";

function UnreadBadge({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-live px-1.5 text-[10px] font-bold text-white">{n > 99 ? "99+" : n}</span>;
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
          "flex min-h-[38px] items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-brand-700 text-white dark:bg-brand-600" : "text-ink hover:bg-sunken",
          !active && c.unread > 0 && "font-bold",
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
      <div className="flex-1 space-y-4 overflow-y-auto p-2">
        <div>
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Channels</div>
          <div className="space-y-0.5">
            {pub.map((c) => item(c, c.type === "ANNOUNCEMENTS" ? <Megaphone size={15} className="shrink-0 opacity-70" /> : <Hash size={15} className="shrink-0 opacity-70" />))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Direct messages</span>
            <button type="button" onClick={onNewDm} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="New direct message" title="New direct message">
              <Plus size={15} />
            </button>
          </div>
          {dms.length === 0 ? (
            <button type="button" onClick={onNewDm} className="w-full rounded-md border border-dashed border-line px-2 py-3 text-left text-xs text-muted hover:text-ink">
              Start a private conversation with any manager.
            </button>
          ) : (
            <div className="space-y-0.5">
              {dms.map((c) => {
                const others = c.memberIds.filter((id) => id !== meId);
                const first = members.get(others[0] ?? "");
                return item(
                  c,
                  others.length > 1 ? (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-bold text-muted ring-1 ring-line">{others.length}</span>
                  ) : (
                    <Avatar name={first?.displayName ?? c.name} src={first?.avatarUrl} size={24} />
                  ),
                );
              })}
            </div>
          )}
        </div>
      </div>
      <Link href="/settings/notifications" onClick={onNavigate} className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs text-muted hover:text-ink">
        <Bell size={13} /> Mention &amp; DM alerts
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
      const res = await fetch("/api/chat/dm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userIds: picked }) });
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
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-sunken" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!picked.length || busy}
            onClick={() => void start()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {picked.length > 1 ? `Start group chat (${picked.length})` : "Start conversation"}
          </button>
        </>
      }
    >
      <label className="relative block">
        <span className="sr-only">Search managers</span>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search managers or teams" className="input pl-9" autoFocus />
      </label>
      <p className="mt-2 text-xs text-muted">Pick one manager for a private chat, or several for a group conversation. Only the people in it can read it.</p>
      <ul className="mt-2 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
        {list.map((m) => {
          const on = picked.includes(m.userId);
          return (
            <li key={m.userId}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.userId) : [...p, m.userId]))}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken", on && "bg-brand-50 dark:bg-brand-900/30")}
              >
                <Avatar name={m.displayName} src={m.avatarUrl} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{m.displayName}</span>
                  {m.team && (
                    <span className="flex items-center gap-1 truncate text-xs text-muted">
                      <TeamLogo team={m.team} size={14} /> {m.team.name}
                    </span>
                  )}
                </span>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded border", on ? "border-brand-600 bg-brand-600 text-white" : "border-line")}>{on && <Check size={13} />}</span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No managers match “{q}”.</li>}
      </ul>
    </Modal>
  );
}
