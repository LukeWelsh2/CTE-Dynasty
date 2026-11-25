// Trade page — "What is in this deal, is it fair, and what do I need to do?"
// Header card: both teams with the value each gets, the verdict + fairness bar and where the trade stands; then the
// viewer's actions, what each side receives (value breakdown behind a tap), and evaluation / cap / vote / timeline.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, CheckCircle2, ChevronDown, CircleDashed, MessageSquare, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, ButtonLink, CompareBar, ListRow, Meter, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
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
  const title = trade.teams.map((t) => t.abbrev || t.name).join(multi ? " · " : " ⇄ ");

  // status-specific actions for this viewer
  const actions: React.ReactNode[] = [];
  if (trade.status === "PROPOSED") {
    if (meInTrade && !meInTrade.accepted && myId !== trade.proposerTeamId && window.open)
      actions.push(
        <RespondButtons
          key="respond"
          tradeId={trade.id}
          dropsNeeded={acceptInfo?.dropsNeeded ?? 0}
          capOverBy={acceptInfo?.capOverBy ?? 0}
          capLimit={acceptInfo?.capLimit ?? null}
          capLimitLabel={acceptInfo?.capLimitLabel}
          capBefore={acceptInfo?.capBefore}
          capAfter={acceptInfo?.capAfter}
          candidates={acceptInfo?.candidates ?? []}
        />,
      );
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
          <span key="rv" className="self-center text-[13px] font-semibold text-amber-700 dark:text-amber-300">
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

  const two = trade.teams.length === 2;
  const showVotes = settings.commissioner.publicTradeVotes || ctx.isCommish;
  const actionsBody = (
    <>
      <div className="flex flex-wrap gap-2">{actions}</div>
      {trade.status === "PROPOSED" && trade.expiresAt && (
        <p className="mt-2 text-[13px] text-muted">
          Expires {fmtWhen(trade.expiresAt, tz)} · {timeLeft(trade.expiresAt)}
        </p>
      )}
    </>
  );

  return (
    <div>
      <TradeLiveRefresh leagueId={league.id} />
      <PageHeader
        kicker={
          <Link href="/trades" className="-my-2 inline-flex min-h-8 items-center gap-1 hover:underline">
            <ArrowLeft size={13} /> Trades
          </Link>
        }
        title={title}
        subtitle={
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <StatusBadge status={trade.status} />
            <span>
              {trade.season} · Wk {trade.week} · proposed {fmtWhen(trade.createdAt, tz, { withYear: true })}
            </span>
          </span>
        }
        actions={
          involved && trade.status === "PROPOSED" && myId !== trade.proposerTeamId ? (
            <ButtonLink href={`/trades/new?counter=${trade.id}`} variant="secondary">
              Counter offer
            </ButtonLink>
          ) : undefined
        }
      />
      <TradesNav active="center" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />

      {/* the deal at a glance: who gets how much value, the verdict and where the trade stands */}
      <section className="card mb-4 px-4 pb-4 pt-4">
        {two && ev ? (
          <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
            {trade.teams.map((t, i) => {
              const evT = ev.teams.find((x) => x.teamId === t.teamId);
              const right = i === 1;
              return (
                <div key={t.teamId} className={cn("flex min-w-0 flex-col", right ? "col-start-3 items-end text-right" : "items-start")}>
                  <TeamLogo team={t} size={44} round />
                  <Link
                    href={`/teams/${t.teamId}`}
                    title={t.name}
                    className={cn("mt-2 max-w-full truncate text-[15px] font-semibold leading-5 hover:underline", t.teamId === myId ? "text-brand-600 dark:text-brand-400" : "text-ink")}
                  >
                    {t.name}
                  </Link>
                  <span className="max-w-full truncate text-[13px] text-muted">
                    {t.record ?? ""}
                    {evT ? ` · ${OUTLOOK_LABEL[evT.outlook]}` : ""}
                  </span>
                  <span className="numeral mt-1 text-[28px] font-semibold leading-8 tracking-[-0.02em] text-ink">{evT ? fmtValue(evT.received) : "—"}</span>
                  <span className="eyebrow">gets</span>
                </div>
              );
            })}
            <span className="col-start-2 row-start-1 mt-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-muted" aria-hidden>
              <ArrowLeftRight size={16} />
            </span>
          </div>
        ) : ev ? (
          <ul className="divide-y divide-line/70">
            {trade.teams.map((t) => {
              const evT = ev.teams.find((x) => x.teamId === t.teamId);
              return (
                <ListRow
                  key={t.teamId}
                  className="px-0"
                  href={`/teams/${t.teamId}`}
                  leading={<TeamLogo team={t} size={32} round />}
                  title={t.name}
                  subtitle={`${t.record ?? ""}${evT ? ` · ${OUTLOOK_LABEL[evT.outlook]}` : ""}`}
                  value={evT ? fmtValue(evT.received) : "—"}
                  valueSub="gets"
                  mine={t.teamId === myId}
                />
              );
            })}
          </ul>
        ) : null}
        {ev && (
          <FairnessMeter
            className="mx-auto mt-4 max-w-2xl"
            compact={two}
            teams={ev.teams.map((t) => ({ teamId: t.teamId, name: t.name, received: t.received, net: t.net, outlook: t.outlook }))}
            fairness={ev.fairness}
            verdict={ev.verdict}
            tone={ev.verdictTone}
          />
        )}
        {(trade.status === "PROPOSED" || trade.status === "ACCEPTED" || !ev) && (
          <div className={cn("mx-auto max-w-2xl", ev && "mt-3 border-t border-line/70 pt-3")}>
            <TradeTimeline trade={trade} tz={tz} />
          </div>
        )}
      </section>

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
        <Alert tone="info" className="mb-3">You&apos;re a party to this trade. If you approve it yourself, the approval is recorded in the commissioner audit log for the league to see.</Alert>
      )}

      {actions.length > 0 && (
        // phones: actions first (the sidebar copy sits below the assets)
        <Panel title="Your move" className="mb-4 lg:hidden">
          {actionsBody}
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
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamLogo team={t} size={24} /> <span className="truncate">{t.abbrev || t.name} receives</span>
                    </span>
                  }
                  subtitle={t.managerName ?? undefined}
                  actions={evT ? <span className="numeral text-[20px] font-semibold text-ink">{fmtValue(evT.received)}</span> : undefined}
                  bodyClassName="pt-0"
                >
                  {incoming.length ? (
                    <div className="divide-y divide-line/70">
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
                                {a.type === "PLAYER" && a.rosPoints !== undefined && !settled && <div className="text-[12px] leading-4 text-muted">Rest of season {fmtPts(a.rosPoints, 1)} proj pts</div>}
                                {res && (
                                  <div className="mt-1 text-[13px] leading-[18px] text-muted">
                                    <b className="numeral text-ink">{fmtPts(res.started, 1)}</b> starter pts ({res.startedWeeks} wk{res.startedWeeks === 1 ? "" : "s"}) · {fmtPts(res.total, 1)} total
                                    {res.currentTeamId !== t.teamId && <span> · {res.currentTeamId ? "since moved on" : "since released"}</span>}
                                  </div>
                                )}
                                {pk && (
                                  <div className="mt-1 text-[13px] leading-[18px] text-muted">
                                    {pk.used && pk.player ? (
                                      <>
                                        Used{pk.slot ? ` at ${pk.slot}` : ""} on{" "}
                                        <Link href={`/players/${pk.player.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                                          {pk.player.fullName}
                                        </Link>{" "}
                                        ({pk.player.position})
                                      </>
                                    ) : (
                                      <>Not used yet</>
                                    )}
                                  </div>
                                )}
                                {a.components.length > 0 && (
                                  <details className="group mt-0.5">
                                    <summary className="-mx-1 inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md px-1 text-[13px] font-semibold text-brand-600 hover:bg-brand-600/[0.06] dark:text-brand-400 [&::-webkit-details-marker]:hidden">
                                      Value breakdown
                                      <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
                                    </summary>
                                    <ComponentList components={a.components} className="mt-1 rounded-lg bg-sunken px-3 py-2" />
                                  </details>
                                )}
                              </>
                            }
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-2 text-[13px] text-muted">Nothing — roster relief only.</p>
                  )}
                  {t.drops.length > 0 && (
                    <p className="mt-2 border-t border-line/70 pt-2 text-[13px] text-muted">
                      Drops to make room: <b className="text-ink">{t.drops.map((d) => `${d.fullName} (${d.position})`).join(", ")}</b>
                    </p>
                  )}
                </Panel>
              );
            })}
          </div>

          {trade.status === "COMPLETED" && results && (
            <Panel title="How it's going" info={<p>Fantasy points the received players have scored as starters for their new teams since the trade.</p>}>
              {two ? (
                <CompareBar
                  label="Starter pts"
                  left={results.teamTotals.get(`${trade.id}:${trade.teams[0]!.teamId}`) ?? 0}
                  right={results.teamTotals.get(`${trade.id}:${trade.teams[1]!.teamId}`) ?? 0}
                  leftText={`${trade.teams[0]!.abbrev} ${fmtPts(results.teamTotals.get(`${trade.id}:${trade.teams[0]!.teamId}`) ?? 0, 1)}`}
                  rightText={`${fmtPts(results.teamTotals.get(`${trade.id}:${trade.teams[1]!.teamId}`) ?? 0, 1)} ${trade.teams[1]!.abbrev}`}
                />
              ) : (
                <ul className="divide-y divide-line/70">
                  {trade.teams.map((t) => (
                    <ListRow key={t.teamId} className="px-0" leading={<TeamLogo team={t} size={28} />} title={t.name} value={fmtPts(results.teamTotals.get(`${trade.id}:${t.teamId}`) ?? 0, 1)} valueSub="starter pts" />
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {trade.message && (
            <Panel title="Message">
              <p className="flex items-start gap-2 text-[15px] italic text-ink">
                <MessageSquare size={15} className="mt-1 shrink-0 text-muted" aria-hidden />“{trade.message}”
              </p>
            </Panel>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {actions.length > 0 && (
            <Panel title="Your move" className="hidden lg:block">
              {actionsBody}
            </Panel>
          )}
          {ev && (
            <Panel
              title="Evaluation"
              subtitle={trade.evaluationSource === "snapshot" ? "Values at the time of the trade" : "Live values for the team receiving"}
              info={<p>Each side&apos;s total uses a consolidation adjustment — one stud is worth more than two mid-level pieces with the same raw sum. Net = what a team gets minus what it sends.</p>}
              noPad
            >
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {ev.teams.map((t) => (
                  <ListRow
                    key={t.teamId}
                    title={t.name}
                    subtitle={`Raw ${fmtValue(t.receivedRaw)} · adj. ${t.consolidation >= 0 ? "+" : ""}${fmtValue(t.consolidation)} · gets ${fmtValue(t.received)}`}
                    value={`${t.net >= 0 ? "+" : "−"}${fmtValue(Math.abs(t.net))}`}
                    valueSub="net"
                    valueTone={t.net >= 0 ? "good" : "bad"}
                    mine={t.teamId === myId}
                  />
                ))}
              </ul>
              {ev.warnings.length > 0 && (
                <ul className="space-y-1 border-t border-line/70 px-4 py-3">
                  {ev.warnings.map((w) => (
                    <li key={w} className="text-[13px] text-amber-700 dark:text-amber-300">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {ev && (settled || trade.status === "PROPOSED" || trade.status === "ACCEPTED") && ev.teams.some((t) => (t.cap && settings.salaryCap.enabled) || t.roster) && (
            <Panel title={settings.salaryCap.enabled ? "Cap & roster" : "Roster"} subtitle={settled ? "At the time of the trade" : "If processed now"}>
              <ul className="divide-y divide-line/70">
                {ev.teams.map((t) => (
                  <li key={t.teamId} className="py-2 first:pt-0 last:pb-0">
                    <div className="truncate text-[14px] font-semibold text-ink">{t.name}</div>
                    {t.cap && settings.salaryCap.enabled && (
                      <div>
                        <CapLine before={t.cap.before} after={t.cap.after} cap={t.cap.cap} label={`${trade.season}`} />
                      </div>
                    )}
                    {t.cap && settings.salaryCap.enabled && t.cap.nextBefore !== t.cap.nextAfter && (
                      <div>
                        <CapLine before={t.cap.nextBefore} after={t.cap.nextAfter} cap={t.cap.nextCap} label={`${trade.season + 1}`} />
                      </div>
                    )}
                    {t.roster && (
                      <div className="numeral text-[13px] text-muted">
                        Active roster {t.roster.activeBefore} → <b className={cn("text-ink", t.roster.overflow > 0 && t.roster.activeAfter > t.roster.activeBefore && "text-loss")}>{t.roster.activeAfter}</b> / {t.roster.max}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {trade.reviewEndsAt && (
            <Panel title="League vote" subtitle={trade.status === "ACCEPTED" ? `Review ${timeLeft(trade.reviewEndsAt)}` : `Review ended ${fmtWhen(trade.reviewEndsAt, tz)}`}>
              <Meter value={trade.votes.veto} max={Math.max(1, trade.votes.required)} tone={trade.votes.veto >= trade.votes.required ? "bad" : "neutral"} caption="Vetoes to block" valueText={`${trade.votes.veto} / ${trade.votes.required}`} />
              {showVotes && <p className="mt-2 text-[13px] text-muted">{trade.votes.approve} approve</p>}
              {showVotes && trade.votes.list.length > 0 && (
                <ul className="mt-2 divide-y divide-line/70 text-[14px]">
                  {trade.votes.list.map((v) => (
                    <li key={v.teamId} className="flex min-h-9 items-center justify-between gap-2">
                      <span className="truncate">{v.teamName}</span>
                      <span className={v.vote === "VETO" ? "font-semibold text-loss" : "font-semibold text-win"}>{v.vote === "VETO" ? "Veto" : "Approve"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          <Panel title="Timeline">
            <ol className="space-y-3">
              {events.map((e, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[14px]">
                  {e.tone === "good" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-win" /> : e.tone === "bad" ? <XCircle size={16} className="mt-0.5 shrink-0 text-loss" /> : <CircleDashed size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />}
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{e.label}</div>
                    {e.at && <div className="text-[13px] text-muted">{fmtWhen(e.at, tz, { withYear: true })}</div>}
                    {e.note && e.note !== e.label && <div className="text-[13px] text-muted">{e.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
            {(parentVisible || counters.length > 0) && (
              <div className="mt-3 space-y-1 border-t border-line/70 pt-2 text-[13px]">
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
