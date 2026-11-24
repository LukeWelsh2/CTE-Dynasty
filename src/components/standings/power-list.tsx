// Power rankings list (server, docs/DESIGN.md §5 "Ranking"): ranked rows — rank + movement · logo · team (+ record,
// streak, manager) · a bar scaled to the top power score · the score. Tapping a row opens the blurb, the injury
// report and every component behind the score as a stat grid (native <details>, no client JS).
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { InjuryTag, StatGrid, TeamLogo } from "@/components/ui/core";
import type { PowerRow } from "@/lib/playoffs/view";
import { cn, fmtPts, ordinal, record } from "@/lib/utils";
import { ClinchBadge, fmtProb, LastFive, Movement } from "./bits";

export function PowerList({ rows, myTeamId }: { rows: PowerRow[]; myTeamId: string | null }) {
  const maxScore = Math.max(1, ...rows.map((r) => r.row.powerScore));
  return (
    <ol className="card divide-y divide-line/70 overflow-hidden" aria-label="Power rankings">
      {rows.map((p) => {
        const r = p.row;
        const mine = r.team.id === myTeamId;
        const delta = p.prevRank === null ? null : p.prevRank - r.powerRank;
        const pct = Math.max(2, Math.min(100, (r.powerScore / maxScore) * 100));
        const streakTone = r.streak.startsWith("W") ? ("good" as const) : r.streak.startsWith("L") ? ("bad" as const) : undefined;
        return (
          <li key={r.team.id}>
            <details className="group">
              <summary
                className={cn(
                  "flex min-h-[60px] cursor-pointer list-none items-center gap-3 py-2 pl-3 pr-3 transition-colors hover:bg-sunken/70 sm:pl-4 [&::-webkit-details-marker]:hidden",
                  mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]",
                )}
              >
                <span className="flex w-7 shrink-0 flex-col items-center">
                  <span className="numeral text-[17px] font-semibold leading-5 text-ink">{r.powerRank}</span>
                  <Movement delta={delta} className="mt-0.5 text-[12px]" />
                </span>
                <TeamLogo team={r.team} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span title={r.team.name} className={cn("truncate text-[15px] font-semibold leading-5 sm:text-sm", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                      {r.team.name}
                    </span>
                    <ClinchBadge marker={p.marker} />
                  </span>
                  <span className="block truncate text-[13px] leading-[18px] text-muted">
                    {record(r.wins, r.losses, r.ties)}
                    {r.streak ? ` · ${r.streak}` : ""}
                    {p.owner ? ` · ${p.owner}` : ""}
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink/[0.05] dark:bg-white/[0.06]" aria-hidden>
                    <span className={cn("block h-full rounded-full", mine ? "bg-brand-600 dark:bg-brand-400" : "bg-ink/30 dark:bg-white/35")} style={{ width: `${pct}%` }} />
                  </span>
                </span>
                {/* wide screens: the components behind the score stay in the row (phones: tap to open) */}
                <span className="hidden shrink-0 grid-cols-5 gap-4 text-right lg:grid">
                  {[
                    ["PF", fmtPts(r.pointsFor, 1), ordinal(p.pfRank)],
                    ["All-play", `${(p.allPlayPct * 100).toFixed(0)}%`, null],
                    ["ROS/wk", p.rosPerWeek !== null ? fmtPts(p.rosPerWeek, 1) : "—", p.rosRank ? ordinal(p.rosRank) : null],
                    ["Playoffs", p.playoffPct !== null ? fmtProb(p.playoffPct, p.playoffLock) : "—", null],
                  ].map(([label, value, sub]) => (
                    <span key={label} className="w-[4.5rem]">
                      <span className="block whitespace-nowrap text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">{label}</span>
                      <span className="numeral block text-[14px] font-semibold leading-5 text-ink">{value}</span>
                      {sub && <span className="block text-[12px] leading-4 text-muted">{sub}</span>}
                    </span>
                  ))}
                  <span className="w-24">
                    <span className="block text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">Last 5</span>
                    <LastFive results={r.last5} className="mt-0.5" />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="numeral block text-[17px] font-semibold leading-5 text-ink">{r.powerScore.toFixed(1)}</span>
                  <span className="block text-[12px] leading-4 text-muted">score</span>
                </span>
                <ChevronDown size={16} className="-ml-1 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
              </summary>
              <div className="border-t border-line/70 bg-sunken px-4 py-3 motion-safe:animate-fade-in">
                <p className="max-w-[70ch] text-[14px] leading-5 text-ink">{p.blurb}</p>
                {p.injured.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" aria-label="Key players on the injury report">
                    {p.injured.map((i) => (
                      <li key={i.id} className="inline-flex items-center gap-1.5">
                        <InjuryTag status={i.status} />
                        <span className="text-ink">{i.name}</span> {i.position}
                      </li>
                    ))}
                  </ul>
                )}
                <StatGrid
                  className="mt-3"
                  items={[
                    { label: "Record", value: record(r.wins, r.losses, r.ties), sub: r.streak ? <span className={streakTone === "good" ? "text-win" : streakTone === "bad" ? "text-loss" : undefined}>{r.streak}</span> : undefined },
                    { label: "PF", value: fmtPts(r.pointsFor, 1), sub: ordinal(p.pfRank) },
                    { label: "All-play", value: `${(p.allPlayPct * 100).toFixed(0)}%` },
                    { label: "ROS/wk", value: p.rosPerWeek !== null ? fmtPts(p.rosPerWeek, 1) : "—", sub: p.rosRank ? ordinal(p.rosRank) : undefined },
                    {
                      label: "Playoffs",
                      value: p.playoffPct !== null ? fmtProb(p.playoffPct, p.playoffLock) : "—",
                      tone: p.playoffLock === "clinched" ? "good" : undefined,
                    },
                    { label: "Score", value: r.powerScore.toFixed(1), sub: "of 100" },
                  ]}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">
                    Last 5 <LastFive results={r.last5} />
                  </span>
                  <Link href={mine ? "/team" : `/teams/${r.team.id}`} className="inline-flex min-h-10 items-center text-[14px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    Team page ›
                  </Link>
                </div>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
