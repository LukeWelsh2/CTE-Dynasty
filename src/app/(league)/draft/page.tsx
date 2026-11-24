import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Dices, Gavel, LayoutList, ListOrdered, Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
import { firstOpenDraftSeason } from "@/lib/picks";
import { computeRookieOrder } from "@/lib/draft/order";
import { roundPickLabel } from "@/lib/draft/logic";
import { auctionRules, rookieRules } from "@/lib/draft/data";
import { fmtDateTime, utcToZonedLocal } from "@/lib/draft/time";
import { cn, record } from "@/lib/utils";
import { StatusBadge, TypeBadge } from "@/components/draft/bits";
import { DraftControls, OrderEditor, RescheduleButton } from "@/components/draft/draft-controls";
import { CreateAuctionForm, CreateRookieDraftForm } from "@/components/draft/create-forms";
import { PickLedger } from "@/components/draft/pick-ledger";
import { advanceDraft, draftNeedsTick } from "@/lib/draft/tick";

export const metadata: Metadata = { title: "Draft Center" };

const METHOD_LABEL = {
  REVERSE_STANDINGS: "Reverse standings",
  REVERSE_MAX_PF: "Reverse points for (fewest PF picks first)",
  LOTTERY: "Draft lottery",
  REVERSE_POTENTIAL_POINTS: "Reverse potential points (best possible lineups)",
} as const;

export default async function DraftCenterPage() {
  const ctx = await getLeagueContext();
  const { league, settings } = ctx;
  const tz = settings.general.timezone;
  const nextSeason = firstOpenDraftSeason(league.season, league.phase);
  const years = settings.trades.futurePickYears;
  const ledgerSeasons = Array.from({ length: years }, (_, i) => nextSeason + i);

  // keep scheduled drafts honest even when the job scheduler is off
  const due = await db.draft.findMany({ where: { leagueId: league.id, status: { in: ["LIVE", "SCHEDULED"] } }, select: { id: true } });
  for (const d of due) if (await draftNeedsTick(d.id)) await advanceDraft(d.id).catch(() => null);

  const [drafts, teams, picks, order] = await Promise.all([
    db.draft.findMany({
      where: { leagueId: league.id },
      orderBy: [{ season: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { selections: true, lots: { where: { status: "SOLD" } } } } },
    }),
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "asc" } }),
    db.draftPick.findMany({ where: { leagueId: league.id, season: { gte: nextSeason, lt: nextSeason + years } } }),
    computeRookieOrder(league.id, nextSeason, settings),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rookieDraft = drafts.find((d) => d.type === "ROOKIE" && d.season === nextSeason) ?? null;
  const live = drafts.filter((d) => d.status === "LIVE" || d.status === "PAUSED");
  const rounds = settings.draft.rookie.rounds;
  const seasonPicks = picks.filter((p) => p.season === nextSeason);
  const pickOf = (teamId: string, round: number) => seasonPicks.find((p) => p.originalTeamId === teamId && p.round === round);
  // order rows: the created draft's stored order wins over the computed one
  const storedOrder = rookieDraft ? rookieRules(rookieDraft, settings).teamOrder : [];
  const orderRows = storedOrder.length
    ? storedOrder.map((id, i) => ({ teamId: id, slot: i + 1, row: order.rows.find((r) => r.teamId === id) }))
    : order.rows.map((r) => ({ teamId: r.teamId, slot: r.slot, row: r }));
  const manual = rookieDraft ? rookieRules(rookieDraft, settings).manualOrder : false;
  const existingRookieSeasons = new Set(drafts.filter((d) => d.type === "ROOKIE").map((d) => d.season));
  const creatableRookie = ledgerSeasons.filter((s) => !existingRookieSeasons.has(s));
  const a = settings.draft.auction;
  const auctionSummary = `Budget $${a.budget}${settings.salaryCap.enabled ? " (capped by cap space)" : ""}, min bid $${a.minBid}, +$${a.bidIncrement}, ${a.nominationSeconds}s to nominate, ${a.bidSeconds}s bid clock (resets to ${a.resetSecondsOnBid}s), ${a.rosterSpotsToFill} roster spots, ${a.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" ? "max bid reserves $" + a.minBid + " per open spot" : "max bid = remaining budget"}, ${a.contractYearsMode === "WINNER_CHOOSES" ? "winner chooses contract years" : `${a.fixedContractYears}-year contracts`}.`;
  const defaultStart = settings.draft.rookie.scheduledFor ? utcToZonedLocal(new Date(settings.draft.rookie.scheduledFor), tz) : "";
  const roomTeams = (ids: string[]) =>
    ids.map((id) => teamById.get(id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, ownerName: null }));

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={`${league.name} · ${league.season}`}
        title="Draft Center"
        subtitle="Rookie drafts, salary auctions, the lottery and every team's future picks"
        actions={
          <>
            <ButtonLink href="/draft/board" variant="secondary" size="sm">
              <LayoutList size={14} /> My big board
            </ButtonLink>
            <ButtonLink href="/draft/results" variant="secondary" size="sm">
              <Trophy size={14} /> Results
            </ButtonLink>
          </>
        }
      />

      {live.map((d) => (
        <Link
          key={d.id}
          href={d.type === "AUCTION" ? `/draft/auction?id=${d.id}` : `/draft/rookie?id=${d.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-live/40 bg-gradient-to-r from-brand-950 to-brand-800 px-4 py-3 text-white shadow-panel hover:brightness-110"
        >
          <div className="flex items-center gap-3">
            <StatusBadge status={d.status} />
            <div>
              <div className="font-display text-xl font-bold uppercase">{d.name}</div>
              <div className="text-xs text-white/75">{d.status === "LIVE" ? "The draft room is open" : "Paused by the commissioner"}</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 font-semibold text-gold-300">
            Enter room <ArrowRight size={16} />
          </span>
        </Link>
      ))}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Drafts" subtitle="Every rookie draft and salary auction in league history" noPad>
            {drafts.length === 0 ? (
              <div className="p-3">
                <EmptyState title="No drafts yet">{ctx.isCommish ? "Create the next rookie draft or an auction from Commissioner tools." : "The commissioner hasn't created a draft yet."}</EmptyState>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Draft</th>
                      <th>Status</th>
                      <th className="hidden sm:table-cell">When</th>
                      <th className="num">Progress</th>
                      <th className="text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => {
                      const isAuction = d.type === "AUCTION";
                      const total = isAuction ? null : Array.isArray(d.order) ? (d.order as unknown[]).length : 0;
                      const done = isAuction ? d._count.lots : d._count.selections;
                      const kind = isAuction ? auctionRules(d, settings).kind : undefined;
                      const room = isAuction ? `/draft/auction?id=${d.id}` : `/draft/rookie?id=${d.id}`;
                      return (
                        <tr key={d.id}>
                          <td>
                            <Link href={d.status === "COMPLETE" ? `/draft/results?id=${d.id}` : room} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                              {d.name}
                            </Link>
                            <div className="mt-0.5">
                              <TypeBadge type={d.type} kind={kind} />
                            </div>
                          </td>
                          <td>
                            <StatusBadge status={d.status} />
                          </td>
                          <td className="hidden text-xs text-muted sm:table-cell">
                            {d.status === "COMPLETE" ? `Done ${fmtDateTime(d.completedAt, tz, { withZone: false })}` : d.startTime ? fmtDateTime(d.startTime, tz) : "Not scheduled"}
                          </td>
                          <td className="num text-xs">{isAuction ? (done ? `${done} sold` : d.status === "COMPLETE" ? "Imported" : "—") : `${done}/${total}`}</td>
                          <td>
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {d.status !== "COMPLETE" && (
                                <ButtonLink href={room} size="xs" variant={d.status === "LIVE" ? "gold" : "secondary"}>
                                  {d.status === "LIVE" ? "Enter room" : "Room"}
                                </ButtonLink>
                              )}
                              {(d.status === "COMPLETE" || done > 0) && (
                                <ButtonLink href={`/draft/results?id=${d.id}`} size="xs" variant="ghost">
                                  Results
                                </ButtonLink>
                              )}
                              {ctx.isCommish && d.status === "SCHEDULED" && (
                                <>
                                  <RescheduleButton draftId={d.id} current={d.startTime ? utcToZonedLocal(d.startTime, tz) : ""} timezone={tz} />
                                  <OrderEditor
                                    draftId={d.id}
                                    label={isAuction ? "Nomination order" : "Draft order"}
                                    teams={roomTeams(isAuction ? ((d.order as string[]) ?? []) : rookieRules(d, settings).teamOrder)}
                                  />
                                </>
                              )}
                              {ctx.isCommish && d.status !== "COMPLETE" && <DraftControls draftId={d.id} status={d.status} type={d.type} hasActivity={done > 0} compact showDelete />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title={`${nextSeason} rookie draft order`}
            subtitle={`${METHOD_LABEL[settings.draft.rookie.orderMethod]} · ${settings.draft.rookie.style === "SNAKE" ? "Snake" : "Linear"} · ${rounds} round${rounds === 1 ? "" : "s"}${settings.draft.rookie.playoffTeamsByFinish ? " · playoff teams by finish" : ""}`}
            actions={
              <div className="flex gap-1.5">
                {settings.draft.rookie.orderMethod === "LOTTERY" && (
                  <ButtonLink href={`/draft/lottery?season=${nextSeason}`} size="xs" variant="gold">
                    <Dices size={13} /> Lottery
                  </ButtonLink>
                )}
                {rookieDraft && (
                  <ButtonLink href={`/draft/rookie?id=${rookieDraft.id}`} size="xs" variant="secondary">
                    Draft room
                  </ButtonLink>
                )}
              </div>
            }
            noPad
          >
            <div className="space-y-2 px-3 pt-3">
              {rookieDraft ? (
                <Alert tone="success">
                  The {rookieDraft.name} is {rookieDraft.status.toLowerCase()}. {manual ? "The commissioner set this order manually." : "Order applied from league settings."}{" "}
                  {order.status === "PROJECTED" && !manual && rookieDraft.status === "SCHEDULED" && "Standings aren't final — the commissioner can reset the order once they are."}
                </Alert>
              ) : order.status === "PROJECTED" ? (
                <Alert tone="info">Projected from the current {order.basisSeason} standings — the order locks in when the season ends{settings.draft.rookie.orderMethod === "LOTTERY" ? " and the lottery is drawn" : ""}.</Alert>
              ) : order.status === "NO_RESULTS" ? (
                <Alert tone="warn">No {order.basisSeason} results yet, so teams are listed in league order. The commissioner can set the order manually after creating the draft.</Alert>
              ) : (
                <Alert tone="success">Final {order.basisSeason} results.</Alert>
              )}
              {order.method === "LOTTERY" && order.lottery?.official && (
                <p className="text-xs text-muted">
                  Lottery drawn {fmtDateTime(order.lottery.drawnAt, tz)} · <Link href={`/draft/lottery?season=${nextSeason}`} className="link">watch the reveal</Link>
                </p>
              )}
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th className="num w-10">Slot</th>
                    <th>Team</th>
                    <th className="num hidden sm:table-cell">Record</th>
                    <th className="num hidden md:table-cell">PF</th>
                    <th className="num hidden md:table-cell" title="Sum of each week's best possible lineup">
                      Potential
                    </th>
                    <th className="hidden lg:table-cell">Basis</th>
                    {Array.from({ length: rounds }, (_, i) => (
                      <th key={i} className="text-center">
                        R{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderRows.map(({ teamId, slot, row }) => {
                    const t = teamById.get(teamId);
                    if (!t) return null;
                    return (
                      <tr key={teamId} className={cn(teamId === ctx.myTeam?.id && "bg-gold-300/10")}>
                        <td className="num font-display text-lg font-bold">{slot}</td>
                        <td className="max-w-[200px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <TeamLogo team={t} size={24} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{t.name}</span>
                              {row?.group === "LOTTERY" && <Badge tone="gold">Lottery</Badge>}
                              {row?.group === "PLAYOFF" && <Badge tone="brand">Playoffs</Badge>}
                            </span>
                          </span>
                        </td>
                        <td className="num hidden text-xs sm:table-cell">{row ? record(row.wins, row.losses, row.ties) : "—"}</td>
                        <td className="num hidden text-xs md:table-cell">{row ? row.pointsFor.toFixed(1) : "—"}</td>
                        <td className="num hidden text-xs md:table-cell">{row ? row.potentialPoints.toFixed(1) : "—"}</td>
                        <td className="hidden text-xs text-muted lg:table-cell">{manual ? "Set by commissioner" : row?.basis}</td>
                        {Array.from({ length: rounds }, (_, i) => {
                          const p = pickOf(teamId, i + 1);
                          const owner = p ? teamById.get(p.ownerTeamId) : null;
                          const traded = p && p.ownerTeamId !== p.originalTeamId;
                          const n = settings.draft.rookie.style === "SNAKE" && (i + 1) % 2 === 0 ? orderRows.length - slot + 1 : slot;
                          return (
                            <td key={i} className={cn("text-center text-xs", traded && "bg-brand-50 dark:bg-brand-900/30")}>
                              <div className="font-semibold">{p?.pickInRound ? roundPickLabel(p.round, p.pickInRound) : roundPickLabel(i + 1, n)}</div>
                              {traded && owner ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-700 dark:text-brand-200" title={`Owned by ${owner.name}`}>
                                  <TeamLogo team={owner} size={14} /> {owner.abbrev}
                                </div>
                              ) : !p ? (
                                <div className="text-[10px] text-muted">no pick</div>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Draft tools" noPad>
            <ul className="divide-y divide-line">
              {[
                { href: "/draft/rookie", icon: ListOrdered, label: "Rookie draft room", desc: "On the clock, board, queue" },
                { href: "/draft/auction", icon: Gavel, label: "Salary auction room", desc: "Nominate, bid, budgets" },
                { href: "/draft/board", icon: LayoutList, label: "My big board", desc: "Rank your rookie class" },
                { href: "/rookies", icon: BookOpen, label: "Rookie rankings", desc: "League consensus, updated daily" },
                { href: `/draft/lottery?season=${nextSeason}`, icon: Dices, label: "Draft lottery", desc: settings.draft.rookie.orderMethod === "LOTTERY" ? "Odds and the official draw" : "Odds simulator" },
                { href: "/draft/results", icon: Trophy, label: "Draft results", desc: "Every completed draft" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-sunken">
                    <l.icon size={18} className="text-brand-600 dark:text-brand-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{l.label}</span>
                      <span className="block text-xs text-muted">{l.desc}</span>
                    </span>
                    <ArrowRight size={14} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          {ctx.isCommish && (
            <>
              <Panel title="Create rookie draft" subtitle="Uses the existing pick assets, including traded picks">
                <CreateRookieDraftForm seasons={creatableRookie} timezone={tz} defaultStart={defaultStart} />
              </Panel>
              <Panel title="Create salary auction" subtitle="Startup or annual free-agent auction">
                <CreateAuctionForm
                  seasons={[league.season, league.season + 1]}
                  defaultOrder={settings.draft.auction.nominationOrder}
                  summary={auctionSummary}
                  timezone={tz}
                  defaultKind={drafts.some((d) => d.type === "AUCTION") ? "FREE_AGENT" : "STARTUP"}
                />
              </Panel>
            </>
          )}
        </div>
      </div>

      <Panel title="Pick ownership ledger" subtitle={`Every team's rookie picks for ${ledgerSeasons[0]}–${ledgerSeasons[ledgerSeasons.length - 1]} · highlighted cells were traded`} noPad>
        {picks.length === 0 ? (
          <div className="p-3">
            <EmptyState title="No future picks yet">Picks are created at the season rollover for the next {years} seasons.</EmptyState>
          </div>
        ) : (
          <PickLedger teams={teams} picks={picks} seasons={ledgerSeasons} rounds={rounds} myTeamId={ctx.myTeam?.id ?? null} />
        )}
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Rows are the team each pick originally belonged to; a team logo means the pick now belongs to that team. Picks get their number (e.g. 1.04) once that season&apos;s draft order is set.
        </p>
      </Panel>
    </div>
  );
}
