"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Bell,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Gavel,
  House,
  ListOrdered,
  LogOut,
  Menu,
  Receipt,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Swords,
  Trophy,
  User,
  UserSearch,
  X,
} from "lucide-react";
import { Avatar, menuItemClass, menuLabelClass, PosBadge, TeamLogo } from "@/components/ui/core";
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

/** The league mark: uploaded logo or the gold "CTE" squircle. */
function LeagueMark({ logoUrl, size = 36 }: { logoUrl: string | null; size?: number }) {
  if (logoUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt="" className="shrink-0 rounded-[10px] object-cover ring-1 ring-white/10" style={{ width: size, height: size }} />;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-b from-gold-300 to-gold-500 font-display font-black tracking-tight text-brand-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_1px_2px_rgb(0_0_0/0.3)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      CTE
    </span>
  );
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
        className="flex h-10 w-full min-w-0 max-w-sm items-center gap-2 rounded-full bg-white/[0.08] px-3.5 text-sm text-white/65 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] transition-colors hover:bg-white/[0.12] hover:text-white/80 sm:h-9"
      >
        <Search size={16} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">
          <span className="sm:hidden">Search</span>
          <span className="hidden sm:inline">Search players, teams…</span>
        </span>
        <span className="hidden rounded-md bg-white/10 px-1.5 py-px text-[11px] font-medium text-white/70 sm:inline">⌘K</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[120] flex bg-raised sm:items-start sm:justify-center sm:bg-[rgb(3_7_18/0.5)] sm:p-4 sm:pt-[10vh] dark:sm:bg-black/[0.66]"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="animate-fade-in flex h-full w-full flex-col overflow-hidden bg-raised pt-[env(safe-area-inset-top)] text-ink sm:h-auto sm:max-w-xl sm:rounded-2xl sm:pt-0 sm:shadow-pop"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line/70 pl-4 pr-1.5 sm:pr-2">
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
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    inputRef.current?.focus();
                  }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-ink"
                  aria-label="Clear search"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/[0.12] text-panel dark:bg-white/25 dark:text-raised">
                    <X size={12} strokeWidth={3} />
                  </span>
                </button>
              )}
              <button type="button" onClick={close} className="h-10 shrink-0 rounded-full px-2.5 text-[15px] font-semibold text-brand-600 hover:bg-ink/[0.05] dark:text-brand-300 sm:hidden">
                Cancel
              </button>
              <kbd className="kbd mr-1 hidden sm:inline">Esc</kbd>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] sm:max-h-[60vh] sm:flex-none sm:pb-1.5" role="listbox" aria-label="Search results">
              {!q && <div className="px-4 py-8 text-center text-sm text-muted">Type a player name like “Bijan” or a team name.</div>}
              {q && !results.length && <div className="px-4 py-8 text-center text-sm text-muted">{loading ? "Searching…" : "No matches"}</div>}
              {results.map((r, i) => {
                const Icon = r.type === "player" ? null : TYPE_ICON[r.type];
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    role="option"
                    aria-selected={i === idx}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => go(r)}
                    className={cn("flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors active:bg-ink/[0.06]", i === idx && "sm:bg-brand-500/[0.08] dark:sm:bg-brand-400/[0.12]")}
                  >
                    {Icon ? (
                      <span className="flex h-7 w-[30px] shrink-0 items-center justify-center rounded-md bg-sunken text-muted" title={r.type}>
                        <Icon size={14} aria-hidden />
                      </span>
                    ) : (
                      <PosBadge pos={r.position} className="shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold sm:text-sm">{r.label}</span>
                      {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
                    </span>
                    <ChevronRight size={16} className={cn("shrink-0 text-faint", i === idx ? "sm:opacity-100" : "sm:opacity-0")} aria-hidden />
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

/** Bell + recent notifications. A full-width card under the top bar on phones, a dropdown from sm up. */
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
        className={cn("relative flex h-10 w-10 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white active:scale-95", open && "bg-white/10 text-white")}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="numeral absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-live px-1 text-[11px] font-bold leading-none tracking-normal text-white ring-2 ring-chrome">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="raised animate-menu fixed inset-x-2 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 flex max-h-[min(34rem,calc(100dvh-3.5rem-env(safe-area-inset-top)-5.5rem))] origin-top-right flex-col overflow-hidden rounded-2xl text-ink sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:max-h-[min(34rem,80vh)] sm:w-[380px]">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line/70 py-1.5 pl-4 pr-1.5">
            <span className="text-[15px] font-semibold">Notifications</span>
            <div className="flex items-center text-[13px] font-semibold">
              {unread > 0 && (
                <button className="h-9 rounded-full px-2.5 text-brand-600 hover:bg-ink/[0.05] dark:text-brand-300" onClick={markAll}>
                  Mark all read
                </button>
              )}
              <Link className="flex h-9 items-center rounded-full px-2.5 text-brand-600 hover:bg-ink/[0.05] dark:text-brand-300" href="/settings/notifications" onClick={() => setOpen(false)}>
                Settings
              </Link>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {items === null && (
              <div className="space-y-3 p-2.5" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <span className="skeleton block h-3.5 w-3/5" />
                    <span className="skeleton block h-3 w-4/5" />
                  </div>
                ))}
              </div>
            )}
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
                className="flex w-full gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-ink/[0.04] dark:hover:bg-white/[0.05]"
              >
                <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-500 dark:bg-brand-400")} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className={cn("min-w-0 text-sm", n.readAt ? "font-medium text-ink/85" : "font-semibold")}>{n.title}</span>
                    <span className="shrink-0 text-xs text-muted" suppressHydrationWarning>
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs leading-relaxed text-muted">{n.body}</span>
                </span>
              </button>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="flex h-11 shrink-0 items-center justify-center border-t border-line/70 text-[13px] font-semibold text-brand-600 hover:bg-ink/[0.04] dark:text-brand-300">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

/** Drawer icon per section (keyed by the section's href). */
const SECTION_ICON: Record<string, typeof House> = {
  "/": House,
  "/team": ClipboardList,
  "/players": UserSearch,
  "/scoring": Swords,
  "/standings": ListOrdered,
  "/trades": ArrowLeftRight,
  "/transactions": Receipt,
  "/draft": Gavel,
  "/league": Trophy,
  "/commissioner": ShieldCheck,
};

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
        className="-ml-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 active:scale-95 md:hidden"
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
          <div className="scrim animate-backdrop absolute inset-0" onClick={close} aria-hidden />
          <div className="animate-drawer absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col bg-raised text-ink shadow-pop">
            <div className="shrink-0 bg-chrome pl-[max(1rem,env(safe-area-inset-left))] pr-2 pt-[env(safe-area-inset-top)] text-white">
              <div className="flex h-14 items-center gap-2.5">
                <LeagueMark logoUrl={league.logoUrl} size={34} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-display text-lg font-extrabold uppercase tracking-[0.04em]">{league.name}</span>
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-400">{league.season} season</span>
                </span>
                <button ref={closeRef} onClick={close} aria-label="Close menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
                  <X size={22} />
                </button>
              </div>
            </div>
            <nav aria-label="All sections" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
              {myTeam && (
                <Link href="/team" onClick={close} className="mx-3 mt-3 flex items-center gap-3 rounded-xl bg-sunken px-3 py-2.5 ring-1 ring-inset ring-line/60 transition-colors active:bg-ink/[0.06]">
                  <TeamLogo team={myTeam} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{myTeam.name}</span>
                    <span className="block text-xs text-muted">{myTeam.record ? `${myTeam.record} · ` : ""}Set lineup &amp; roster</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-faint" aria-hidden />
                </Link>
              )}
              <ul className="mt-2">
                {items.map((item) => {
                  const active = item.label === current;
                  const Icon = SECTION_ICON[item.href] ?? FileText;
                  const rowCls = cn(
                    "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] font-semibold transition-colors active:bg-ink/[0.05]",
                    active ? "text-brand-700 dark:text-brand-200" : "text-ink",
                    item.commishOnly && !active && "text-gold-700 dark:text-gold-400",
                  );
                  const icon = (
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]",
                        active ? "bg-brand-600 text-white dark:bg-brand-500" : item.commishOnly ? "bg-gold-400/20 text-gold-700 dark:text-gold-400" : "bg-sunken text-muted",
                      )}
                    >
                      <Icon size={17} />
                    </span>
                  );
                  if (!item.children?.length)
                    return (
                      <li key={item.label}>
                        <Link href={item.href} onClick={close} aria-current={active && path === item.href ? "page" : undefined} className={rowCls}>
                          {icon}
                          <span className="flex-1">{item.label}</span>
                        </Link>
                      </li>
                    );
                  const links = item.children.some((c) => c.href === item.href) ? item.children : [{ label: item.overviewLabel ?? `${item.label} home`, href: item.href }, ...item.children];
                  const activeHref = active ? activeChildHref(links, path) : null;
                  const isOpen = expanded === item.label;
                  const panelId = `menu-${item.label.toLowerCase().replace(/\W+/g, "-")}`;
                  return (
                    <li key={item.label}>
                      <button type="button" onClick={() => setExpanded(isOpen ? null : item.label)} aria-expanded={isOpen} aria-controls={panelId} className={rowCls}>
                        {icon}
                        <span className="flex-1">{item.label}</span>
                        <ChevronDown size={18} className={cn("shrink-0 text-faint transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
                      </button>
                      {isOpen && (
                        <ul id={panelId} className="mb-1.5 ml-[3.75rem] mr-3 border-l border-line">
                          {links.map((c) => {
                            const here = c.href === activeHref;
                            return (
                              <li key={c.href}>
                                <Link
                                  href={c.href}
                                  onClick={close}
                                  aria-current={here ? "page" : undefined}
                                  className={cn(
                                    "relative -ml-px flex min-h-11 items-center border-l-2 pl-3.5 pr-2 text-[15px] transition-colors active:bg-ink/[0.04]",
                                    here ? "border-gold-500 font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
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
                <div className="mx-3 mt-3 border-t border-line/70 pt-3">
                  <div className="eyebrow mb-1.5 px-1">Switch league</div>
                  <div className="space-y-1">
                    {leagues.map((l) => (
                      <form key={l.id} action={switchLeagueAction}>
                        <input type="hidden" name="leagueId" value={l.id} />
                        <button
                          className={cn("flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm transition-colors hover:bg-ink/[0.05]", l.id === league.id ? "bg-sunken font-semibold" : "text-muted")}
                          aria-current={l.id === league.id ? "true" : undefined}
                        >
                          <span className="truncate">{l.name}</span>
                        </button>
                      </form>
                    ))}
                  </div>
                </div>
              )}
              <div className="mx-3 mt-3 border-t border-line/70 pt-2 text-sm text-muted">
                <Link href="/settings/notifications" onClick={close} className="flex min-h-11 items-center gap-2.5 rounded-lg px-1 hover:text-ink">
                  <Bell size={16} aria-hidden /> Notifications &amp; phone alerts
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
    <header className="bg-chrome pt-[env(safe-area-inset-top)] text-white">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-1.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:gap-3">
        <MobileMenu isCommish={isCommish} hiddenHrefs={hiddenHrefs} league={league} leagues={leagues} myTeam={myTeam} />
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-xl" aria-label={`${league.name} home`}>
          <LeagueMark logoUrl={league.logoUrl} />
          <span className="hidden leading-tight sm:block">
            <span className="block font-display text-[19px] font-extrabold uppercase leading-5 tracking-[0.04em]">{league.name}</span>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-400">{league.season} Season · Dynasty</span>
          </span>
        </Link>
        {leagues.length > 1 && (
          <Dropdown
            trigger={
              <button className="hidden h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-white/70 hover:bg-white/10 hover:text-white lg:flex">
                Switch league <ChevronDown size={12} aria-hidden />
              </button>
            }
          >
            {leagues.map((l) => (
              <form key={l.id} action={switchLeagueAction}>
                <input type="hidden" name="leagueId" value={l.id} />
                <button className={cn(menuItemClass, l.id === league.id && "font-semibold")}>{l.name}</button>
              </form>
            ))}
          </Dropdown>
        )}
        <div className="flex min-w-0 flex-1 justify-center sm:px-2">
          <GlobalSearch />
        </div>
        {myTeam && (
          <Link href="/team" className="hidden items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-white/10 lg:flex">
            <TeamLogo team={myTeam} size={30} />
            <span className="leading-tight">
              <span className="block max-w-[160px] truncate text-sm font-semibold">{myTeam.name}</span>
              {myTeam.record && <span className="numeral block text-[11px] text-white/60">{myTeam.record}</span>}
            </span>
          </Link>
        )}
        <ThemeToggle />
        <NotificationsBell userId={user.id} initialUnread={unread} />
        <Dropdown
          align="right"
          className="w-64"
          trigger={
            <button className="-mr-1 flex h-10 items-center gap-1 rounded-full px-[5px] transition-colors hover:bg-white/10 sm:mr-0" aria-label="Account menu">
              <Avatar name={user.name} src={user.avatarUrl} size={30} className="ring-2 ring-white/15" />
              <ChevronDown size={14} className="hidden opacity-70 sm:block" aria-hidden />
            </button>
          }
        >
          <div className={menuLabelClass}>
            Signed in as <span className="font-semibold text-ink">{user.name}</span>
          </div>
          <Link href={`/managers/${user.id}`} className={menuItemClass}>
            <User size={15} aria-hidden /> My manager profile
          </Link>
          <Link href="/settings/profile" className={menuItemClass}>
            <Settings size={15} aria-hidden /> Edit profile
          </Link>
          <Link href="/settings/notifications" className={menuItemClass}>
            <Bell size={15} aria-hidden /> Notifications &amp; phone alerts
          </Link>
          <form action={logoutAction}>
            <button className={cn(menuItemClass, "text-loss [&>svg]:text-loss")}>
              <LogOut size={15} aria-hidden /> Sign out
            </button>
          </form>
        </Dropdown>
      </div>
    </header>
  );
}
