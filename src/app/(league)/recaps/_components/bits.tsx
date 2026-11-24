// Small presentational pieces shared by the recap archive and week pages (server-safe).
import Link from "next/link";
import { ArrowDown, ArrowUp, Armchair, CloudRain, Clover, Flame, Lightbulb, Minus, Swords, ThumbsDown, Trophy, Waves } from "lucide-react";
import { TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/recap/compute";
import type { AwardKey, RecapTeam } from "@/lib/recap/types";

export function pts(n: number, decimals: number) {
  return fmtNum(n, decimals);
}

export function pctText(p: number) {
  return `${Math.round(p * 100)}%`;
}

export function fmtWhen(iso: string | Date | null | undefined, tz: string, withTime = true): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}), timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("en-US");
  }
}

export const UNKNOWN_TEAM: RecapTeam = { id: "", name: "Unknown team", abbrev: "?", logoUrl: null, primaryColor: "#1f3fa1", secondaryColor: "#f5b301", owner: null, record: null, rank: null };

export function teamOf(teams: Record<string, RecapTeam>, id: string | null | undefined): RecapTeam {
  return (id && teams[id]) || UNKNOWN_TEAM;
}

/** Only #rgb/#rrggbb colors reach inline styles. */
export function safeColor(c: string | null | undefined, fallback = "#1f3fa1"): string {
  return c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : fallback;
}

// The UI-kit logo keeps a 9px minimum font, so four-letter abbreviations overflow small badges.
const SMALL_LOGO_FONT: [number, string][] = [
  [16, "!text-[6px]"],
  [18, "!text-[6.5px]"],
  [20, "!text-[7.5px]"],
  [22, "!text-[8px]"],
  [25, "!text-[8.5px]"],
  [28, "!text-[8.5px]"],
];

/** TeamLogo that keeps long abbreviations inside the badge at small sizes. */
export function RecapLogo({ team, size = 24, className }: { team: RecapTeam; size?: number; className?: string }) {
  const label = (team.abbrev || team.name.slice(0, 3)).slice(0, 4);
  const fit = !team.logoUrl && label.length > 3 ? SMALL_LOGO_FONT.find(([max]) => size <= max)?.[1] : undefined;
  return <TeamLogo team={team} size={size} className={cn(fit, className)} />;
}

/** Compact award names for dense lists. */
export const AWARD_SHORT: Record<AwardKey, string> = {
  TOP_SCORE: "Top score",
  LOWEST_SCORE: "Low score",
  BIGGEST_BLOWOUT: "Blowout",
  CLOSEST_GAME: "Closest game",
  BEST_DECISION: "Best call",
  BENCH_BLUNDER: "Bench blunder",
  LUCKIEST_WIN: "Luckiest win",
  UNLUCKIEST_LOSS: "Unlucky loss",
  WAIVER_HERO: "Waiver hero",
};

export function TeamName({ team, className, logo = 24, showRecord = false }: { team: RecapTeam; className?: string; logo?: number | false; showRecord?: boolean }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      {logo !== false && <RecapLogo team={team} size={logo} />}
      <span className="min-w-0">
        {team.id ? (
          <Link href={`/teams/${team.id}`} className="block truncate font-semibold text-ink hover:text-brand-700 hover:underline dark:hover:text-brand-300">
            {team.name}
          </Link>
        ) : (
          <span className="block truncate font-semibold">{team.name}</span>
        )}
        {showRecord && (team.record || team.owner) && (
          <span className="block truncate text-[11px] leading-tight text-muted">{[team.record, team.owner].filter(Boolean).join(" · ")}</span>
        )}
      </span>
    </span>
  );
}

const AWARD_ICONS: Record<AwardKey, typeof Trophy> = {
  TOP_SCORE: Trophy,
  LOWEST_SCORE: ThumbsDown,
  BIGGEST_BLOWOUT: Flame,
  CLOSEST_GAME: Swords,
  BEST_DECISION: Lightbulb,
  BENCH_BLUNDER: Armchair,
  LUCKIEST_WIN: Clover,
  UNLUCKIEST_LOSS: CloudRain,
  WAIVER_HERO: Waves,
};

const AWARD_TONES: Record<AwardKey, string> = {
  TOP_SCORE: "bg-gold-500 text-brand-950",
  LOWEST_SCORE: "bg-slate-600 text-white",
  BIGGEST_BLOWOUT: "bg-orange-600 text-white",
  CLOSEST_GAME: "bg-brand-700 text-white",
  BEST_DECISION: "bg-emerald-600 text-white",
  BENCH_BLUNDER: "bg-red-600 text-white",
  LUCKIEST_WIN: "bg-green-600 text-white",
  UNLUCKIEST_LOSS: "bg-indigo-600 text-white",
  WAIVER_HERO: "bg-sky-600 text-white",
};

export function AwardIcon({ k, size = 18, className }: { k: AwardKey; size?: number; className?: string }) {
  const Icon = AWARD_ICONS[k] ?? Trophy;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md", AWARD_TONES[k], className)} style={{ width: size + 12, height: size + 12 }} aria-hidden>
      <Icon size={size} />
    </span>
  );
}

export function MoveArrow({ change, className }: { change: number; className?: string }) {
  if (change > 0)
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-xs font-bold text-win", className)} title={`Up ${change}`}>
        <ArrowUp size={13} aria-hidden />
        {change}
        <span className="sr-only">places up</span>
      </span>
    );
  if (change < 0)
    return (
      <span className={cn("inline-flex items-center gap-0.5 text-xs font-bold text-loss", className)} title={`Down ${-change}`}>
        <ArrowDown size={13} aria-hidden />
        {-change}
        <span className="sr-only">places down</span>
      </span>
    );
  return (
    <span className={cn("inline-flex items-center text-muted", className)} title="No change">
      <Minus size={13} aria-hidden />
      <span className="sr-only">no change</span>
    </span>
  );
}

/** Two-color win probability bar (away left, home right). */
export function ProbBar({ left, leftColor, rightColor, className, label }: { left: number; leftColor: string; rightColor: string; className?: string; label: string }) {
  const l = Math.max(2, Math.min(98, Math.round(left * 100)));
  return (
    <div className={cn("flex h-2 w-full overflow-hidden rounded-full bg-sunken", className)} role="img" aria-label={label}>
      <div style={{ width: `${l}%`, background: safeColor(leftColor) }} />
      <div style={{ width: `${100 - l}%`, background: safeColor(rightColor, "#f5b301") }} />
    </div>
  );
}

/** Win-probability line chart for the home team (SVG, 50% guide). */
export function WinProbChart({ series, homeColor, awayColor, homeName, awayName, className }: { series: number[]; homeColor: string; awayColor: string; homeName: string; awayName: string; className?: string }) {
  if (series.length < 2) return null;
  const W = 300;
  const H = 80;
  const pad = 4;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (series.length - 1);
  const y = (p: number) => pad + (1 - p) * (H - pad * 2);
  const d = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = `${d} L${x(series.length - 1).toFixed(1)},${y(0.5)} L${x(0).toFixed(1)},${y(0.5)} Z`;
  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label={`Win probability over the week: ${homeName} versus ${awayName}`}>
        <rect x="0" y="0" width={W} height={H / 2} fill={safeColor(homeColor)} opacity="0.07" />
        <rect x="0" y={H / 2} width={W} height={H / 2} fill={safeColor(awayColor, "#f5b301")} opacity="0.07" />
        <line x1={pad} x2={W - pad} y1={y(0.5)} y2={y(0.5)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="3 3" />
        <path d={area} fill={safeColor(homeColor)} opacity="0.12" />
        <path d={d} fill="none" stroke={safeColor(homeColor)} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="flex justify-between text-[10px] uppercase tracking-wide text-muted">
        <span>Kickoff</span>
        <span>Final</span>
      </figcaption>
    </figure>
  );
}

/** Efficiency bar (0..1) colored by quality. */
export function EffBar({ value, className, compact = false }: { value: number; className?: string; compact?: boolean }) {
  const pctv = Math.round(value * 100);
  const tone = value >= 0.95 ? "bg-win" : value >= 0.85 ? "bg-brand-600" : value >= 0.75 ? "bg-amber-500" : "bg-loss";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("h-1.5 w-full min-w-[60px] overflow-hidden rounded-full bg-sunken", compact && "hidden sm:block")} aria-hidden>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, pctv)}%` }} />
      </div>
      <span className={cn("shrink-0 text-right text-xs font-bold tabular-nums", compact ? "w-full sm:w-10" : "w-10")}>{pctv}%</span>
    </div>
  );
}

export function SectionTitle({ id, title, subtitle, actions }: { id?: string; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div id={id} className="mb-2 flex scroll-mt-16 flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
