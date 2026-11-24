"use client";
// Phone standings (docs/DESIGN.md → Reference screens → Standings): ranked rows with at most four visible columns —
// rank · team (+ manager) · two key numbers picked by a column switcher (Overview | Points | Form). Tapping a row
// expands every other column as a stat grid (nothing in the desktop table is lost), plus the tiebreak note.
import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ResultPill, Stat, TeamLogo } from "@/components/ui/core";
import { SegmentedControl } from "@/components/ui/client";
import { cn } from "@/lib/utils";

export interface PhoneStandingsRow {
  team: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
  rank: number;
  owner: string | null;
  mine: boolean;
  marker: { code: string; title: string } | null;
  seed: number | null;
  byeSeed: boolean;
  record: string;
  pct: string;
  gb: string;
  div: string | null;
  pf: string;
  pa: string;
  diff: number;
  streak: string;
  last5: ("W" | "L" | "T")[];
  allPlay: string | null;
  median: string | null;
  hiWk: number;
  avg: string;
  odds: string | null;
  /** change in playoff odds since last week, in points */
  oddsDelta: number | null;
  oddsClinched: boolean;
  oddsOut: boolean;
  tieNote: string | null;
}

type Mode = "overview" | "points" | "form";

export function StandingsList({ rows, playoffAfter, byeAfter, hasOdds }: { rows: PhoneStandingsRow[]; playoffAfter: number | null; byeAfter: number | null; hasOdds: boolean }) {
  const [mode, setMode] = useState<Mode>("overview");
  const [open, setOpen] = useState<string | null>(null);
  const heads: Record<Mode, [string, string]> = {
    overview: ["W-L-T", hasOdds ? "Playoff" : "PF"],
    points: ["PF", "PA"],
    form: ["Strk", "Last 5"],
  };
  const cut = (label: string, dotted?: boolean) => (
    <li aria-hidden className="flex items-center gap-2 px-4 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
      <span className={cn("h-px flex-1 border-t border-ink/25 dark:border-white/25", dotted ? "border-dotted" : "border-dashed")} />
      {label}
      <span className={cn("h-px flex-1 border-t border-ink/25 dark:border-white/25", dotted ? "border-dotted" : "border-dashed")} />
    </li>
  );
  return (
    <div className="card overflow-hidden">
      <div className="p-3">
        <SegmentedControl<Mode>
          full
          ariaLabel="Columns"
          value={mode}
          onChange={setMode}
          options={[
            { value: "overview", label: "Overview" },
            { value: "points", label: "Points" },
            { value: "form", label: "Form" },
          ]}
        />
      </div>
      <ol aria-label="Overall standings">
        <li aria-hidden className="flex items-center gap-3 border-y border-line/70 px-4 py-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">
          <span className="w-5 text-center">#</span>
          <span className="flex-1">Team</span>
          <span className="w-12 text-right">{heads[mode][0]}</span>
          <span className={cn("text-right", mode === "form" ? "w-[4.5rem]" : "w-14")}>{heads[mode][1]}</span>
          <span className="w-4" />
        </li>
        {rows.map((r, i) => {
          const expanded = open === r.team.id;
          const a = mode === "overview" ? r.record : mode === "points" ? r.pf : r.streak || "—";
          const b =
            mode === "overview" ? (
              hasOdds ? (
                <span className={cn(r.oddsClinched ? "text-win" : r.oddsOut ? "text-muted" : "text-ink")}>{r.odds ?? "—"}</span>
              ) : (
                r.pf
              )
            ) : mode === "points" ? (
              r.pa
            ) : (
              <span className="inline-flex gap-[2px]">
                {r.last5.length ? r.last5.map((x, k) => <ResultPill key={k} result={x} className="h-4 min-w-4 rounded-[4px] px-0 text-[10px]" />) : "—"}
              </span>
            );
          return (
            <Fragment key={r.team.id}>
              {byeAfter !== null && i === byeAfter && cut("Bye line", true)}
              {playoffAfter !== null && i === playoffAfter && cut("Playoff line")}
              <li className={cn((i > 0 && i !== playoffAfter && i !== byeAfter) && "border-t border-line/70")}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : r.team.id)}
                  className={cn(
                    "flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-sunken/70",
                    r.mine && "bg-brand-600/[0.05] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.08]",
                  )}
                >
                  <span className={cn("numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted", r.tieNote && "underline decoration-dotted underline-offset-2")}>{r.rank}</span>
                  <TeamLogo team={r.team} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span title={r.team.name} className={cn("truncate text-[15px] font-semibold leading-5", r.mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                        {r.team.name}
                      </span>
                      {r.seed && (
                        <span className="shrink-0 text-[12px] font-semibold text-muted" title={r.byeSeed ? `Seed ${r.seed} (bye)` : `Seed ${r.seed}`}>
                          #{r.seed}
                        </span>
                      )}
                      {r.marker && (
                        <span className="shrink-0 text-[12px] font-bold text-muted" title={r.marker.title}>
                          {r.marker.code}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[13px] leading-[18px] text-muted">{r.owner ?? "No manager"}</span>
                  </span>
                  <span className="numeral w-12 shrink-0 text-right text-[15px] font-semibold text-ink">{a}</span>
                  <span className={cn("numeral shrink-0 text-right text-[15px] font-semibold", mode === "form" ? "w-[4.5rem]" : "w-14")}>{b}</span>
                  <ChevronDown size={16} className={cn("w-4 shrink-0 text-faint transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
                </button>
                {expanded && (
                  <div className="border-t border-line/70 bg-sunken px-4 py-3 motion-safe:animate-fade-in">
                    <div className="grid grid-cols-3 gap-x-3 gap-y-3">
                      <Stat size="sm" label="W-L-T" value={r.record} />
                      <Stat size="sm" label="Pct" value={r.pct} />
                      <Stat size="sm" label="GB" value={r.gb} />
                      <Stat size="sm" label="PF" value={r.pf} />
                      <Stat size="sm" label="PA" value={r.pa} />
                      <Stat size="sm" label="Diff" value={`${r.diff > 0 ? "+" : ""}${r.diff.toFixed(2)}`} tone={r.diff >= 0 ? "good" : "bad"} />
                      <Stat size="sm" label="Streak" value={r.streak || "—"} tone={r.streak.startsWith("W") ? "good" : r.streak.startsWith("L") ? "bad" : undefined} />
                      <Stat
                        size="sm"
                        label="Last 5"
                        value={
                          <span className="inline-flex gap-[2px] align-middle">
                            {r.last5.length ? r.last5.map((x, k) => <ResultPill key={k} result={x} className="h-4 min-w-4 rounded-[4px] px-0 text-[10px]" />) : "—"}
                          </span>
                        }
                      />
                      {r.div !== null && <Stat size="sm" label="Div" value={r.div} />}
                      {r.allPlay !== null && <Stat size="sm" label="All-play" value={r.allPlay} />}
                      {r.median !== null && <Stat size="sm" label="Median" value={r.median} />}
                      <Stat size="sm" label="High wks" value={r.hiWk} />
                      <Stat size="sm" label="Avg" value={r.avg} />
                      {hasOdds && (
                        <Stat
                          size="sm"
                          label="Playoff"
                          value={r.odds ?? "—"}
                          sub={r.oddsDelta ? <span className={r.oddsDelta > 0 ? "text-win" : "text-loss"}>{`${r.oddsDelta > 0 ? "▲" : "▼"}${Math.abs(r.oddsDelta)} wk`}</span> : undefined}
                        />
                      )}
                    </div>
                    {r.tieNote && <p className="mt-3 text-[13px] leading-[18px] text-muted">{r.tieNote}</p>}
                    <Link href={r.mine ? "/team" : `/teams/${r.team.id}`} className="mt-2 inline-flex min-h-10 items-center text-[14px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                      Team page ›
                    </Link>
                  </div>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
