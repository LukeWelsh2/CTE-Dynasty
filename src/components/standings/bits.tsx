// Small server-safe building blocks shared by the standings, power rankings and playoff pages.
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { TabLinks, TeamLogo } from "@/components/ui/core";
import { MARKER_INFO, type Marker } from "@/lib/sim/clinch";
import { cn } from "@/lib/utils";

export type StandingsTab = "standings" | "power" | "playoffs";

export function StandingsTabs({ active, showPower = true }: { active: StandingsTab; showPower?: boolean }) {
  const tabs = [
    { key: "standings", label: "Standings", href: "/standings" },
    ...(showPower
      ? [
          {
            key: "power",
            label: (
              <>
                Power<span className="hidden sm:inline"> Rankings</span>
              </>
            ),
            href: "/standings/power",
          },
        ]
      : []),
    {
      key: "playoffs",
      label: (
        <>
          <span className="sm:hidden">Playoffs</span>
          <span className="hidden sm:inline">Playoff Bracket &amp; Odds</span>
        </>
      ),
      href: "/playoffs",
    },
  ];
  return <TabLinks tabs={tabs} active={active} />;
}

/** Pill segmented control built from links (server friendly). */
export function SegmentLinks({ items, active, label }: { items: { key: string; label: string; href: string }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          aria-current={it.key === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            it.key === active ? "bg-panel text-ink shadow-panel" : "text-muted hover:text-ink",
          )}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

const MARKER_TONE: Record<Marker, string> = {
  z: "bg-gold-500 text-brand-950",
  y: "bg-brand-700 text-white dark:bg-brand-500",
  x: "bg-win text-white",
  e: "bg-sunken text-muted ring-1 ring-line",
};

export function ClinchBadge({ marker, className }: { marker: Marker | null | undefined; className?: string }) {
  if (!marker) return null;
  return (
    <span
      title={MARKER_INFO[marker].description}
      aria-label={MARKER_INFO[marker].description}
      className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-extrabold leading-none", MARKER_TONE[marker], className)}
    >
      {marker}
    </span>
  );
}

export function MarkerLegend({ markers }: { markers?: Marker[] }) {
  const list = markers ?? (["x", "y", "z", "e"] as Marker[]);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {list.map((m) => (
        <li key={m} className="inline-flex items-center gap-1.5">
          <ClinchBadge marker={m} />
          {MARKER_INFO[m].description}
        </li>
      ))}
    </ul>
  );
}

export function LastFive({ results, className }: { results: ("W" | "L" | "T")[]; className?: string }) {
  if (!results.length) return <span className="text-muted">—</span>;
  const text = results.join(" ");
  return (
    <span className={cn("inline-flex items-center gap-[3px]", className)} title={`Last ${results.length}: ${text}`}>
      <span className="sr-only">Last {results.length}: {text}</span>
      {results.map((r, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold leading-none text-white",
            r === "W" ? "bg-win" : r === "L" ? "bg-loss" : "bg-slate-400",
          )}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

export function Streak({ value }: { value: string }) {
  if (!value) return <span className="text-muted">—</span>;
  const w = value.startsWith("W");
  const l = value.startsWith("L");
  return <span className={cn("font-semibold tabular-nums", w && "text-win", l && "text-loss")}>{value}</span>;
}

export function Movement({ delta, className }: { delta: number | null; className?: string }) {
  if (delta === null) return <span className={cn("text-[11px] text-muted", className)}>new</span>;
  if (delta === 0)
    return (
      <span className={cn("inline-flex items-center text-muted", className)} title="No change">
        <Minus size={12} aria-hidden />
        <span className="sr-only">No change</span>
      </span>
    );
  const up = delta > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-bold tabular-nums", up ? "text-win" : "text-loss", className)} title={`${up ? "Up" : "Down"} ${Math.abs(delta)}`}>
      {up ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
      {Math.abs(delta)}
      <span className="sr-only">{up ? "up" : "down"}</span>
    </span>
  );
}

/** Probability text: whole percents, "<1%" / ">99%" unless mathematically decided. */
export function fmtProb(p: number | null | undefined, decided?: "clinched" | "eliminated" | null): string {
  if (decided === "clinched") return "100%";
  if (decided === "eliminated") return "0%";
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (p >= 0.995) return ">99%";
  if (p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

export function OddsCell({ p, decided, delta, showBar = true }: { p: number | null | undefined; decided?: "clinched" | "eliminated" | null; delta?: number | null; showBar?: boolean }) {
  const text = fmtProb(p, decided);
  const width = decided === "clinched" ? 100 : decided === "eliminated" ? 0 : Math.round((p ?? 0) * 100);
  const d = delta !== null && delta !== undefined && Math.abs(delta) >= 0.005 ? Math.round(delta * 100) : 0;
  return (
    <span className="inline-flex min-w-[64px] flex-col items-end gap-0.5">
      <span className="inline-flex items-baseline gap-1">
        {d !== 0 && (
          <span className={cn("text-[10px] font-semibold tabular-nums", d > 0 ? "text-win" : "text-loss")} title="Change since last week">
            {d > 0 ? "▲" : "▼"}
            {Math.abs(d)}
          </span>
        )}
        <span className={cn("font-semibold tabular-nums", decided === "clinched" && "text-win", (decided === "eliminated" || text === "<1%") && "text-muted")}>{text}</span>
      </span>
      {showBar && p !== null && p !== undefined && (
        <span className="h-1 w-14 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className={cn("block h-full rounded-full", decided === "clinched" ? "bg-win" : "bg-brand-500")} style={{ width: `${width}%` }} />
        </span>
      )}
    </span>
  );
}

export interface TeamCellTeam {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export function TeamCell({
  team,
  owner,
  myTeamId,
  marker,
  seed,
  byeSeed,
  size = 28,
  compact,
}: {
  team: TeamCellTeam;
  owner?: string | null;
  myTeamId?: string | null;
  marker?: Marker | null;
  seed?: number | null;
  byeSeed?: boolean;
  size?: number;
  compact?: boolean;
}) {
  const mine = team.id === myTeamId;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TeamLogo team={team} size={size} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1">
          <Link
            href={mine ? "/team" : `/teams/${team.id}`}
            className={cn("truncate font-semibold hover:underline", mine ? "text-ink" : "text-brand-700 dark:text-brand-300", compact ? "max-w-[120px] sm:max-w-[220px]" : "max-w-[150px] sm:max-w-[240px]")}
          >
            {team.name}
          </Link>
          <ClinchBadge marker={marker} />
          {seed ? (
            <span
              title={byeSeed ? `Seed ${seed} (first-round bye) if the season ended today` : `Seed ${seed} if the season ended today`}
              className={cn(
                "inline-flex h-4 items-center rounded px-1 text-[9px] font-bold leading-none ring-1",
                byeSeed ? "bg-gold-300/30 text-gold-600 ring-gold-400/60 dark:text-gold-300" : "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:ring-brand-800",
              )}
            >
              #{seed}
            </span>
          ) : null}
        </span>
        {owner !== undefined && <span className="block truncate text-[11px] leading-tight text-muted">{owner ?? "No manager"}</span>}
      </span>
    </span>
  );
}

export const TIEBREAKER_LABELS: Record<string, string> = {
  H2H: "Head-to-head record",
  POINTS_FOR: "Total points for",
  DIVISION_RECORD: "Division win percentage",
  POINTS_AGAINST: "Points against (more is better)",
  ALL_PLAY: "All-play wins",
  COIN_FLIP: "Coin flip",
};

/** "Nov 24, 6:00 AM" in the league timezone. */
export function fmtWhen(d: Date | string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
  } catch {
    return new Date(d).toLocaleString();
  }
}
