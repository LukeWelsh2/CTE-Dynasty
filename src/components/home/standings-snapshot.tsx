// Standings snapshot (Home): ranked rows — rank · logo · team + "record · PF" · playoff odds on the right — with the
// playoff line between the last seed and the first team out. Legend, seeding rules and the odds timestamp sit behind
// the ⓘ sheet instead of footnotes.
import Link from "next/link";
import { Fragment } from "react";
import { MoreLink, Panel, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { formatWhen, pctLabel } from "./logic";
import type { StandingsSnapshotData } from "./types";

const MARKER_TITLE: Record<string, string> = {
  z: "Clinched a first-round bye",
  y: "Clinched the division",
  x: "Clinched a playoff spot",
  e: "Eliminated from playoff contention",
};

export function StandingsSnapshot({ data, timezone, className }: { data: StandingsSnapshotData; timezone: string; className?: string }) {
  const markers = [...new Set(data.rows.map((r) => r.marker).filter((m): m is NonNullable<typeof m> => !!m))];
  // seeding skips teams (division winners / points wildcards): mark each seeded row instead of a cut line
  const showSeeds = data.anyGames && data.cutAfterRank === null && data.rows.some((r) => r.seed !== null);
  const info = data.anyGames ? (
    <>
      <p>
        Top {data.playoffTeams} make the playoffs{data.byes ? `; the top ${data.byes} get first-round byes` : ""}.
      </p>
      {showSeeds && <p>Seeds (#) follow the league&apos;s division-winner and wildcard rules, so the playoff field isn&apos;t simply the top {data.playoffTeams}.</p>}
      {data.hasOdds && (
        <p suppressHydrationWarning>
          Odds are each team&apos;s chance to make the playoffs, from season simulations{data.oddsAsOf ? ` (updated ${formatWhen(data.oddsAsOf, timezone)})` : ""}.
        </p>
      )}
      {markers.length > 0 && (
        <ul className="space-y-1">
          {markers.map((m) => (
            <li key={m}>
              <strong className="font-semibold">{m}</strong> · {MARKER_TITLE[m]}
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/playoffs" className="link">
          Bracket &amp; odds
        </Link>
      </p>
    </>
  ) : (
    <p>Standings start after Week 1.</p>
  );
  return (
    <Panel
      title="Standings"
      subtitle={data.anyGames ? `Top ${data.playoffTeams} make the playoffs` : "Starts after Week 1"}
      info={info}
      infoTitle="How standings work"
      className={className}
      noPad
      actions={<MoreLink href="/standings">All</MoreLink>}
    >
      <ol aria-label={`Standings${data.myRowDetached ? " (top teams and your team)" : ""}`}>
        <li aria-hidden className="flex items-center gap-3 border-y border-line/70 px-4 py-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">
          <span className="w-5 text-center">#</span>
          <span className="flex-1">Team</span>
          <span className="w-14 text-right">{data.hasOdds ? "Odds" : "PF"}</span>
        </li>
        {data.rows.map((r, i) => {
          const prev = data.rows[i - 1];
          const showGap = data.myRowDetached && i === data.rows.length - 1 && prev && r.rank > prev.rank + 1;
          const showCut = data.cutAfterRank !== null && prev && prev.rank === data.cutAfterRank && r.rank > data.cutAfterRank;
          return (
            <Fragment key={r.team.id}>
              {showCut && (
                <li aria-hidden className="flex items-center gap-2 px-4 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                  <span className="h-px flex-1 border-t border-dashed border-ink/25 dark:border-white/25" />
                  Playoff line
                  <span className="h-px flex-1 border-t border-dashed border-ink/25 dark:border-white/25" />
                </li>
              )}
              {showGap && !showCut && (
                <li aria-hidden className="px-4 text-center text-xs leading-3 text-muted">
                  ⋯
                </li>
              )}
              <li className={cn(!showCut && i > 0 && "border-t border-line/70")}>
                <Link
                  href={`/teams/${r.team.id}`}
                  className={cn("flex min-h-[52px] items-center gap-3 px-4 py-1.5 transition-colors hover:bg-sunken/70", r.isMine && "bg-brand-600/[0.05] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.08]")}
                >
                  <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{r.rank}</span>
                  <TeamLogo team={r.team} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span title={r.team.name} className={cn("truncate text-[15px] font-semibold leading-5 sm:text-sm", r.isMine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                        {r.team.name}
                      </span>
                      {showSeeds && r.seed !== null && (
                        <span className="shrink-0 text-[12px] font-semibold text-muted" title={`Current #${r.seed} playoff seed`}>
                          #{r.seed}
                        </span>
                      )}
                      {r.marker && (
                        <span className="shrink-0 text-[12px] font-bold text-muted" title={MARKER_TITLE[r.marker]}>
                          {r.marker}
                        </span>
                      )}
                    </span>
                    <span className="numeral block text-[13px] leading-[18px] text-muted">
                      {r.record}
                      {r.streak && <span className={cn("ml-1.5", r.streak.startsWith("W") ? "text-win" : r.streak.startsWith("L") ? "text-loss" : "")}>{r.streak}</span>}
                      {data.hasOdds && <span> · PF {r.pointsFor.toFixed(0)}</span>}
                    </span>
                  </span>
                  <span className={cn("numeral w-14 shrink-0 text-right text-[15px] font-semibold", data.hasOdds && (r.playoffPct ?? 0) < 0.5 ? "text-muted" : "text-ink")}>
                    {data.hasOdds ? pctLabel(r.playoffPct) : r.pointsFor.toFixed(0)}
                  </span>
                </Link>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </Panel>
  );
}
