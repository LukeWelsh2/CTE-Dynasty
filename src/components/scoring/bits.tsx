// Small presentational pieces for live scoring + schedule (no hooks: usable from server and client components).
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/ui/core";
import { gameStatusLabel, wpPercent } from "@/lib/live/format";
import { ScrollRow } from "./scroll-row";
import type { GameLite } from "@/lib/live/types";

/** Two-color win-probability bar. `leftProb` is the left team's chance (0-1). */
export function WinProbBar({
  leftProb,
  leftColor,
  rightColor,
  leftLabel,
  rightLabel,
  final = false,
  size = "md",
  className,
}: {
  leftProb: number;
  leftColor: string;
  rightColor: string;
  leftLabel?: string;
  rightLabel?: string;
  final?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const l = wpPercent(leftProb, final);
  const r = final ? 100 - l : wpPercent(1 - leftProb, false);
  const h = size === "lg" ? "h-3" : size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className={className}>
      {(leftLabel || rightLabel) && (
        <div className="mb-1 flex items-center justify-between text-[11px] font-semibold tabular-nums text-muted">
          <span>
            <span className="text-ink">{l}%</span> {leftLabel}
          </span>
          <span className="text-[10px] uppercase tracking-wider">Win prob</span>
          <span>
            {rightLabel} <span className="text-ink">{r}%</span>
          </span>
        </div>
      )}
      <div
        className={cn("flex w-full overflow-hidden rounded-full bg-sunken", h)}
        role="img"
        aria-label={`Win probability: ${leftLabel ?? "left"} ${l}%, ${rightLabel ?? "right"} ${r}%`}
      >
        <div className="h-full transition-[width] duration-700" style={{ width: `${l}%`, background: leftColor }} />
        <div className="h-full w-0.5 shrink-0 bg-panel" />
        <div className="h-full flex-1 transition-[width] duration-700" style={{ background: rightColor }} />
      </div>
    </div>
  );
}

export function MatchupStatus({ status, label, className }: { status: string; label?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider", className)}>
      {status === "LIVE" ? (
        <span className="inline-flex items-center gap-1 rounded bg-live px-1.5 py-px text-white">
          <LiveDot className="bg-white" /> Live
        </span>
      ) : status === "FINAL" ? (
        <span className="rounded bg-ink/80 px-1.5 py-px text-panel">Final</span>
      ) : (
        <span className="rounded border border-line bg-sunken px-1.5 py-px text-muted">Upcoming</span>
      )}
      {label && <span className="truncate text-gold-600 dark:text-gold-400">{label}</span>}
    </span>
  );
}

/** Game status text with live styling (Q3 4:21 in red, Final muted, kickoff time) */
export function GameStatusText({ game, tz, className }: { game: GameLite | null | undefined; tz: string; className?: string }) {
  if (!game) return <span className={cn("text-muted", className)}>Bye</span>;
  const label = gameStatusLabel(game, tz);
  return <span className={cn("tabular-nums", game.state === "in" ? "font-semibold text-live" : "text-muted", className)}>{label}</span>;
}

export function PointsDelta({ points, className }: { points: number; className?: string }) {
  const pos = points >= 0;
  return (
    <span className={cn("font-bold tabular-nums", pos ? "text-win" : "text-loss", className)}>
      {pos ? "+" : "−"}
      {Math.abs(points).toFixed(2)}
    </span>
  );
}

export function WeekPills({ weeks, active, current, hrefFor, label = "Week", markers }: { weeks: number[]; active: number; current: number; hrefFor: (w: number) => string; label?: string; markers?: Record<number, string> }) {
  return (
    <ScrollRow label={`${label} selector`} className="scroll-thin relative -mx-1 mb-3 flex items-center gap-1 overflow-x-auto px-1 pb-1 pt-1">
      {weeks.map((w) => (
        <Link
          key={w}
          href={hrefFor(w)}
          aria-current={w === active ? "page" : undefined}
          title={markers?.[w]}
          className={cn(
            "relative flex h-8 min-w-[2.5rem] shrink-0 items-center justify-center rounded-md border px-2 text-xs font-bold tabular-nums transition-colors",
            w === active ? "border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-600" : "border-line bg-panel text-ink hover:bg-sunken",
            markers?.[w] && w !== active && "border-gold-400/70",
          )}
        >
          {w === current && w !== active && <span className="absolute -top-1 right-0.5 h-1.5 w-1.5 rounded-full bg-live" aria-hidden />}
          {w}
        </Link>
      ))}
    </ScrollRow>
  );
}

export function TeamRecord({ record, rank, className }: { record: string; rank?: number | null; className?: string }) {
  return (
    <span className={cn("text-[11px] tabular-nums text-muted", className)}>
      {record}
      {rank ? ` · ${ordinalShort(rank)}` : ""}
    </span>
  );
}

function ordinalShort(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}
