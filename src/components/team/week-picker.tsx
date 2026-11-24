"use client";
// "Week 11 ▾" period selector with previous / next arrows (navigates via the ?week= search param).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function WeekPicker({ basePath, week, currentWeek, maxWeek, extraQuery = {}, className }: { basePath: string; week: number; currentWeek: number; maxWeek: number; extraQuery?: Record<string, string>; className?: string }) {
  const router = useRouter();
  const href = (w: number) => {
    const q = new URLSearchParams(extraQuery);
    if (w !== currentWeek) q.set("week", String(w));
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
  // round secondary icon buttons + a pill select (DESIGN.md: rounded-full controls, solid panel with a hairline)
  const arrow =
    "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink shadow-[0_0_0_1px_rgb(var(--c-line)),0_1px_2px_rgb(16_24_40/0.06)] transition-[background-color,transform] duration-150 hover:bg-sunken active:scale-[0.94] dark:bg-white/[0.06] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] dark:hover:bg-white/[0.1] sm:h-9 sm:w-9";
  return (
    <div className={cn("inline-flex max-w-full items-center gap-1", className)}>
      {week > 1 ? (
        <Link href={href(week - 1)} className={arrow} aria-label="Previous week">
          <ChevronLeft size={16} />
        </Link>
      ) : (
        <span className={cn(arrow, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronLeft size={16} />
        </span>
      )}
      <select
        aria-label="Select week"
        className="input h-10 w-auto min-w-0 rounded-full py-0 pl-4 font-display text-[15px] font-bold uppercase tracking-[0.04em] sm:h-9 sm:text-[15px]"
        value={week}
        onChange={(e) => router.push(href(Number(e.target.value)))}
      >
        {weeks.map((w) => (
          <option key={w} value={w}>
            Week {w}
            {w === currentWeek ? " (current)" : ""}
          </option>
        ))}
      </select>
      {week < maxWeek ? (
        <Link href={href(week + 1)} className={arrow} aria-label="Next week">
          <ChevronRight size={16} />
        </Link>
      ) : (
        <span className={cn(arrow, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronRight size={16} />
        </span>
      )}
      {week !== currentWeek && (
        <Link href={href(currentWeek)} className="ml-1 inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[13px] font-semibold text-brand-600 transition-colors hover:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-400/10 sm:h-9">
          Back to Week {currentWeek}
        </Link>
      )}
    </div>
  );
}

export interface WeekNav {
  basePath: string;
  week: number;
  currentWeek: number;
  maxWeek: number;
  extraQuery?: Record<string, string>;
}

/** "Week 12 ▾" as a big bold title (Roster pattern): a native select styled as the heading, plus "Back to Week N". */
export function WeekTitle({ basePath, week, currentWeek, maxWeek, extraQuery = {} }: WeekNav) {
  const router = useRouter();
  const href = (w: number) => {
    const q = new URLSearchParams(extraQuery);
    if (w !== currentWeek) q.set("week", String(w));
    const s = q.toString();
    return `${basePath}${s ? `?${s}` : ""}`;
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <label className="relative inline-flex items-center gap-1">
        <h2 className="whitespace-nowrap text-[26px] font-bold leading-8 tracking-[-0.02em] text-ink">Week {week}</h2>
        <ChevronDownIcon />
        <select aria-label="Select week" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={week} onChange={(e) => router.push(href(Number(e.target.value)))}>
          {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
              {w === currentWeek ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>
      {week !== currentWeek && (
        <Link href={href(currentWeek)} className="inline-flex h-10 shrink-0 items-center whitespace-nowrap text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Wk {currentWeek} ›
        </Link>
      )}
    </span>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
