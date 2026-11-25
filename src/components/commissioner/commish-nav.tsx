"use client";
// Commissioner sub-navigation (sits above the title on every /commissioner page): the kit's underline tab row
// (TabLinks look) — scrolls sideways with snap on phones, fades the edge that has more, keeps the active tab in view.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ScrollRow } from "@/components/ui/scroll-row";

const ITEMS = [
  { href: "/commissioner", label: "Home", exact: true },
  { href: "/commissioner/settings", label: "Settings", exclude: "/commissioner/settings/scoring" },
  { href: "/commissioner/settings/scoring", label: "Scoring" },
  { href: "/commissioner/members", label: "Members" },
  { href: "/commissioner/rosters", label: "Rosters" },
  { href: "/commissioner/trades", label: "Trades" },
  { href: "/commissioner/schedule", label: "Schedule" },
  { href: "/commissioner/season", label: "Season" },
  { href: "/commissioner/system", label: "System" },
];

export function CommishNav() {
  const path = usePathname() ?? "";
  return (
    <ScrollRow as="nav" aria-label="Commissioner tools" className="-mx-1 mb-3 gap-1 border-b border-line px-1">
      {ITEMS.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href) && !(it.exclude && path.startsWith(it.exclude));
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 text-[15px] font-semibold transition-colors duration-150 sm:min-h-10 sm:text-sm",
              active
                ? "text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand-600 dark:after:bg-brand-400"
                : "text-muted hover:text-ink",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </ScrollRow>
  );
}
