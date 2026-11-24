// Small presentational pieces shared by the draft pages (server-safe, no hooks).
import Link from "next/link";
import { Badge, TeamLogo } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import type { RoomPlayer, RoomTeam } from "@/lib/draft/types";

export function StatusBadge({ status }: { status: string }) {
  if (status === "LIVE")
    return (
      <Badge tone="live" className="gap-1.5">
        <span className="inline-block h-1.5 w-1.5 animate-pulseDot rounded-full bg-white" /> Live
      </Badge>
    );
  if (status === "PAUSED") return <Badge tone="amber">Paused</Badge>;
  if (status === "COMPLETE") return <Badge tone="green">Complete</Badge>;
  return <Badge tone="brand">Scheduled</Badge>;
}

export function typeLabel(type: string, kind?: string) {
  if (type === "AUCTION") return kind === "FREE_AGENT" ? "Free-agent auction" : "Salary auction";
  if (type === "ROOKIE") return "Rookie draft";
  return type;
}

export function TypeBadge({ type, kind }: { type: string; kind?: string }) {
  if (type === "AUCTION") return <Badge tone="gold">{kind === "FREE_AGENT" ? "FA auction" : "Salary auction"}</Badge>;
  if (type === "ROOKIE") return <Badge tone="purple">Rookie draft</Badge>;
  return <Badge>{type}</Badge>;
}

/**
 * Position identity for board cells / tracker cards: a faint wash + a 3px leading edge in the position colour
 * (the PosPill hues, docs/DESIGN.md §6.3). Always paired with the text label. Written out in full for Tailwind's JIT.
 */
export const POS_TINT: Record<string, string> = {
  QB: "bg-pink-600/[0.06] border-l-pink-700 dark:bg-pink-400/10 dark:border-l-pink-400",
  RB: "bg-emerald-600/[0.06] border-l-emerald-700 dark:bg-emerald-400/10 dark:border-l-emerald-400",
  WR: "bg-sky-600/[0.06] border-l-sky-700 dark:bg-sky-400/10 dark:border-l-sky-400",
  TE: "bg-violet-600/[0.06] border-l-violet-600 dark:bg-violet-400/10 dark:border-l-violet-400",
  K: "bg-amber-600/[0.06] border-l-amber-800 dark:bg-amber-400/10 dark:border-l-amber-400",
  DEF: "bg-slate-500/[0.07] border-l-slate-600 dark:bg-slate-400/10 dark:border-l-slate-400",
  DL: "bg-stone-500/[0.07] border-l-stone-600 dark:bg-stone-400/10 dark:border-l-stone-400",
  LB: "bg-stone-500/[0.07] border-l-stone-600 dark:bg-stone-400/10 dark:border-l-stone-400",
  DB: "bg-stone-500/[0.07] border-l-stone-600 dark:bg-stone-400/10 dark:border-l-stone-400",
};

/** "Ty Simpson" → "T. Simpson", "Marvin Harrison Jr." → "M. Harrison Jr." (phones); team defenses stay whole. */
export function shortName(full: string, position?: string | null): string {
  if (position === "DEF") return full;
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

export function TeamChip({ team, size = 20, className, showName = true }: { team: Pick<RoomTeam, "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor"> | null | undefined; size?: number; className?: string; showName?: boolean }) {
  if (!team) return <span className="text-muted">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <TeamLogo team={team} size={size} />
      {showName && <span className="truncate font-semibold">{team.name}</span>}
    </span>
  );
}

/**
 * A player in a draft list / table: headshot with the NFL logo badge, bold name (link), position pill + NFL team +
 * red injury letter, and an optional extra on the second line. `short` abbreviates the first name ("T. Simpson").
 */
export function PlayerCell({
  player,
  size = 36,
  sub,
  short,
  noLink,
}: {
  player: Pick<RoomPlayer, "id" | "fullName" | "position" | "team" | "injuryStatus">;
  size?: number;
  sub?: React.ReactNode;
  short?: boolean;
  noLink?: boolean;
}) {
  const name = short ? shortName(player.fullName, player.position) : player.fullName;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <HeadshotBadge player={{ id: player.id, fullName: player.fullName, position: player.position }} nflTeam={player.team} size={size} />
      <span className="min-w-0">
        {noLink ? (
          <span title={player.fullName} className="block truncate text-[15px] font-bold leading-5 text-ink sm:text-sm">
            {name}
          </span>
        ) : (
          <Link href={`/players/${player.id}`} title={player.fullName} className="block truncate text-[15px] font-bold leading-5 text-ink hover:underline sm:text-sm">
            {name}
          </Link>
        )}
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-ink">
          <PosPill pos={player.position} />
          {player.position !== "DEF" && <span className="shrink-0 font-medium">{player.team ?? "FA"}</span>}
          <InjuryLetter status={player.injuryStatus} />
          {sub}
        </span>
      </span>
    </span>
  );
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-muted", className)}>—</span>;
  return <span className={cn("tabular-nums", value < 0 && "text-loss", className)}>${value.toLocaleString()}</span>;
}
