"use client";
// Players search filters (the Controls layer, docs/DESIGN.md §4.1). All state lives in the URL (shareable); changes
// navigate with a transition. Phones: position chips that scroll sideways, the search box, then the two filters that
// answer "who can I add?" (availability, stats timeframe); NFL team, health and rookies sit behind "More filters"
// (with a count when any is set). sm+: everything inline.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { AVAILABILITY, AVAILABILITY_LABELS, DEFAULT_FILTERS, filtersToQuery, type PlayerFilters } from "@/lib/players/filters";
import type { PositionFilter, Timeframe } from "@/lib/players/logic";
import { chipClass } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";

const TF_LABELS: Record<Timeframe, string> = {
  season: "Season totals",
  avg: "Season average",
  last: "Last week",
  week: "Specific week",
  proj: "This week (projected)",
  ros: "Rest of season (projected)",
};

export function PlayerFilterBar({
  filters,
  positions,
  teams,
  nflTeams,
  maxWeek,
  week,
  hasTeam,
}: {
  filters: PlayerFilters;
  positions: PositionFilter[];
  teams: { id: string; name: string; abbrev: string }[];
  nflTeams: { abbr: string; name: string }[];
  maxWeek: number;
  week: number;
  hasTeam: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(filters.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setQ(filters.q), [filters.q]);
  const extraSet = (filters.nfl ? 1 : 0) + (filters.health !== "all" ? 1 : 0) + (filters.rookies ? 1 : 0);
  const [more, setMore] = useState(extraSet > 0);

  const go = (patch: Partial<PlayerFilters>) => {
    const next: PlayerFilters = { ...filters, page: 1, ...patch };
    start(() => router.push(`${pathname}${filtersToQuery(next)}`, { scroll: false }));
  };

  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() }), 350);
  };

  const statusValue = filters.status === "team" && filters.owner ? `team:${filters.owner}` : filters.status;
  const dirty = filtersToQuery({ ...filters, page: 1, sort: DEFAULT_FILTERS.sort, dir: DEFAULT_FILTERS.dir }) !== "";

  return (
    <div className="mb-3 space-y-2.5">
      <ScrollRow role="tablist" aria-label="Position" className="-mx-3 scroll-px-3 gap-2 px-3 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {positions.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={filters.pos === p}
            data-active={filters.pos === p || undefined}
            onClick={() => go({ pos: p, sort: p !== filters.pos && filters.sort.startsWith("stat:") ? "pts" : filters.sort })}
            className={chipClass(filters.pos === p, "md", "min-w-[48px]")}
          >
            {p === "DEF" ? "DST" : p}
          </button>
        ))}
      </ScrollRow>

      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search players</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search players" enterKeyHint="search" className="input h-10 rounded-full py-1 pl-9" />
        </label>
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls="player-more-filters"
          className={cn(chipClass(more || extraSet > 0, "md"), "sm:hidden")}
        >
          <SlidersHorizontal size={15} aria-hidden /> Filters{extraSet > 0 ? ` (${extraSet})` : ""}
        </button>
        {pending && <Loader2 size={16} className="shrink-0 animate-spin text-muted" aria-label="Loading" />}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select label="Availability" value={statusValue} onChange={(v) => (v.startsWith("team:") ? go({ status: "team", owner: v.slice(5) }) : go({ status: v as PlayerFilters["status"], owner: null }))}>
          {AVAILABILITY.filter((a) => hasTeam || a !== "mine").map((a) => (
            <option key={a} value={a}>
              {/* "Available (FA + waivers)" is cut off in the half-width phone select; free agents and waivers are their own options */}
              {a === "available" ? "Available" : AVAILABILITY_LABELS[a]}
            </option>
          ))}
          <optgroup label="Fantasy team">
            {teams.map((t) => (
              <option key={t.id} value={`team:${t.id}`}>
                {t.name} ({t.abbrev})
              </option>
            ))}
          </optgroup>
        </Select>
        <Select label="Stats" value={filters.tf} onChange={(v) => go({ tf: v as Timeframe, wk: v === "week" ? (filters.wk ?? Math.max(1, week - 1)) : null })}>
          {(Object.keys(TF_LABELS) as Timeframe[]).map((t) => (
            <option key={t} value={t}>
              {t === "proj" ? `Week ${week} projection` : TF_LABELS[t]}
            </option>
          ))}
        </Select>
        {filters.tf === "week" && (
          <Select label="Week" value={String(filters.wk ?? week)} onChange={(v) => go({ wk: Number(v) })}>
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </Select>
        )}
        <div id="player-more-filters" className={cn("col-span-2 grid-cols-2 gap-2 sm:contents", more ? "grid" : "hidden")}>
          <Select label="NFL team" value={filters.nfl ?? ""} onChange={(v) => go({ nfl: v || null })}>
            <option value="">All NFL teams</option>
            {nflTeams.map((t) => (
              <option key={t.abbr} value={t.abbr}>
                {t.abbr} — {t.name}
              </option>
            ))}
            <option value="FA">No NFL team</option>
          </Select>
          <Select label="Health" value={filters.health} onChange={(v) => go({ health: v as PlayerFilters["health"] })}>
            <option value="all">Any health</option>
            <option value="healthy">Healthy</option>
            <option value="injured">Injured</option>
          </Select>
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-control bg-panel px-3 text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] sm:h-9">
            <input type="checkbox" checked={filters.rookies} onChange={(e) => go({ rookies: e.target.checked })} className="h-4 w-4" />
            Rookies only
          </label>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={() => start(() => router.push(pathname, { scroll: false }))}
            className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-control px-3 text-[13px] font-semibold text-brand-600 hover:bg-brand-600/[0.08] dark:text-brand-400 sm:col-span-1 sm:ml-auto sm:h-9"
          >
            <RotateCcw size={14} aria-hidden /> Reset filters
          </button>
        )}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="input h-10 w-full py-1 pr-8 text-[13px] font-semibold sm:h-9 sm:w-auto">
        {children}
      </select>
    </label>
  );
}
