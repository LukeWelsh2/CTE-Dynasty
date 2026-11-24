// One news item as a list row (render inside a `card divide-y` list): category · time · source, the headline (links
// to the source), a 2-line summary, the fantasy analysis behind a tap (no JS), and the linked players as chips.
// "Your player" items get the blue "mine" edge.
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Badge, InjuryTag, PlayerHeadshot } from "@/components/ui/core";
import { CategoryBadge, type OwnerTagTeam } from "@/components/players/tags";
import { fmtDateTime, sourceLabel } from "@/lib/players/format";
import { cn, timeAgo } from "@/lib/utils";

export interface NewsCardItem {
  id: string;
  headline: string;
  summary: string | null;
  analysis: string | null;
  url: string | null;
  imageUrl: string | null;
  source: string;
  category: string;
  publishedAt: Date | string;
}

export interface NewsCardPlayer {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  owner: OwnerTagTeam | null;
}

/** Summary text worth showing under the headline (feeds often repeat the headline or lead with a dash) */
function summaryText(item: Pick<NewsCardItem, "headline" | "summary">): string | null {
  const s = item.summary?.replace(/^[\s—–-]+/, "").trim();
  if (!s) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(s) === norm(item.headline) ? null : s;
}

export function NewsCard({ item, players, highlight, tz, compact }: { item: NewsCardItem; players: NewsCardPlayer[]; highlight?: boolean; tz: string; compact?: boolean }) {
  const summary = summaryText(item);
  const maxChips = compact ? 3 : 6;
  return (
    <article className={cn("flex gap-3 px-4 py-3", highlight && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
          <CategoryBadge category={item.category} />
          {highlight && <Badge tone="brand">Your player</Badge>}
          <time dateTime={new Date(item.publishedAt).toISOString()} title={fmtDateTime(item.publishedAt, tz)}>
            {timeAgo(item.publishedAt)}
          </time>
          <span>· {sourceLabel(item.source)}</span>
        </div>
        <h3 className="mt-1 text-[15px] font-semibold leading-5 text-ink sm:text-sm">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {item.headline}
              <ExternalLink size={12} className="ml-1 inline align-baseline text-faint" aria-label="(opens source)" />
            </a>
          ) : (
            item.headline
          )}
        </h3>
        {summary && <p className={cn("mt-1 max-w-[70ch] text-[13px] leading-[18px] text-muted", compact ? "line-clamp-2" : "line-clamp-3")}>{summary}</p>}
        {item.analysis && (
          <details className="group mt-0.5">
            <summary className="-my-1 inline-flex min-h-10 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400 [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Fantasy analysis</span>
              <span className="hidden group-open:inline">Hide analysis</span>
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="mt-0.5 max-w-[70ch] text-[13px] leading-5 text-ink/90">{item.analysis}</p>
          </details>
        )}
        {players.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {players.slice(0, maxChips).map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} title={p.owner ? `${p.fullName} · ${p.owner.name}` : `${p.fullName} · free agent`} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-sunken pl-1 pr-2.5 text-[13px] text-ink hover:bg-ink/[0.07] dark:hover:bg-white/[0.08]">
                <PlayerHeadshot player={p} size={24} />
                <span className="truncate font-semibold">{p.fullName}</span>
                <span className="shrink-0 text-muted">
                  {p.position}
                  {p.team ? ` ${p.team}` : ""}
                </span>
                <InjuryTag status={p.injuryStatus} />
                {p.owner ? (
                  <span className={cn("shrink-0 text-[12px] font-semibold", p.owner.isMine ? "text-brand-600 dark:text-brand-400" : "text-muted")}>{p.owner.abbrev}</span>
                ) : (
                  <span className="shrink-0 text-[12px] font-semibold text-win">FA</span>
                )}
              </Link>
            ))}
            {players.length > maxChips && <span className="inline-flex h-8 items-center rounded-full bg-sunken px-2.5 text-[13px] text-muted">+{players.length - maxChips} more</span>}
          </div>
        )}
      </div>
      {item.imageUrl && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" loading="lazy" className="hidden h-20 w-28 shrink-0 rounded-lg object-cover sm:block" />
      )}
    </article>
  );
}
