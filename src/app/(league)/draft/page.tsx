// Draft Center — "When is the next draft, where do I pick and which picks do I own?"
// Summary strip (my first pick · my picks this draft · picks owned in the window · next draft), a live banner when a
// room is open, shortcut chips to the rooms / boards / results, then the rookie order (phone rows, tap for details;
// the full table from md), the drafts list (commissioner controls inline) and the pick ownership ledger. Order rules,
// tiebreaks and the ledger legend sit behind ⓘ; the commissioner's create forms are collapsed rows.
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight, Dices, Gavel, LayoutList, ListOrdered, Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Chip, Collapsible, EmptyState, MoreLink, PageHeader, Panel, SummaryStrip, ButtonLink } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { firstOpenDraftSeason } from "@/lib/picks";
import { computeRookieOrder } from "@/lib/draft/order";
import { roundPickLabel } from "@/lib/draft/logic";
import { auctionRules, rookieRules } from "@/lib/draft/data";
import { fmtDateTime, utcToZonedLocal } from "@/lib/draft/time";
import { cn, record } from "@/lib/utils";
import { StatusBadge, typeLabel } from "@/components/draft/bits";
import { DraftControls, OrderEditor, RescheduleButton } from "@/components/draft/draft-controls";
import { CreateAuctionForm, CreateRookieDraftForm } from "@/components/draft/create-forms";
import { PickLedger } from "@/components/draft/pick-ledger";
import { DraftKindIcon, DraftOrderList, DraftOrderTable, LiveDraftBanner, type OrderListRow } from "@/components/draft/center";
import { advanceDraft, draftNeedsTick } from "@/lib/draft/tick";

export const metadata: Metadata = { title: "Draft Center" };

const METHOD_LABEL = {
  REVERSE_STANDINGS: "Reverse standings",
  REVERSE_MAX_PF: "Reverse max potential points (best possible lineups)",
  LOTTERY: "Draft lottery",
  // legacy value, applied exactly like REVERSE_MAX_PF (@/lib/draft/logic)
  REVERSE_POTENTIAL_POINTS: "Reverse max potential points (best possible lineups)",
} as const;

const METHOD_SHORT = {
  REVERSE_STANDINGS: "Reverse standings",
  REVERSE_MAX_PF: "Reverse max PF",
  LOTTERY: "Lottery",
  REVERSE_POTENTIAL_POINTS: "Reverse max PF",
} as const;

const TIEBREAK_LABEL = {
  MAX_POTENTIAL_POINTS: "lower max potential points",
  POINTS_FOR: "lower points for",
  POINTS_AGAINST: "higher points against",
  COIN_FLIP: "coin flip",
} as const;

const shortDate = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);

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
  const myTeamId = ctx.myTeam?.id ?? null;
  const rookieDraft = drafts.find((d) => d.type === "ROOKIE" && d.season === nextSeason) ?? null;
  const live = drafts.filter((d) => d.status === "LIVE" || d.status === "PAUSED");
  const rounds = settings.draft.rookie.rounds;
  const snake = settings.draft.rookie.style === "SNAKE";
  const seasonPicks = picks.filter((p) => p.season === nextSeason);
  const pickOf = (teamId: string, round: number) => seasonPicks.find((p) => p.originalTeamId === teamId && p.round === round);
  // order rows: the created draft's stored order wins over the computed one
  const storedOrder = rookieDraft ? rookieRules(rookieDraft, settings).teamOrder : [];
  const orderRows = storedOrder.length
    ? storedOrder.map((id, i) => ({ teamId: id, slot: i + 1, row: order.rows.find((r) => r.teamId === id) }))
    : order.rows.map((r) => ({ teamId: r.teamId, slot: r.slot, row: r }));
  const manual = rookieDraft ? rookieRules(rookieDraft, settings).manualOrder : false;
  const slotOf = new Map(orderRows.map((r) => [r.teamId, r.slot]));
  const labelFor = (originalTeamId: string, round: number, pickInRound: number | null) => {
    if (pickInRound) return roundPickLabel(round, pickInRound);
    const slot = slotOf.get(originalTeamId);
    if (!slot) return `R${round}`;
    return roundPickLabel(round, snake && round % 2 === 0 ? orderRows.length - slot + 1 : slot);
  };
  const lite = (t: (typeof teams)[number]) => ({ id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor });
  const listRows: OrderListRow[] = orderRows.flatMap(({ teamId, slot, row }) => {
    const t = teamById.get(teamId);
    if (!t) return [];
    return [
      {
        team: lite(t),
        slot,
        record: row ? record(row.wins, row.losses, row.ties) : null,
        pointsFor: row ? row.pointsFor.toFixed(1) : null,
        potential: row ? row.potentialPoints.toFixed(1) : null,
        basis: manual ? "Set by the commissioner" : (row?.basis ?? null),
        group: row?.group ?? null,
        picks: Array.from({ length: rounds }, (_, i) => {
          const p = pickOf(teamId, i + 1);
          const owner = p && p.ownerTeamId !== p.originalTeamId ? teamById.get(p.ownerTeamId) : null;
          return { round: i + 1, label: labelFor(teamId, i + 1, p?.pickInRound ?? null), owner: owner ? lite(owner) : null, missing: !p, used: !!p?.playerId };
        }),
      },
    ];
  });

  // summary: where I pick, how many picks I own
  const myNext = myTeamId
    ? seasonPicks
        .filter((p) => p.ownerTeamId === myTeamId && !p.playerId)
        .map((p) => {
          const slot = slotOf.get(p.originalTeamId) ?? 99;
          const inRound = p.pickInRound ?? (snake && p.round % 2 === 0 ? orderRows.length - slot + 1 : slot);
          return { p, overall: (p.round - 1) * orderRows.length + inRound, label: labelFor(p.originalTeamId, p.round, p.pickInRound) };
        })
        .sort((a, b) => a.overall - b.overall)
    : [];
  const myOwned = myTeamId ? picks.filter((p) => p.ownerTeamId === myTeamId && !p.playerId).length : 0;
  const orderFinal = !!rookieDraft || order.status === "FINAL";
  const nextDraft =
    rookieDraft?.status === "LIVE"
      ? { value: "Live", sub: "room open", tone: "live" as const }
      : rookieDraft?.status === "PAUSED"
        ? { value: "Paused", sub: "room open", tone: undefined }
        : rookieDraft?.status === "COMPLETE"
          ? { value: "Done", sub: `${nextSeason} rookie` }
          : rookieDraft?.startTime
            ? { value: shortDate(rookieDraft.startTime, tz), sub: `${nextSeason} rookie`, title: fmtDateTime(rookieDraft.startTime, tz) }
            : { value: "TBD", sub: rookieDraft ? "no date" : "not created" };

  const existingRookieSeasons = new Set(drafts.filter((d) => d.type === "ROOKIE").map((d) => d.season));
  const creatableRookie = ledgerSeasons.filter((s) => !existingRookieSeasons.has(s));
  const a = settings.draft.auction;
  const auctionRulesList = [
    { label: "Budget", value: `$${a.budget}`, sub: settings.salaryCap.enabled ? "or cap space" : undefined },
    { label: "Min bid", value: `$${a.minBid}`, sub: `+$${a.bidIncrement} steps` },
    { label: "Spots", value: a.rosterSpotsToFill, sub: "to fill" },
    { label: "Nominate", value: `${a.nominationSeconds}s`, sub: "clock" },
    { label: "Bid clock", value: `${a.bidSeconds}s`, sub: `resets to ${a.resetSecondsOnBid}s` },
    { label: "Contracts", value: a.contractYearsMode === "WINNER_CHOOSES" ? "Winner" : `${a.fixedContractYears} yr`, sub: a.contractYearsMode === "WINNER_CHOOSES" ? "chooses years" : "fixed" },
  ];
  const maxBidNote = a.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" ? `Max bid keeps $${a.minBid} for each other open spot.` : "Max bid = remaining budget.";
  const defaultStart = settings.draft.rookie.scheduledFor ? utcToZonedLocal(new Date(settings.draft.rookie.scheduledFor), tz) : "";
  const roomTeams = (ids: string[]) =>
    ids.map((id) => teamById.get(id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ ...lite(t), ownerName: null }));

  const statusLine = rookieDraft
    ? manual
      ? "set by the commissioner"
      : rookieDraft.status === "SCHEDULED"
        ? "draft created"
        : rookieDraft.status === "COMPLETE"
          ? "final"
          : "draft under way"
    : order.status === "PROJECTED"
      ? "projected"
      : order.status === "NO_RESULTS"
        ? `no ${order.basisSeason} results yet`
        : "final";
  const orderInfo = (
    <div className="space-y-2">
      <p>
        <strong>Method:</strong> {METHOD_LABEL[settings.draft.rookie.orderMethod]} · {snake ? "snake" : "linear"} · {rounds} round{rounds === 1 ? "" : "s"}.
      </p>
      {settings.draft.rookie.playoffTeamsByFinish && <p>Playoff teams pick in order of finish (the champion picks last).</p>}
      {settings.standings.draftOrderTiebreakers?.length ? <p>Ties: {settings.standings.draftOrderTiebreakers.map((t) => TIEBREAK_LABEL[t]).join(", then ")}.</p> : null}
      {rookieDraft ? (
        <p>
          The {rookieDraft.name} is {rookieDraft.status.toLowerCase()}. {manual ? "The commissioner set this order manually." : "Order applied from league settings."}
          {order.status === "PROJECTED" && !manual && rookieDraft.status === "SCHEDULED" ? " Standings aren't final — the commissioner can reset the order once they are." : ""}
        </p>
      ) : order.status === "PROJECTED" ? (
        <p>
          Projected from the current {order.basisSeason} standings — the order locks in when the season ends{settings.draft.rookie.orderMethod === "LOTTERY" ? " and the lottery is drawn" : ""}.
        </p>
      ) : order.status === "NO_RESULTS" ? (
        <p>No {order.basisSeason} results yet, so teams are listed in league order. The commissioner can set the order manually after creating the draft.</p>
      ) : (
        <p>Final {order.basisSeason} results.</p>
      )}
      {order.method === "LOTTERY" && order.lottery?.official && (
        <p>
          Lottery drawn {fmtDateTime(order.lottery.drawnAt, tz)} ·{" "}
          <Link href={`/draft/lottery?season=${nextSeason}`} className="link">
            watch the reveal
          </Link>
        </p>
      )}
      <p>Max PF = the sum of each week&apos;s best possible lineup. A struck-through pick with a team logo under it now belongs to that team. Tap a row for its record, points and every round.</p>
    </div>
  );

  const tools = [
    { href: rookieDraft ? `/draft/rookie?id=${rookieDraft.id}` : "/draft/rookie", icon: <ListOrdered size={15} />, label: "Rookie room", title: "On the clock, board, queue" },
    { href: "/draft/auction", icon: <Gavel size={15} />, label: "Auction room", title: "Nominate, bid, budgets" },
    { href: `/draft/board?class=${nextSeason}`, icon: <LayoutList size={15} />, label: "My big board", title: "Rank your rookie class" },
    { href: "/rookies", icon: <BookOpen size={15} />, label: "Rankings", title: "League rookie rankings, updated daily" },
    { href: `/draft/lottery?season=${nextSeason}`, icon: <Dices size={15} />, label: "Lottery", title: settings.draft.rookie.orderMethod === "LOTTERY" ? "Odds and the official draw" : "Odds simulator" },
    { href: "/draft/results", icon: <Trophy size={15} />, label: "Results", title: "Every completed draft" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader kicker={`${league.season} season`} title="Draft center" className="!mb-0" />

      <ScrollRow as="nav" aria-label="Draft tools" className="-mx-3 gap-2 px-3 sm:mx-0 sm:px-0">
        {tools.map((t) => (
          <Chip key={t.label} href={t.href} icon={t.icon} title={t.title}>
            {t.label}
          </Chip>
        ))}
      </ScrollRow>

      {live.map((d) => (
        <LiveDraftBanner
          key={d.id}
          href={d.type === "AUCTION" ? `/draft/auction?id=${d.id}` : `/draft/rookie?id=${d.id}`}
          name={d.name}
          status={d.status}
          sub={d.type === "AUCTION" ? `${d._count.lots} sold` : `${d._count.selections}/${Array.isArray(d.order) ? (d.order as unknown[]).length : 0} picks made`}
        />
      ))}

      {myTeamId && (
        <SummaryStrip
          items={[
            { label: "Pick", value: myNext[0]?.label ?? "—", sub: myNext[0] ? (orderFinal ? "my 1st" : "projected") : "none owned", title: myNext[0] ? `Your earliest ${nextSeason} pick${orderFinal ? "" : " (projected)"}` : undefined },
            { label: "Picks", value: myNext.length, sub: `in ${nextSeason}`, title: myNext.length ? `${nextSeason} picks: ${myNext.map((x) => x.label).join(", ")}` : undefined },
            { label: "Owned", value: myOwned, sub: `${ledgerSeasons[0]}–${String(ledgerSeasons[ledgerSeasons.length - 1]).slice(2)}`, title: `Unused picks you own in the ${ledgerSeasons[0]}–${ledgerSeasons[ledgerSeasons.length - 1]} drafts` },
            { label: "Draft", value: nextDraft.value, sub: nextDraft.sub, tone: "tone" in nextDraft ? nextDraft.tone : undefined, title: "title" in nextDraft ? nextDraft.title : `${nextSeason} rookie draft`, href: rookieDraft ? `/draft/rookie?id=${rookieDraft.id}` : undefined },
          ]}
        />
      )}

      <div className={cn("grid gap-4", ctx.isCommish && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
        <div className="min-w-0 space-y-4">
          <Panel
            title={`${nextSeason} draft order`}
            subtitle={`${METHOD_SHORT[settings.draft.rookie.orderMethod]} · ${statusLine}`}
            info={orderInfo}
            infoTitle="How the order is set"
            noPad
            actions={
              rookieDraft ? (
                <MoreLink href={`/draft/rookie?id=${rookieDraft.id}`}>Room</MoreLink>
              ) : settings.draft.rookie.orderMethod === "LOTTERY" ? (
                <MoreLink href={`/draft/lottery?season=${nextSeason}`}>Lottery</MoreLink>
              ) : undefined
            }
          >
            {listRows.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState title="No teams yet" />
              </div>
            ) : (
              <>
                <div className="md:hidden">
                  <DraftOrderList rows={listRows} myTeamId={myTeamId} rounds={rounds} />
                </div>
                <div className="hidden md:block">
                  <DraftOrderTable rows={listRows} myTeamId={myTeamId} rounds={rounds} />
                </div>
              </>
            )}
          </Panel>

          <Panel title="Drafts" subtitle={drafts.length ? `${drafts.length} in league history` : undefined} noPad actions={drafts.some((d) => d.status === "COMPLETE") ? <MoreLink href="/draft/results">Results</MoreLink> : undefined}>
            {drafts.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState title="No drafts yet">{ctx.isCommish ? "Create one under Commissioner." : "The commissioner hasn't created a draft yet."}</EmptyState>
              </div>
            ) : (
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {drafts.map((d) => {
                  const isAuction = d.type === "AUCTION";
                  const total = isAuction ? null : Array.isArray(d.order) ? (d.order as unknown[]).length : 0;
                  const done = isAuction ? d._count.lots : d._count.selections;
                  const kind = isAuction ? auctionRules(d, settings).kind : undefined;
                  const room = isAuction ? `/draft/auction?id=${d.id}` : `/draft/rookie?id=${d.id}`;
                  const when =
                    d.status === "COMPLETE"
                      ? `Done ${d.completedAt ? shortDate(d.completedAt, tz) : ""}`.trim()
                      : d.status === "LIVE"
                        ? "In progress"
                        : d.status === "PAUSED"
                          ? "Paused"
                          : d.startTime
                            ? fmtDateTime(d.startTime, tz, { withZone: false })
                            : "Not scheduled";
                  const progress = isAuction ? (done ? `${done} sold` : d.status === "COMPLETE" ? "Imported" : null) : `${done}/${total} picks`;
                  const commishTools = ctx.isCommish && d.status !== "COMPLETE";
                  return (
                    <li key={d.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <DraftKindIcon type={d.type} label={typeLabel(d.type, kind)} />
                        <div className="min-w-0 flex-1">
                          <Link href={d.status === "COMPLETE" ? `/draft/results?id=${d.id}` : room} title={d.name} className="block truncate text-[15px] font-semibold leading-5 text-ink hover:underline sm:text-sm">
                            {d.name}
                          </Link>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[13px] leading-[18px] text-muted">
                            <StatusBadge status={d.status} />
                            <span className="truncate" title={d.status === "COMPLETE" && d.completedAt ? fmtDateTime(d.completedAt, tz) : undefined}>
                              {[when, progress].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        </div>
                        {d.status !== "COMPLETE" ? (
                          <ButtonLink href={room} size="sm" variant={d.status === "LIVE" ? "primary" : "secondary"} className="shrink-0">
                            {d.status === "LIVE" ? "Enter" : "Room"}
                          </ButtonLink>
                        ) : (
                          <ButtonLink href={`/draft/results?id=${d.id}`} size="sm" variant="secondary" className="shrink-0">
                            Results
                          </ButtonLink>
                        )}
                      </div>
                      {(commishTools || (d.status !== "COMPLETE" && done > 0)) && (
                        <div className="mt-1 flex flex-wrap items-start gap-x-4 pl-[52px]">
                          {d.status !== "COMPLETE" && done > 0 && (
                            <Link href={`/draft/results?id=${d.id}`} className="inline-flex min-h-9 items-center gap-0.5 text-[13px] font-semibold text-brand-600 dark:text-brand-400">
                              Results <ChevronRight size={14} aria-hidden />
                            </Link>
                          )}
                          {commishTools && (
                            <details className="group [&[open]]:basis-full">
                              <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[13px] font-semibold text-brand-600 dark:text-brand-400 [&::-webkit-details-marker]:hidden">
                                Manage <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
                              </summary>
                              <div className="mb-1 mt-1 flex flex-wrap items-center gap-2">
                                {d.status === "SCHEDULED" && (
                                  <>
                                    <RescheduleButton draftId={d.id} current={d.startTime ? utcToZonedLocal(d.startTime, tz) : ""} timezone={tz} />
                                    <OrderEditor draftId={d.id} label={isAuction ? "Nomination order" : "Draft order"} teams={roomTeams(isAuction ? ((d.order as string[]) ?? []) : rookieRules(d, settings).teamOrder)} />
                                  </>
                                )}
                                <DraftControls draftId={d.id} status={d.status} type={d.type} hasActivity={done > 0} compact showDelete />
                              </div>
                            </details>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {ctx.isCommish && (
          <Panel title="Commissioner" subtitle="Create drafts" noPad className="self-start">
            <div className="divide-y divide-line/70 border-t border-line/70 px-4">
              <Collapsible summary={creatableRookie.length ? `Create ${creatableRookie[0]} rookie draft` : "Create rookie draft"} meta={creatableRookie.length ? undefined : "all created"}>
                <CreateRookieDraftForm seasons={creatableRookie} timezone={tz} defaultStart={defaultStart} />
              </Collapsible>
              <Collapsible summary="Create salary auction" meta="startup / FA">
                <CreateAuctionForm
                  seasons={[league.season, league.season + 1]}
                  defaultOrder={settings.draft.auction.nominationOrder}
                  rules={auctionRulesList}
                  note={maxBidNote}
                  timezone={tz}
                  defaultKind={drafts.some((d) => d.type === "AUCTION") ? "FREE_AGENT" : "STARTUP"}
                />
              </Collapsible>
            </div>
          </Panel>
        )}
      </div>

      <Panel
        title="Pick ownership"
        subtitle={`${ledgerSeasons[0]}–${ledgerSeasons[ledgerSeasons.length - 1]} · every team's rookie picks`}
        info={
          <div className="space-y-2">
            <p>Rows are the team each pick originally belonged to. A team logo means the pick now belongs to that team; a grey dot means the original team still owns it.</p>
            <p>Picks get their number (e.g. 1.04) once that season&apos;s draft order is set. &ldquo;Owns&rdquo; counts the unused picks each team holds in this window.</p>
          </div>
        }
        infoTitle="Reading the ledger"
        noPad
      >
        {picks.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState title="No future picks yet">Picks are created at the season rollover for the next {years} seasons.</EmptyState>
          </div>
        ) : (
          <PickLedger teams={teams} picks={picks} seasons={ledgerSeasons} rounds={rounds} myTeamId={myTeamId} />
        )}
      </Panel>
    </div>
  );
}
