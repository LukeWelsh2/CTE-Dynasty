// Small server-safe building blocks shared by the standings, power rankings and playoff pages.
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { SegmentedLinks, TabLinks, TeamLogo } from "@/components/ui/core";
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
            // one inline wrapper: the tab is a flex row, which would trim the space before " Rankings"
            label: (
              <span>
                Power<span className="hidden sm:inline"> rankings</span>
              </span>
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
          <span className="hidden sm:inline">Playoff bracket &amp; odds</span>
        </>
      ),
      href: "/playoffs",
    },
  ];
  return <TabLinks tabs={tabs} active={active} />;
}

/** Segmented control built from links (server friendly) — the kit's SegmentedLinks under the old name. */
export function SegmentLinks({ items, active, label, full }: { items: { key: string; label: string; href: string }[]; active: string; label: string; full?: boolean }) {
  return <SegmentedLinks options={items} active={active} ariaLabel={label} full={full} scroll={false} />;
}

// v3: clinch markers are quiet letter chips (green = in, grey = out); the meaning is in the title / legend
const MARKER_TONE: Record<Marker, string> = {
  z: "bg-win/10 text-win",
  y: "bg-win/10 text-win",
  x: "bg-win/10 text-win",
  e: "bg-ink/[0.06] text-muted",
};

export function ClinchBadge({ marker, className }: { marker: Marker | null | undefined; className?: string }) {
  if (!marker) return null;
  return (
    <span
      title={MARKER_INFO[marker].description}
      aria-label={MARKER_INFO[marker].description}
      className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[11px] font-bold leading-none", MARKER_TONE[marker], className)}
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
            "inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[10px] font-bold leading-none text-white",
            r === "W" ? "bg-green-700 dark:bg-green-600" : r === "L" ? "bg-[rgb(208_31_43)]" : "bg-ink/40",
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
          <span className={cn("text-[11px] font-semibold tabular-nums", d > 0 ? "text-win" : "text-loss")} title="Change since last week">
            {d > 0 ? "▲" : "▼"}
            {Math.abs(d)}
          </span>
        )}
        <span className={cn("font-semibold tabular-nums", decided === "clinched" && "text-win", (decided === "eliminated" || text === "<1%") && "text-muted")}>{text}</span>
      </span>
      {showBar && p !== null && p !== undefined && (
        <span className="h-1 w-14 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className={cn("block h-full rounded-full", decided === "clinched" ? "bg-win" : "bg-brand-600 dark:bg-brand-400")} style={{ width: `${width}%` }} />
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
            className={cn("truncate font-semibold hover:underline", mine ? "text-brand-600 dark:text-brand-400" : "text-ink", compact ? "max-w-[120px] sm:max-w-[220px]" : "max-w-[150px] sm:max-w-[240px]")}
          >
            {team.name}
          </Link>
          <ClinchBadge marker={marker} />
          {seed ? (
            <span
              title={byeSeed ? `Seed ${seed} (first-round bye) if the season ended today` : `Seed ${seed} if the season ended today`}
              className={cn("inline-flex h-4 items-center rounded px-1 text-[11px] font-semibold leading-none", byeSeed ? "bg-ink/[0.08] text-ink" : "bg-ink/[0.05] text-muted")}
            >
              #{seed}
            </span>
          ) : null}
        </span>
        {owner !== undefined && <span className="block truncate text-xs leading-tight text-muted">{owner ?? "No manager"}</span>}
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
