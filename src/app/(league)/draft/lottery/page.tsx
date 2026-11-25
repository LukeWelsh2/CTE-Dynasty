// Draft lottery — "Who gets the top pick, and what are my odds?"
// Summary (teams in the draw · my seed · my #1 odds · drawn or not), the draw (reveal / simulate / official run), and
// the odds matrix (sticky team column, blue heat). Rules and the order method live in ⓘ.
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, EmptyState, PageHeader, Panel, SummaryStrip, TabLinks, TeamLogo } from "@/components/ui/core";
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

  const myIdx = ctx.myTeam ? pool.findIndex((t) => t.id === ctx.myTeam!.id) : -1;
  const myTop = myIdx >= 0 ? matrix[myIdx]?.[0] ?? 0 : null;
  const pct = (p: number) => (p >= 0.9995 ? "100%" : p > 0 && p < 0.001 ? "<0.1%" : `${(p * 100).toFixed(1)}%`);
  const lotteryInfo = (
    <div className="space-y-2">
      <p>{rulesText}</p>
      <p>
        {settings.draft.rookie.lottery.teams} lottery teams draw for the top picks of the {season} rookie draft. Seeds are the pre-lottery order ({order.status === "FINAL" ? "final" : "projected"}); each cell is the chance of landing that pick.
      </p>
      {warn && <p>{warn}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader kicker={`${season} rookie draft`} title="Draft lottery" className="!mb-0" />
      <TabLinks className="!mb-0" active={String(season)} tabs={seasons.map((s) => ({ key: String(s), label: `${s} lottery`, href: `/draft/lottery?season=${s}` }))} />
      {!isLottery && (
        <Alert tone="info" icon>
          The order is set by <strong>{settings.draft.rookie.orderMethod.replaceAll("_", " ").toLowerCase()}</strong> — simulations only.
          {ctx.isCommish ? " Switch the order method to Lottery in League Settings → Draft for an official draw." : ""}
        </Alert>
      )}
      {draftStarted && <Alert tone="warn">The {draft!.name} has started — the lottery result is locked.</Alert>}
      {order.status === "NO_RESULTS" ? (
        <EmptyState title={`No ${order.basisSeason} results yet`}>The lottery pool comes from the {order.basisSeason} standings.</EmptyState>
      ) : pool.length < 2 ? (
        <EmptyState title="Not enough lottery teams">Set at least two lottery teams in League Settings → Draft.</EmptyState>
      ) : (
        <>
          <SummaryStrip
            items={[
              { label: "Teams", value: pool.length, sub: "in the draw" },
              { label: "My seed", value: myIdx >= 0 ? `#${myIdx + 1}` : "—", sub: myIdx >= 0 ? "pre-lottery" : "not in it" },
              { label: "#1 odds", value: myTop !== null ? pct(myTop) : "—", sub: myIdx >= 0 ? `${pct(odds[myIdx] ?? 0)} weight` : undefined, title: "Chance of winning the first pick" },
              { label: "Status", value: official ? "Drawn" : isLottery ? "Not yet" : "Sim", sub: official ? fmtShort(official.drawnAt, settings.general.timezone) : isLottery ? (order.status === "FINAL" ? "seeds final" : "projected") : "only" },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel title={official ? "Lottery results" : "The draw"} subtitle={official ? `Drawn ${fmtDateTime(official.drawnAt, settings.general.timezone)}` : "Revealed from the last lottery pick up to #1"} info={lotteryInfo} infoTitle="How the lottery works">
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
                myTeamId={ctx.myTeam?.id ?? null}
              />
            </Panel>
            <Panel title="Odds" subtitle={`${order.status === "FINAL" ? "Final" : "Projected"} seeds · % chance of each pick`} info={lotteryInfo} infoTitle="How the lottery works" noPad>
              <div className="scroll-thin overflow-x-auto border-t border-line/70">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th className="tbl-sticky !z-20">Team</th>
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
                      const mine = t.id === ctx.myTeam?.id;
                      return (
                        <tr key={t.id} className={cn(mine && "row-mine")}>
                          <td className="tbl-sticky">
                            <span className="flex min-w-0 items-center gap-2" title={t.name}>
                              <span className="numeral w-4 text-right text-[13px] font-semibold text-muted">{i + 1}</span>
                              <TeamLogo team={t} size={22} />
                              <span className="min-w-0 leading-tight">
                                <span className={cn("block font-semibold sm:hidden", mine && "text-brand-600 dark:text-brand-400")}>{t.abbrev}</span>
                                <span className={cn("hidden max-w-[150px] truncate font-semibold sm:block", mine && "text-brand-600 dark:text-brand-400")}>{t.name}</span>
                                {r && <span className="block text-[12px] text-muted">{`${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`}</span>}
                              </span>
                            </span>
                          </td>
                          <td className="num font-semibold">{(odds[i] * 100).toFixed(1)}%</td>
                          {matrix[i].map((p, k) => (
                            <td key={k} className="num text-[13px]" style={p >= 0.0005 ? { backgroundColor: `rgb(var(--c-accent) / ${Math.min(0.32, 0.04 + p * 0.5).toFixed(3)})` } : undefined}>
                              {p >= 0.0005 ? (p * 100).toFixed(1) : <span className="text-faint">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function fmtShort(d: string | Date, tz: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(d));
}
