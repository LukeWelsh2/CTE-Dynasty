// Small presentational pieces shared by the players table, quick card, profile, news and injury pages.
// No client hooks and no server-only imports: usable from server and client components.
import Link from "next/link";
import { Newspaper } from "lucide-react";
import { Badge, TeamLogo } from "@/components/ui/core";
import { cn, timeAgo } from "@/lib/utils";

export interface OwnerTagTeam {
  teamId: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  isMine: boolean;
}

/** Fantasy owner: team logo + abbreviation, "FA", or "W (Wed)" for players on waivers */
export function OwnerTag({
  owner,
  waiver,
  className,
  full,
}: {
  owner: OwnerTagTeam | null;
  waiver?: { processAtLabel?: string | null; weekday?: string | null; reason?: string } | null;
  className?: string;
  full?: boolean;
}) {
  if (owner)
    return (
      <Link href={`/teams/${owner.teamId}`} title={owner.name} className={cn("inline-flex items-center gap-1.5 font-semibold hover:underline", owner.isMine && "text-gold-600 dark:text-gold-400", className)}>
        <TeamLogo team={{ name: owner.name, abbrev: owner.abbrev, logoUrl: owner.logoUrl, primaryColor: owner.primaryColor, secondaryColor: owner.secondaryColor }} size={18} />
        <span className="text-xs">{full ? owner.name : owner.abbrev}</span>
      </Link>
    );
  if (waiver)
    return (
      <Badge tone="amber" className={className} title={`${waiver.reason ? `${waiver.reason}. ` : ""}${waiver.processAtLabel ? `Claims process ${waiver.processAtLabel}` : ""}`}>
        W{waiver.weekday ? ` (${waiver.weekday})` : ""}
      </Badge>
    );
  return (
    <Badge tone="green" className={className} title="Free agent">
      FA
    </Badge>
  );
}

/** Recent news indicator linking to the player's news tab */
export function NewsDot({ playerId, news, className }: { playerId: string; news: { headline: string; publishedAt: string } | null; className?: string }) {
  if (!news) return null;
  return (
    // 24px hit area around the 16px badge; the negative margin keeps rows as compact as before
    <Link
      href={`/players/${playerId}?tab=news`}
      title={`${news.headline} (${timeAgo(news.publishedAt)})`}
      aria-label={`Recent news: ${news.headline}`}
      className={cn("group/news -m-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50", className)}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-brand-600 text-white group-hover/news:bg-brand-700">
        <Newspaper size={10} />
      </span>
    </Link>
  );
}

/** Phone rows: "Sun 1:00 PM" → "Sun 1pm", "Thu 8:20 PM" → "Thu 8:20pm" (any other text passes through) */
export function shortKickoff(s: string): string {
  return s.replace(/:00\s?([AP]M)/, "$1").replace(/\s?([AP]M)\b/, (_, m: string) => m.toLowerCase());
}

/** Opponent + kickoff / live status / final result */
export function GameCell({ game, bye, kickoffLabel }: { game: { label: string; state: string; statusDetail: string | null; result: string | null } | null; bye?: boolean; kickoffLabel?: string | null }) {
  if (!game) return <span className="text-xs font-semibold text-muted">{bye ? "BYE" : "—"}</span>;
  const win = game.result?.startsWith("W");
  const loss = game.result?.startsWith("L");
  return (
    <span className="block whitespace-nowrap leading-tight">
      <span className="text-xs font-semibold">{game.label}</span>
      <span
        className={cn(
          "block text-[10px]",
          game.state === "in" ? "font-bold text-live" : game.state === "post" ? (win ? "text-win" : loss ? "text-loss" : "text-muted") : "text-muted",
        )}
      >
        {game.state === "post" ? (game.result ?? "Final") : game.state === "in" ? (game.statusDetail ?? "Live") : (kickoffLabel ?? game.statusDetail ?? "")}
      </span>
    </span>
  );
}

const CATEGORY_TONES: Record<string, "red" | "brand" | "purple" | "neutral"> = { INJURY: "red", NEWS: "brand", ANALYSIS: "purple", TRANSACTION: "neutral" };

export function CategoryBadge({ category }: { category: string }) {
  return <Badge tone={CATEGORY_TONES[category] ?? "neutral"}>{category === "NEWS" ? "News" : category === "INJURY" ? "Injury" : category.toLowerCase()}</Badge>;
}

/** Practice participation chip (DNP / LP / FP) */
export function PracticeTag({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted">—</span>;
  const v = value.toUpperCase();
  const tone = v.startsWith("DNP") || v.includes("DID NOT") ? "red" : v.startsWith("LP") || v.includes("LIMITED") ? "amber" : v.startsWith("FP") || v.includes("FULL") ? "green" : "neutral";
  return <Badge tone={tone}>{value}</Badge>;
}
