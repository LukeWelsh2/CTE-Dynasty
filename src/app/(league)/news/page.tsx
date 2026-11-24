// Player news — "What happened to my players (and everyone else)?" Scope as a segmented control (All · My players ·
// Their NFL teams), category chips and position / team pickers, then one card of hairline rows (headline, 2-line
// summary, fantasy analysis behind a tap, linked player chips; my players get the blue edge).
import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueContext } from "@/lib/league";
import { NFL_TEAMS } from "@/lib/nfl/teams";
import { Chip, EmptyState, InfoButton, PageHeader, SegmentedLinks } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { NewsCard } from "@/components/players/news-card";
import { Pagination } from "@/components/players/pagination";
import { NewsFilterSelect } from "@/components/players/news-filters";
import { positionFilterOptions } from "@/lib/players/logic";
import { loadNewsFeed, newsHref, NEWS_PER_PAGE, parseNewsFilters, type NewsFilters } from "@/lib/players/news";

export const metadata: Metadata = { title: "Player News" };

export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getLeagueContext();
  const f = parseNewsFilters(await searchParams, ctx);
  const { entries, total, pages, myTeams } = await loadNewsFeed(ctx, f);
  const tz = ctx.settings.general.timezone;
  const page = Math.min(f.page, pages);
  const scopes: { key: NewsFilters["scope"]; label: string }[] = [
    { key: "all", label: "All" },
    ...(ctx.myTeam
      ? [
          { key: "mine" as const, label: "My players" },
          { key: "myteams" as const, label: "Their teams" },
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
        title={
          <span className="inline-flex items-center gap-1.5">
            Player news
            <InfoButton title="Player news" size={18}>
              <p>Headlines and fantasy notes from ESPN, checked every few minutes. &quot;My players&quot; shows news about your roster; &quot;Their teams&quot; adds news about your players&apos; NFL teams.</p>
            </InfoButton>
          </span>
        }
        subtitle={`${total.toLocaleString()} item${total === 1 ? "" : "s"}`}
      />
      <div className="mb-3 space-y-2.5">
        {scopes.length > 1 && <SegmentedLinks options={scopes.map((s) => ({ key: s.key, label: s.label, href: newsHref(f, { scope: s.key }) }))} active={f.scope} full ariaLabel="News scope" scroll={false} />}
        <ScrollRow aria-label="Category" className="-mx-3 scroll-px-3 gap-2 px-3 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {cats.map((c) => (
            <Chip key={c.key} href={newsHref(f, { category: c.key === "ALL" ? null : c.key })} active={(f.category ?? "ALL") === c.key} scroll={false}>
              {c.label}
            </Chip>
          ))}
        </ScrollRow>
        <div className="flex gap-2">
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
      {f.scope === "myteams" && myTeams.length > 0 && <p className="mb-2 truncate px-1 text-[13px] text-muted">Teams: {myTeams.join(", ")}</p>}

      {entries.length ? (
        <>
          <div className="card divide-y divide-line/70 overflow-hidden">
            {entries.map((e) => (
              <NewsCard key={e.item.id} item={e.item} players={e.players} highlight={e.highlight} tz={tz} />
            ))}
          </div>
          <Pagination page={page} pages={pages} total={total} perPage={NEWS_PER_PAGE} href={(p) => newsHref(f, { page: p })} />
        </>
      ) : (
        <EmptyState title="No news matches these filters">
          {f.scope === "mine" ? "No recent news about your players." : "Try a different position, team or category."}{" "}
          <Link href="/news" className="link">
            Show all news
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
