// Presentation primitives (server-safe), re-exported from ./core. Each kind of data has ONE look across the app —
// docs/DESIGN.md §5 "Pattern catalogue" maps data → component:
//   summary numbers → SummaryStrip · label-above-number → Stat / StatGrid · key/value → StatRow
//   head-to-head → CompareBar (+ CompareHeader) · one percentage → Ring · share of a whole → Meter (./core)
//   ranking → RankBar rows · change over time → Sparkline (rows) / TrendChart (./client, detail views)
//   status → ResultPill / Delta / GameStatus · a matchup → MatchupRow · section titles → SectionHeader
//   secondary detail → Collapsible (or ShowMore in ./client), explanations → InfoButton
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoButton } from "./info-button";

type Tone = "good" | "bad" | "live" | "brand" | "muted";
const TONE_TEXT: Record<Tone, string> = {
  good: "text-win",
  bad: "text-loss",
  live: "text-live",
  brand: "text-brand-600 dark:text-brand-400",
  muted: "text-muted",
};

// ───────── Section header (outside or inside cards) ─────────
/**
 * Bold sentence-case section title (17px) with an optional grey subline, an ⓘ sheet for explanations and a right
 * slot (usually `<MoreLink>`). Use between cards ("Around the league") or as the first line inside a card body.
 */
export function SectionHeader({
  title,
  sub,
  info,
  infoTitle,
  action,
  as: Tag = "h2",
  className,
  id,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  info?: React.ReactNode;
  infoTitle?: string;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("mb-2 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <Tag id={id} className="truncate text-[17px] font-bold leading-6 tracking-[-0.01em] text-ink">
            {title}
          </Tag>
          {info && <InfoButton title={infoTitle ?? (typeof title === "string" ? title : "About")}>{info}</InfoButton>}
        </div>
        {sub && <p className="truncate text-[13px] text-muted">{sub}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 pb-0.5">{action}</div>}
    </div>
  );
}

// ───────── Numbers ─────────
export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  /** one short grey line under the number ("4th of 12", "of $300") */
  sub?: React.ReactNode;
  tone?: Tone;
  href?: string;
  /** tooltip / accessible description of the number */
  title?: string;
};

/**
 * The 2–4 numbers that answer a page's main question, in one white card divided by hairlines: micro-label above a
 * big tabular number, one grey subline. One row on every width (keep values short: "7-4", "$6", "85%").
 */
export function SummaryStrip({ items, header, className }: { items: SummaryItem[]; /** full-width first row (e.g. a team identity link) */ header?: React.ReactNode; className?: string }) {
  const n = Math.min(4, Math.max(1, items.length));
  return (
    <dl className={cn("card grid gap-px overflow-hidden bg-line/80 dark:bg-white/[0.07]", n === 1 ? "grid-cols-1" : n === 2 ? "grid-cols-2" : n === 3 ? "grid-cols-3" : "grid-cols-4", className)}>
      {header && <div className="col-span-full min-w-0 bg-panel">{header}</div>}
      {items.slice(0, 4).map((it) => {
        const body = (
          <>
            <dt className="truncate text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">{it.label}</dt>
            <dd className={cn("numeral mt-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.02em] sm:text-[24px]", it.tone ? TONE_TEXT[it.tone] : "text-ink")}>{it.value}</dd>
            {it.sub != null && <dd className="truncate text-[12px] leading-4 text-muted sm:text-[13px]">{it.sub}</dd>}
          </>
        );
        return it.href ? (
          <Link key={it.label} href={it.href} title={it.title} className="min-w-0 bg-panel px-3 py-3 transition-colors hover:bg-sunken sm:px-4">
            {body}
          </Link>
        ) : (
          <div key={it.label} title={it.title} className="min-w-0 bg-panel px-3 py-3 sm:px-4">
            {body}
          </div>
        );
      })}
    </dl>
  );
}

const STAT_SIZES = {
  sm: "text-[17px] leading-6",
  md: "text-[22px] leading-7 sm:text-[24px]",
  lg: "text-[28px] leading-8 sm:text-[32px] sm:leading-9",
} as const;

/** Micro-label above a big tabular number (+ one grey subline). The unit of StatGrid. */
export function Stat({
  label,
  value,
  sub,
  tone,
  size = "md",
  align = "left",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  size?: keyof typeof STAT_SIZES;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", align === "center" && "text-center", align === "right" && "text-right", className)}>
      <div className="truncate text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">{label}</div>
      <div className={cn("numeral mt-0.5 truncate font-semibold tracking-[-0.02em]", STAT_SIZES[size], tone ? TONE_TEXT[tone] : "text-ink")}>{value}</div>
      {sub != null && <div className="truncate text-[13px] leading-[18px] text-muted">{sub}</div>}
    </div>
  );
}

/** Breakdown as a grid of Stats (label above number) — instead of prose or a 2-row table. */
export function StatGrid({
  items,
  cols = 3,
  size = "sm",
  className,
}: {
  items: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; key?: string }[];
  cols?: 2 | 3 | 4;
  size?: keyof typeof STAT_SIZES;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-x-4 gap-y-4", cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4", className)}>
      {items.map((it, i) => (
        <Stat key={it.key ?? (typeof it.label === "string" ? it.label : i)} label={it.label} value={it.value} sub={it.sub} tone={it.tone} size={size} />
      ))}
    </div>
  );
}

/** Key / value line: label left, tabular value right (+ optional grey note under the label). Stack them in a list. */
export function StatRow({
  label,
  value,
  sub,
  tone,
  className,
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  className?: string;
  /** totals row: bold label + value */
  strong?: boolean;
}) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-3 py-2", className)}>
      <div className="min-w-0">
        <div className={cn("truncate text-[15px] leading-5 sm:text-sm", strong ? "font-semibold text-ink" : "text-ink/85")}>{label}</div>
        {sub && <div className="truncate text-[13px] leading-[18px] text-muted">{sub}</div>}
      </div>
      <div className={cn("numeral shrink-0 text-[15px] sm:text-sm", strong ? "font-bold" : "font-semibold", tone ? TONE_TEXT[tone] : "text-ink")}>{value}</div>
    </div>
  );
}

/** Signed change: "+3.2" green, "−1.4" red, "0.0" grey. */
export function Delta({ value, decimals = 1, suffix = "", className, invert }: { value: number; decimals?: number; suffix?: string; className?: string; invert?: boolean }) {
  const r = Number(value.toFixed(decimals));
  const good = invert ? r < 0 : r > 0;
  const bad = invert ? r > 0 : r < 0;
  return (
    <span className={cn("numeral font-semibold", good ? "text-win" : bad ? "text-loss" : "text-muted", className)}>
      {r > 0 ? "+" : r < 0 ? "−" : ""}
      {Math.abs(r).toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** W / L / T result pill (20px square). Pass a streak like "W3" as `result` to show it as one pill. */
export function ResultPill({ result, className, title }: { result: string; className?: string; title?: string }) {
  const k = result.trim().charAt(0).toUpperCase();
  return (
    <span
      title={title}
      className={cn(
        "numeral inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] px-1 text-[11px] font-bold leading-none text-white",
        k === "W" ? "bg-green-700 dark:bg-green-600" : k === "L" ? "bg-[rgb(208_31_43)]" : "bg-ink/40 dark:bg-white/30",
        className,
      )}
    >
      {result}
    </span>
  );
}

// ───────── Bars & charts ─────────
/**
 * ESPN-style head-to-head stat row: value left · label centre · value right, with a split bar under it that grows
 * from the centre toward each side, scaled to the bigger value. The leading side is bold and its bar is in its color.
 */
export function CompareBar({
  label,
  left,
  right,
  leftText,
  rightText,
  decimals = 1,
  lowerIsBetter,
  leftColor = "rgb(var(--c-accent))",
  rightColor = "rgb(var(--c-ink) / 0.72)",
  className,
}: {
  label: React.ReactNode;
  left: number;
  right: number;
  leftText?: React.ReactNode;
  rightText?: React.ReactNode;
  decimals?: number;
  lowerIsBetter?: boolean;
  leftColor?: string;
  rightColor?: string;
  className?: string;
}) {
  const max = Math.max(Math.abs(left), Math.abs(right));
  const lp = max > 0 ? (Math.abs(left) / max) * 100 : 0;
  const rp = max > 0 ? (Math.abs(right) / max) * 100 : 0;
  const tie = Math.abs(left - right) < 1e-9;
  const leftLeads = !tie && (lowerIsBetter ? left < right : left > right);
  const rightLeads = !tie && !leftLeads;
  const fmt = (v: number) => v.toFixed(decimals);
  const trail = "rgb(var(--c-ink) / 0.13)";
  return (
    <div className={cn("py-2", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2">
        <span className={cn("numeral truncate text-[15px]", leftLeads ? "font-bold text-ink" : "font-medium text-muted")}>{leftText ?? fmt(left)}</span>
        <span className="truncate text-center text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</span>
        <span className={cn("numeral truncate text-right text-[15px]", rightLeads ? "font-bold text-ink" : "font-medium text-muted")}>{rightText ?? fmt(right)}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1" aria-hidden>
        <span className="flex h-1.5 justify-end overflow-hidden rounded-full bg-ink/[0.05] dark:bg-white/[0.06]">
          <span className="wp-seg block h-full rounded-full transition-[width] duration-700 ease-out-expo" style={{ width: `${lp}%`, ["--seg" as string]: leftLeads || tie ? leftColor : trail }} />
        </span>
        <span className="flex h-1.5 overflow-hidden rounded-full bg-ink/[0.05] dark:bg-white/[0.06]">
          <span className="wp-seg block h-full rounded-full transition-[width] duration-700 ease-out-expo" style={{ width: `${rp}%`, ["--seg" as string]: rightLeads || tie ? rightColor : trail }} />
        </span>
      </div>
    </div>
  );
}

/** Column heads for a list of CompareBars: left side identity · right side identity. */
export function CompareHeader({ left, right, className }: { left: React.ReactNode; right: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-line/70 pb-2", className)}>
      <div className="min-w-0">{left}</div>
      <div className="min-w-0 text-right">{right}</div>
    </div>
  );
}

/**
 * One headline percentage as a ring (win probability, playoff odds). `value` 0..1. The centre shows the % unless
 * `children` replaces it.
 */
export function Ring({
  value,
  size = 64,
  stroke = 6,
  color = "rgb(var(--c-accent))",
  label,
  children,
  className,
}: {
  value: number | null | undefined;
  size?: number;
  stroke?: number;
  color?: string;
  /** accessible name ("Win probability") */
  label?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const v = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pctText = v == null ? "—" : v > 0.995 && v < 1 ? ">99%" : v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`;
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v == null ? undefined : Math.round(v * 100)}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-ink) / 0.08)" strokeWidth={stroke} />
        {v != null && v > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * v} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out-expo"
          />
        )}
      </svg>
      <span className="numeral absolute inset-0 flex items-center justify-center font-semibold text-ink" style={{ fontSize: Math.max(11, Math.round(size * 0.25)) }}>
        {children ?? pctText}
      </span>
    </span>
  );
}

/**
 * Ranked row with an inline bar scaled to the leader (render inside `<RankList>` / any `<ul>`): rank · visual ·
 * name + grey subline + bar · right-aligned value. `mine` paints the bar blue and the name blue.
 */
export function RankBar({
  rank,
  leading,
  title,
  sub,
  value,
  max,
  display,
  valueSub,
  mine,
  href,
  titleText,
  className,
}: {
  rank?: React.ReactNode;
  leading?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  value: number;
  max: number;
  /** formatted value (defaults to value.toFixed(1)) */
  display?: React.ReactNode;
  valueSub?: React.ReactNode;
  mine?: boolean;
  href?: string;
  titleText?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  const inner = (
    <>
      {rank != null && <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{rank}</span>}
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            title={titleText ?? (typeof title === "string" ? title : undefined)}
            className={cn("min-w-0 shrink truncate text-[15px] font-semibold leading-5 sm:text-sm", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}
          >
            {title}
          </span>
          {sub && <span className="numeral min-w-[2.5rem] shrink-[2] truncate text-[13px] text-muted">{sub}</span>}
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink/[0.05] dark:bg-white/[0.06]" aria-hidden>
          <span className={cn("block h-full rounded-full", mine ? "bg-brand-600 dark:bg-brand-400" : "bg-ink/30 dark:bg-white/35")} style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="numeral block text-[15px] font-semibold leading-5 text-ink">{display ?? value.toFixed(1)}</span>
        {valueSub && <span className="block text-[12px] leading-4 text-muted">{valueSub}</span>}
      </span>
    </>
  );
  const cls = cn("flex min-h-[52px] items-center gap-3 px-4 py-2", href && "transition-colors hover:bg-sunken/70 active:bg-sunken", className);
  return <li>{href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}</li>;
}

/** A card list of RankBars (or ListRows) separated by hairlines. */
export function RankList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn("divide-y divide-line/70", className)}>{children}</ul>;
}

/**
 * Tiny line for a trend inside a row (weekly scores, odds history). Stroke is `currentColor` (default the muted
 * grey; pass `className="text-brand-600"` to highlight). `area` adds a faint fill; the last point gets a dot.
 */
export function Sparkline({
  data,
  width = 72,
  height = 24,
  area,
  baseline,
  className,
  label,
  strokeWidth = 1.75,
}: {
  data: (number | null | undefined)[];
  width?: number;
  height?: number;
  area?: boolean;
  /** draw a dashed reference line at this value (e.g. league average) */
  baseline?: number;
  className?: string;
  label?: string;
  strokeWidth?: number;
}) {
  const pts = data.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null && Number.isFinite(p.v));
  if (pts.length < 2) return <span className={cn("inline-block", className)} style={{ width, height }} aria-hidden />;
  const vals = pts.map((p) => p.v).concat(baseline != null ? [baseline] : []);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = strokeWidth + 1.5;
  const sx = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (width - pad * 2);
  const sy = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const d = pts.map((p, k) => `${k ? "L" : "M"}${sx(p.i).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible text-muted", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {baseline != null && <line x1={pad} x2={width - pad} y1={sy(baseline)} y2={sy(baseline)} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 2" strokeWidth={1} />}
      {area && <path d={`${d} L${sx(last.i).toFixed(1)} ${height - 1} L${sx(pts[0]!.i).toFixed(1)} ${height - 1} Z`} fill="currentColor" fillOpacity={0.1} />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx(last.i)} cy={sy(last.v)} r={2.25} fill="currentColor" />
    </svg>
  );
}

// ───────── Disclosure ─────────
/**
 * Secondary detail behind a tap (server-safe `<details>`): a 48px summary row with an optional right-side meta and
 * a chevron; the content renders below when open. Use for "About" rows, tiebreakers, full breakdowns.
 */
export function Collapsible({
  summary,
  meta,
  children,
  defaultOpen,
  className,
  bodyClassName,
}: {
  summary: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <details className={cn("group", className)} open={defaultOpen}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 py-2 text-[15px] font-semibold text-ink outline-none transition-colors hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/50 sm:text-sm dark:hover:text-brand-400 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {meta && <span className="shrink-0 text-[13px] font-medium text-muted">{meta}</span>}
        <ChevronDown size={18} className="shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className={cn("pb-3", bodyClassName)}>{children}</div>
    </details>
  );
}

// ───────── Matchup row ─────────
type MatchTeam = { id: string; name: string; abbrev?: string | null; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null };
export type MatchupRowSide = { team: MatchTeam; score: number; projected: number; record?: string | null };

/**
 * The one matchup row (home scoreboard, scoreboard page, schedules): two team lines (logo · name · record · score)
 * and a status column (Live dot / Final / the favourite's odds before kickoff). Before kickoff the scores are the
 * projections in grey. `mine` gets the blue leading edge.
 */
export function MatchupRow({
  away,
  home,
  status,
  homeWinProb,
  href,
  mine,
  myTeamId,
  decimals = 2,
  winnerTeamId,
  label,
  note,
  logo,
  className,
}: {
  away: MatchupRowSide | null;
  home: MatchupRowSide | null;
  status: string;
  homeWinProb?: number | null;
  href?: string;
  mine?: boolean;
  myTeamId?: string | null;
  decimals?: number;
  /** decided result (playoff tiebreaks); otherwise the higher score wins once final */
  winnerTeamId?: string | null;
  /** round label ("Semifinal") shown in the status column */
  label?: string | null;
  /** an extra grey line under the teams (multi-week game state) */
  note?: React.ReactNode;
  /** render prop for the team logo (TeamLogo lives in ./core) */
  logo?: (team: MatchTeam) => React.ReactNode;
  className?: string;
}) {
  const live = status === "LIVE";
  const final = status === "FINAL";
  const upcoming = !live && !final;
  const both = away && home;
  const leaderId = !both ? null : final && winnerTeamId ? winnerTeamId : away.score === home.score ? null : away.score > home.score ? away.team.id : home.team.id;
  const fav = both && homeWinProb != null ? (homeWinProb >= 0.5 ? home : away) : null;
  const favPct = homeWinProb != null ? Math.max(homeWinProb, 1 - homeWinProb) : null;
  const line = (s: MatchupRowSide | null, key: string) => {
    if (!s) return <div key={key} className="flex h-7 items-center text-[13px] font-semibold text-muted">Bye</div>;
    const lead = leaderId === s.team.id;
    const trailing = !upcoming && leaderId !== null && !lead;
    return (
      <div key={key} className="flex h-7 min-w-0 items-center gap-2.5">
        {logo?.(s.team)}
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span title={s.team.name} className={cn("truncate text-[15px] font-semibold leading-5 sm:text-sm", s.team.id === myTeamId ? "text-brand-600 dark:text-brand-400" : trailing ? "text-muted" : "text-ink")}>
            {s.team.name}
          </span>
          {s.record && <span className="numeral shrink-0 text-[12px] text-muted">{s.record}</span>}
        </span>
        <span className={cn("numeral shrink-0 text-[15px] leading-5", upcoming ? "font-medium text-muted" : lead ? "font-bold text-ink" : "font-medium text-muted")}>
          {upcoming ? s.projected.toFixed(1) : s.score.toFixed(decimals)}
        </span>
      </div>
    );
  };
  const statusCol = (
    <span className="flex w-[4.25rem] shrink-0 flex-col items-end justify-center gap-0.5 border-l border-line/70 pl-3 text-right text-[12px] leading-4">
      {live ? (
        <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-[0.04em] text-live">
          <span className="live-dot h-1.5 w-1.5 bg-live" aria-hidden /> Live
        </span>
      ) : final ? (
        <span className="font-semibold uppercase tracking-[0.04em] text-ink">Final</span>
      ) : (
        <span className="font-semibold uppercase tracking-[0.04em] text-muted">Proj</span>
      )}
      {label && <span className="truncate text-muted" title={label}>{label}</span>}
      {!final && fav && favPct != null && (
        <span className="numeral truncate text-muted" title="Win probability">
          {Math.round(favPct * 100)}% {fav.team.abbrev ?? ""}
        </span>
      )}
    </span>
  );
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        {line(away, "a")}
        {line(home, "h")}
        {note && <span className="mt-0.5 block truncate text-[12px] text-muted">{note}</span>}
      </span>
      {statusCol}
    </>
  );
  const cls = cn(
    "relative flex items-center gap-3 px-4 py-2.5",
    mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]",
    href && "transition-colors hover:bg-sunken/70 active:bg-sunken",
    className,
  );
  return href ? (
    <Link href={href} className={cls} aria-label={both ? `${away.team.name} vs ${home.team.name}` : "Matchup"}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** "See all" footer link for a card list (48px row, blue, chevron). */
export function SeeAll({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("flex min-h-12 items-center justify-center gap-1 border-t border-line/70 text-[14px] font-semibold text-brand-600 transition-colors hover:bg-sunken/70 dark:text-brand-400", className)}>
      {children}
      <ChevronRight size={15} aria-hidden />
    </Link>
  );
}
