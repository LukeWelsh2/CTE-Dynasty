"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Repeat, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", icon: Home, match: [] as string[] },
  { href: "/team", label: "Roster", icon: Users, match: ["/team"] },
  { href: "/scoring/my", label: "Matchup", icon: Trophy, match: ["/scoring"] },
  { href: "/trades", label: "Trades", icon: Repeat, match: ["/trades"] },
  { href: "/chat", label: "Chat", icon: MessageCircle, match: ["/chat"] },
];

/** Whether a tab owns the current path: whole path segments only, so /teams/… doesn't light up "Roster". */
export function tabActive(tab: { href: string; match: string[] }, path: string): boolean {
  if (tab.href === "/") return path === "/";
  return tab.match.some((m) => path === m || path.startsWith(m + "/"));
}

/**
 * Bottom tab bar on phones (thumb-reachable primary sections): a floating, solid white rounded bar inset from the screen
 * edges (no glass), icon over label, the active tab blue on a light-blue rounded highlight. `--tabbar-h` (globals.css)
 * is its whole footprint, so `<main>` and fixed bottom bars clear it.
 */
export function MobileTabBar() {
  const path = usePathname() ?? "/";
  return (
    <nav
      aria-label="Primary"
      className="tabbar-float fixed bottom-[var(--tabbar-gap)] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 rounded-[22px] bg-chrome p-1 md:hidden"
    >
      <div className="grid grid-cols-5 gap-0.5">
        {TABS.map((t) => {
          const active = tabActive(t, path);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 text-[11px] font-semibold leading-tight tracking-[-0.005em] transition-colors",
                active ? "bg-brand-600/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-400" : "text-ink/80 hover:bg-sunken active:bg-sunken",
              )}
            >
              <span aria-hidden className="flex h-6 items-center justify-center transition-transform duration-200 ease-out-expo group-active:scale-90">
                <Icon size={22} strokeWidth={active ? 2.3 : 1.8} />
              </span>
              <span className="whitespace-nowrap">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
