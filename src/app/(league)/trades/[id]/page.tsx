import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleDashed, MessageSquare, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, Badge, ButtonLink, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
import { TradesNav } from "@/components/trades/trade-nav";
import { AssetLine, StatusBadge, TradeTimeline } from "@/components/trades/trade-card";
import { CancelOfferButton, CommishTradeButton, RespondButtons, TradeLiveRefresh, VoteButtons } from "@/components/trades/trade-actions";
import { CapLine, ComponentList, FairnessMeter } from "@/components/trades/value-display";
import { canViewTrade, loadTradeViews, tradeViewInclude } from "@/lib/trades/views";
import { acceptInfoFor } from "@/lib/trades/respond";
import { tradeResults } from "@/lib/trades/results";
import { canVoteOnTrade, tradeWindow } from "@/lib/trades/rules";
import { draftHeldSeasons, rookieDraftsText } from "@/lib/trades/execute";
import { lockedPickSeasons } from "@/lib/draft/trading";
import { STATUS_META, fmtWhen, timeLeft, type TradeStatusKey } from "@/lib/trades/format";
import { OUTLOOK_LABEL, fmtValue } from "@/lib/value/model";
import { cn, fmtPts } from "@/lib/utils";

export const metadata = { title: "Trade" };

export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLeagueContext();
  const { league, settings, myTeam } = ctx;
  const tz = settings.general.timezone;
  const row = await db.trade.findUnique({ where: { id }, include: tradeViewInclude });
  if (!row || row.leagueId !== league.id) notFound();
  if (!canViewTrade(row, { teamId: myTeam?.id ?? null, isCommish: ctx.isCommish })) notFound();
  const [trade] = await loadTradeViews(league.id, [row], { settings, season: ctx.season, viewerTeamId: myTeam?.id });
  const ev = trade.evaluation;
  const myId = myTeam?.id ?? null;
  const involved = !!myId && trade.teams.some((t) => t.teamId === myId);
  const meInTrade = trade.teams.find((t) => t.teamId === myId);
  const settled = trade.status === "COMPLETED" || trade.status === "REVERSED";
  const window = tradeWindow(settings, league.phase, ctx.week);

  const [results, acceptInfo, resolver, parent] = await Promise.all([
    trade.status === "COMPLETED" ? tradeResults(league.id, [{ id: trade.id, season: trade.season, week: trade.week, assets: row.assets }], settings) : Promise.resolve(null),
    trade.status === "PROPOSED" && meInTrade && !meInTrade.accepted && myId !== trade.proposerTeamId
      ? acceptInfoFor(trade, myId!, { leagueId: league.id, season: ctx.season, phase: league.phase, week: ctx.week, settings })
      : Promise.resolve(null),
    trade.resolvedById ? db.user.findUnique({ where: { id: trade.resolvedById }, select: { name: true } }) : Promise.resolve(null),
    trade.parentTradeId ? db.trade.findUnique({ where: { id: trade.parentTradeId }, select: { id: true, status: true, createdAt: true, teams: { select: { teamId: true } } } }) : Promise.resolve(null),
  ]);
  // picks of a rookie draft that is under way (draft.rookie.tradingDuringDraft off) can't change hands: an accepted
  // trade waits for the draft (trades/jobs.ts settleReviewedTrade, DRAFT_LOCKED; approval is refused) and a completed
  // one can't be reversed until it's over (execute.ts reverseTrade)
  const checkHolds = (trade.status === "ACCEPTED" || (trade.status === "COMPLETED" && ctx.isCommish)) && trade.assets.some((a) => a.type === "PICK");
  const heldSeasons = checkHolds ? draftHeldSeasons(trade.assets, await lockedPickSeasons(league.id, settings)) : [];
  const reverseHold = trade.status === "COMPLETED" && heldSeasons.length ? `Can't be reversed while ${rookieDraftsText(heldSeasons)} ${heldSeasons.length === 1 ? "is" : "are"} under way` : null;
  const reviewOver = !!trade.reviewEndsAt && trade.reviewEndsAt.getTime() <= Date.now();
  const draftWait = trade.status === "ACCEPTED" && heldSeasons.length ? `Waiting for ${rookieDraftsText(heldSeasons)} to finish` : null;
  const heldPicks = `${heldSeasons.join(" and ")} picks can't change hands while ${rookieDraftsText(heldSeasons)} ${heldSeasons.length === 1 ? "is" : "are"} under way`;
  const viewer = { teamId: myId, isCommish: ctx.isCommish };
  // linked offers are only shown when this viewer could open them (private offers stay private)
  const parentVisible = parent && canViewTrade(parent, viewer) ? parent : null;
  const counters = trade.counters.filter((c) => canViewTrade({ status: c.status, teams: trade.teams }, viewer));
  const maxValue = Math.max(10, ...trade.assets.map((a) => a.value));
  const multi = trade.teams.length > 2;
  const nameOf = new Map(trade.teams.map((t) => [t.teamId, t.name]));
  const title = trade.teams.map((t) => t.name).join(multi ? " · " : " ⇄ ");

  // status-specific actions for this viewer
  const actions: React.ReactNode[] = [];
  if (trade.status === "PROPOSED") {
    if (meInTrade && !meInTrade.accepted && myId !== trade.proposerTeamId && window.open)
      actions.push(<RespondButtons key="respond" tradeId={trade.id} dropsNeeded={acceptInfo?.dropsNeeded ?? 0} capOverBy={acceptInfo?.capOverBy ?? 0} candidates={acceptInfo?.candidates ?? []} />);
    if (myId === trade.proposerTeamId) actions.push(<CancelOfferButton key="cancel" tradeId={trade.id} />);
  }
  // voting closes when the review ends (voteTradeAction), even if the trade then waits for a rookie draft
  if (trade.status === "ACCEPTED" && trade.reviewEndsAt && !reviewOver && canVoteOnTrade(settings, trade.teams.map((t) => t.teamId), myId))
    actions.push(<VoteButtons key="vote" tradeId={trade.id} mine={trade.votes.mine} approve={trade.votes.approve} veto={trade.votes.veto} required={trade.votes.required} showCounts={settings.commissioner.publicTradeVotes || ctx.isCommish} />);
  if (ctx.isCommish) {
    if (trade.status === "ACCEPTED") actions.push(<CommishTradeButton key="ap" tradeId={trade.id} kind="approve" />, <CommishTradeButton key="ve" tradeId={trade.id} kind="veto" />);
    if (trade.status === "PROPOSED") actions.push(<CommishTradeButton key="fc" tradeId={trade.id} kind="force" />, <CommishTradeButton key="ve" tradeId={trade.id} kind="veto" />);
    if (trade.status === "COMPLETED")
      actions.push(
        reverseHold ? (
          <span key="rv" className="self-center text-xs font-semibold text-amber-700 dark:text-amber-300">
            {reverseHold}.
          </span>
        ) : (
          <CommishTradeButton key="rv" tradeId={trade.id} kind="reverse" />
        ),
      );
  }

  const events: { label: string; at: Date | null; tone: "good" | "bad" | "pending"; note?: string | null }[] = [
    { label: `Proposed by ${nameOf.get(trade.proposerTeamId)}`, at: trade.createdAt, tone: "good" },
    ...trade.teams
      .filter((t) => t.teamId !== trade.proposerTeamId)
      .map((t) => ({
        label: t.accepted ? `${t.name} accepted` : t.respondedAt ? `${t.name} responded` : `Waiting on ${t.name}`,
        at: t.respondedAt,
        tone: (t.accepted ? "good" : t.respondedAt ? "bad" : "pending") as "good" | "bad" | "pending",
      })),
  ];
  if (trade.status === "ACCEPTED") {
    events.push({ label: trade.reviewEndsAt ? (reviewOver ? "League review ended" : `League review ends (${timeLeft(trade.reviewEndsAt)})`) : "Awaiting commissioner approval", at: trade.reviewEndsAt, tone: reviewOver ? "good" : "pending" });
    if (draftWait && (reviewOver || !trade.reviewEndsAt)) events.push({ label: draftWait, at: null, tone: "pending" });
  }
  if (trade.completedAt) events.push({ label: "Trade processed", at: trade.completedAt, tone: "good", note: trade.status === "COMPLETED" ? trade.resolutionNote : null });
  if (["REJECTED", "CANCELLED", "VETOED", "EXPIRED", "COUNTERED", "REVERSED"].includes(trade.status))
    events.push({ label: STATUS_META[trade.status as TradeStatusKey].label + (resolver ? ` by ${resolver.name}` : ""), at: trade.updatedAt, tone: "bad", note: trade.resolutionNote });

  return (
    <div>
      <TradeLiveRefresh leagueId={league.id} />
      <PageHeader
        kicker={
          <span className="inline-flex items-center gap-2">
            <Link href="/trades" className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeft size={12} /> Trade Center
            </Link>
          </span>
        }
        title={title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={trade.status} /> {trade.season} · week {trade.week} · proposed {fmtWhen(trade.createdAt, tz, { withYear: true })}
          </span>
        }
        actions={
          involved && trade.status === "PROPOSED" && myId !== trade.proposerTeamId ? (
            <ButtonLink href={`/trades/new?counter=${trade.id}`} variant="secondary" size="sm">
              Counter offer
            </ButtonLink>
          ) : undefined
        }
      />
      <TradesNav active="center" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />
      <div className="mb-3">
        <TradeTimeline trade={trade} tz={tz} />
      </div>
      {acceptInfo?.errors.length ? <Alert tone="error" className="mb-3">{acceptInfo.errors.join(" ")}</Alert> : null}
      {trade.status === "PROPOSED" && meInTrade && !meInTrade.accepted && !window.open && <Alert tone="warn" className="mb-3">{window.reason}</Alert>}
      {draftWait && (
        <Alert tone="info" className="mb-3">
          {reviewOver || !trade.reviewEndsAt ? (
            <>
              <b>{draftWait}.</b> {reviewOver ? `The league review is over, but ${heldPicks}: the trade goes through once it's complete.` : `${heldPicks}, so the commissioner can approve this trade once it's complete.`}
            </>
          ) : (
            `${heldPicks}. If it's still going when the review ends, the trade waits for it to finish.`
          )}
        </Alert>
      )}
      {ctx.isCommish && involved && trade.status === "ACCEPTED" && settings.trades.reviewType === "COMMISSIONER" && (
        <Alert tone="info" className="mb-3">You're a party to this trade. If you approve it yourself, the approval is recorded in the commissioner audit log for the league to see.</Alert>
      )}

      {actions.length > 0 && (
        // phones: actions first (the sidebar copy sits below the assets)
        <Panel title="Actions" className="mb-4 lg:hidden">
          <div className="flex flex-wrap gap-2">{actions}</div>
          {trade.status === "PROPOSED" && trade.expiresAt && <p className="mt-2 text-xs text-muted">Offer expires {fmtWhen(trade.expiresAt, tz)} ({timeLeft(trade.expiresAt)}).</p>}
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className={cn("grid gap-4", multi ? "xl:grid-cols-3" : "md:grid-cols-2")}>
            {trade.teams.map((t) => {
              const incoming = trade.assets.filter((a) => a.toTeamId === t.teamId);
              const evT = ev?.teams.find((x) => x.teamId === t.teamId);
              return (
                <Panel
                  key={t.teamId}
                  title={
                    <span className="flex items-center gap-2 normal-case">
                      <TeamLogo team={t} size={22} /> <span className="truncate">{t.name} receives</span>
                    </span>
                  }
                  subtitle={`${t.record ?? ""}${t.managerName ? ` · ${t.managerName}` : ""}${evT ? ` · ${OUTLOOK_LABEL[evT.outlook]}` : ""}`}
                  actions={evT ? <span className="font-display text-xl font-bold tabular-nums">{fmtValue(evT.received)}</span> : undefined}
                >
                  {incoming.length ? (
                    <div className="divide-y divide-line/60">
                      {incoming.map((a) => {
                        const res = results?.players.get(`${trade.id}:${a.player?.id}`);
                        const pk = a.pick ? results?.picks.get(a.pick.id) : undefined;
                        return (
                          <AssetLine
                            key={a.id}
                            asset={a}
                            maxValue={maxValue}
                            fromName={multi ? nameOf.get(a.fromTeamId) : undefined}
                            extra={
                              <>
                                {a.type === "PLAYER" && a.rosPoints !== undefined && !settled && (
                                  <div className="text-[11px] text-muted">Rest of season: {fmtPts(a.rosPoints, 1)} projected pts</div>
                                )}
                                <ComponentList components={a.components} className="mt-1" />
                                {res && (
                                  <div className="mt-1 rounded bg-sunken px-2 py-1 text-[11px]">
                                    <b className="text-ink">{fmtPts(res.started, 1)}</b> pts as a starter for {t.name} ({res.startedWeeks} wk{res.startedWeeks === 1 ? "" : "s"}) · {fmtPts(res.total, 1)} total since the trade
                                    {res.currentTeamId !== t.teamId && <span className="ml-1 text-muted">· {res.currentTeamId ? "since moved on" : "since released"}</span>}
                                  </div>
                                )}
                                {pk && (
                                  <div className="mt-1 rounded bg-sunken px-2 py-1 text-[11px]">
                                    {pk.used && pk.player ? (
                                      <>
                                        Used{pk.slot ? ` at ${pk.slot}` : ""} on{" "}
                                        <Link href={`/players/${pk.player.id}`} className="link font-semibold">
                                          {pk.player.fullName}
                                        </Link>{" "}
                                        ({pk.player.position})
                                      </>
                                    ) : (
                                      <>Not used yet</>
                                    )}
                                  </div>
                                )}
                              </>
                            }
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Nothing — roster relief only.</p>
                  )}
                  {t.drops.length > 0 && (
                    <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
                      Drops to make room: <b className="text-ink">{t.drops.map((d) => `${d.fullName} (${d.position})`).join(", ")}</b>
                    </p>
                  )}
                </Panel>
              );
            })}
          </div>

          {trade.status === "COMPLETED" && results && (
            <Panel title="How it's going" subtitle="Fantasy points received players have scored as starters for their new teams since the trade">
              <div className="grid gap-3 sm:grid-cols-2">
                {trade.teams.map((t) => (
                  <div key={t.teamId} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                    <TeamLogo team={t} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{t.name}</div>
                      <div className="text-xs text-muted">starter points from acquired players</div>
                    </div>
                    <div className="font-display text-2xl font-bold tabular-nums">{fmtPts(results.teamTotals.get(`${trade.id}:${t.teamId}`) ?? 0, 1)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {trade.message && (
            <Panel title="Message">
              <p className="flex items-start gap-2 text-sm italic text-ink">
                <MessageSquare size={15} className="mt-0.5 shrink-0 text-muted" />“{trade.message}”
              </p>
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          {actions.length > 0 && (
            <Panel title="Actions" className="hidden lg:block">
              <div className="flex flex-wrap gap-2">{actions}</div>
              {trade.status === "PROPOSED" && trade.expiresAt && <p className="mt-2 text-xs text-muted">Offer expires {fmtWhen(trade.expiresAt, tz)} ({timeLeft(trade.expiresAt)}).</p>}
            </Panel>
          )}
          {ev && (
            <Panel title="Trade evaluation" subtitle={trade.evaluationSource === "snapshot" ? "Values at the time of the trade" : "Live values · each asset for the team receiving it"}>
              <FairnessMeter teams={ev.teams.map((t) => ({ teamId: t.teamId, name: t.name, received: t.received, net: t.net, outlook: t.outlook }))} fairness={ev.fairness} verdict={ev.verdict} tone={ev.verdictTone} />
              <table className="tbl tbl-compact mt-3">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th className="num">Raw</th>
                    <th className="num" title="Consolidation adjustment">Adj.</th>
                    <th className="num">Gets</th>
                    <th className="num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.teams.map((t) => (
                    <tr key={t.teamId}>
                      <td className="max-w-[110px] truncate font-semibold">{t.name}</td>
                      <td className="num">{fmtValue(t.receivedRaw)}</td>
                      <td className="num text-muted">{t.consolidation >= 0 ? "+" : ""}{fmtValue(t.consolidation)}</td>
                      <td className="num font-bold">{fmtValue(t.received)}</td>
                      <td className={cn("num font-semibold", t.net >= 0 ? "text-win" : "text-loss")}>{t.net >= 0 ? "+" : ""}{fmtValue(t.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ev.warnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {ev.warnings.map((w) => (
                    <li key={w} className="text-xs text-amber-700 dark:text-amber-300">
                      • {w}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {ev && (settled || trade.status === "PROPOSED" || trade.status === "ACCEPTED") && ev.teams.some((t) => (t.cap && settings.salaryCap.enabled) || t.roster) && (
            <Panel title={settings.salaryCap.enabled ? "Cap & roster impact" : "Roster impact"} subtitle={settled ? "At the time of the trade" : "If processed now"}>
              <ul className="space-y-2">
                {ev.teams.map((t) => (
                  <li key={t.teamId} className="text-xs">
                    <div className="font-semibold text-ink">{t.name}</div>
                    {t.cap && settings.salaryCap.enabled && <CapLine before={t.cap.before} after={t.cap.after} cap={t.cap.cap} label={`${trade.season}`} />}
                    {t.cap && settings.salaryCap.enabled && t.cap.nextBefore !== t.cap.nextAfter && (
                      <div>
                        <CapLine before={t.cap.nextBefore} after={t.cap.nextAfter} cap={t.cap.nextCap} label={`${trade.season + 1}`} />
                      </div>
                    )}
                    {t.roster && (
                      <div className="text-muted">
                        Active roster {t.roster.activeBefore} → <b className={cn("text-ink", t.roster.overflow > 0 && t.roster.activeAfter > t.roster.activeBefore && "text-loss")}>{t.roster.activeAfter}</b> / {t.roster.max}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {trade.reviewEndsAt && (
            <Panel title="League vote" subtitle={`${trade.votes.required} veto votes block the trade`}>
              <div className="flex items-center gap-3 text-sm">
                <Badge tone="red">{trade.votes.veto} veto</Badge>
                {(settings.commissioner.publicTradeVotes || ctx.isCommish) && <Badge tone="green">{trade.votes.approve} approve</Badge>}
                <span className="text-xs text-muted">{trade.status === "ACCEPTED" ? `Review ${timeLeft(trade.reviewEndsAt)}` : `Review ended ${fmtWhen(trade.reviewEndsAt, tz)}`}</span>
              </div>
              {(settings.commissioner.publicTradeVotes || ctx.isCommish) && trade.votes.list.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {trade.votes.list.map((v) => (
                    <li key={v.teamId} className="flex justify-between">
                      <span>{v.teamName}</span>
                      <span className={v.vote === "VETO" ? "font-semibold text-loss" : "font-semibold text-win"}>{v.vote === "VETO" ? "Veto" : "Approve"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel title="Timeline">
            <ol className="space-y-2">
              {events.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {e.tone === "good" ? <CheckCircle2 size={14} className="mt-px shrink-0 text-win" /> : e.tone === "bad" ? <XCircle size={14} className="mt-px shrink-0 text-loss" /> : <CircleDashed size={14} className="mt-px shrink-0 text-gold-500" />}
                  <div>
                    <div className="font-semibold text-ink">{e.label}</div>
                    {e.at && <div className="text-muted">{fmtWhen(e.at, tz, { withYear: true })}</div>}
                    {e.note && e.note !== e.label && <div className="text-muted">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
            {(parentVisible || counters.length > 0) && (
              <div className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
                {parentVisible && (
                  <div>
                    Counter to{" "}
                    <Link href={`/trades/${parentVisible.id}`} className="link">
                      the original offer
                    </Link>{" "}
                    ({STATUS_META[parentVisible.status as TradeStatusKey]?.label})
                  </div>
                )}
                {counters.map((c) => (
                  <div key={c.id}>
                    Countered with{" "}
                    <Link href={`/trades/${c.id}`} className="link">
                      a new offer
                    </Link>{" "}
                    ({STATUS_META[c.status as TradeStatusKey]?.label}) · {fmtWhen(c.createdAt, tz)}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
