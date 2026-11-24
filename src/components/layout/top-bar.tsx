"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, FileText, LogOut, Menu, Search, Settings, Shield, User, X } from "lucide-react";
import { Avatar, PosBadge, TeamLogo } from "@/components/ui/core";
import { Dropdown, ThemeToggle } from "@/components/ui/client";
import { useLiveEvents } from "@/lib/realtime/client";
import { cn, timeAgo } from "@/lib/utils";
import { logoutAction, switchLeagueAction } from "@/lib/auth/actions";
import { activeChildHref, navItemActive, visibleNav } from "./nav-config";

interface TopBarTeam {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  record?: string;
}

interface TopBarProps {
  user: { id: string; name: string; avatarUrl: string | null };
  league: { id: string; name: string; season: number; logoUrl: string | null };
  leagues: { id: string; name: string }[];
  myTeam: TopBarTeam | null;
  unread: number;
  isCommish: boolean;
  hiddenHrefs?: string[];
}

type SearchResult = { type: "player" | "team" | "manager" | "page"; id: string; label: string; sub?: string; href: string; position?: string };

/** Stop the page behind an open sheet / drawer from scrolling (iOS rubber-banding included). */
function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

const TYPE_ICON = { team: Shield, manager: User, page: FileText } as const;

/** ⌘K / "/" search. A full-screen sheet on phones (results fill the screen above the keyboard), a dialog from sm up. */
function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  useLockBodyScroll(open);

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
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results ?? []);
          setIdx(0);
          setLoading(false);
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const close = () => setOpen(false);
  const go = (r: SearchResult) => {
    setOpen(false);
    setQ("");
    router.push(r.href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Search players and teams"
        className="flex h-10 w-full min-w-0 max-w-xs items-center gap-2 rounded-md bg-white/10 px-3 text-sm text-white/70 hover:bg-white/15 sm:h-9"
      >
        <Search size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">
          <span className="sm:hidden">Search</span>
          <span className="hidden sm:inline">Search players, teams…</span>
        </span>
        <span className="hidden rounded border border-white/20 px-1.5 text-[10px] sm:inline">⌘K</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[120] flex bg-panel sm:items-start sm:justify-center sm:bg-black/50 sm:p-4 sm:pt-[10vh]"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="flex h-full w-full flex-col overflow-hidden bg-panel pt-[env(safe-area-inset-top)] text-ink sm:h-auto sm:max-w-xl sm:rounded-xl sm:border sm:border-line sm:pt-0 sm:shadow-pop"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line pl-3 pr-1 sm:pr-2">
              <Search size={18} className="shrink-0 text-muted" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                  if (e.key === "ArrowDown") setIdx((i) => Math.min(results.length - 1, i + 1));
                  if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
                  if (e.key === "Enter" && results[idx]) {
                    e.preventDefault();
                    go(results[idx]);
                  }
                }}
                aria-label="Search players, teams, managers and pages"
                placeholder="Players, teams, managers, pages…"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70 sm:h-12 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    inputRef.current?.focus();
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
              <button type="button" onClick={close} className="h-10 shrink-0 rounded-md px-2 text-sm font-semibold text-brand-700 hover:bg-sunken dark:text-brand-300 sm:hidden">
                Cancel
              </button>
              <button type="button" onClick={close} className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink sm:flex" aria-label="Close search">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:max-h-[60vh] sm:flex-none sm:pb-1" role="listbox" aria-label="Search results">
              {!q && <div className="px-4 py-6 text-center text-sm text-muted">Type a player name like “Bijan” or a team name.</div>}
              {q && !results.length && <div className="px-4 py-6 text-center text-sm text-muted">{loading ? "Searching…" : "No matches"}</div>}
              {results.map((r, i) => {
                const Icon = r.type === "player" ? null : TYPE_ICON[r.type];
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    role="option"
                    aria-selected={i === idx}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => go(r)}
                    className={cn("flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left active:bg-sunken", i === idx && "sm:bg-sunken")}
                  >
                    {Icon ? (
                      <span className="flex h-6 w-[30px] shrink-0 items-center justify-center rounded bg-sunken text-muted" title={r.type}>
                        <Icon size={14} aria-hidden />
                      </span>
                    ) : (
                      <PosBadge pos={r.position} className="shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.label}</span>
                      {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
                    </span>
                  </button>
                );
              })}
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

/** Bell + recent notifications. A full-width panel under the top bar on phones, a dropdown from sm up. */
function NotificationsBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useLiveEvents([`user:${userId}`], (e) => {
    if (e.type === "notification") {
      setUnread((u) => u + 1);
      setItems((list) => (list ? [e.data as NotificationItem, ...list].slice(0, 30) : list));
    }
  });
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setItems(d.notifications ?? []))
      .catch(() => setItems([]));
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAll = async () => {
    await fetch("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) });
    setUnread(0);
    setItems((l) => l?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? l);
  };

  return (
    <div ref={ref} className="sm:relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("relative flex h-10 w-10 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white", open && "bg-white/10 text-white")}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-live px-1 text-[10px] font-bold leading-none text-white ring-2 ring-brand-950">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 flex max-h-[min(34rem,calc(100dvh-3.5rem-env(safe-area-inset-top)-5.5rem))] flex-col overflow-hidden rounded-lg border border-line bg-panel text-ink shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:max-h-[min(34rem,80vh)] sm:w-[380px]">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line py-1 pl-3 pr-1">
            <span className="text-sm font-bold">Notifications</span>
            <div className="flex items-center text-xs font-semibold">
              {unread > 0 && (
                <button className="h-9 rounded-md px-2 text-brand-600 hover:bg-sunken dark:text-brand-300" onClick={markAll}>
                  Mark all read
                </button>
              )}
              <Link className="flex h-9 items-center rounded-md px-2 text-brand-600 hover:bg-sunken dark:text-brand-300" href="/settings/notifications" onClick={() => setOpen(false)}>
                Settings
              </Link>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
                className={cn("block w-full border-b border-line/60 px-3 py-2.5 text-left hover:bg-sunken", !n.readAt && "bg-brand-50/70 dark:bg-brand-900/25")}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-semibold">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted" suppressHydrationWarning>
                    {timeAgo(n.createdAt)}
                  </span>
                </div>
                <div className="line-clamp-2 text-xs text-muted">{n.body}</div>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="flex h-11 shrink-0 items-center justify-center border-t border-line text-xs font-semibold text-brand-600 hover:bg-sunken dark:text-brand-300">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

/** Phone menu: a drawer with every section as an accordion (the current one open), my team and league switching. */
function MobileMenu({
  isCommish,
  hiddenHrefs = [],
  league,
  leagues,
  myTeam,
}: {
  isCommish: boolean;
  hiddenHrefs?: string[];
  league: TopBarProps["league"];
  leagues: TopBarProps["leagues"];
  myTeam: TopBarTeam | null;
}) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const items = visibleNav(isCommish, hiddenHrefs);
  const current = items.find((i) => navItemActive(i, path))?.label ?? null;
  const [expanded, setExpanded] = useState<string | null>(current);
  const closeRef = useRef<HTMLButtonElement>(null);
  useLockBodyScroll(open);
  // closes on navigation (also covers links that point at the current page's section)
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      <button
        className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white hover:bg-white/10 md:hidden"
        onClick={() => {
          setExpanded(current);
          setOpen(true);
        }}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <Menu size={22} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[110] md:hidden" role="dialog" aria-modal="true" aria-label="Site menu">
          <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden />
          <div className="animate-drawer absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col bg-panel text-ink shadow-pop">
            <div className="shrink-0 bg-brand-950 pl-[max(1rem,env(safe-area-inset-left))] pr-2 pt-[env(safe-area-inset-top)] text-white">
              <div className="flex h-14 items-center gap-2.5">
                {league.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={league.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gold-500 font-display text-xs font-black text-brand-950">CTE</span>
                )}
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-display text-lg font-extrabold uppercase tracking-wider">{league.name}</span>
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-400">{league.season} season</span>
                </span>
                <button ref={closeRef} onClick={close} aria-label="Close menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-white/10">
                  <X size={22} />
                </button>
              </div>
            </div>
            <nav aria-label="All sections" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
              {myTeam && (
                <Link href="/team" onClick={close} className="flex items-center gap-3 border-b border-line bg-sunken/60 px-4 py-3 hover:bg-sunken">
                  <TeamLogo team={myTeam} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{myTeam.name}</span>
                    <span className="block text-xs text-muted">{myTeam.record ? `${myTeam.record} · ` : ""}Set lineup &amp; roster</span>
                  </span>
                </Link>
              )}
              <ul>
                {items.map((item) => {
                  const active = item.label === current;
                  if (!item.children?.length)
                    return (
                      <li key={item.label} className="border-b border-line">
                        <Link
                          href={item.href}
                          onClick={close}
                          aria-current={active && path === item.href ? "page" : undefined}
                          className={cn("flex min-h-12 items-center px-4 text-sm font-bold uppercase tracking-wide hover:bg-sunken", active && "text-brand-700 dark:text-brand-300", item.commishOnly && "text-gold-600 dark:text-gold-400")}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  const links = item.children.some((c) => c.href === item.href) ? item.children : [{ label: item.overviewLabel ?? `${item.label} home`, href: item.href }, ...item.children];
                  const activeHref = active ? activeChildHref(links, path) : null;
                  const isOpen = expanded === item.label;
                  const panelId = `menu-${item.label.toLowerCase().replace(/\W+/g, "-")}`;
                  return (
                    <li key={item.label} className="border-b border-line">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : item.label)}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        className={cn(
                          "flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-sm font-bold uppercase tracking-wide hover:bg-sunken",
                          active && "text-brand-700 dark:text-brand-300",
                          item.commishOnly && "text-gold-600 dark:text-gold-400",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          {item.label}
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-gold-500" aria-label="(current section)" />}
                        </span>
                        <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform", isOpen && "rotate-180")} aria-hidden />
                      </button>
                      {isOpen && (
                        <ul id={panelId} className="pb-2">
                          {links.map((c) => {
                            const here = c.href === activeHref;
                            return (
                              <li key={c.href}>
                                <Link
                                  href={c.href}
                                  onClick={close}
                                  aria-current={here ? "page" : undefined}
                                  className={cn(
                                    "ml-4 flex min-h-11 items-center border-l-2 pl-4 pr-4 text-[15px] hover:bg-sunken hover:text-ink",
                                    here ? "border-gold-500 font-semibold text-ink" : "border-line text-muted",
                                  )}
                                >
                                  {c.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {leagues.length > 1 && (
                <div className="border-b border-line px-4 py-3">
                  <div className="label">Switch league</div>
                  <div className="space-y-1">
                    {leagues.map((l) => (
                      <form key={l.id} action={switchLeagueAction}>
                        <input type="hidden" name="leagueId" value={l.id} />
                        <button
                          className={cn("flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-sunken", l.id === league.id ? "bg-sunken font-bold" : "text-muted")}
                          aria-current={l.id === league.id ? "true" : undefined}
                        >
                          <span className="truncate">{l.name}</span>
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              )}
              <div className="px-4 pt-3 text-xs text-muted">
                <Link href="/settings/notifications" onClick={close} className="flex min-h-10 items-center gap-2 hover:text-ink">
                  <Bell size={15} aria-hidden /> Notifications &amp; phone alerts
                </Link>
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

export function TopBar({ user, league, leagues, myTeam, unread, isCommish, hiddenHrefs }: TopBarProps) {
  return (
    <header className="bg-brand-950 pt-[env(safe-area-inset-top)] text-white">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-1.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-3">
        <MobileMenu isCommish={isCommish} hiddenHrefs={hiddenHrefs} league={league} leagues={leagues} myTeam={myTeam} />
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${league.name} home`}>
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
        <div className="flex min-w-0 flex-1 justify-center sm:px-2">
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
          className="w-64"
          trigger={
            <button className="-mr-1 flex h-10 items-center gap-1 rounded-md px-[5px] hover:bg-white/10 sm:mr-0" aria-label="Account menu">
              <Avatar name={user.name} src={user.avatarUrl} size={30} />
              <ChevronDown size={14} className="hidden opacity-70 sm:block" />
            </button>
          }
        >
          <div className="border-b border-line px-3 py-2 text-xs text-muted">
            Signed in as <span className="font-semibold text-ink">{user.name}</span>
          </div>
          <Link href={`/managers/${user.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunken">
            <User size={14} /> My manager profile
          </Link>
          <Link href="/settings/profile" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunken">
            <Settings size={14} /> Edit profile
          </Link>
          <Link href="/settings/notifications" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-sunken">
            <Bell size={14} /> Notifications &amp; phone alerts
          </Link>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-loss hover:bg-sunken">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </Dropdown>
      </div>
    </header>
  );
}
