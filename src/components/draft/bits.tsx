// Small presentational pieces shared by the draft pages (server-safe, no hooks).
import Link from "next/link";
import { Badge, PosBadge, PlayerHeadshot, TeamLogo, InjuryTag } from "@/components/ui/core";
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

export function TypeBadge({ type, kind }: { type: string; kind?: string }) {
  if (type === "AUCTION") return <Badge tone="gold">{kind === "FREE_AGENT" ? "FA auction" : "Salary auction"}</Badge>;
  if (type === "ROOKIE") return <Badge tone="purple">Rookie draft</Badge>;
  return <Badge>{type}</Badge>;
}

/** Position-tinted background for board cells / chips (always paired with the text label). */
export const POS_TINT: Record<string, string> = {
  QB: "bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900",
  RB: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900",
  WR: "bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900",
  TE: "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900",
  K: "bg-violet-50 border-violet-200 dark:bg-violet-950/40 dark:border-violet-900",
  DEF: "bg-slate-100 border-slate-300 dark:bg-slate-800/60 dark:border-slate-700",
  DL: "bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-900",
  LB: "bg-teal-50 border-teal-200 dark:bg-teal-950/40 dark:border-teal-900",
  DB: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900",
};

export function TeamChip({ team, size = 20, className, showName = true }: { team: Pick<RoomTeam, "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor"> | null | undefined; size?: number; className?: string; showName?: boolean }) {
  if (!team) return <span className="text-muted">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <TeamLogo team={team} size={size} />
      {showName && <span className="truncate font-semibold">{team.name}</span>}
    </span>
  );
}

export function PlayerCell({ player, size = 30, sub }: { player: Pick<RoomPlayer, "id" | "fullName" | "position" | "team" | "injuryStatus">; size?: number; sub?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PlayerHeadshot player={{ id: player.id, fullName: player.fullName, position: player.position }} size={size} />
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <Link href={`/players/${player.id}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {player.fullName}
          </Link>
          <InjuryTag status={player.injuryStatus} />
        </span>
        <span className="flex items-center gap-1 text-[11px] leading-tight text-muted">
          <PosBadge pos={player.position} className="h-4 min-w-[24px] text-[9px]" />
          <span>{player.team ?? "FA"}</span>
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
