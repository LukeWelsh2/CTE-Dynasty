import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueContext } from "@/lib/league";
import { NFL_TEAMS } from "@/lib/nfl/teams";
import { EmptyState, PageHeader } from "@/components/ui/core";
import { NewsCard } from "@/components/players/news-card";
import { Pagination } from "@/components/players/pagination";
import { NewsFilterSelect } from "@/components/players/news-filters";
import { positionFilterOptions } from "@/lib/players/logic";
import { loadNewsFeed, newsHref, NEWS_PER_PAGE, parseNewsFilters, type NewsFilters } from "@/lib/players/news";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Player News" };

function Seg<T extends string>({ items, active, href }: { items: { key: T; label: string }[]; active: T; href: (k: T) => string }) {
  return (
    <div className="scroll-thin flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-panel p-1">
      {items.map((i) => (
        <Link
          key={i.key}
          href={href(i.key)}
          aria-current={active === i.key ? "page" : undefined}
          className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold", active === i.key ? "bg-brand-700 text-white dark:bg-brand-600" : "text-muted hover:bg-sunken hover:text-ink")}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getLeagueContext();
  const f = parseNewsFilters(await searchParams, ctx);
  const { entries, total, pages, myTeams } = await loadNewsFeed(ctx, f);
  const tz = ctx.settings.general.timezone;
  const page = Math.min(f.page, pages);
  const scopes: { key: NewsFilters["scope"]; label: string }[] = [
    { key: "all", label: "All news" },
    ...(ctx.myTeam
      ? [
          { key: "mine" as const, label: "My players" },
          { key: "myteams" as const, label: "My players' NFL teams" },
        ]
      : []),
  ];
  const cats: { key: "ALL" | "NEWS" | "INJURY"; label: string }[] = [
    { key: "ALL", label: "Everything" },
    { key: "NEWS", label: "News" },
    { key: "INJURY", label: "Injuries" },
  ];

  return (
    <div>
      <PageHeader
        kicker="Players"
        title="Player News"
        subtitle={`${total.toLocaleString()} item${total === 1 ? "" : "s"} · headlines and fantasy notes from ESPN, updated every few minutes`}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Seg items={scopes} active={f.scope} href={(k) => newsHref(f, { scope: k })} />
        <Seg items={cats} active={f.category ?? "ALL"} href={(k) => newsHref(f, { category: k === "ALL" ? null : k })} />
        <div className="flex w-full gap-2 sm:w-auto">
          <NewsFilterSelect
            label="Position"
            value={f.pos}
            options={positionFilterOptions(ctx.settings).map((p) => ({ value: p, label: p === "ALL" ? "All positions" : p === "DEF" ? "DST" : p }))}
            hrefs={Object.fromEntries(positionFilterOptions(ctx.settings).map((p) => [p, newsHref(f, { pos: p })]))}
          />
          <NewsFilterSelect
            label="NFL team"
            value={f.nfl ?? ""}
            options={[{ value: "", label: "All NFL teams" }, ...NFL_TEAMS.map((t) => ({ value: t.abbr, label: `${t.abbr} — ${t.city} ${t.name}` }))]}
            hrefs={Object.fromEntries([["", newsHref(f, { nfl: null })], ...NFL_TEAMS.map((t) => [t.abbr, newsHref(f, { nfl: t.abbr })])])}
          />
        </div>
      </div>
      {f.scope === "myteams" && myTeams.length > 0 && <p className="mb-2 text-xs text-muted">Teams: {myTeams.join(", ")}</p>}

      {entries.length ? (
        <div className="space-y-2">
          {entries.map((e) => (
            <NewsCard key={e.item.id} item={e.item} players={e.players} highlight={e.highlight} tz={tz} />
          ))}
          <Pagination page={page} pages={pages} total={total} perPage={NEWS_PER_PAGE} href={(p) => newsHref(f, { page: p })} />
        </div>
      ) : (
        <EmptyState title="No news matches these filters">
          {f.scope === "mine" ? "There is no recent news about your players." : "Try a different position, team or category."}{" "}
          <Link href="/news" className="link">
            Show all news
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
