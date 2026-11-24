"use client";
// Horizontal switcher of every matchup in the week (live scores), current one highlighted. Scrolls with snap and
// fades the edge with more tiles on phones; the current tile is scrolled into view.
import Link from "next/link";
import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import { LiveDot } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";

export interface StripMatchup {
  id: string;
  status: string;
  home: { id: string; abbrev: string; primaryColor: string; score: number; projected: number } | null;
  away: { id: string; abbrev: string; primaryColor: string; score: number; projected: number } | null;
}

export function MatchupStrip({ leagueId, week, currentId, matchups: initial, myTeamId }: { leagueId: string; week: number; currentId: string; matchups: StripMatchup[]; myTeamId: string | null }) {
  const [ms, setMs] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setMs(initial);
  }
  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "score.update") return;
    const u = e.data as ScoreUpdateEvent;
    if (u.week !== week) return;
    setMs((cur) =>
      cur.map((m) =>
        m.id === u.matchupId
          ? { ...m, status: u.status, home: m.home && { ...m.home, score: u.homeScore, projected: u.homeProjected }, away: m.away && { ...m.away, score: u.awayScore, projected: u.awayProjected } }
          : m,
      ),
    );
  });
  const sorted = [...ms].sort((a, b) => {
    const mine = (m: StripMatchup) => (m.home?.id === myTeamId || m.away?.id === myTeamId ? 0 : 1);
    return mine(a) - mine(b);
  });
  return (
    <ScrollRow as="nav" aria-label={`Week ${week} matchups`} className="-mx-3 scroll-px-3 gap-2 px-3 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
      <Link
        href={`/scoring?week=${week}`}
        className="flex w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-sunken text-center text-[11px] font-semibold uppercase leading-tight tracking-[0.06em] text-muted ring-1 ring-inset ring-line/70 transition-colors hover:text-ink active:scale-[0.98]"
      >
        <LayoutGrid size={16} aria-hidden />
        <span>
          All
          <span className="block text-ink">Wk {week}</span>
        </span>
      </Link>
      {sorted.map((m) => {
        const current = m.id === currentId;
        const mine = m.home?.id === myTeamId || m.away?.id === myTeamId;
        const upcoming = m.status === "UPCOMING";
        const lead = !upcoming && m.home && m.away ? (m.home.score > m.away.score ? m.home.id : m.away.score > m.home.score ? m.away.id : null) : null;
        return (
          <Link
            key={m.id}
            href={`/scoring/${m.id}`}
            aria-current={current ? "page" : undefined}
            aria-label={`${m.away?.abbrev ?? "Bye"} vs ${m.home?.abbrev ?? "Bye"}${current ? " (this matchup)" : ""}`}
            className={cn(
              "min-w-[8.5rem] shrink-0 rounded-xl px-3 py-2 text-[13px] transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98]",
              current
                ? "bg-brand-500/10 shadow-[inset_0_0_0_2px_rgb(58_106_230)] dark:bg-brand-400/15 dark:shadow-[inset_0_0_0_2px_rgb(138_177_251)]"
                : mine
                  ? "bg-gold-400/[0.1] shadow-[inset_0_0_0_1px_rgb(245_179_1/0.45)] hover:bg-gold-400/[0.15]"
                  : "bg-panel shadow-card hover:bg-sunken",
            )}
          >
            {[m.away, m.home].map((t, i) =>
              t ? (
                <div key={t.id} className="flex items-center justify-between gap-3 leading-5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-3 w-1 shrink-0 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/30" style={{ background: t.primaryColor }} aria-hidden />
                    <span className={cn("truncate font-semibold", t.id === myTeamId ? "text-brand-700 dark:text-brand-300" : "text-ink")}>{t.abbrev}</span>
                  </span>
                  <span className={cn("numeral", upcoming ? "text-muted" : lead && lead !== t.id ? "font-medium text-ink/55" : "font-semibold text-ink")}>
                    {upcoming ? t.projected.toFixed(1) : t.score.toFixed(1)}
                  </span>
                </div>
              ) : (
                <div key={i} className="leading-5 text-muted">
                  BYE
                </div>
              ),
            )}
            <div className={cn("mt-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em]", m.status === "LIVE" ? "text-live" : "text-muted")}>
              {m.status === "LIVE" && <LiveDot className="h-1.5 w-1.5" />}
              {m.status === "LIVE" ? "Live" : m.status === "FINAL" ? "Final" : "Proj"}
            </div>
          </Link>
        );
      })}
    </ScrollRow>
  );
}
