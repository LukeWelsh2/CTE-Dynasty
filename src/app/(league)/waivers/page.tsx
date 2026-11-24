// Waivers & FAB: my pending claims (rank / bid / drop / cancel), next run countdown, FAB budgets for every
// team, waiver order, players on waivers, results of recent runs (bids revealed after processing).
import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Gavel, ListOrdered, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { nextWaiverRun } from "@/lib/waiver-schedule";
import { Badge, ButtonLink, EmptyState, InjuryTag, PageHeader, Panel, PosBadge, StatTile, TeamLogo } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { ClaimList, type ClaimItem, type DropOption } from "@/components/waivers/claim-list";
import { Countdown, LiveRefresh } from "@/components/waivers/countdown";
import { MoneyChip, RuleLine, TxNav } from "@/components/waivers/bits";
import { loadFabTable, loadMyClaims, loadPlayersOnWaivers, loadRecentResults, waiverOrderRelevant } from "@/lib/waivers/data";
import { getLastRun } from "@/lib/waivers/process";
import { processWaiversNowAction } from "@/lib/waivers/actions";
import { TIEBREAKER_LABEL, bidVisible, waiverContractYears, waiverMinBid } from "@/lib/waivers/logic";
import { daysLabel, fmtDateTime, hourLabel, relative, tzAbbrev } from "@/lib/waivers/format";
import { cn, ordinal } from "@/lib/utils";

export const metadata: Metadata = { title: "Waivers & FAB" };

const TYPE_LABEL = { FAB: "FAB blind bidding", PRIORITY: "Waiver priority", FREE_FOR_ALL: "Free for all" } as const;

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
  const maxSpent = Math.max(1, ...fabRows.map((r) => r.spent));

  return (
    <div>
      <LiveRefresh leagueId={league.id} types={["waivers.processed", "transaction"]} />
      <PageHeader
        kicker="Transactions"
        title="Waivers & FAB"
        subtitle={`${TYPE_LABEL[w.type]} · runs ${daysLabel(w.processDays)} at ${hourLabel(w.processHour)} ${tzAbbrev(tz)} · dropped players wait ${w.waiverPeriodHours}h`}
        actions={
          <>
            <ButtonLink href="/players?status=available" variant="secondary" size="sm">
              Browse free agents
            </ButtonLink>
            {ctx.isCommish && (
              <ActionButton action={processWaiversNowAction} variant="gold" size="sm" confirm="Process every pending claim that is due by the next scheduled run now?">
                <Gavel size={14} /> Process waivers now
              </ActionButton>
            )}
          </>
        }
      />
      <TxNav active="waivers" />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          label="Next waiver run"
          value={nextRun ? <Countdown to={nextRun.toISOString()} initialNow={now.getTime()} doneText="processing…" /> : "—"}
          sub={nextRun ? fmtDateTime(nextRun, tz) : "No processing days set"}
        />
        <StatTile
          label="Last processed"
          value={lastRun ? <span className="text-xl">{relative(lastRun.at, now.getTime())}</span> : runs[0] ? <span className="text-xl">{relative(runs[0].at, now.getTime())}</span> : "—"}
          sub={lastRun ? `${lastRun.awarded} won · ${lastRun.lost} lost · ${lastRun.invalid} invalid${lastRun.manual ? " · by commissioner" : ""}` : runs[0] ? fmtDateTime(runs[0].at, tz) : "No runs yet"}
        />
        {fab ? (
          <StatTile label="My FAB" value={myTeam ? `$${balance}` : "—"} sub={`of $${w.faabBudget} budget${w.faabRollover ? " · unused FAB rolls over" : ""}`} tone={myTeam && balance <= 0 ? "bad" : undefined} />
        ) : (
          <StatTile label="Waiver type" value={<span className="text-xl">{TYPE_LABEL[w.type]}</span>} sub={w.priorityType === "ROLLING" ? "Rolling priority" : "Resets weekly by record"} />
        )}
        <StatTile
          label="My waiver priority"
          value={myTeamRow ? `#${myTeamRow.waiverPriority}` : "—"}
          sub={orderRelevant ? `of ${teamCount}${fab ? " · breaks tied bids" : ""}` : `Tiebreaker: ${TIEBREAKER_LABEL[w.tiebreaker]}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {myTeam && (
            <Panel
              title="My pending claims"
              subtitle={claims.length ? "Claims process in this order — your #1 is decided first. Bids stay hidden until the run." : undefined}
              actions={claims.length ? <Badge tone="brand">{claims.length}</Badge> : undefined}
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
                <EmptyState title="No pending claims" className="py-6">
                  Place a claim on any player who is on waivers from the{" "}
                  <Link href="/players?status=available" className="link">
                    Players page
                  </Link>
                  {onWaivers.length ? " or from the list of players on waivers." : "."}
                </EmptyState>
              )}
            </Panel>
          )}

          {fab && (
            <Panel title="FAB budgets" subtitle={`${season} season · $${w.faabBudget} budget per team${w.faabTradable && settings.trades.allowFaabTrading ? " · FAB can be traded" : ""}`} noPad>
              <div className="max-h-[560px] overflow-auto">
                <table className="tbl">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>Team</th>
                      <th className="num">Budget</th>
                      <th className="num">Spent</th>
                      <th className="num hidden sm:table-cell">Trades</th>
                      <th className="num hidden md:table-cell">Adj.</th>
                      <th className="num">Left</th>
                      <th className="hidden md:table-cell">Used</th>
                      <th className="num hidden sm:table-cell">Won</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...fabRows]
                      .sort((a, b) => b.remaining - a.remaining || a.team.name.localeCompare(b.team.name))
                      .map((r) => {
                        const net = r.tradeIn - r.tradeOut;
                        const mine = r.team.id === myTeam?.id;
                        return (
                          <tr key={r.team.id} className={cn(mine && "bg-gold-300/15")}>
                            <td>
                              <Link href={`/waivers/fab/${r.team.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                                <TeamLogo team={r.team} size={22} />
                                <span className="truncate font-semibold text-ink">{r.team.name}</span>
                              </Link>
                            </td>
                            <td className="num">${r.budget}</td>
                            <td className="num">{r.spent ? `$${r.spent}` : "—"}</td>
                            <td className={cn("num hidden sm:table-cell", net > 0 && "text-win", net < 0 && "text-loss")}>{net ? `${net > 0 ? "+" : "−"}$${Math.abs(net)}` : "—"}</td>
                            <td className="num hidden md:table-cell">{r.adjustments ? `${r.adjustments > 0 ? "+" : "−"}$${Math.abs(r.adjustments)}` : "—"}</td>
                            <td className={cn("num font-bold", r.remaining <= 0 ? "text-loss" : "text-ink")}>
                              ${r.remaining}
                              {r.remaining !== r.cached && (
                                <span className="ml-1 text-[10px] font-normal text-amber-600" title={`Cached balance $${r.cached} differs from the ledger`}>
                                  *
                                </span>
                              )}
                            </td>
                            <td className="hidden w-32 md:table-cell">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line" aria-hidden>
                                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (r.spent / maxSpent) * 100)}%` }} />
                              </div>
                            </td>
                            <td className="num hidden sm:table-cell">{r.claimsWon}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Tap a team for its full FAB ledger. Balances come from the FAB ledger (season start, waiver wins, trades, commissioner adjustments).</p>
            </Panel>
          )}

          <Panel title="Recent results" subtitle="Every bid is revealed once a run is processed" id="results" noPad>
            {runs.length ? (
              <div className="divide-y divide-line">
                {runs.map((run) => (
                  <section key={run.at.toISOString()} className="px-3 py-3">
                    <h3 className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-display text-sm font-bold uppercase tracking-wide text-ink">Run · {fmtDateTime(run.at, tz)}</span>
                      <span className="text-xs text-muted">
                        {run.players.filter((p) => p.winner).length} awarded · {run.total} claim{run.total === 1 ? "" : "s"}
                      </span>
                    </h3>
                    <ul className="space-y-2">
                      {run.players.map((p) => {
                        const player = p.winner?.addPlayer ?? p.others[0]?.addPlayer;
                        if (!player) return null;
                        return (
                          <li key={p.playerId} className="rounded-md border border-line bg-sunken/40 px-2.5 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <PosBadge pos={player.position} />
                                <Link href={`/players/${player.id}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                  {player.fullName}
                                </Link>
                                <InjuryTag status={player.injuryStatus} />
                                <span className="text-[11px] text-muted">{player.team ?? "FA"}</span>
                              </span>
                              {p.winner ? (
                                <span className="flex items-center gap-1.5 text-sm">
                                  <TeamLogo team={p.winner.team} size={20} />
                                  <span className={cn("font-semibold", p.winner.teamId === myTeam?.id ? "text-win" : "text-ink")}>{p.winner.team.name}</span>
                                  {fab && canSee(p.winner.teamId, true) && <MoneyChip amount={p.winner.bidAmount} kind="fab" />}
                                </span>
                              ) : (
                                <Badge tone="neutral">Not awarded</Badge>
                              )}
                            </div>
                            {p.winner?.dropPlayer && <div className="mt-1 text-[11px] text-muted">Dropped {p.winner.dropPlayer.fullName}</div>}
                            {p.others.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 border-t border-line/70 pt-1.5 text-xs">
                                {p.others.map((o) => (
                                  <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <Badge tone={o.status === "LOST" ? "neutral" : "amber"}>{o.status === "LOST" ? "Lost" : "Invalid"}</Badge>
                                    <span className={cn("font-medium", o.teamId === myTeam?.id ? "text-ink" : "text-muted")}>{o.team.name}</span>
                                    {fab && canSee(o.teamId, false) && <span className="tabular-nums text-ink">${o.bidAmount}</span>}
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
              </div>
            ) : (
              <EmptyState title="No waiver runs yet" className="m-3">
                Results show here after each run{nextRun ? ` — the next one is ${fmtDateTime(nextRun, tz)}` : ""}.
              </EmptyState>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          {orderRelevant && (
            <Panel title="Waiver order" subtitle={w.priorityType === "ROLLING" ? "Rolling: a winning claim moves a team to the back" : "Resets after every run — worst record first"} noPad>
              <ol className="divide-y divide-line/70">
                {orderRows.map((r) => (
                  <li key={r.team.id} className={cn("flex items-center gap-2 px-3 py-1.5 text-sm", r.team.id === myTeam?.id && "bg-gold-300/15")}>
                    <span className="w-6 text-right font-display font-bold tabular-nums text-muted">{r.waiverPriority}</span>
                    <TeamLogo team={r.team} size={20} />
                    <span className="truncate font-medium text-ink">{r.team.name}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel title="On waivers now" subtitle={onWaivers.length ? `${onWaivers.length} player${onWaivers.length === 1 ? "" : "s"} — claim from the player page` : undefined} noPad>
            {onWaivers.length ? (
              <ul className="max-h-[420px] divide-y divide-line/70 overflow-y-auto">
                {onWaivers.map((o) => (
                  <li key={o.player.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <PosBadge pos={o.player.position} />
                        <Link href={`/players/${o.player.id}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                          {o.player.fullName}
                        </Link>
                        <InjuryTag status={o.player.injuryStatus} />
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {o.player.team ?? "FA"}
                        {o.droppedBy ? ` · dropped by ${o.droppedBy.abbrev}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-muted">
                      <span className="flex items-center justify-end gap-1">
                        <Clock size={11} /> clears
                      </span>
                      <span className="font-semibold text-ink">{fmtDateTime(o.clearsAt, tz)}</span>
                      {myClaimPlayers.has(o.player.id) && (
                        <Badge tone="green" className="ml-1 mt-0.5">
                          Claimed
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-sm text-muted">Nobody is on waivers. Dropped players appear here for {w.waiverPeriodHours} hours.</p>
            )}
          </Panel>

          <Panel title="How waivers work" noPad>
            <dl className="px-3 py-1">
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
            <div className="flex items-start gap-2 border-t border-line bg-sunken/50 px-3 py-2 text-[11px] text-muted">
              <ShieldCheck size={14} className="mt-px shrink-0 text-brand-600" />
              <span>
                {fab ? "Highest valid bid wins each player." : "Highest waiver priority wins each player."} Each claim is re-checked when it runs: {fab ? "FAB balance, " : ""}roster room after the drop, cap space and limits. Your claims are decided in your order.
              </span>
            </div>
          </Panel>

          {orderRelevant && myTeamRow && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
              <ListOrdered size={14} /> You are {ordinal(myTeamRow.waiverPriority)} of {teamCount} in the waiver order.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
