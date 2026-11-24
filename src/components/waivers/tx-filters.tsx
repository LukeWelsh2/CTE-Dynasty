"use client";
// Transaction log filters: selects submit the GET form on change, the player search submits on Enter / button.
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { buttonClass } from "@/components/ui/core";

export interface TxFilterOptions {
  types: { value: string; label: string }[];
  teams: { value: string; label: string }[];
  seasons: { value: string; label: string }[];
  weeks: { value: string; label: string }[];
}

export function TxFilters({ options, values }: { options: TxFilterOptions; values: { type: string; team: string; season: string; week: string; q: string } }) {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const submit = () => form.current?.requestSubmit();
  const select = (name: string, label: string, value: string, opts: { value: string; label: string }[]) => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <select name={name} defaultValue={value} onChange={submit} className="input h-9 py-1.5">
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      ref={form}
      method="get"
      action="/transactions"
      onSubmit={(e) => {
        // keep the URL clean: drop empty / default filters (works without JS as a plain GET form too)
        e.preventDefault();
        const p = new URLSearchParams();
        for (const [k, v] of new FormData(e.currentTarget).entries()) {
          const s = String(v).trim();
          if (s && !(k === "type" && s === "all")) p.set(k, s);
        }
        const qs = p.toString();
        router.push(qs ? `/transactions?${qs}` : "/transactions");
      }}
      className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel p-3 shadow-panel sm:grid-cols-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
      {select("type", "Type", values.type, options.types)}
      {select("team", "Team", values.team, options.teams)}
      {select("season", "Season", values.season, options.seasons)}
      {select("week", "Week", values.week, options.weeks)}
      <label className="col-span-2 min-w-0 sm:col-span-2 lg:col-span-1">
        <span className="label">Player</span>
        <span className="relative flex items-center gap-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-muted" />
          <input type="search" name="q" defaultValue={values.q} placeholder="Search players or notes" className="input h-9 py-1.5 pl-8" aria-label="Search transactions by player" />
          <button type="submit" className={buttonClass("secondary", "sm", "h-9 shrink-0")}>
            Go
          </button>
          {values.q && (
            <a href={clearQ(values)} className={buttonClass("ghost", "sm", "h-9 shrink-0 px-2")} aria-label="Clear player search">
              <X size={14} />
            </a>
          )}
        </span>
      </label>
    </form>
  );
}

function clearQ(v: { type: string; team: string; season: string; week: string }) {
  const q = new URLSearchParams();
  if (v.type && v.type !== "all") q.set("type", v.type);
  if (v.team) q.set("team", v.team);
  if (v.season) q.set("season", v.season);
  if (v.week) q.set("week", v.week);
  const s = q.toString();
  return s ? `/transactions?${s}` : "/transactions";
}
