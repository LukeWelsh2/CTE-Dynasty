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
        <div className="hero-surface relative rounded-none px-5 py-8 text-center shadow-none sm:px-8">
          <p className="numeral font-display text-[80px] font-black leading-none tracking-[0.02em] text-gold-400 sm:text-[96px]" aria-hidden>
            404
          </p>
          <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.24em] text-gold-400/90">Out of bounds</p>
          <h1 id="league-404-title" className="mt-1 font-display text-3xl font-extrabold uppercase tracking-[0.02em]">
            Page not found
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/75">
            That page isn&apos;t in the playbook. The player, team, trade or week you were looking for may have moved or no longer exists.
          </p>
          <Link href="/" className={buttonClass("gold", "lg", "mt-5 sm:h-10 sm:text-sm")}>
            <House size={16} aria-hidden /> Back to League Home
          </Link>
        </div>
        <nav aria-label="Popular pages" className="p-3 sm:p-4">
          <h2 className="eyebrow mb-2 px-1">Try one of these</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DESTINATIONS.map((d) => (
              <li key={d.href}>
                <Link href={d.href} className="flex min-h-[52px] items-center gap-3 rounded-xl bg-sunken px-3 py-2.5 transition-colors hover:bg-brand-500/[0.08] dark:hover:bg-brand-400/[0.12]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-500/10 text-brand-700 dark:bg-brand-400/15 dark:text-brand-200">
                    <d.icon size={17} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{d.label}</span>
                    <span className="block truncate text-xs text-muted">{d.hint}</span>
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
