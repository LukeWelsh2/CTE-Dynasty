"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Repeat, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", icon: Home, match: [] as string[] },
  { href: "/team", label: "My Team", icon: Users, match: ["/team"] },
  { href: "/scoring/my", label: "Matchup", icon: Trophy, match: ["/scoring"] },
  { href: "/trades", label: "Trades", icon: Repeat, match: ["/trades"] },
  { href: "/chat", label: "Chat", icon: MessageCircle, match: ["/chat"] },
];

/** Whether a tab owns the current path: whole path segments only, so /teams/… doesn't light up "My Team". */
export function tabActive(tab: { href: string; match: string[] }, path: string): boolean {
  if (tab.href === "/") return path === "/";
  return tab.match.some((m) => path === m || path.startsWith(m + "/"));
}

/** Bottom tab bar on phones (thumb-reachable primary sections). Solid bar with a hairline; main reserves room for it. */
export function MobileTabBar() {
  const path = usePathname() ?? "/";
  return (
    <nav
      aria-label="Primary"
      className="bar-bottom fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden"
    >
      <div className="grid grid-cols-5">
        {TABS.map((t) => {
          const active = tabActive(t, path);
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-semibold leading-tight tracking-[-0.005em] transition-colors",
                active ? "text-ink" : "text-muted",
              )}
            >
              {/* the active tab's icon sits in a tinted pill (clear state without a heavy indicator) */}
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-200 ease-out-expo group-active:scale-90",
                  active ? "bg-brand-500/[0.12] text-brand-600 dark:bg-brand-400/[0.18] dark:text-brand-200" : "text-muted",
                )}
              >
                <Icon size={21} strokeWidth={active ? 2.3 : 1.9} />
              </span>
              <span className="whitespace-nowrap">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
