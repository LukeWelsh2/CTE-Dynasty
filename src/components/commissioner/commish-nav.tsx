"use client";
// Commissioner sub-navigation (sits under the main nav on every /commissioner page).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, CalendarDays, Gauge, ListChecks, Settings2, ShieldCheck, Sigma, Users, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/commissioner", label: "Home", icon: Gauge, exact: true },
  { href: "/commissioner/settings", label: "Settings", icon: Settings2, exclude: "/commissioner/settings/scoring" },
  { href: "/commissioner/settings/scoring", label: "Scoring", icon: Sigma },
  { href: "/commissioner/members", label: "Members", icon: Users },
  { href: "/commissioner/rosters", label: "Rosters", icon: ListChecks },
  { href: "/commissioner/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/commissioner/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/commissioner/season", label: "Season", icon: ShieldCheck },
  { href: "/commissioner/system", label: "System", icon: Wrench },
];

export function CommishNav() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Commissioner tools" className="scroll-thin -mx-3 mb-4 overflow-x-auto border-b border-line bg-panel/60 px-3 sm:mx-0 sm:rounded-lg sm:border sm:px-1">
      <ul className="flex min-w-max gap-0.5">
        {ITEMS.map((it) => {
          const active = it.exact ? path === it.href : path.startsWith(it.href) && !(it.exclude && path.startsWith(it.exclude));
          const Icon = it.icon;
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors",
                  active ? "border-gold-500 text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                <Icon size={14} aria-hidden />
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
