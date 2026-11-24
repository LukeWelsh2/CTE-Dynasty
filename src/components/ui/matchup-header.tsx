"use client";
// The Matchup header (docs/DESIGN.md §6.1, the canonical "Matchup" pattern): round logos with a rank badge and the
// record under them; the two scores as big condensed numerals either side of a VS badge with the projections in grey
// under each; then compact centred label rows (YET TO PLAY / PLAYING, WIN) and a two-part win bar (leader green).
// `size="md"` is the compact version (League Home); it adds the team names under the logos.
import Link from "next/link";
import { LiveNumber } from "./client";
import { TeamLogo, type TeamLike } from "./core";
import { fmtPoints, VsBadge } from "./fantasy";
import { cn } from "@/lib/utils";

export interface MatchupHeaderSide {
  team: TeamLike & { id: string };
  href: string;
  record?: string | null;
  /** rank / seed shown as a small badge on the logo */
  badge?: number | null;
  badgeTitle?: string;
  score: number;
  projected: number;
  yetToPlay?: number | null;
  playing?: number | null;
  mine?: boolean;
}

/** whole percent, 1–99 while a game can still flip; 0 / 100 once decided */
function pct(p: number, final: boolean) {
  const v = Math.round(p * 100);
  return final ? v : Math.min(99, Math.max(1, v));
}

export function MatchupHeader({
  left,
  right,
  leftWinProb,
  status,
  decided,
  winLabel = "Win",
  size = "lg",
  showNames,
  className,
}: {
  left: MatchupHeaderSide;
  right: MatchupHeaderSide | null;
  leftWinProb: number;
  /** UPCOMING | LIVE | FINAL */
  status: string;
  /** the result is decided (final): win % shows 100 / 0 */
  decided?: boolean;
  winLabel?: string;
  size?: "lg" | "md";
  /** team names under the logos (Home; the Matchup page shows them in its segmented control) */
  showNames?: boolean;
  className?: string;
}) {
  const lg = size === "lg";
  const logo = lg ? 52 : 44;
  const upcoming = status === "UPCOMING";
  const final = status === "FINAL";
  const scoreCls = cn("font-score font-bold leading-none tracking-[0.005em]", lg ? "text-[40px]" : "text-[34px]");
  if (!right) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <TeamLogo team={left.team} size={logo} round />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">{left.team.name}</div>
          <div className="text-[13px] text-muted">{left.record}</div>
        </div>
      </div>
    );
  }
  const l = pct(leftWinProb, !!decided);
  const r = 100 - l;
  const even = l === r;
  const leftLeads = l > r;
  const tone = (lead: boolean) => (even ? "text-muted" : lead ? "text-win" : "text-loss");
  const dimL = final && left.score < right.score;
  const dimR = final && right.score < left.score;
  const ytp = !final && left.yetToPlay != null && right.yetToPlay != null;
  const playing = status === "LIVE" && left.playing != null && right.playing != null;
  const labelRow = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3";
  const num = "numeral text-right text-[15px] font-semibold text-ink";
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-start gap-2 sm:gap-4">
        <Side side={left} logo={logo} showNames={showNames} align="left" />
        <div className={cn("flex min-w-0 flex-col items-end", lg ? "pt-1.5" : "pt-1")}>
          <LiveNumber value={left.score} decimals={2} format={(n) => fmtPoints(n)} className={cn(scoreCls, upcoming ? "text-faint" : dimL ? "text-muted" : "text-ink")} />
          <span className="numeral mt-1 text-[14px] text-muted" title="Projected">
            {left.projected.toFixed(1)}
          </span>
        </div>
        <div className={cn("flex justify-center", lg ? "pt-2" : "pt-1.5")}>
          <VsBadge size={lg ? 34 : 30} />
        </div>
        <div className={cn("flex min-w-0 flex-col items-start", lg ? "pt-1.5" : "pt-1")}>
          <LiveNumber value={right.score} decimals={2} format={(n) => fmtPoints(n)} className={cn(scoreCls, upcoming ? "text-faint" : dimR ? "text-muted" : "text-ink")} />
          <span className="numeral mt-1 text-[14px] text-muted" title="Projected">
            {right.projected.toFixed(1)}
          </span>
        </div>
        <Side side={right} logo={logo} showNames={showNames} align="right" />
      </div>

      <div className="mx-auto max-w-[300px] space-y-1">
        {ytp && (
          <div className={labelRow}>
            <span className={num}>{left.yetToPlay}</span>
            <span className="eyebrow text-center">Yet to play</span>
            <span className={cn(num, "text-left")}>{right.yetToPlay}</span>
          </div>
        )}
        {playing && (
          <div className={labelRow}>
            <span className={num}>{left.playing}</span>
            <span className="eyebrow text-center text-live">Playing</span>
            <span className={cn(num, "text-left")}>{right.playing}</span>
          </div>
        )}
        <div className={labelRow}>
          <span className={cn("numeral text-right text-[17px] font-bold", tone(leftLeads))}>{l}%</span>
          <span className="eyebrow text-center">{winLabel}</span>
          <span className={cn("numeral text-left text-[17px] font-bold", tone(!leftLeads && !even))}>{r}%</span>
        </div>
      </div>
      {/* two-part bar: the leader green, the other grey (to scale, never thinner than a sliver) */}
      <div className="flex h-1.5 gap-1" role="img" aria-label={`${winLabel}: ${left.team.name} ${l}%, ${right.team.name} ${r}%`}>
        <span className={cn("rounded-full", !even && leftLeads ? "bg-win" : "bg-ink/15 dark:bg-white/20")} style={{ flexBasis: `${Math.max(6, l)}%` }} />
        <span className={cn("rounded-full", !even && !leftLeads ? "bg-win" : "bg-ink/15 dark:bg-white/20")} style={{ flexBasis: `${Math.max(6, r)}%` }} />
      </div>
    </div>
  );
}

function Side({ side, logo, showNames, align }: { side: MatchupHeaderSide; logo: number; showNames?: boolean; align: "left" | "right" }) {
  const right = align === "right";
  return (
    <Link href={side.href} title={side.team.name} aria-label={side.team.name} className={cn("group flex flex-col items-center", showNames ? "w-[76px]" : "w-[60px]")}>
      <span className="relative">
        <TeamLogo team={side.team} size={logo} round className={cn(side.mine && "ring-2 ring-brand-600 ring-offset-2 ring-offset-panel dark:ring-brand-400")} />
        {side.badge ? (
          <span
            title={side.badgeTitle}
            className={cn(
              "numeral absolute -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-panel px-1 text-[11px] font-semibold text-ink shadow-[0_0_0_1px_rgb(var(--c-line))]",
              right ? "-right-2" : "-left-2",
            )}
          >
            {side.badge}
          </span>
        ) : null}
      </span>
      {showNames && (
        <span className={cn("mt-1.5 line-clamp-2 min-h-[30px] w-full break-words text-center text-[12px] font-semibold leading-[15px] group-hover:underline", side.mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>{side.team.name}</span>
      )}
      {side.record && <span className="numeral mt-1 text-[13px] leading-4 text-muted">{side.record}</span>}
    </Link>
  );
}
