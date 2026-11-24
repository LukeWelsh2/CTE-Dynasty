// My players: injuries on my roster (3 shown) and the latest headlines about my players (3 shown, headline only —
// the summary is one tap away on the article / player page).
import Link from "next/link";
import { ExternalLink, Newspaper } from "lucide-react";
import { Badge, InjuryTag, Panel, PlayerHeadshot, SeeAll } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { PlayerCardButton } from "@/components/players/player-card";
import { cn, timeAgo } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
import { injuryLevel } from "./logic";
import type { InjuryLite, NewsLite, NewsModule } from "./types";

function InjuryRow({ i }: { i: InjuryLite }) {
  const lvl = injuryLevel(i.player.injuryStatus);
  return (
    <li className="flex min-h-[52px] items-center gap-3 px-4 py-2">
      <PlayerCardButton playerId={i.player.id} playerName={i.player.fullName}>
        <PlayerHeadshot player={i.player} size={32} />
      </PlayerCardButton>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={`/players/${i.player.id}`} title={i.player.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline sm:text-sm">
            {i.player.fullName}
          </Link>
          <InjuryTag status={i.player.injuryStatus} />
        </div>
        <div className="truncate text-[13px] leading-[18px] text-muted">
          {[i.player.position + (i.player.team ? ` · ${i.player.team}` : ""), i.bodyPart, i.practice ? `Practice: ${i.practice}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {i.starting && <Badge tone={lvl === "QUESTIONABLE" ? "amber" : "red"}>Starting</Badge>}
        {i.rosterStatus !== "ACTIVE" && <Badge tone="neutral">{i.rosterStatus}</Badge>}
      </div>
    </li>
  );
}

/** Headline-only news row (the summary lives on the article / player page). */
function NewsRow({ n }: { n: NewsLite }) {
  const external = !!n.url && /^https?:\/\//i.test(n.url);
  const p = n.players[0];
  const headline = (
    <span className="line-clamp-2 text-[15px] font-semibold leading-5 text-ink group-hover:underline sm:text-sm">
      {n.headline}
      {external && <ExternalLink size={11} className="ml-1 inline align-baseline text-muted" aria-label="(opens in a new tab)" />}
    </span>
  );
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      {p ? (
        <PlayerCardButton playerId={p.id} playerName={p.fullName} className="mt-0.5">
          <PlayerHeadshot player={p} size={32} />
        </PlayerCardButton>
      ) : (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken text-muted" aria-hidden>
          <Newspaper size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {external ? (
          <a href={n.url!} target="_blank" rel="noopener noreferrer" className="group block">
            {headline}
          </a>
        ) : (
          <Link href={p ? `/players/${p.id}` : "/news?scope=mine"} className="group block">
            {headline}
          </Link>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
          {n.category === "INJURY" && <Badge tone="red">Injury</Badge>}
          <span className="truncate">
            {n.players
              .slice(0, 2)
              .map((x) => x.fullName)
              .join(", ")}
          </span>
          <span className="shrink-0" suppressHydrationWarning>
            · {timeAgo(n.publishedAt)}
          </span>
        </div>
      </div>
    </li>
  );
}

export function MyNews({ data, className }: { data: NewsModule; className?: string }) {
  if (!data.hasTeam) return null;
  const startingHurt = data.injuries.filter((i) => i.starting).length;
  return (
    <Panel
      title="My players"
      subtitle={data.injuries.length ? `${data.injuries.length} injured${startingHurt ? ` · ${startingHurt} starting` : ""}` : "No injuries"}
      className={className}
      noPad
      actions={
        <div className="flex items-center gap-3">
          <MoreLink href="/injuries?scope=mine" className="hidden sm:inline-flex">
            Injuries
          </MoreLink>
          <MoreLink href="/news?scope=mine">News</MoreLink>
        </div>
      }
    >
      <div className={cn("grid", data.injuries.length > 0 && "md:grid-cols-2 md:divide-x md:divide-line/70")}>
        {data.injuries.length > 0 && (
          <div className="min-w-0 border-t border-line/70">
            <h3 className="eyebrow px-4 pb-1 pt-3">Injuries</h3>
            <ShowMore as="ul" initial={3} className="divide-y divide-line/70" moreLabel={data.injuries.length > 3 ? `Show ${Math.min(6, data.injuries.length) - 3} more` : undefined}>
              {data.injuries.slice(0, 6).map((i) => (
                <InjuryRow key={i.player.id} i={i} />
              ))}
            </ShowMore>
            {data.injuries.length > 6 && <SeeAll href="/injuries?scope=mine">All {data.injuries.length} injured players</SeeAll>}
          </div>
        )}
        <div className="min-w-0 border-t border-line/70">
          <h3 className="eyebrow px-4 pb-1 pt-3">News</h3>
          {data.news.length ? (
            <ShowMore as="ul" initial={3} className="divide-y divide-line/70">
              {data.news.map((n) => (
                <NewsRow key={n.id} n={n} />
              ))}
            </ShowMore>
          ) : (
            <div className="px-4 pb-4">
              <PanelEmpty action={<MoreLink href="/news">League-wide news</MoreLink>}>No recent news about your players.</PanelEmpty>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
