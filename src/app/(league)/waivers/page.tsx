// Waivers & FAB — "When do waivers run, what am I claiming, and how much FAB do I have?"
// Summary strip (next run countdown · my FAB · my priority · pending claims), then my claims (rank / bid / drop /
// cancel), players on waivers now, recent results (bids revealed per the league setting), every team's FAB left,
// the waiver order and the rules behind a tap. Phones interleave main + rail by importance (display: contents).
import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Gavel, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { nextWaiverRun } from "@/lib/waiver-schedule";
import { Alert, Badge, ButtonLink, Collapsible, EmptyState, PageHeader, Panel, RankBar, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ActionButton, ShowMore } from "@/components/ui/client";
import { InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { ClaimList, type ClaimItem, type DropOption } from "@/components/waivers/claim-list";
import { Countdown, LiveRefresh } from "@/components/waivers/countdown";
import { MoneyChip, RuleLine, TxNav } from "@/components/waivers/bits";
import { loadFabTable, loadMyClaims, loadPlayersOnWaivers, loadRecentResults, waiverOrderRelevant } from "@/lib/waivers/data";
import { getLastRun } from "@/lib/waivers/process";
import { auctionPoolFor, teamAddBlock } from "@/lib/players/context";
import { AUCTION_POOL_REASON } from "@/lib/players/logic";
import { processWaiversNowAction } from "@/lib/waivers/actions";
import { TIEBREAKER_LABEL, bidVisible, waiverContractYears, waiverMinBid } from "@/lib/waivers/logic";
import { daysLabel, fmtDateTime, hourLabel, relative, tzAbbrev } from "@/lib/waivers/format";
import { cn, fmtMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Waivers & FAB" };

const TYPE_LABEL = { FAB: "FAB blind bidding", PRIORITY: "Waiver priority", FREE_FOR_ALL: "Free for all" } as const;
const REVEAL_NOTE = {
  ALL_BIDS: "Every bid is revealed once a run is processed",
  WINNING_ONLY: "Winning bids are revealed after each run; losing bids stay private",
  NONE: "Bids stay private — you only see your own",
} as const;

export default async function WaiversPage() {
  const ctx = await getLeagueContext();
  const { league, settings, myTeam, season } = ctx;
  const w = settings.waivers;
  const tz = settings.general.timezone;
  const fab = w.type === "FAB";
  const now = new Date();
  const nextRun = nextWaiverRun(settings, now);
  const [claims, roster, myTeamRow, fabRows, onWaivers, runs, lastRun] = await Promise.all([
    myTeam ? loadMyClaims(myTeam.id) : Promise.resolve([]),
    myTeam ? db.rosterSpot.findMany({ where: { teamId: myTeam.id }, include: { player: { select: { fullName: true, position: true, team: true } } }, orderBy: [{ salary: "desc" }] }) : Promise.resolve([]),
    myTeam ? db.team.findUnique({ where: { id: myTeam.id }, select: { faabBalance: true, waiverPriority: true } }) : Promise.resolve(null),
    loadFabTable(league.id, season),
    loadPlayersOnWaivers(league.id, now),
    loadRecentResults(league.id, { runs: 6 }),
    getLastRun(league.id),
  ]);
  // claims that will be ruled invalid at the next run: my team is out of the playoffs (waivers.eliminatedTeamsCanAdd /
  // playoffs.eliminatedTeamsCanTransact), or the player is held for the auction pool (keepers.releasedPlayersReturnTo)
  const [addBlock, heldForAuction] = await Promise.all([
    myTeam ? teamAddBlock(ctx) : Promise.resolve(null),
    claims.length ? auctionPoolFor(ctx, claims.map((c) => c.addPlayerId)) : Promise.resolve(new Set<string>()),
  ]);
  const heldClaims = claims.filter((c) => heldForAuction.has(c.addPlayerId));
  const teamCount = fabRows.length;
  const balance = myTeamRow?.faabBalance ?? 0;
  const myClaimPlayers = new Set(claims.map((c) => c.addPlayerId));
  const claimItems: ClaimItem[] = claims.map((c) => ({
    id: c.id,
    priority: c.priority,
    player: c.addPlayer,
    dropPlayerId: c.dropPlayerId,
    bid: c.bidAmount,
    processAtLabel: c.processAt ? fmtDateTime(c.processAt, tz) : null,
  }));
  const undroppable = new Set(w.undroppablePlayerIds ?? []);
  const canSee = (teamId: string, won: boolean) => bidVisible(settings, { teamId, won }, { teamId: myTeam?.id ?? null, isCommish: ctx.isCommish });
  const dropOptions: DropOption[] = roster.filter((r) => !undroppable.has(r.playerId)).map((r) => ({
    id: r.playerId,
    status: r.status,
    label: `${r.player.fullName} · ${r.player.position}${r.player.team ? " " + r.player.team : ""} · $${r.salary}${r.status !== "ACTIVE" ? ` · ${r.status}` : ""}`,
  }));
  const orderRelevant = waiverOrderRelevant(settings);
  const orderRows = [...fabRows].sort((a, b) => a.waiverPriority - b.waiverPriority);
  const maxBudget = Math.max(1, ...fabRows.map((r) => Math.max(r.budget, r.remaining)));
  const lastAt = lastRun?.at ?? runs[0]?.at ?? null;
  const lastLine = lastRun
    ? `Last run ${relative(lastRun.at, now.getTime())} · ${lastRun.awarded} won · ${lastRun.lost} lost · ${lastRun.invalid} invalid${lastRun.manual ? " · by commissioner" : ""}`
    : lastAt
      ? `Last run ${relative(lastAt, now.getTime())}`
      : "No runs yet";

  return (
    <div>
      <LiveRefresh leagueId={league.id} types={["waivers.processed", "transaction"]} />
      <PageHeader
        title="Waivers & FAB"
        actions={
          <>
            <ButtonLink href="/players?status=available" variant="secondary">
              Free agents
            </ButtonLink>
            {ctx.isCommish && (
              <ActionButton action={processWaiversNowAction} variant="primary" size="md" confirm="Process every pending claim that is due by the next scheduled run now?">
                <Gavel size={15} /> Process now
              </ActionButton>
            )}
          </>
        }
      />
      <TxNav active="waivers" />

      <SummaryStrip
        className="mb-4"
        items={[
          {
            label: "Next run",
            value: nextRun ? <Countdown to={nextRun.toISOString()} initialNow={now.getTime()} doneText="processing…" /> : "—",
            sub: nextRun ? nextRun.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }) : "No days set",
            title: nextRun ? `Waivers run ${daysLabel(w.processDays)} at ${hourLabel(w.processHour)} ${tzAbbrev(tz)}` : undefined,
          },
          fab
            ? { label: "My FAB", value: myTeam ? fmtMoney(balance) : "—", sub: `of $${w.faabBudget}`, tone: myTeam && balance <= 0 ? "bad" : undefined, href: myTeam ? `/waivers/fab/${myTeam.id}` : undefined, title: w.faabRollover ? "Unused FAB rolls over" : undefined }
            : { label: "Type", value: w.type === "PRIORITY" ? "Priority" : "FFA", sub: w.priorityType === "ROLLING" ? "rolling" : "resets weekly" },
          {
            label: "Priority",
            value: myTeamRow ? `#${myTeamRow.waiverPriority}` : "—",
            sub: orderRelevant ? `of ${teamCount}` : TIEBREAKER_LABEL[w.tiebreaker],
            title: orderRelevant && fab ? "Breaks tied bids" : undefined,
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="contents lg:block lg:min-w-0 lg:space-y-4">
          {myTeam && addBlock && (
            <Alert tone="warn" className="order-1 lg:order-none">
              {addBlock}
              {claims.length ? ` Your pending claim${claims.length === 1 ? "" : "s"} will be ruled invalid when waivers run.` : ""}
            </Alert>
          )}
          {myTeam && !addBlock && heldClaims.length > 0 && (
            <Alert tone="warn" className="order-1 lg:order-none">
              {AUCTION_POOL_REASON}: {heldClaims.map((c) => c.addPlayer.fullName).join(", ")} can only be signed in the {season} auction, so {heldClaims.length === 1 ? "this claim" : "these claims"} will be ruled invalid until that
              auction is complete.
            </Alert>
          )}
          {myTeam && (
            <Panel
              className="order-1 min-w-0 lg:order-none"
              title="My claims"
              subtitle={claims.length ? "Decided in this order" : undefined}
              actions={claims.length ? <Badge tone="brand">{claims.length} pending</Badge> : undefined}
              info={<p>Your #1 claim is decided first. Each claim is re-checked when it runs: {fab ? "FAB balance, " : ""}roster room after the drop, cap space and limits. Bids stay hidden until the run.</p>}
              noPad
            >
              {claimItems.length ? (
                <ClaimList
                  claims={claimItems}
                  fab={fab}
                  minBid={waiverMinBid(settings)}
                  bidStep={Math.max(1, w.bidIncrement ?? 1)}
                  balance={balance}
                  dropOptions={dropOptions}
                  salaryRule={{ equalsBid: w.salaryEqualsBid && fab, multiplier: w.salaryMultiplier, min: settings.salaryCap.minSalary, max: settings.salaryCap.maxSalary }}
                  contractYears={waiverContractYears(settings)}
                />
              ) : (
                <EmptyState title="No pending claims" className="mx-4 mb-4 py-6">
                  Claim a player on waivers from his{" "}
                  <Link href="/players?status=available" className="link">
                    player page
                  </Link>
                  .
                </EmptyState>
              )}
            </Panel>
          )}

          <Panel className="order-3 min-w-0 lg:order-none" title="Recent results" subtitle={lastLine} info={<p>{!fab ? "Claims are decided by waiver priority." : REVEAL_NOTE[w.revealBids ?? "ALL_BIDS"]}.</p>} id="results" noPad>
            {runs.length ? (
              <ShowMore as="div" initial={3} moreLabel="Show older runs" className="border-t border-line/70">
                {runs.map((run) => (
                  <section key={run.at.toISOString()} className="border-b border-line/70 last:border-b-0">
                    <h3 className="flex min-h-9 items-center justify-between gap-2 bg-sunken px-4 py-1.5">
                      <span className="truncate text-[13px] font-semibold text-ink">{fmtDateTime(run.at, tz)}</span>
                      <span className="shrink-0 text-[12px] text-muted">
                        {run.players.filter((p) => p.winner).length} awarded · {run.total} claim{run.total === 1 ? "" : "s"}
                      </span>
                    </h3>
                    <ul className="divide-y divide-line/70">
                      {run.players.map((p) => {
                        const player = p.winner?.addPlayer ?? p.others[0]?.addPlayer;
                        if (!player) return null;
                        return (
                          <li key={p.playerId} className="px-4 py-2.5">
                            <div className="flex min-h-10 items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <Link href={`/players/${player.id}`} title={player.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
                                    {player.fullName}
                                  </Link>
                                  <InjuryLetter status={player.injuryStatus} className="text-[13px]" />
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                                  <PosPill pos={player.position} />
                                  <span className="min-w-0 truncate">
                                    {player.team ?? "FA"}
                                    {p.winner?.dropPlayer ? ` · dropped ${p.winner.dropPlayer.fullName}` : ""}
                                  </span>
                                </div>
                              </div>
                              {p.winner ? (
                                <span className="flex shrink-0 flex-col items-end gap-0.5">
                                  <span className="flex items-center gap-1.5">
                                    <TeamLogo team={p.winner.team} size={20} />
                                    <span className={cn("max-w-[7.5rem] truncate text-[14px] font-semibold", p.winner.teamId === myTeam?.id ? "text-brand-600 dark:text-brand-400" : "text-ink")} title={p.winner.team.name}>
                                      {p.winner.team.name}
                                    </span>
                                  </span>
                                  {fab && canSee(p.winner.teamId, true) && <MoneyChip amount={p.winner.bidAmount} kind="fab" />}
                                </span>
                              ) : (
                                <Badge tone="neutral">Not awarded</Badge>
                              )}
                            </div>
                            {p.others.length > 0 && (
                              <ul className="mt-1.5 space-y-1 text-[13px]">
                                {p.others.map((o) => (
                                  <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <Badge tone={o.status === "LOST" ? "neutral" : "amber"}>{o.status === "LOST" ? "Lost" : "Invalid"}</Badge>
                                    <span className={cn("font-medium", o.teamId === myTeam?.id ? "text-ink" : "text-muted")}>{o.team.name}</span>
                                    {fab && canSee(o.teamId, false) && <span className="numeral text-ink">${o.bidAmount}</span>}
                                    {o.resultNote && <span className="text-muted">— {o.resultNote}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </ShowMore>
            ) : (
              <EmptyState title="No waiver runs yet" className="mx-4 mb-4">
                {nextRun ? `Next run ${fmtDateTime(nextRun, tz)}.` : "Results show here after each run."}
              </EmptyState>
            )}
          </Panel>
        </div>

        <aside className="contents lg:block lg:min-w-0 lg:space-y-4">
          <Panel
            className="order-2 min-w-0 lg:order-none"
            title="On waivers now"
            subtitle={onWaivers.length ? `${onWaivers.length} player${onWaivers.length === 1 ? "" : "s"} · claim from the player page` : undefined}
            noPad
          >
            {onWaivers.length ? (
              <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
                {onWaivers.map((o) => (
                  <li key={o.player.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Link href={`/players/${o.player.id}`} title={o.player.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
                          {o.player.fullName}
                        </Link>
                        <InjuryLetter status={o.player.injuryStatus} className="text-[13px]" />
                        {myClaimPlayers.has(o.player.id) && <Badge tone="green">Claimed</Badge>}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                        <PosPill pos={o.player.position} />
                        <span className="min-w-0 truncate">
                          {o.player.team ?? "FA"}
                          {o.droppedBy ? ` · dropped by ${o.droppedBy.abbrev}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="flex items-center justify-end gap-1 text-[12px] leading-4 text-muted">
                        <Clock size={12} aria-hidden /> clears
                      </span>
                      <span className="numeral block text-[13px] font-semibold leading-5 text-ink">{fmtDateTime(o.clearsAt, tz)}</span>
                    </span>
                  </li>
                ))}
              </ShowMore>
            ) : (
              <p className="border-t border-line/70 px-4 py-4 text-[14px] text-muted">Nobody is on waivers. Dropped players wait here for {w.waiverPeriodHours} hours.</p>
            )}
          </Panel>

          {fab && (
            <Panel
              className="order-4 min-w-0 lg:order-none"
              title="FAB left"
              subtitle={`${season} · $${w.faabBudget} per team${w.faabTradable && settings.trades.allowFaabTrading ? " · tradable" : ""}`}
              info={<p>Balances come from the FAB ledger: season start, waiver wins, trades and commissioner adjustments. Tap a team for its full ledger. An asterisk means the cached balance differs from the ledger.</p>}
              noPad
            >
              <ShowMore as="ul" initial={5} moreLabel="Show all teams" className="divide-y divide-line/70 border-t border-line/70">
                {[...fabRows]
                  .sort((a, b) => b.remaining - a.remaining || a.team.name.localeCompare(b.team.name))
                  .map((r, i) => {
                    const net = r.tradeIn - r.tradeOut;
                    const bits = [r.spent ? `$${r.spent} spent` : null, r.claimsWon ? `${r.claimsWon} won` : null, net ? `trades ${net > 0 ? "+" : "−"}$${Math.abs(net)}` : null, r.adjustments ? `adj. ${r.adjustments > 0 ? "+" : "−"}$${Math.abs(r.adjustments)}` : null].filter(Boolean);
                    return (
                      <RankBar
                        key={r.team.id}
                        rank={i + 1}
                        leading={<TeamLogo team={r.team} size={28} />}
                        title={r.team.name}
                        sub={bits.length ? <span className="hidden sm:inline">{bits.join(" · ")}</span> : undefined}
                        value={Math.max(0, r.remaining)}
                        max={maxBudget}
                        display={
                          <span className={r.remaining <= 0 ? "text-loss" : undefined} title={r.remaining !== r.cached ? `Cached balance $${r.cached} differs from the ledger` : undefined}>
                            ${r.remaining}
                            {r.remaining !== r.cached && <span className="text-amber-700 dark:text-amber-300">*</span>}
                          </span>
                        }
                        valueSub={`of $${r.budget}`}
                        mine={r.team.id === myTeam?.id}
                        href={`/waivers/fab/${r.team.id}`}
                      />
                    );
                  })}
              </ShowMore>
            </Panel>
          )}

          {orderRelevant && (
            <Panel
              className="order-5 min-w-0 lg:order-none"
              title="Waiver order"
              subtitle={w.priorityType === "ROLLING" ? (fab ? "Rolling · a won tie moves a team to the back" : "Rolling · a win moves a team to the back") : "Resets after every run · worst record first"}
              noPad
            >
              <ShowMore as="ol" initial={5} moreLabel="Show full order" className="divide-y divide-line/70 border-t border-line/70">
                {orderRows.map((r) => {
                  const mine = r.team.id === myTeam?.id;
                  return (
                    <li key={r.team.id} className={cn("flex min-h-11 items-center gap-3 px-4 py-1.5", mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}>
                      <span className="numeral w-6 text-right text-[15px] font-semibold text-muted">{r.waiverPriority}</span>
                      <TeamLogo team={r.team} size={24} />
                      <span className={cn("truncate text-[15px] font-medium sm:text-sm", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>{r.team.name}</span>
                    </li>
                  );
                })}
              </ShowMore>
            </Panel>
          )}

          <section className="card order-6 min-w-0 px-4 lg:order-none">
            <Collapsible summary="How waivers work" meta={fab ? "FAB" : TYPE_LABEL[w.type]}>
              <dl>
                <RuleLine label="Type">{TYPE_LABEL[w.type]}</RuleLine>
                <RuleLine label="Processing">
                  {daysLabel(w.processDays)} · {hourLabel(w.processHour)} {tzAbbrev(tz)}
                </RuleLine>
                <RuleLine label="Waiver period">{w.waiverPeriodHours} hours after a drop</RuleLine>
                {w.lockPlayersAfterGameStart && <RuleLine label="Game lock">Free agents lock at kickoff until the next run</RuleLine>}
                {fab && (
                  <>
                    <RuleLine label="Minimum bid">${waiverMinBid(settings)}</RuleLine>
                    <RuleLine label="Tied bids">{TIEBREAKER_LABEL[w.tiebreaker]}</RuleLine>
                    {w.faabRollover && <RuleLine label="Rollover">Unused FAB rolls over</RuleLine>}
                  </>
                )}
                <RuleLine label="Signing salary">
                  {w.salaryEqualsBid && fab ? `Winning bid${w.salaryMultiplier !== 1 ? ` × ${w.salaryMultiplier}` : ""} (min $${settings.salaryCap.minSalary})` : `$${settings.salaryCap.minSalary} (league minimum)`}
                </RuleLine>
                <RuleLine label="Contract">
                  {waiverContractYears(settings)} year{waiverContractYears(settings) === 1 ? "" : "s"}
                </RuleLine>
                {(w.maxAcquisitionsPerWeek !== null || w.maxAcquisitionsPerSeason !== null) && (
                  <RuleLine label="Acquisition limits">
                    {[w.maxAcquisitionsPerWeek !== null ? `${w.maxAcquisitionsPerWeek}/week` : null, w.maxAcquisitionsPerSeason !== null ? `${w.maxAcquisitionsPerSeason}/season` : null].filter(Boolean).join(" · ")}
                  </RuleLine>
                )}
                <RuleLine label="After waivers">{w.continuousFreeAgency ? "Free agent (first come, first served)" : "Claims only"}</RuleLine>
              </dl>
              <p className="mt-2 flex items-start gap-2 text-[13px] text-muted">
                <ShieldCheck size={15} className="mt-px shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
                <span>
                  {fab ? "Highest valid bid wins each player." : "Highest waiver priority wins each player."} Each claim is re-checked when it runs: {fab ? "FAB balance, " : ""}roster room after the drop, cap space and limits.
                </span>
              </p>
            </Collapsible>
          </section>
        </aside>
      </div>
    </div>
  );
}
