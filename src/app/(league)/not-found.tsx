// 404 inside the league shell: shown when a league page calls notFound() (unknown player, team, trade,
// matchup, recap week…). The nav stays in place, so this offers the most common destinations.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ClipboardList, House, ListOrdered, MessagesSquare, Search, Swords } from "lucide-react";
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
    <div className="mx-auto max-w-2xl py-6 sm:py-10">
      <section aria-labelledby="league-404-title" className="overflow-hidden rounded-xl border border-line bg-panel shadow-panel">
        <div className="relative overflow-hidden bg-brand-950 px-5 py-8 text-center text-white sm:px-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent 0 47px, rgba(255,255,255,0.09) 47px 48px), radial-gradient(ellipse at 50% -30%, rgba(245,179,1,0.4), transparent 60%)",
            }}
          />
          <div className="relative">
            <p className="font-display text-7xl font-black leading-none tracking-wider text-gold-400 sm:text-8xl" aria-hidden>
              404
            </p>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.25em] text-gold-400/90">Out of bounds</p>
            <h1 id="league-404-title" className="mt-1 font-display text-3xl font-extrabold uppercase tracking-wide">
              Page not found
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/75">
              That page isn&apos;t in the playbook. The player, team, trade or week you were looking for may have moved or no longer exists.
            </p>
            <Link href="/" className={buttonClass("gold", "md", "mt-5")}>
              <House size={15} aria-hidden /> Back to League Home
            </Link>
          </div>
        </div>
        <nav aria-label="Popular pages" className="p-3 sm:p-4">
          <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">Try one of these</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DESTINATIONS.map((d) => (
              <li key={d.href}>
                <Link href={d.href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:border-brand-300 hover:bg-sunken dark:hover:border-brand-700">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                    <d.icon size={17} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{d.label}</span>
                    <span className="block truncate text-xs text-muted">{d.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>
    </div>
  );
}
