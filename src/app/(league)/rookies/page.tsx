// Rookie rankings — "Who are the best rookies in this class?"
// Title (superflex / 1-QB in the kicker, how the scores are built in ⓘ), class tabs, the summary (ranked · updated ·
// biggest riser · biggest faller), then the rankings (tier sections of rows on phones, the table from md).
import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { ButtonLink, InfoButton, PageHeader, SummaryStrip, TabLinks } from "@/components/ui/core";
import { getRookieRankingsView } from "@/lib/rookies/queries";
import { positionFilters } from "@/lib/draft/data";
import { isSuperflex } from "@/lib/rookies/logic";
import { fmtDateTime } from "@/lib/draft/time";
import { RookieRankings } from "@/components/draft/rookie-rankings";
import { shortName } from "@/components/draft/bits";

export const metadata: Metadata = { title: "Rookie Rankings" };

export default async function RookieRankingsPage({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const classes = [ctx.league.season, ctx.league.season + 1];
  const classYear = classes.includes(Number(sp.class)) ? Number(sp.class) : classes[0];
  const view = await getRookieRankingsView(ctx.league.id, classYear, ctx.league.season, ctx.settings);
  const tz = ctx.settings.general.timezone;
  const pinned = view.rows.filter((r) => r.source === "COMMISSIONER").length;
  const riser = [...view.rows].filter((r) => r.movement > 0).sort((a, b) => b.movement - a.movement)[0];
  const faller = [...view.rows].filter((r) => r.movement < 0).sort((a, b) => a.movement - b.movement)[0];
  const positions = positionFilters(ctx.settings, { includeDef: false }).filter((p) => p !== "K");
  const sf = isSuperflex(ctx.settings);
  const updated = view.updatedAt ? new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(view.updatedAt)) : "—";
  return (
    <div className="space-y-4">
      <PageHeader
        kicker={`Players · ${sf ? "superflex" : "1-QB"} values`}
        className="!mb-0"
        title={
          <span className="inline-flex items-center gap-1">
            Rookie rankings
            <InfoButton title="How rookies are ranked">
              <p>League consensus for dynasty rookie drafts, updated daily through the offseason.</p>
              <p className="mt-2">
                Automatic scores blend Sleeper search rank, dynasty ADP, NFL draft capital (when known), positional value{sf ? " with a superflex QB bump" : ""} and age. Movement compares with the previous day&apos;s snapshot.
              </p>
              <p className="mt-2">A pin means the commissioner placed the player by hand; he keeps that spot when the automatic rankings refresh.</p>
            </InfoButton>
          </span>
        }
        actions={
          <ButtonLink href={`/draft/board?class=${classYear}`} size="md" variant="secondary">
            My big board
          </ButtonLink>
        }
      />
      <TabLinks
        className="!mb-0"
        active={String(classYear)}
        tabs={classes.map((c, i) => ({ key: String(c), label: i === 0 ? `${c} class` : `${c} (next)`, href: `/rookies?class=${c}` }))}
      />
      <SummaryStrip
        items={[
          { label: "Ranked", value: view.rows.length, sub: pinned ? `${pinned} by commish` : "all auto" },
          {
            label: "Updated",
            value: updated,
            sub: view.snapshotCount ? `${view.snapshotCount} snapshot${view.snapshotCount === 1 ? "" : "s"}` : "no history",
            title: view.updatedAt ? `Last update ${fmtDateTime(view.updatedAt, tz)}` : undefined,
          },
          { label: "Riser", value: riser ? `▲${riser.movement}` : "—", sub: riser ? `${shortName(riser.name, riser.position)} #${riser.rank}` : "no moves", tone: riser ? "good" : undefined, title: riser ? `${riser.name}: up ${riser.movement} to #${riser.rank}` : undefined },
          { label: "Faller", value: faller ? `▼${-faller.movement}` : "—", sub: faller ? `${shortName(faller.name, faller.position)} #${faller.rank}` : "no moves", tone: faller ? "bad" : undefined, title: faller ? `${faller.name}: down ${-faller.movement} to #${faller.rank}` : undefined },
        ]}
      />
      <RookieRankings classYear={classYear} rows={view.rows} isCommish={ctx.isCommish} positions={positions} excluded={view.excluded} />
    </div>
  );
}
