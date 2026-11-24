"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, LogOut, Menu, Search, Settings, User, X } from "lucide-react";
import { Avatar, PosBadge, TeamLogo } from "@/components/ui/core";
import { Dropdown, ThemeToggle } from "@/components/ui/client";
import { useLiveEvents } from "@/lib/realtime/client";
import { cn, timeAgo } from "@/lib/utils";
import { logoutAction, switchLeagueAction } from "@/lib/auth/actions";
import { visibleNav } from "./nav-config";

interface TopBarProps {
  user: { id: string; name: string; avatarUrl: string | null };
  league: { id: string; name: string; season: number; logoUrl: string | null };
  leagues: { id: string; name: string }[];
  myTeam: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; record?: string } | null;
  unread: number;
  isCommish: boolean;
  hiddenHrefs?: string[];
}

type SearchResult = { type: "player" | "team" | "manager" | "page"; id: string; label: string; sub?: string; href: string; position?: string };

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "/" && !(e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);
  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results ?? []);
          setIdx(0);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (r: SearchResult) => {
    setOpen(false);
    setQ("");
    router.push(r.href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-xs items-center gap-2 rounded-md bg-white/10 px-3 text-sm text-white/70 hover:bg-white/15"
      >
        <Search size={15} />
        <span className="flex-1 text-left">Search players, teams…</span>
        <span className="hidden rounded border border-white/20 px-1.5 text-[10px] sm:inline">⌘K</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/50 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-panel text-ink shadow-pop">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={16} className="text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "ArrowDown") setIdx((i) => Math.min(results.length - 1, i + 1));
                  if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
                  if (e.key === "Enter" && results[idx]) go(results[idx]);
                }}
                placeholder="Search any NFL player, fantasy team, manager or page…"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {!q && <div className="px-4 py-6 text-center text-sm text-muted">Type a player name like “Bijan” or a team name. Press Enter to open.</div>}
              {q && !results.length && <div className="px-4 py-6 text-center text-sm text-muted">No matches</div>}
              {results.map((r, i) => (
                <button
                  key={`${r.type}-${r.id}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(r)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", i === idx && "bg-sunken")}
                >
                  {r.type === "player" ? <PosBadge pos={r.position} /> : <span className="w-[30px] text-center text-[10px] font-bold uppercase text-muted">{r.type}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.label}</span>
                    {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
  type: string;
}

function NotificationsBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useLiveEvents([`user:${userId}`], (e) => {
    if (e.type === "notification") {
      setUnread((u) => u + 1);
      setItems((list) => (list ? [e.data as NotificationItem, ...list].slice(0, 30) : list));
    }
  });
  useEffect(() => {
    if (!open) return;
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setItems(d.notifications ?? []))
      .catch(() => setItems([]));
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const markAll = async () => {
    await fetch("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) });
    setUnread(0);
    setItems((l) => l?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? l);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Notifications">
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-live px-1 text-[9px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[360px] max-w-[92vw] overflow-hidden rounded-lg border border-line bg-panel text-ink shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-bold">Notifications</span>
            <div className="flex gap-3 text-xs">
              <button className="link" onClick={markAll}>Mark all read</button>
              <Link className="link" href="/settings/notifications" onClick={() => setOpen(false)}>Settings</Link>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items === null && <div className="p-4 text-center text-sm text-muted">Loading…</div>}
            {items?.length === 0 && <div className="p-6 text-center text-sm text-muted">You&apos;re all caught up.</div>}
            {items?.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setOpen(false);
                  if (!n.readAt) {
                    fetch("/api/notifications", { method: "POST", body: JSON.stringify({ ids: [n.id] }) });
                    setUnread((u) => Math.max(0, u - 1));
                  }
                  if (n.url) router.push(n.url);
                }}
                className={cn("block w-full border-b border-line/60 px-3 py-2 text-left hover:bg-sunken", !n.readAt && "bg-brand-50/70 dark:bg-brand-900/25")}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{n.title}</span>
                  <span className="shrink-0 text-[10px] text-muted">{timeAgo(n.createdAt)}</span>
                </div>
                <div className="line-clamp-2 text-xs text-muted">{n.body}</div>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-line py-2 text-center text-xs font-semibold text-brand-600 hover:bg-sunken">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}

function MobileMenu({ isCommish, hiddenHrefs = [] }: { isCommish: boolean; hiddenHrefs?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="rounded-md p-2 text-white md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu size={20} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[110] bg-black/50 md:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-[86%] max-w-sm overflow-y-auto bg-panel text-ink shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-brand-900 px-4 py-3 text-white">
              <span className="font-display text-lg font-extrabold uppercase tracking-wider">CTE Dynasty</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu">
                <X size={20} />
              </button>
            </div>
            {visibleNav(isCommish, hiddenHrefs).map((item) => (
              <div key={item.label} className="border-b border-line">
                <Link href={item.href} onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm font-bold uppercase tracking-wide">
                  {item.label}
                </Link>
                {item.children?.map((c) => (
                  <Link key={c.href} href={c.href} onClick={() => setOpen(false)} className="block px-7 py-1.5 text-sm text-muted hover:text-ink">
                    {c.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function TopBar({ user, league, leagues, myTeam, unread, isCommish, hiddenHrefs }: TopBarProps) {
  return (
    <header className="bg-brand-950 text-white">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-3">
        <MobileMenu isCommish={isCommish} hiddenHrefs={hiddenHrefs} />
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {league.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={league.logoUrl} alt="" className="h-9 w-9 rounded-md object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-500 font-display text-sm font-black tracking-tight text-brand-950">CTE</span>
          )}
          <span className="hidden leading-tight sm:block">
            <span className="block font-display text-lg font-extrabold uppercase tracking-wider">{league.name}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-400">{league.season} Season · Dynasty</span>
          </span>
        </Link>
        {leagues.length > 1 && (
          <Dropdown
            trigger={
              <button className="hidden items-center gap-1 rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 lg:flex">
                Switch league <ChevronDown size={12} />
              </button>
            }
          >
            {leagues.map((l) => (
              <form key={l.id} action={switchLeagueAction}>
                <input type="hidden" name="leagueId" value={l.id} />
                <button className={cn("block w-full px-3 py-2 text-left text-sm hover:bg-sunken", l.id === league.id && "font-bold")}>{l.name}</button>
              </form>
            ))}
          </Dropdown>
        )}
        <div className="flex flex-1 justify-center px-2">
          <GlobalSearch />
        </div>
        {myTeam && (
          <Link href="/team" className="hidden items-center gap-2 rounded-md px-2 py-1 hover:bg-white/10 lg:flex">
            <TeamLogo team={myTeam} size={28} />
            <span className="leading-tight">
              <span className="block max-w-[160px] truncate text-sm font-semibold">{myTeam.name}</span>
              {myTeam.record && <span className="block text-[11px] text-white/60">{myTeam.record}</span>}
            </span>
          </Link>
        )}
        <ThemeToggle />
        <NotificationsBell userId={user.id} initialUnread={unread} />
        <Dropdown
          align="right"
          trigger={
            <button className="flex items-center gap-1 rounded-md p-1 hover:bg-white/10" aria-label="Account menu">
              <Avatar name={user.name} src={user.avatarUrl} size={30} />
              <ChevronDown size={14} className="hidden opacity-70 sm:block" />
            </button>
          }
        >
          <div className="border-b border-line px-3 py-2 text-xs text-muted">Signed in as <span className="font-semibold text-ink">{user.name}</span></div>
          <Link href={`/managers/${user.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunken"><User size={14} /> My manager profile</Link>
          <Link href="/settings/profile" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunken"><Settings size={14} /> Edit profile</Link>
          <Link href="/settings/notifications" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunken"><Bell size={14} /> Notifications & phone alerts</Link>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-loss hover:bg-sunken"><LogOut size={14} /> Sign out</button>
          </form>
        </Dropdown>
      </div>
    </header>
  );
}
