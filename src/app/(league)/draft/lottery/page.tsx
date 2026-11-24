import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, EmptyState, PageHeader, Panel, TabLinks, TeamLogo } from "@/components/ui/core";
import { firstOpenDraftSeason } from "@/lib/picks";
import { computeRookieOrder } from "@/lib/draft/order";
import { lotteryProbabilities, normalizeOdds } from "@/lib/draft/logic";
import { fmtDateTime } from "@/lib/draft/time";
import { LotteryReveal } from "@/components/draft/lottery-reveal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Draft Lottery" };

export default async function LotteryPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const next = firstOpenDraftSeason(ctx.league.season, ctx.league.phase);
  const seasons = [next, next + 1];
  const season = seasons.includes(Number(sp.season)) ? Number(sp.season) : next;
  const settings = ctx.settings;
  const isLottery = settings.draft.rookie.orderMethod === "LOTTERY";
  const [order, draft] = await Promise.all([computeRookieOrder(ctx.league.id, season, settings), db.draft.findFirst({ where: { leagueId: ctx.league.id, type: "ROOKIE", season } })]);
  const teams = new Map(order.rows.map((r) => [r.teamId, r.team]));
  const official = order.lottery?.official ? order.lottery : null;
  const poolIds = official ? [...official.pool] : order.lotteryPool;
  const pool = poolIds
    .map((id) => teams.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, ownerName: null }));
  const odds = official ? official.odds : normalizeOdds(pool.length, settings.draft.rookie.lottery.odds);
  const lot = settings.draft.rookie.lottery;
  const rules = official ? { picksDrawn: official.picksDrawn ?? null, maxDropSpots: official.maxDropSpots ?? null } : { picksDrawn: lot.picksDrawn ?? null, maxDropSpots: lot.maxDropSpots ?? null };
  const matrix = lotteryProbabilities(pool.length, odds, rules);
  const rulesText = [
    rules.picksDrawn ? `The first ${Math.min(rules.picksDrawn, pool.length)} pick${rules.picksDrawn === 1 ? " is" : "s are"} drawn by weighted odds among the teams still in the pool; the rest of the lottery teams follow in pre-lottery order.` : "Every lottery pick is drawn by weighted odds among the teams still in the pool.",
    rules.maxDropSpots ? `No team falls more than ${rules.maxDropSpots} spot${rules.maxDropSpots === 1 ? "" : "s"} below its pre-lottery seed.` : rules.picksDrawn ? "" : "A team can fall as far as the last lottery pick.",
    "Non-lottery teams follow in draft order.",
  ].filter(Boolean).join(" ");
  const draftStarted = !!draft && draft.status !== "SCHEDULED";
  const canRun = isLottery && order.status !== "NO_RESULTS" && pool.length >= 2 && !draftStarted;
  const warn = !order.regularSeasonComplete ? `The ${order.basisSeason} regular season isn't over, so the lottery teams are based on the current standings.` : null;
  const rowFor = (id: string) => order.rows.find((r) => r.teamId === id);

  return (
    <div className="space-y-4">
      <PageHeader kicker="Rookie draft" title="Draft Lottery" subtitle={`${settings.draft.rookie.lottery.teams} lottery teams draw for the top picks of the ${season} rookie draft`} />
      <TabLinks active={String(season)} tabs={seasons.map((s) => ({ key: String(s), label: `${s} lottery`, href: `/draft/lottery?season=${s}` }))} />
      {!isLottery && (
        <Alert tone="info">
          This league sets its rookie order by <strong>{settings.draft.rookie.orderMethod.replaceAll("_", " ").toLowerCase()}</strong>, so there's no official lottery. You can still simulate one with the configured lottery odds.
          {ctx.isCommish ? " Switch the order method to Lottery in League Settings → Draft to run an official draw." : ""}
        </Alert>
      )}
      {draftStarted && <Alert tone="warn">The {draft!.name} has started — the lottery result is locked.</Alert>}
      {order.status === "NO_RESULTS" ? (
        <EmptyState title={`No ${order.basisSeason} results yet`}>The lottery pool comes from the {order.basisSeason} standings.</EmptyState>
      ) : pool.length < 2 ? (
        <EmptyState title="Not enough lottery teams">Set at least two lottery teams in League Settings → Draft.</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title={official ? "Lottery results" : "The draw"} subtitle={official ? `Drawn ${fmtDateTime(official.drawnAt, settings.general.timezone)}` : "Picks are revealed from the last lottery pick up to #1"}>
            <LotteryReveal
              leagueId={ctx.league.id}
              season={season}
              pool={pool}
              odds={odds}
              official={official?.result ?? null}
              drawnAt={official?.drawnAt ?? null}
              canRun={canRun}
              canClear={isLottery && !draftStarted}
              warn={warn}
              isCommish={ctx.isCommish}
              rules={rules}
              liveReveal={lot.liveReveal !== false}
            />
          </Panel>
          <Panel title="Odds" subtitle={`${order.status === "FINAL" ? "Final" : "Projected"} pre-lottery seeds · chance of landing each pick`} noPad>
            <div className="overflow-x-auto">
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th className="num">Seed</th>
                    <th>Team</th>
                    <th className="num hidden sm:table-cell">Record</th>
                    <th className="num">Odds</th>
                    {pool.map((_, k) => (
                      <th key={k} className="num">
                        #{k + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pool.map((t, i) => {
                    const r = rowFor(t.id);
                    return (
                      <tr key={t.id} className={cn(t.id === ctx.myTeam?.id && "bg-gold-300/10")}>
                        <td className="num font-display text-lg font-bold">{i + 1}</td>
                        <td className="max-w-[180px]">
                          <span className="flex items-center gap-1.5">
                            <TeamLogo team={t} size={20} />
                            <span className="truncate font-semibold">{t.name}</span>
                          </span>
                        </td>
                        <td className="num hidden text-xs sm:table-cell">{r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : "—"}</td>
                        <td className="num font-bold">{(odds[i] * 100).toFixed(1)}%</td>
                        {matrix[i].map((p, k) => (
                          <td key={k} className="num text-xs" style={{ backgroundColor: `rgb(245 179 1 / ${Math.min(0.55, p * 0.9)})` }}>
                            {p >= 0.0005 ? `${(p * 100).toFixed(1)}` : "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line px-3 py-2 text-xs text-muted">{rulesText}</p>
          </Panel>
        </div>
      )}
    </div>
  );
}
