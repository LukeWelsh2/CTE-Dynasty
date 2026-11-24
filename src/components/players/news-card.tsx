// One news item: headline, summary, fantasy analysis (expandable, no JS), source, time, linked player chips.
import Link from "next/link";
import { ExternalLink } from "lucide-react";
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

export function NewsCard({ item, players, highlight, tz, compact }: { item: NewsCardItem; players: NewsCardPlayer[]; highlight?: boolean; tz: string; compact?: boolean }) {
  return (
    <article
      className={cn(
        "flex gap-3 rounded-lg border border-line bg-panel p-3 shadow-panel",
        highlight && "border-l-4 border-l-gold-500 bg-gold-300/5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <CategoryBadge category={item.category} />
          {highlight && <Badge tone="gold">Your player</Badge>}
          <time dateTime={new Date(item.publishedAt).toISOString()} title={fmtDateTime(item.publishedAt, tz)}>
            {timeAgo(item.publishedAt)}
          </time>
          <span>· {sourceLabel(item.source)}</span>
        </div>
        <h3 className={cn("mt-1 font-semibold leading-snug text-ink", compact ? "text-sm" : "text-[15px]")}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {item.headline}
              <ExternalLink size={11} className="ml-1 inline align-baseline text-muted" aria-label="(opens source)" />
            </a>
          ) : (
            item.headline
          )}
        </h3>
        {item.summary && <p className="mt-1 text-sm text-muted">{item.summary}</p>}
        {item.analysis && (
          <details className="group mt-1.5 text-sm">
            <summary className="cursor-pointer list-none text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
              <span className="group-open:hidden">Fantasy analysis ▸</span>
              <span className="hidden group-open:inline">Hide analysis ▾</span>
            </summary>
            <p className="mt-1 leading-relaxed text-ink/90">{item.analysis}</p>
          </details>
        )}
        {players.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {players.slice(0, 8).map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} className="chip max-w-full hover:bg-sunken">
                <PlayerHeadshot player={p} size={18} />
                <span className="truncate font-semibold">{p.fullName}</span>
                <span className="text-muted">
                  {p.position}
                  {p.team ? ` ${p.team}` : ""}
                </span>
                <InjuryTag status={p.injuryStatus} />
                {p.owner ? (
                  <span className={cn("rounded px-1 text-[10px] font-bold", p.owner.isMine ? "bg-gold-500 text-brand-950" : "bg-sunken text-muted")} title={p.owner.name}>
                    {p.owner.abbrev}
                  </span>
                ) : (
                  <span className="rounded bg-green-100 px-1 text-[10px] font-bold text-green-800 dark:bg-green-900/40 dark:text-green-300">FA</span>
                )}
              </Link>
            ))}
            {players.length > 8 && <span className="chip text-muted">+{players.length - 8} more</span>}
          </div>
        )}
      </div>
      {item.imageUrl && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" loading="lazy" className="hidden h-20 w-28 shrink-0 rounded-md object-cover sm:block" />
      )}
    </article>
  );
}
