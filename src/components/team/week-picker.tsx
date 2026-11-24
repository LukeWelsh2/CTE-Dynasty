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
  const arrow = "inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-ink hover:bg-sunken";
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
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
        className="h-8 rounded-md border border-line bg-panel px-2 font-display text-sm font-bold uppercase tracking-wide text-ink focus:border-brand-500 focus:outline-none"
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
        <Link href={href(currentWeek)} className="ml-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Back to Week {currentWeek}
        </Link>
      )}
    </div>
  );
}
