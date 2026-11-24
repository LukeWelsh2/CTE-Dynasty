// Small presentational pieces for live scoring + schedule (no hooks: usable from server and client components).
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge, GameStatus, LiveDot, WinProbBar } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { contrastPair } from "@/components/home/bits";
import { gameStatusLabel, wpPercent } from "@/lib/live/format";
import type { GameLite } from "@/lib/live/types";

type WpTeam = { name: string; abbrev: string; primaryColor: string; secondaryColor: string };

/**
 * Win probability row (DESIGN.md recipe): the two percentages as numerals with a team-colored dot at either end, a
 * caption in the middle and the kit's two-segment bar underneath. `leftProb` is the left team's chance (0-1).
 */
export function WinProbRow({
  leftProb,
  left,
  right,
  final = false,
  caption,
  size = "md",
  glow = true,
  className,
}: {
  leftProb: number;
  left: WpTeam;
  right: WpTeam;
  /** the result is decided: show 100 / 0 instead of clamping to 1–99 */
  final?: boolean;
  /** middle label ("Win probability"; a multi-week playoff game: "Game win probability") */
  caption?: string;
  size?: "sm" | "md";
  glow?: boolean;
  className?: string;
}) {
  const [lc, rc] = contrastPair(left, right);
  const l = wpPercent(leftProb, final);
  const r = final ? 100 - l : wpPercent(1 - leftProb, false);
  const label = caption ?? (final ? "Result" : "Win probability");
  const pct = size === "md" ? "text-[15px]" : "text-xs";
  return (
    <div className={className}>
      <div className={cn("flex items-center justify-between gap-2", size === "md" ? "mb-1.5" : "mb-1")}>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/30" style={{ background: lc }} aria-hidden />
          <span className={cn("numeral font-semibold text-ink", pct)}>{l}%</span>
          {size === "sm" && <span className="truncate text-[11px] font-semibold text-muted">{left.abbrev}</span>}
        </span>
        <span className="eyebrow truncate">{label}</span>
        <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
          {size === "sm" && <span className="truncate text-[11px] font-semibold text-muted">{right.abbrev}</span>}
          <span className={cn("numeral font-semibold text-ink", pct)}>{r}%</span>
          <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/30" style={{ background: rc }} aria-hidden />
        </span>
      </div>
      <WinProbBar
        left={final ? l / 100 : leftProb}
        leftColor={lc}
        rightColor={rc}
        size={size === "md" ? "md" : "sm"}
        glow={glow}
        label={`${label}: ${left.name} ${l}%, ${right.name} ${r}%`}
      />
    </div>
  );
}

/** LIVE / Final / Upcoming badge plus the playoff round label ("Semifinals"), when there is one. */
export function MatchupStatus({ status, label, className }: { status: string; label?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <GameStatus status={status} />
      {label && (
        <Badge tone="gold" className="min-w-0 truncate">
          {label}
        </Badge>
      )}
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
    <span className={cn("numeral font-semibold", pos ? "text-win" : "text-loss", className)}>
      {pos ? "+" : "−"}
      {Math.abs(points).toFixed(2)}
    </span>
  );
}

/**
 * Week picker: a horizontally scrolling row of round week chips (snaps, fades the edge, scrolls the active week into
 * view). 40px tall on phones. The current week carries a live-red dot; playoff weeks a gold ring.
 */
export function WeekPills({
  weeks,
  active,
  current,
  hrefFor,
  label = "Week",
  markers,
  hash,
}: {
  weeks: number[];
  active: number;
  current: number;
  hrefFor: (w: number) => string;
  label?: string;
  markers?: Record<number, string>;
  /** in-page anchors (plain <a>, no client navigation) */
  hash?: boolean;
}) {
  return (
    <ScrollRow as="nav" aria-label={`${label} selector`} className="-mx-3 mb-3 scroll-px-3 gap-1.5 px-3 py-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
      {weeks.map((w) => {
        const on = w === active;
        const cls = cn(
          "relative inline-flex h-10 min-w-10 shrink-0 select-none items-center justify-center rounded-full px-3 text-[13px] font-semibold tabular-nums transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] sm:h-8 sm:min-w-9 sm:px-2.5",
          on
            ? "bg-ink text-panel shadow-[0_1px_2px_rgb(16_24_40/0.2)]"
            : markers?.[w]
              ? "bg-panel text-ink shadow-[inset_0_0_0_1.5px_rgb(245_179_1/0.7)] hover:bg-sunken dark:bg-white/[0.05]"
              : "bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken dark:bg-white/[0.05] dark:hover:bg-white/[0.09]",
        );
        const inner = (
          <>
            {w === current && !on && <LiveDot className="absolute right-1 top-1 h-1.5 w-1.5" />}
            <span className="sr-only">{label} </span>
            {w}
            {w === current && <span className="sr-only"> (current week)</span>}
          </>
        );
        return hash ? (
          <a key={w} href={hrefFor(w)} aria-current={on ? "page" : undefined} title={markers?.[w]} className={cls}>
            {inner}
          </a>
        ) : (
          <Link key={w} href={hrefFor(w)} aria-current={on ? "page" : undefined} title={markers?.[w]} className={cls}>
            {inner}
          </Link>
        );
      })}
    </ScrollRow>
  );
}

export function TeamRecord({ record, rank, className }: { record: string; rank?: number | null; className?: string }) {
  return (
    <span className={cn("numeral text-xs text-muted", className)}>
      {record}
      {rank ? ` · ${ordinalShort(rank)}` : ""}
    </span>
  );
}

export function ordinalShort(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}
