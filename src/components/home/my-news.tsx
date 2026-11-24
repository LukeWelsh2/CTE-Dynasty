// My players: injury alerts for my roster and the latest news about my players.
import Link from "next/link";
import { ExternalLink, HeartPulse, Newspaper } from "lucide-react";
import { Badge, InjuryTag, Panel, PlayerHeadshot } from "@/components/ui/core";
import { PlayerCardButton } from "@/components/players/player-card";
import { cn, timeAgo } from "@/lib/utils";
import { MoreLink, PanelEmpty, SubHeading } from "./bits";
import { injuryLevel } from "./logic";
import type { InjuryLite, NewsLite, NewsModule } from "./types";

function InjuryRow({ i }: { i: InjuryLite }) {
  const lvl = injuryLevel(i.player.injuryStatus);
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <PlayerCardButton playerId={i.player.id} playerName={i.player.fullName}>
        <PlayerHeadshot player={i.player} size={30} />
      </PlayerCardButton>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={`/players/${i.player.id}`} title={i.player.fullName} className="truncate text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {i.player.fullName}
          </Link>
          <InjuryTag status={i.player.injuryStatus} />
          <span className="shrink-0 text-[11px] text-muted">
            {i.player.position}
            {i.player.team ? ` · ${i.player.team}` : ""}
          </span>
        </div>
        <div className="truncate text-xs text-muted">
          {[i.player.injuryStatus, i.bodyPart, i.practice ? `Practice: ${i.practice}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {i.starting && <Badge tone={lvl === "QUESTIONABLE" ? "amber" : "red"}>Starting</Badge>}
        {i.rosterStatus !== "ACTIVE" && <Badge tone="neutral">{i.rosterStatus}</Badge>}
      </div>
    </li>
  );
}

function NewsRow({ n }: { n: NewsLite }) {
  const external = !!n.url && /^https?:\/\//i.test(n.url);
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        {n.players[0] ? (
          <PlayerCardButton playerId={n.players[0].id} playerName={n.players[0].fullName} className="mt-0.5">
            <PlayerHeadshot player={n.players[0]} size={34} />
          </PlayerCardButton>
        ) : (
          <Newspaper size={18} className="mt-1 text-muted" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          {external ? (
            <a href={n.url!} target="_blank" rel="noopener noreferrer" className="group line-clamp-3 text-sm font-semibold leading-snug text-ink hover:underline">
              {n.headline}
              <ExternalLink size={11} className="ml-1 inline align-baseline text-muted opacity-0 group-hover:opacity-100" aria-label="(opens in a new tab)" />
            </a>
          ) : (
            <Link href={n.players[0] ? `/players/${n.players[0].id}` : "/news?scope=mine"} className="line-clamp-3 text-sm font-semibold leading-snug text-ink hover:underline">
              {n.headline}
            </Link>
          )}
          {n.summary && n.summary !== n.headline && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{n.summary}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {n.players.slice(0, 3).map((p) => (
              <Link key={p.id} href={`/players/${p.id}`} className="inline-flex min-h-6 items-center font-semibold text-brand-700 hover:underline dark:text-brand-300">
                {p.fullName}
              </Link>
            ))}
            {n.category === "INJURY" && <Badge tone="red">Injury</Badge>}
            <span suppressHydrationWarning>{timeAgo(n.publishedAt)}</span>
          </div>
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
      title="My Players"
      subtitle={data.injuries.length ? `${data.injuries.length} injured${startingHurt ? ` · ${startingHurt} in your lineup` : ""}` : "No injuries on your roster"}
      className={className}
      actions={
        <div className="flex items-center gap-3">
          <MoreLink href="/injuries?scope=mine" className="hidden sm:inline-flex">
            Injuries
          </MoreLink>
          <MoreLink href="/news?scope=mine">News</MoreLink>
        </div>
      }
    >
      <div className={cn("grid gap-4", data.injuries.length > 0 && "md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
        {data.injuries.length > 0 && (
          <div className="min-w-0">
            <SubHeading right={<HeartPulse size={13} className="text-loss" aria-hidden />}>Injury alerts</SubHeading>
            <ul className="divide-y divide-line/70">
              {data.injuries.slice(0, 6).map((i) => (
                <InjuryRow key={i.player.id} i={i} />
              ))}
            </ul>
            {data.injuries.length > 6 && (
              <Link href="/injuries?scope=mine" className="mt-1 flex min-h-8 items-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                +{data.injuries.length - 6} more injured players
              </Link>
            )}
          </div>
        )}
        <div className="min-w-0">
          <SubHeading>Latest news</SubHeading>
          {data.news.length ? (
            <ul className="divide-y divide-line/70">
              {data.news.map((n) => (
                <NewsRow key={n.id} n={n} />
              ))}
            </ul>
          ) : (
            <PanelEmpty action={<MoreLink href="/news">League-wide news</MoreLink>}>No recent news about your players.</PanelEmpty>
          )}
        </div>
      </div>
    </Panel>
  );
}
