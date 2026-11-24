"use client";
// Phone playoff odds (docs/DESIGN.md §5.2): one row per team — logo · team (+ record, manager) · two numbers chosen by
// a column switcher (Playoffs | Seeding | Projection); tapping a row opens every column of the desktop table as a
// stat grid. md+ shows the full OddsTable instead.
import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Stat, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export interface PhoneOddsRow {
  team: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
  owner: string | null;
  mine: boolean;
  marker: { code: string; title: string } | null;
  record: string;
  projRecord: string | null;
  projPF: string;
  playoff: string;
  /** change in playoff odds since the previous snapshot, in points */
  playoffDelta: number | null;
  playoffClinched: boolean;
  out: boolean;
  bye: string;
  division: string | null;
  finals: string;
  title: string;
  titleDelta: number | null;
  avgSeed: string;
  swing: string | null;
}

type Mode = "odds" | "seed" | "proj";

function Delta({ d }: { d: number | null }) {
  if (!d) return null;
  return <span className={cn("text-[12px] font-semibold", d > 0 ? "text-win" : "text-loss")}>{`${d > 0 ? "▲" : "▼"}${Math.abs(d)}`}</span>;
}

export function OddsList({ rows, swingLabel, hasRemaining }: { rows: PhoneOddsRow[]; swingLabel: string | null; hasRemaining: boolean }) {
  const [mode, setMode] = useState<Mode>("odds");
  const [open, setOpen] = useState<string | null>(null);
  const modes: [Mode, string][] = [
    ["odds", "Odds"],
    ["seed", "Seeding"],
    ...(hasRemaining ? ([["proj", "Projection"]] as [Mode, string][]) : []),
  ];
  const heads: Record<Mode, [string, string]> = { odds: ["Playoffs", "Title"], seed: ["Bye", "Avg seed"], proj: ["Proj rec", "Proj PF"] };
  return (
    <div>
      <div role="radiogroup" aria-label="Columns" className="flex gap-2 px-3 pb-2">
        {modes.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            onClick={() => setMode(v)}
            className={cn("inline-flex h-10 items-center rounded-full px-4 text-[14px] font-semibold transition-colors", mode === v ? "bg-brand-600 text-white" : "bg-sunken text-ink hover:bg-ink/[0.07] dark:hover:bg-white/[0.08]")}
          >
            {label}
          </button>
        ))}
      </div>
      <ol aria-label="Playoff odds">
        <li aria-hidden className="flex items-center gap-2.5 border-y border-line/70 py-1.5 pl-4 pr-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">
          <span className="flex-1">Team</span>
          <span className="w-[4.25rem] whitespace-nowrap text-right">{heads[mode][0]}</span>
          <span className="w-[4.25rem] whitespace-nowrap text-right">{heads[mode][1]}</span>
          <span className="w-3.5" />
        </li>
        {rows.map((r, i) => {
          const expanded = open === r.team.id;
          const a =
            mode === "odds" ? (
              <span className={cn(r.playoffClinched ? "text-win" : r.out ? "text-muted" : "text-ink")}>{r.playoff}</span>
            ) : mode === "seed" ? (
              r.bye
            ) : (
              (r.projRecord ?? "—")
            );
          const b = mode === "odds" ? r.title : mode === "seed" ? r.avgSeed : r.projPF;
          return (
            <li key={r.team.id} className={cn(i > 0 && "border-t border-line/70")}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : r.team.id)}
                className={cn(
                  "flex min-h-[56px] w-full items-center gap-2.5 py-2 pl-4 pr-2 text-left transition-colors hover:bg-sunken/70",
                  r.mine && "bg-brand-600/[0.05] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.08]",
                )}
              >
                <TeamLogo team={r.team} size={26} />
                <span className="min-w-0 flex-1">
                  <span title={r.team.name} className={cn("block truncate text-[15px] font-semibold leading-5", r.mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                    {r.team.name}
                  </span>
                  <span className="block truncate text-[13px] leading-[18px] text-muted">
                    {r.record}
                    {r.marker ? (
                      <span className="font-semibold" title={r.marker.title}>
                        {" "}
                        · {r.marker.code}
                      </span>
                    ) : null}
                    {r.owner ? ` · ${r.owner}` : ""}
                  </span>
                </span>
                <span className="numeral w-[4.25rem] shrink-0 text-right text-[15px] font-semibold text-ink">{a}</span>
                <span className="numeral w-[4.25rem] shrink-0 text-right text-[15px] font-semibold text-ink">{b}</span>
                <ChevronDown size={14} className={cn("w-3.5 shrink-0 text-faint transition-transform duration-200", expanded && "rotate-180")} aria-hidden />
              </button>
              {expanded && (
                <div className="border-t border-line/70 bg-sunken px-4 py-3 motion-safe:animate-fade-in">
                  <div className="grid grid-cols-3 gap-x-3 gap-y-3">
                    <Stat size="sm" label="Record" value={r.record} />
                    {r.projRecord && <Stat size="sm" label="Proj rec" value={r.projRecord} />}
                    <Stat size="sm" label="Proj PF" value={r.projPF} />
                    <Stat size="sm" label="Playoffs" value={r.playoff} tone={r.playoffClinched ? "good" : undefined} sub={<Delta d={r.playoffDelta} />} />
                    <Stat size="sm" label="Bye" value={r.bye} />
                    {r.division !== null && <Stat size="sm" label="Division" value={r.division} />}
                    <Stat size="sm" label="Finals" value={r.finals} />
                    <Stat size="sm" label="Title" value={r.title} sub={<Delta d={r.titleDelta} />} />
                    <Stat size="sm" label="Avg seed" value={r.avgSeed} />
                    {swingLabel && r.swing !== null && <Stat size="sm" label={swingLabel} value={r.swing} />}
                  </div>
                  <Link href={r.mine ? "/team" : `/teams/${r.team.id}`} className="mt-2 inline-flex min-h-10 items-center text-[14px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    Team page ›
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
