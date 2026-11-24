"use client";
// Players search filter bar. All state lives in the URL (shareable); changes navigate with a transition.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { AVAILABILITY, AVAILABILITY_LABELS, DEFAULT_FILTERS, filtersToQuery, type PlayerFilters } from "@/lib/players/filters";
import type { PositionFilter, Timeframe } from "@/lib/players/logic";
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
    <div className="mb-3 space-y-2 rounded-lg border border-line bg-panel p-2.5 shadow-panel">
      <div className="flex flex-wrap items-center gap-2">
        <ScrollRow role="tablist" aria-label="Position" className="-mx-0.5 max-w-full gap-1 px-0.5">
          {positions.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={filters.pos === p}
              onClick={() => go({ pos: p, sort: p !== filters.pos && filters.sort.startsWith("stat:") ? "pts" : filters.sort })}
              className={cn(
                "h-10 min-w-[44px] shrink-0 rounded-md border px-2.5 text-xs font-bold transition-colors sm:h-8",
                filters.pos === p ? "border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-600" : "border-line bg-panel text-ink hover:bg-sunken",
              )}
            >
              {p === "DEF" ? "DST" : p}
            </button>
          ))}
        </ScrollRow>
        <label className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search players</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name…" enterKeyHint="search" className="input h-10 py-1 pl-8 sm:h-8" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select label="Availability" value={statusValue} onChange={(v) => (v.startsWith("team:") ? go({ status: "team", owner: v.slice(5) }) : go({ status: v as PlayerFilters["status"], owner: null }))}>
          {AVAILABILITY.filter((a) => hasTeam || a !== "mine").map((a) => (
            <option key={a} value={a}>
              {AVAILABILITY_LABELS[a]}
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
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 text-xs font-semibold sm:h-8">
          <input type="checkbox" checked={filters.rookies} onChange={(e) => go({ rookies: e.target.checked })} />
          Rookies only
        </label>
        <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:ml-auto">
          {pending && <Loader2 size={14} className="animate-spin text-muted" aria-label="Loading" />}
          {dirty && (
            <button type="button" onClick={() => start(() => router.push(pathname, { scroll: false }))} className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted hover:bg-sunken hover:text-ink sm:h-8">
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="input h-10 w-full py-1 pr-7 text-xs font-semibold sm:h-8 sm:w-auto">
        {children}
      </select>
    </label>
  );
}
