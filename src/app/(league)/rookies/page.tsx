import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { ButtonLink, PageHeader, StatTile, TabLinks } from "@/components/ui/core";
import { getRookieRankingsView } from "@/lib/rookies/queries";
import { positionFilters } from "@/lib/draft/data";
import { isSuperflex } from "@/lib/rookies/logic";
import { fmtDateTime } from "@/lib/draft/time";
import { RookieRankings } from "@/components/draft/rookie-rankings";

export const metadata: Metadata = { title: "Rookie Rankings" };

export default async function RookieRankingsPage({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const classes = [ctx.league.season, ctx.league.season + 1];
  const classYear = classes.includes(Number(sp.class)) ? Number(sp.class) : classes[0];
  const view = await getRookieRankingsView(ctx.league.id, classYear, ctx.league.season, ctx.settings);
  const tz = ctx.settings.general.timezone;
  const pinned = view.rows.filter((r) => r.source === "COMMISSIONER").length;
  const risers = [...view.rows].filter((r) => r.movement > 0).sort((a, b) => b.movement - a.movement)[0];
  const fallers = [...view.rows].filter((r) => r.movement < 0).sort((a, b) => a.movement - b.movement)[0];
  const positions = positionFilters(ctx.settings, { includeDef: false }).filter((p) => p !== "K");
  return (
    <div className="space-y-3">
      <PageHeader
        kicker="Players"
        title="Rookie Rankings"
        subtitle={`League consensus for dynasty rookie drafts · ${isSuperflex(ctx.settings) ? "superflex" : "1-QB"} values · updated daily through the offseason`}
        actions={
          <ButtonLink href={`/draft/board?class=${classYear}`} size="sm" variant="secondary">
            Build my big board
          </ButtonLink>
        }
      />
      <TabLinks
        active={String(classYear)}
        tabs={classes.map((c, i) => ({ key: String(c), label: i === 0 ? `${c} class (current)` : `${c} class (next)`, href: `/rookies?class=${c}` }))}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Ranked" value={view.rows.length} sub={pinned ? `${pinned} commissioner-ranked` : "all automatic"} />
        <StatTile label="Last update" value={<span className="text-base">{view.updatedAt ? fmtDateTime(view.updatedAt, tz, { withZone: false }) : "—"}</span>} sub={view.snapshotCount ? `${view.snapshotCount} daily snapshot${view.snapshotCount === 1 ? "" : "s"}` : "no history yet"} />
        <StatTile label="Biggest riser" value={<span className="text-base">{risers ? risers.name : "—"}</span>} sub={risers ? `up ${risers.movement} to #${risers.rank}` : "no movement yet"} tone={risers ? "good" : undefined} />
        <StatTile label="Biggest faller" value={<span className="text-base">{fallers ? fallers.name : "—"}</span>} sub={fallers ? `down ${-fallers.movement} to #${fallers.rank}` : "no movement yet"} tone={fallers ? "bad" : undefined} />
      </div>
      <RookieRankings classYear={classYear} rows={view.rows} isCommish={ctx.isCommish} positions={positions} excluded={view.excluded} />
      <p className="text-xs text-muted">
        Automatic scores blend Sleeper search rank, dynasty ADP, NFL draft capital (when known), positional value{isSuperflex(ctx.settings) ? " with a superflex QB bump" : ""} and age. Movement compares with the previous day&apos;s snapshot.
      </p>
    </div>
  );
}
