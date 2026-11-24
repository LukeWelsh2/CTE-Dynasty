// 404 inside the league shell: shown when a league page calls notFound() (unknown player, team, trade,
// matchup, recap week…). The nav stays in place, so this offers the most common destinations.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight, ClipboardList, House, ListOrdered, MessagesSquare, Search, Swords } from "lucide-react";
import { buttonClass } from "@/components/ui/core";

export const metadata: Metadata = { title: "Page not found" };

const DESTINATIONS = [
  { href: "/team", label: "My Team", hint: "Roster, lineup & cap", icon: ClipboardList },
  { href: "/players", label: "Players", hint: "Search every NFL player", icon: Search },
  { href: "/scoring", label: "Scoreboard", hint: "This week's matchups", icon: Swords },
  { href: "/standings", label: "Standings", hint: "Records & playoff race", icon: ListOrdered },
  { href: "/trades", label: "Trade Center", hint: "Offers & trade history", icon: ArrowLeftRight },
  { href: "/chat", label: "League Chat", hint: "Talk trash with the league", icon: MessagesSquare },
];

export default function LeagueNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-4 sm:py-10">
      <section aria-labelledby="league-404-title" className="card overflow-hidden">
        <div className="px-5 pb-5 pt-8 text-center sm:px-8">
          <p className="numeral text-[64px] font-bold leading-none tracking-[-0.04em] text-ink sm:text-[80px]" aria-hidden>
            404
          </p>
          <h1 id="league-404-title" className="mt-3 text-[24px] font-bold tracking-[-0.02em]">
            Page not found
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-[15px] text-muted">The player, team, trade or week may have moved or no longer exists.</p>
          <Link href="/" className={buttonClass("primary", "lg", "mt-5 sm:h-10 sm:text-sm")}>
            <House size={16} aria-hidden /> League home
          </Link>
        </div>
        <nav aria-label="Popular pages" className="border-t border-line/70">
          <h2 className="eyebrow px-4 pb-1 pt-3">Try one of these</h2>
          <ul className="grid grid-cols-1 divide-y divide-line/70 sm:grid-cols-2 sm:divide-y-0">
            {DESTINATIONS.map((d) => (
              <li key={d.href}>
                <Link href={d.href} className="flex min-h-[52px] items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken text-ink/70">
                    <d.icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink sm:text-sm">{d.label}</span>
                    <span className="block truncate text-[13px] text-muted">{d.hint}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </div>
  );
}
