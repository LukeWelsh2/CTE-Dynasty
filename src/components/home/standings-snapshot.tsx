// Standings snapshot: top teams + my team, the playoff cut line, seeds and playoff odds.
import Link from "next/link";
import { Fragment } from "react";
import { Panel, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { MoreLink } from "./bits";
import { formatWhen, pctLabel } from "./logic";
import type { StandingsSnapshotData } from "./types";

const MARKER_TITLE: Record<string, string> = {
  z: "Clinched a first-round bye",
  y: "Clinched the division",
  x: "Clinched a playoff spot",
  e: "Eliminated from playoff contention",
};

export function StandingsSnapshot({ data, timezone, className }: { data: StandingsSnapshotData; timezone: string; className?: string }) {
  const cols = data.hasOdds ? 5 : 4;
  const markers = [...new Set(data.rows.map((r) => r.marker).filter((m): m is NonNullable<typeof m> => !!m))];
  // seeding skips teams (division winners / points wildcards): mark each seeded row instead of a cut line
  const showSeeds = data.anyGames && data.cutAfterRank === null && data.rows.some((r) => r.seed !== null);
  return (
    <Panel
      title="Standings"
      subtitle={data.anyGames ? `Top ${data.playoffTeams} make the playoffs${data.byes ? ` · ${data.byes} byes` : ""}` : "Standings start after Week 1"}
      className={className}
      noPad
      actions={<MoreLink href="/standings">Full standings</MoreLink>}
    >
      <table className="tbl tbl-compact table-fixed text-[13px]">
        <caption className="sr-only">Standings snapshot{data.myRowDetached ? " (top teams and your team)" : ""}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-8 text-center">
              #
            </th>
            <th scope="col">Team</th>
            <th scope="col" className="num w-14 sm:w-[5.25rem]">
              W-L
            </th>
            <th scope="col" className="num w-12">
              PF
            </th>
            {data.hasOdds && (
              <th scope="col" className="num w-[3.25rem]" title="Playoff odds">
                Odds
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => {
            const prev = data.rows[i - 1];
            const showGap = data.myRowDetached && i === data.rows.length - 1 && prev && r.rank > prev.rank + 1;
            const showCut = data.cutAfterRank !== null && prev && prev.rank === data.cutAfterRank && r.rank > data.cutAfterRank;
            return (
              <Fragment key={r.team.id}>
                {showCut && (
                  <tr aria-hidden>
                    <td colSpan={cols} className="!border-b-0 !p-0">
                      <div className="flex items-center gap-2 px-3 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gold-700 dark:text-gold-400">
                        <span className="h-px flex-1 border-t border-dashed border-gold-500/70" />
                        Playoff line
                        <span className="h-px flex-1 border-t border-dashed border-gold-500/70" />
                      </div>
                    </td>
                  </tr>
                )}
                {showGap && !showCut && (
                  <tr aria-hidden>
                    <td colSpan={cols} className="!py-0 text-center text-xs leading-3 text-muted">
                      ⋯
                    </td>
                  </tr>
                )}
                <tr className={cn(r.isMine && "row-mine")}>
                  <td className="text-center font-semibold tabular-nums text-muted">{r.rank}</td>
                  <td className="max-w-0">
                    <Link href={`/teams/${r.team.id}`} className="flex min-w-0 items-center gap-1.5 hover:underline">
                      <TeamLogo team={r.team} size={20} />
                      <span title={r.team.name} className={cn("truncate font-semibold", r.isMine ? "text-brand-700 dark:text-brand-300" : "text-ink")}>
                        {r.team.name}
                      </span>
                      {showSeeds && r.seed !== null && (
                        <span className="shrink-0 rounded bg-gold-300/25 px-1 text-[10px] font-bold leading-4 text-gold-700 dark:text-gold-400" title={`Current #${r.seed} playoff seed`}>
                          #{r.seed}
                        </span>
                      )}
                      {r.marker && (
                        <span className="shrink-0 text-[11px] font-bold text-muted" title={MARKER_TITLE[r.marker]}>
                          {r.marker}
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="num whitespace-nowrap">
                    {r.record}
                    {r.streak && <span className={cn("ml-1 hidden text-[11px] font-medium sm:inline", r.streak.startsWith("W") ? "text-win" : r.streak.startsWith("L") ? "text-loss" : "text-muted")}>{r.streak}</span>}
                  </td>
                  <td className="num text-muted">{r.pointsFor.toFixed(0)}</td>
                  {data.hasOdds && <td className={cn("num font-semibold", r.playoffPct !== null && r.playoffPct >= 0.5 ? "text-ink" : "text-muted")}>{pctLabel(r.playoffPct)}</td>}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {(markers.length > 0 || data.oddsAsOf || showSeeds) && data.anyGames && (
        <div className="space-y-0.5 border-t border-line/70 px-3 py-2.5 text-xs text-muted sm:px-4">
          {showSeeds && <p>Seeds (#) follow the league&apos;s division-winner and wildcard rules, so the playoff field isn&apos;t simply the top {data.playoffTeams}.</p>}
          {markers.length > 0 && (
            <p>
              {markers.map((m, i) => (
                <span key={m}>
                  {i > 0 && " · "}
                  <strong className="text-ink">{m}</strong> {MARKER_TITLE[m].toLowerCase()}
                </span>
              ))}
            </p>
          )}
          {data.oddsAsOf && (
            <p suppressHydrationWarning>
              Playoff odds from season simulations · updated {formatWhen(data.oddsAsOf, timezone)} ·{" "}
              <Link href="/playoffs" className="link">
                Bracket &amp; odds
              </Link>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
