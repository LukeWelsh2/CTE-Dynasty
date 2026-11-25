"use client";
// Transaction log filters: the type as a scrolling chip row (one tap), then team / season / week selects and the
// player search — behind a "Filters" toggle on phones (open when one of them is set), always visible from md.
// Selects submit the GET form on change; the search submits on Enter / Go. Works as a plain GET form without JS.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { buttonClass, chipClass } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";

export interface TxFilterOptions {
  types: { value: string; label: string }[];
  teams: { value: string; label: string }[];
  seasons: { value: string; label: string }[];
  weeks: { value: string; label: string }[];
}

export function TxFilters({ options, values, defaultSeason }: { options: TxFilterOptions; values: { type: string; team: string; season: string; week: string; q: string }; defaultSeason?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const typeInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const active = [values.team, values.week, values.q, values.season && values.season !== defaultSeason ? values.season : ""].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  const submit = () => form.current?.requestSubmit();
  const select = (name: string, label: string, value: string, opts: { value: string; label: string }[]) => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <select name={name} defaultValue={value} onChange={submit} className="input h-10 sm:h-9">
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
      className="space-y-3"
    >
      <input ref={typeInput} type="hidden" name="type" defaultValue={values.type} />
      <div className="flex items-center gap-2">
        <ScrollRow className="-ml-3 min-w-0 flex-1 gap-2 pl-3 scroll-pl-3 sm:ml-0 sm:pl-0 sm:scroll-pl-0" aria-label="Transaction type" role="radiogroup">
          {options.types.map((t) => {
            const on = t.value === values.type;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={on}
                data-active={on || undefined}
                className={chipClass(on)}
                onClick={() => {
                  if (typeInput.current) typeInput.current.value = t.value;
                  submit();
                }}
              >
                {t.value === "all" ? "All" : t.label}
              </button>
            );
          })}
        </ScrollRow>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="tx-more-filters"
          onClick={() => setOpen((o) => !o)}
          className={cn(chipClass(open || active > 0), "shrink-0 md:hidden")}
        >
          <SlidersHorizontal size={15} aria-hidden />
          Filters{active ? ` · ${active}` : ""}
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      <div id="tx-more-filters" className={cn("card grid-cols-2 gap-x-3 gap-y-2 p-3 md:grid lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]", open ? "grid" : "hidden")}>
        <div className="col-span-2 lg:col-span-1">{select("team", "Team", values.team, options.teams)}</div>
        {select("season", "Season", values.season, options.seasons)}
        {select("week", "Week", values.week, options.weeks)}
        <label className="col-span-2 min-w-0 lg:col-span-1">
          <span className="label">Player</span>
          <span className="relative flex items-center gap-1.5">
            <Search size={15} className="pointer-events-none absolute left-2.5 text-muted" aria-hidden />
            <input type="search" name="q" defaultValue={values.q} placeholder="Search players or notes" className="input h-10 min-w-0 flex-1 pl-8 sm:h-9" aria-label="Search transactions by player" />
            <button type="submit" className={buttonClass("secondary", "md", "shrink-0")}>
              Go
            </button>
            {values.q && (
              <a href={clearQ(values)} className={buttonClass("ghost", "md", "shrink-0 px-2.5")} aria-label="Clear player search">
                <X size={16} />
              </a>
            )}
          </span>
        </label>
      </div>
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
