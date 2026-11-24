// Power rankings list (server): rank + movement, blurb, composite score and the components behind it.
import { InjuryTag } from "@/components/ui/core";
import type { PowerRow } from "@/lib/playoffs/view";
import { cn, fmtPts, ordinal, record } from "@/lib/utils";
import { ClinchBadge, fmtProb, LastFive, Movement, Streak, TeamCell } from "./bits";

function Stat({ label, sub, children, className }: { label: string; sub?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
        {sub ? <span className="font-normal normal-case tracking-normal"> · {sub}</span> : null}
      </div>
      <div className="truncate text-sm font-semibold tabular-nums text-ink">{children}</div>
    </div>
  );
}

export function PowerList({ rows, myTeamId }: { rows: PowerRow[]; myTeamId: string | null }) {
  const maxScore = Math.max(1, ...rows.map((r) => r.row.powerScore));
  return (
    <ol className="space-y-2" aria-label="Power rankings">
      {rows.map((p) => {
        const r = p.row;
        const mine = r.team.id === myTeamId;
        const delta = p.prevRank === null ? null : p.prevRank - r.powerRank;
        return (
          <li
            key={r.team.id}
            className={cn(
              "overflow-hidden rounded-lg border bg-panel shadow-panel",
              mine ? "border-gold-400 ring-1 ring-gold-400/50" : "border-line",
            )}
          >
            <div className="h-0.5" style={{ background: `linear-gradient(90deg, ${r.team.primaryColor} 0 70%, ${r.team.secondaryColor} 70% 100%)` }} aria-hidden />
            <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 lg:grid-cols-[52px_minmax(0,1.35fr)_minmax(0,2.2fr)] lg:items-center">
              <div className="row-span-2 flex flex-col items-center justify-start lg:row-span-1">
                <span className="font-display text-3xl font-extrabold leading-none tabular-nums text-ink">{r.powerRank}</span>
                <Movement delta={delta} className="mt-1" />
              </div>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <TeamCell team={r.team} owner={p.owner} myTeamId={myTeamId} marker={p.marker} size={32} />
                  <span className="shrink-0 text-right lg:hidden">
                    <span className="block font-display text-lg font-bold leading-none tabular-nums">{r.powerScore.toFixed(1)}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted">score</span>
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-snug text-ink/90">{p.blurb}</p>
                {p.injured.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted" aria-label="Key players on the injury report">
                    {p.injured.map((i) => (
                      <li key={i.id} className="inline-flex items-center gap-1">
                        <InjuryTag status={i.status} />
                        {i.name} <span className="text-muted/80">{i.position}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="col-start-2 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line pt-2 sm:grid-cols-6 lg:col-start-auto lg:border-0 lg:pt-0">
                <div className="col-span-3 hidden sm:col-span-6 lg:block">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Power score</span>
                    <span className="font-display text-lg font-bold leading-none tabular-nums">{r.powerScore.toFixed(1)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                    <div className="h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${(r.powerScore / maxScore) * 100}%` }} />
                  </div>
                </div>
                <Stat label="Record">
                  {record(r.wins, r.losses, r.ties)} <span className="text-[11px] font-normal text-muted">· <Streak value={r.streak} /></span>
                </Stat>
                <Stat label="PF" sub={ordinal(p.pfRank)}>
                  {fmtPts(r.pointsFor, 1)}
                </Stat>
                <Stat label="All-play">{(p.allPlayPct * 100).toFixed(0)}%</Stat>
                <Stat label="Last 5">
                  <LastFive results={r.last5} />
                </Stat>
                <Stat label="ROS/wk" sub={p.rosRank ? ordinal(p.rosRank) : null}>
                  {p.rosPerWeek !== null ? fmtPts(p.rosPerWeek, 1) : <span className="text-muted">—</span>}
                </Stat>
                <Stat label="Playoffs">
                  <span className="inline-flex items-center gap-1">
                    {p.playoffPct !== null ? fmtProb(p.playoffPct, p.playoffLock) : "—"}
                    <ClinchBadge marker={p.marker} />
                  </span>
                </Stat>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
