// Server-safe pieces for the rule suggestion board: status/category badges and the league vote bar.
import { Badge } from "@/components/ui/core";
import { STATUS_META, categoryLabel, type ProposalStatus, type Tally } from "@/lib/proposals/logic";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, ended }: { status: string; ended?: boolean }) {
  const meta = STATUS_META[status as ProposalStatus] ?? { label: status, tone: "neutral" as const };
  // gold is for trophies only: an open league vote is the one solid-blue (actionable) status
  const voting = status === "VOTING" && !ended;
  return (
    <Badge tone={meta.tone === "gold" ? "brand" : meta.tone} className={voting ? "!bg-brand-600 !text-white !ring-brand-600" : undefined} title={"hint" in meta ? meta.hint : undefined}>
      {ended ? "Vote closed" : meta.label}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  return <Badge tone="neutral">{categoryLabel(category)}</Badge>;
}

/** Support (green) and oppose (red) as shares of the whole league, with the pass threshold marked. */
export function VoteBar({ tally, thresholdPercent, className, showLegend = true }: { tally: Tally; thresholdPercent: number; className?: string; showLegend?: boolean }) {
  const s = Math.round(tally.leagueSupport * 100);
  const o = Math.round(tally.leagueOppose * 100);
  return (
    <div className={className}>
      <div className="relative h-2 overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]" role="img" aria-label={`${s}% of the league supports, ${o}% opposes; ${thresholdPercent}% support needed`}>
        <div className="absolute inset-y-0 left-0 bg-green-700 dark:bg-green-600" style={{ width: `${s}%` }} />
        <div className="absolute inset-y-0 right-0 bg-[rgb(208_31_43)]" style={{ width: `${o}%` }} />
        <div className="absolute inset-y-[-2px] w-0.5 bg-ink/70" style={{ left: `calc(${Math.min(100, thresholdPercent)}% - 1px)` }} title={`${thresholdPercent}% needed to pass`} />
      </div>
      {showLegend && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[12px] tabular-nums text-muted">
          <span className={cn(tally.support && "font-semibold text-win")}>{s}% support</span>
          <span>
            {tally.cast}/{tally.managers} voted
          </span>
          <span className={cn(tally.oppose && "font-semibold text-loss")}>{o}% oppose</span>
        </div>
      )}
    </div>
  );
}
