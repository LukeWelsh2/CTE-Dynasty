"use client";
// Live salary auction room — "What's on the block, what's the high bid, and what can I spend?"
// Phone order: title (one line of facts, the auction rules in ⓘ) → commissioner bar → THE BLOCK (player, countdown +
// time bar, high bid, three big +$ buttons, custom bid, my max bid / spots / budget, bid history) or the nomination card
// → who nominates next → [Players | Targets | Teams | Sales] (best available rows, my targets with max bids, team
// budgets as rows that expand, recent sales). A compact bar with the lot + high bid + clock pins to the top once the
// block scrolls away. lg+: everything at once (targets + sales in the rail, budgets as a table).
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Clock, Gavel, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, Badge, Button, ButtonLink, EmptyState, Meter, Panel, StatGrid, TeamLogo } from "@/components/ui/core";
import { HeadshotBadge, PosPill } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { fmtCountdown, fmtDateTime } from "@/lib/draft/time";
import { bidAction, nominateAction, queueAddAction, queueRemoveAction, setMaxBidAction } from "@/lib/draft/actions";
import type { AuctionLotView, AuctionRoomState, RoomPlayer, RoomTeam } from "@/lib/draft/types";
import { useNow, useRoomAction, useRoomState } from "./use-room";
import { DraftControls } from "./draft-controls";
import { Money, PlayerCell, shortName } from "./bits";
import { FixedClockBar, PosChips, RoomHeader, RoomTabs, useScrolledPast } from "./room-bits";

type Tab = "players" | "targets" | "teams" | "sales";

export function AuctionRoom({ initial, timezone }: { initial: AuctionRoomState; timezone: string }) {
  const { state, refetch, offset, connected, markActed } = useRoomState(initial, {
    onEvent: (type, data, mine) => {
      // sales are always announced (they happen on the clock); undo/status only to the other managers
      if ((type === "auction.sold" || (!mine && (type === "draft.undo" || type === "draft.status"))) && typeof data.message === "string") toast(data.message);
    },
  });
  const { pending, run } = useRoomAction(refetch, markActed);
  const [actAs, setActAs] = useState<string | null>(initial.myTeamId ?? initial.teams[0]?.id ?? null);
  const [nominee, setNominee] = useState<RoomPlayer | null>(null);
  const [tab, setTab] = useState<Tab>("players");
  const d = state.draft;
  const teamsById = useMemo(() => new Map(state.teams.map((t) => [t.id, t])), [state.teams]);
  const budgetsById = useMemo(() => new Map(state.budgets.map((b) => [b.teamId, b])), [state.budgets]);
  const acting = state.isCommish ? actAs : state.myTeamId;
  const myBudget = acting ? budgetsById.get(acting) : undefined;
  const lot = state.openLot;
  const myTurn = d.status === "LIVE" && !lot && !!state.nominatorTeamId && (state.nominatorTeamId === state.myTeamId || state.isCommish);
  const targetIds = useMemo(() => new Set(state.targets.map((t) => t.player.id)), [state.targets]);
  const nominator = state.nominatorTeamId ? teamsById.get(state.nominatorTeamId) : null;

  const pickNominee = (p: RoomPlayer) => {
    setNominee(p);
    document.getElementById("auction-block")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const toggleTarget = (p: RoomPlayer) =>
    targetIds.has(p.id)
      ? run(`t-${p.id}`, () => queueRemoveAction({ draftId: d.id, playerId: p.id }), { quiet: true })
      : run(`t-${p.id}`, () => queueAddAction({ draftId: d.id, playerId: p.id }));

  const kindLabel = d.auctionKind === "FREE_AGENT" ? "Free-agent auction" : "Salary auction";
  const rules = (
    <div className="space-y-3">
      <StatGrid
        cols={3}
        items={[
          { label: "Budget", value: `$${d.budget}`, sub: d.capEnabled ? "or cap space" : undefined },
          { label: "Min bid", value: `$${d.minBid}`, sub: `+$${d.bidIncrement} steps` },
          { label: "Spots", value: d.rosterSpotsToFill, sub: "to fill" },
          { label: "Bid clock", value: `${d.bidSeconds}s`, sub: `resets to ${d.resetSecondsOnBid}s` },
          { label: "Nominate", value: `${d.nominationSeconds}s`, sub: d.autoNominateOnTimeout ? "then auto" : "then skipped" },
          { label: "Contracts", value: d.contractYearsMode === "WINNER_CHOOSES" ? "Winner" : `${d.yearOptions[0]} yr`, sub: d.contractYearsMode === "WINNER_CHOOSES" ? "picks years" : "fixed" },
        ]}
      />
      <p>
        Left = {d.capEnabled ? "the lesser of budget left and cap space" : "budget left"}.{" "}
        {d.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" ? `Your max bid keeps $${d.minBid} for each other open roster spot.` : "Your max bid is your remaining budget."}
      </p>
      {d.proxyBidding && <p>Proxy bidding is on: a max bid on a target bids for you, one step at a time, even while you&apos;re away.</p>}
      <p>Nomination order: {d.nominationOrder === "RANDOM" ? "random" : d.nominationOrder === "REVERSE_STANDINGS" ? "reverse standings" : "set by the commissioner"}.</p>
    </div>
  );

  const tabs: { key: Tab; label: React.ReactNode }[] = [
    { key: "players", label: "Players" },
    ...(state.myTeamId ? [{ key: "targets" as Tab, label: <span>Targets{state.targets.length ? <span className="numeral ml-1 text-muted">{state.targets.length}</span> : null}</span> }] : []),
    { key: "teams", label: "Teams" },
    { key: "sales", label: <span>Sales{state.soldCount ? <span className="numeral ml-1 text-muted">{state.soldCount}</span> : null}</span> },
  ];
  // phones show one section at a time; lg shows them all
  const show = (k: Tab) => cn(tab !== k && "hidden lg:block");

  return (
    <div className="space-y-4">
      <RoomHeader
        eyebrow={`${kindLabel} · ${d.season}`}
        name={d.name}
        status={d.status}
        facts={`${state.soldCount} sold · $${d.budget} budget · min $${d.minBid} · ${d.bidSeconds}s clock`}
        info={rules}
        connected={connected}
        actions={
          <ButtonLink href={`/draft/results?id=${d.id}`} variant="secondary" size="sm">
            Results
          </ButtonLink>
        }
      />

      {state.isCommish && (
        <section className="card space-y-2 px-4 py-3" aria-label="Commissioner controls">
          <div className="eyebrow">Commissioner</div>
          <DraftControls draftId={d.id} status={d.status} type="AUCTION" hasActivity={state.soldCount > 0 || state.recent.length > 0 || !!lot} onChanged={refetch} onBeforeAction={markActed} compact />
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-[13px] font-semibold text-muted" title="Bid and nominate on behalf of">
              Act as
            </span>
            <select className="input h-10 min-w-0 flex-1 py-0 sm:max-w-xs" value={actAs ?? ""} onChange={(e) => setActAs(e.target.value || null)}>
              {state.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === state.myTeamId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <div id="auction-block" className="scroll-mt-16">
            {lot ? (
              <Block lot={lot} state={state} offset={offset} acting={acting} teamsById={teamsById} budget={myBudget} pending={pending} run={run} />
            ) : (
              <NominationBlock
                state={state}
                offset={offset}
                nominator={nominator ?? null}
                myTurn={myTurn}
                actingNominator={state.isCommish ? state.nominatorTeamId : state.myTeamId}
                budget={state.nominatorTeamId ? budgetsById.get(state.nominatorTeamId) : undefined}
                nominee={nominee}
                setNominee={setNominee}
                pending={pending}
                run={run}
                timezone={timezone}
              />
            )}
          </div>
          <NominationStrip state={state} teamsById={teamsById} />
          <div className="lg:hidden">
            <RoomTabs tabs={tabs} value={tab} onChange={setTab} />
          </div>
          <div className={show("teams")}>
            <BudgetsTable state={state} teamsById={teamsById} />
          </div>
        </div>
        <aside className="space-y-4 lg:row-span-2">
          <div className={show("targets")}>
            <TargetsPanel state={state} myTurn={myTurn} onNominate={pickNominee} run={run} pending={pending} />
          </div>
          <div className={show("sales")}>
            <RecentSales state={state} teamsById={teamsById} />
          </div>
        </aside>
        <div className={cn("min-w-0 lg:col-start-1", show("players"))}>
          <BestAvailable state={state} myTurn={myTurn} targetIds={targetIds} onTarget={toggleTarget} onNominate={pickNominee} pending={pending} />
        </div>
      </div>
    </div>
  );
}

type Run = (key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, opts?: { quiet?: boolean }) => Promise<boolean>;

function Block({
  lot,
  state,
  offset,
  acting,
  teamsById,
  budget,
  pending,
  run,
}: {
  lot: AuctionLotView;
  state: AuctionRoomState;
  offset: number;
  acting: string | null;
  teamsById: Map<string, RoomTeam>;
  budget: AuctionRoomState["budgets"][number] | undefined;
  pending: string | null;
  run: Run;
}) {
  const now = useNow(offset, 200, state.serverNow);
  const { ref, past } = useScrolledPast<HTMLElement>();
  const d = state.draft;
  const minNext = lot.currentBid + Math.max(1, d.bidIncrement);
  const [amount, setAmount] = useState(minNext);
  const [showBids, setShowBids] = useState(false);
  const yearChoices = d.yearOptions.filter((y) => y <= (budget?.maxYears ?? Infinity));
  const yearOptions = yearChoices.length ? yearChoices : d.yearOptions.slice(0, 1);
  const defaultYears = Math.min(d.defaultYears, yearOptions[yearOptions.length - 1]);
  const [years, setYears] = useState(defaultYears);
  useEffect(() => setAmount((a) => (a < minNext ? minNext : a)), [minNext]);
  useEffect(() => setYears(defaultYears), [lot.id, defaultYears]);
  const endsAt = lot.endsAt ? new Date(lot.endsAt).getTime() : null;
  const left = endsAt ? Math.max(0, endsAt - now) : null;
  const leader = lot.currentBidTeamId ? teamsById.get(lot.currentBidTeamId) : null;
  const iLead = !!acting && lot.currentBidTeamId === acting;
  const maxBid = budget?.maxBid ?? 0;
  const canBid = d.status === "LIVE" && !!acting && !iLead && (budget?.openSpots ?? 0) > 0 && maxBid >= minNext && (left ?? 1) > 0;
  const bid = (value: number) => run("bid", () => bidAction({ draftId: d.id, lotId: lot.id, amount: value, years: d.contractYearsMode === "WINNER_CHOOSES" ? years : null, teamId: state.isCommish ? acting : null }));
  const clockMax = Math.max(d.bidSeconds, d.resetSecondsOnBid) * 1000;
  const urgent = left !== null && left < 5000;
  const quick = [Math.max(1, d.bidIncrement), 5, 10].filter((v, i, a) => a.indexOf(v) === i);
  const nominatedBy = teamsById.get(lot.nominatedByTeamId);
  const actingTeam = acting ? teamsById.get(acting) : null;
  const blocked = !acting
    ? null
    : iLead
      ? null
      : (budget?.openSpots ?? 0) === 0
        ? "Roster full — no open spots"
        : maxBid < minNext
          ? `Max bid $${maxBid} — can't reach $${minNext}`
          : null;
  const bids = showBids ? lot.bids : lot.bids.slice(0, 3);
  return (
    <>
      <section ref={ref} className="card overflow-hidden" aria-live="polite" aria-label="On the block">
        <div className="px-4 pb-3 pt-3.5">
          <div className="flex items-start gap-3">
            <HeadshotBadge player={lot.player} nflTeam={lot.player.team} size={60} />
            <div className="min-w-0 flex-1">
              <div className="eyebrow flex items-center gap-1.5 text-live">
                {d.status === "LIVE" && <span aria-hidden className="live-dot h-2 w-2 bg-live" />}
                On the block
              </div>
              <div title={lot.player.fullName} className="truncate text-[20px] font-bold leading-6 tracking-[-0.01em] text-ink sm:text-[22px]">
                {lot.player.fullName}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-muted">
                <PosPill pos={lot.player.position} />
                <span className="shrink-0 font-medium text-ink">{lot.player.team ?? "FA"}</span>
                <span className="truncate">
                  {[lot.player.age ? `Age ${lot.player.age}` : null, lot.player.adp ? `ADP ${Math.round(lot.player.adp)}` : null, `lot ${lot.sequence}`].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className={cn("numeral shrink-0 text-[32px] font-semibold leading-none tracking-[-0.03em] sm:text-[36px]", urgent ? "text-live" : "text-ink")}>{left !== null ? fmtCountdown(left) : "—"}</div>
            <div className="min-w-0 flex-1">
              {left !== null && d.status === "LIVE" && <Meter value={left} max={clockMax} tone={urgent ? "bad" : "brand"} label="Time left on the bid clock" />}
              <div className="mt-1.5 text-[12px] font-medium text-muted">{d.status === "PAUSED" ? "Clock stopped · paused" : left === 0 ? "Closing…" : `Sold at 0:00 · resets to ${d.resetSecondsOnBid}s on a bid`}</div>
            </div>
          </div>
        </div>

        {/* high bid */}
        <div className={cn("flex items-center gap-3 border-t border-line/70 px-4 py-3", iLead ? "bg-win/[0.07]" : "bg-sunken/60")}>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">High bid</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[15px]">
              {leader && <TeamLogo team={leader} size={22} />}
              <span className={cn("truncate font-semibold", iLead ? "text-win" : "text-ink")} title={leader?.name}>
                {iLead ? "You're winning" : leader?.name ?? "No bids"}
              </span>
              {iLead && <Check size={16} className="shrink-0 text-win" aria-hidden />}
            </div>
            <div className="mt-0.5 truncate text-[13px] text-muted">
              {d.contractYearsMode === "WINNER_CHOOSES" ? `${lot.contractYears} yr${lot.contractYears === 1 ? "" : "s"} · ` : ""}nominated by {nominatedBy?.abbrev ?? "?"}
            </div>
          </div>
          <div className={cn("numeral shrink-0 text-[40px] font-semibold leading-none tracking-[-0.035em] sm:text-[48px]", iLead ? "text-win" : "text-ink")}>${lot.currentBid}</div>
        </div>

        {/* bidding */}
        <div className="space-y-3 border-t border-line/70 px-4 py-3">
          {acting ? (
            <>
              {state.isCommish && actingTeam && acting !== state.myTeamId && (
                <p className="text-[13px] text-muted">
                  Bidding as <strong className="text-ink">{actingTeam.name}</strong>
                </p>
              )}
              <div className="grid max-w-xl grid-cols-3 gap-2">
                {quick.map((inc) => {
                  const v = lot.currentBid + inc;
                  return (
                    <Button key={inc} size="lg" className="h-12 flex-col gap-0 px-1 leading-tight" disabled={!canBid || v > maxBid || pending === "bid"} onClick={() => bid(v)} aria-label={`Bid $${v} (+$${inc})`}>
                      <span className="numeral text-[17px] font-bold">${v}</span>
                      <span className="text-[12px] font-medium opacity-80">+${inc}</span>
                    </Button>
                  );
                })}
              </div>
              <form
                className="flex max-w-xl items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canBid) void bid(amount);
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="label">Custom bid</span>
                  <span className="relative block">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-muted">$</span>
                    <input id="bid-amount" type="number" inputMode="numeric" className="input h-11 pl-7" min={minNext} max={maxBid} value={amount} onChange={(e) => setAmount(Math.round(Number(e.target.value) || 0))} />
                  </span>
                </label>
                {d.contractYearsMode === "WINNER_CHOOSES" && (
                  <label className="w-[84px] shrink-0">
                    <span className="label">Years</span>
                    <select className="input h-11 py-0" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Button type="submit" size="lg" className="shrink-0" disabled={!canBid || amount < minNext || amount > maxBid || pending === "bid"}>
                  <Gavel size={16} /> Bid ${amount}
                </Button>
              </form>
              {blocked && <p className="text-[13px] font-semibold text-loss">{blocked}</p>}
              <div className="max-w-xl rounded-lg bg-sunken px-3 py-2.5">
                <StatGrid
                  cols={3}
                  items={[
                    { label: "Max bid", value: `$${maxBid}`, tone: maxBid < minNext ? "bad" : undefined },
                    { label: "Spots", value: budget?.openSpots ?? 0, sub: "open" },
                    { label: "Left", value: `$${budget?.remaining ?? 0}`, sub: d.contractYearsMode === "WINNER_CHOOSES" && budget && budget.maxYears < d.yearOptions[d.yearOptions.length - 1] ? `≤ ${budget.maxYears} yrs` : undefined },
                  ]}
                />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted">You don&apos;t manage a team in this league, so you can watch but not bid.</p>
          )}
          {lot.bids.length > 0 && (
            <div>
              <div className="eyebrow mb-1">Bids</div>
              <ol className="divide-y divide-line/70" aria-label="Bid history">
                {bids.map((b, i) => {
                  const t = teamsById.get(b.teamId);
                  return (
                    <li key={`${b.at}-${i}`} className="flex min-h-9 items-center gap-2 text-[14px]">
                      <span className={cn("numeral w-12 font-semibold", i === 0 ? "text-ink" : "text-muted")}>${b.amount}</span>
                      {t && <TeamLogo team={t} size={18} />}
                      <span className={cn("min-w-0 truncate", i === 0 ? "font-semibold text-ink" : "text-muted")}>{t?.name ?? "?"}</span>
                    </li>
                  );
                })}
              </ol>
              {lot.bids.length > 3 && (
                <button type="button" onClick={() => setShowBids((v) => !v)} className="mt-1 inline-flex min-h-9 items-center gap-1 text-[13px] font-semibold text-brand-600 dark:text-brand-400" aria-expanded={showBids}>
                  {showBids ? "Fewer bids" : `All ${lot.bids.length} bids`} <ChevronDown size={14} className={cn("transition-transform", showBids && "rotate-180")} />
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      <FixedClockBar show={past} tone={iLead ? "mine" : urgent ? "urgent" : undefined} label="Back to the block" onTap={() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
        <HeadshotBadge player={lot.player} nflTeam={null} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">Lot {lot.sequence} · {shortName(lot.player.fullName, lot.player.position)}</span>
          <span className={cn("block truncate text-[15px] font-bold leading-5", iLead ? "text-win" : "text-ink")}>
            <span className="numeral">${lot.currentBid}</span> {iLead ? "you" : leader?.abbrev ?? ""}
          </span>
        </span>
        <span className={cn("numeral text-[22px] font-semibold leading-none tracking-[-0.02em]", urgent ? "text-live" : "text-ink")}>{left !== null ? fmtCountdown(left) : "—"}</span>
      </FixedClockBar>
    </>
  );
}

function NominationBlock({
  state,
  offset,
  nominator,
  myTurn,
  actingNominator,
  budget,
  nominee,
  setNominee,
  pending,
  run,
  timezone,
}: {
  state: AuctionRoomState;
  offset: number;
  nominator: RoomTeam | null;
  myTurn: boolean;
  actingNominator: string | null;
  budget: AuctionRoomState["budgets"][number] | undefined;
  nominee: RoomPlayer | null;
  setNominee: (p: RoomPlayer | null) => void;
  pending: string | null;
  run: Run;
  timezone: string;
}) {
  const now = useNow(offset, 250, state.serverNow);
  const d = state.draft;
  const fixedOpening = d.nominatorOpeningBid === "MIN_BID";
  const [opening, setOpening] = useState(d.minBid);
  const yearChoices = d.yearOptions.filter((y) => y <= (budget?.maxYears ?? Infinity));
  const yearOptions = yearChoices.length ? yearChoices : d.yearOptions.slice(0, 1);
  const [years, setYears] = useState(Math.min(d.defaultYears, yearOptions[yearOptions.length - 1]));
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<RoomPlayer[] | null>(null);
  const term = q.trim().toLowerCase();
  const matches = useMemo(() => (term.length < 2 ? [] : state.bestAvailable.filter((p) => p.fullName.toLowerCase().includes(term)).slice(0, 8)), [term, state.bestAvailable]);
  useEffect(() => {
    if (term.length < 2 || matches.length) {
      setRemote(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/draft/${d.id}/players?q=${encodeURIComponent(term)}`);
      const json = (await res.json().catch(() => ({}))) as { players?: RoomPlayer[] };
      setRemote(json.players ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [term, matches.length, d.id]);
  const left = d.pickDeadline ? Math.max(0, new Date(d.pickDeadline).getTime() - now) : null;

  if (d.status === "COMPLETE") {
    return (
      <div className="card flex flex-wrap items-center gap-3 px-4 py-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-win/10 text-win" aria-hidden>
          <Check size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold">Auction complete</div>
          <div className="text-[13px] text-muted">
            {state.soldCount} players sold{d.completedAt ? ` · finished ${fmtDateTime(d.completedAt, timezone)}` : ""}
          </div>
        </div>
        <ButtonLink href={`/draft/results?id=${d.id}`} size="md">
          View results
        </ButtonLink>
      </div>
    );
  }
  if (d.status === "SCHEDULED") {
    const startsIn = d.startTime ? new Date(d.startTime).getTime() - now : null;
    return (
      <div className="card px-4 py-4">
        <div className="eyebrow">Not started</div>
        {startsIn !== null && startsIn > 0 ? (
          <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="numeral text-[34px] font-semibold leading-none tracking-[-0.03em]">{fmtCountdown(startsIn)}</div>
            <div className="text-[13px] text-muted">Starts {fmtDateTime(d.startTime, timezone)}</div>
          </div>
        ) : (
          <div className="mt-1 text-[17px] font-bold">Waiting for the commissioner to open bidding</div>
        )}
        <p className="mt-2 text-[13px] text-muted">
          First to nominate: <strong className="text-ink">{nominator?.name ?? "—"}</strong>. {d.proxyBidding ? "Set targets and max bids below — auto-bids work while you're away." : "Star your targets — if your nomination clock runs out, your top target is nominated for you."}
        </p>
      </div>
    );
  }
  const nominate = (p: RoomPlayer) =>
    run("nominate", () => nominateAction({ draftId: d.id, playerId: p.id, openingBid: fixedOpening ? d.minBid : opening, years: d.contractYearsMode === "WINNER_CHOOSES" ? years : null })).then((ok) => {
      if (ok) {
        setNominee(null);
        setQ("");
        setOpening(d.minBid);
      }
    });
  const list = remote ?? matches;
  const mine = !!nominator && nominator.id === state.myTeamId;
  const total = d.nominationSeconds * 1000;
  return (
    <section className={cn("card px-4 pb-4 pt-3.5", mine && d.status === "LIVE" && "mine")} aria-label="Nomination">
      <div className="flex items-start gap-3">
        {nominator ? <TeamLogo team={nominator} size={48} round /> : <Clock size={40} className="text-faint" />}
        <div className="min-w-0 flex-1">
          <div className={cn("eyebrow", mine ? "text-brand-600 dark:text-brand-400" : undefined)}>{d.status === "PAUSED" ? "Paused" : mine ? "Your turn to nominate" : "Now nominating"}</div>
          <div title={nominator?.name} className="truncate text-[20px] font-bold leading-6 tracking-[-0.01em]">
            {nominator?.name ?? "No team can nominate"}
          </div>
          {budget && (
            <div className="mt-0.5 text-[13px] text-muted">
              Max bid <span className="numeral font-semibold text-ink">${budget.maxBid}</span> · {budget.openSpots} spots
            </div>
          )}
        </div>
      </div>
      {d.status === "LIVE" && left !== null && (
        <div className="mt-3 flex items-center gap-3">
          <div className={cn("numeral shrink-0 text-[32px] font-semibold leading-none tracking-[-0.03em]", left < 10_000 ? "text-live" : "text-ink")}>{fmtCountdown(left)}</div>
          <div className="min-w-0 flex-1">
            {total > 0 && <Meter value={left} max={total} tone={left < 10_000 ? "bad" : "brand"} label="Time left to nominate" />}
            <div className="mt-1.5 text-[12px] font-medium text-muted">to nominate · {d.autoNominateOnTimeout ? "then auto-nominated" : "then the turn is skipped"}</div>
          </div>
        </div>
      )}
      {myTurn && actingNominator && (
        <div className="mt-3 space-y-3 border-t border-line/70 pt-3">
          {nominee ? (
            <div className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2">
              <span className="min-w-0 flex-1">
                <PlayerCell player={nominee} size={40} sub={nominee.adp ? <span className="text-muted">· ADP {Math.round(nominee.adp)}</span> : null} />
              </span>
              <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel" aria-label="Choose a different player" onClick={() => setNominee(null)}>
                <X size={18} />
              </button>
            </div>
          ) : (
            <div>
              <label className="relative block">
                <span className="sr-only">Find a player to nominate</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input className="input h-11 rounded-full pl-9" type="search" placeholder="Search any free agent" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              {list.length > 0 && (
                <ul className="mt-2 divide-y divide-line/70 overflow-hidden rounded-lg ring-1 ring-inset ring-line">
                  {list.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken" onClick={() => setNominee(p)}>
                        <PosPill pos={p.position} />
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.fullName}</span>
                        <span className="shrink-0 text-[13px] text-muted">
                          {p.team ?? "FA"}
                          {p.adp ? ` · ADP ${Math.round(p.adp)}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {term.length >= 2 && remote && remote.length === 0 && <p className="mt-2 text-[13px] text-muted">No un-rostered player matches “{q}”.</p>}
              {term.length < 2 && <p className="mt-2 text-[13px] text-muted">Or tap Nominate on a player below.</p>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="label">{fixedOpening ? "Opening bid (min)" : "Opening bid"}</span>
              <span className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-muted">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="input h-11 pl-7"
                  min={d.minBid}
                  max={budget?.maxBid}
                  value={fixedOpening ? d.minBid : opening}
                  disabled={fixedOpening}
                  onChange={(e) => setOpening(Math.round(Number(e.target.value) || 0))}
                />
              </span>
            </label>
            {d.contractYearsMode === "WINNER_CHOOSES" && (
              <label className="w-[96px] shrink-0">
                <span className="label">Years</span>
                <select className="input h-11 py-0" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y} yr{y === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button size="lg" className="shrink-0" disabled={!nominee || pending === "nominate" || (!fixedOpening && (opening < d.minBid || (budget ? opening > budget.maxBid : false)))} onClick={() => nominee && nominate(nominee)}>
              <Gavel size={16} /> {pending === "nominate" ? "…" : "Nominate"}
            </Button>
          </div>
          {state.isCommish && nominator && nominator.id !== state.myTeamId && (
            <Alert tone="warn" className="text-[13px]">
              Commissioner nomination for <strong>{nominator.name}</strong>.
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}

function NominationStrip({ state, teamsById }: { state: AuctionRoomState; teamsById: Map<string, RoomTeam> }) {
  if (!state.nominatorTeamId) return null;
  const ids = [state.nominatorTeamId, ...state.upNext];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="eyebrow shrink-0" title={state.draft.nominationOrder === "RANDOM" ? "Random order" : state.draft.nominationOrder === "REVERSE_STANDINGS" ? "Reverse standings" : "Custom order"}>
        {state.openLot ? "Next up" : "Nominating"}
      </span>
      <div className="scroll-thin scroll-fade -mr-3 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-3 sm:mr-0 sm:pr-0" aria-label="Nomination order">
        {ids.map((id, i) => {
          const t = teamsById.get(id);
          if (!t) return null;
          const mine = id === state.myTeamId;
          return (
            <span
              key={`${id}-${i}`}
              title={t.name}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold",
                i === 0 ? "bg-ink text-panel" : "bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]",
                mine && i !== 0 && "text-brand-600 shadow-[inset_0_0_0_1.5px_rgb(var(--c-accent))] dark:text-brand-400",
              )}
            >
              <TeamLogo team={t} size={18} /> {t.abbrev}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BudgetsTable({ state, teamsById }: { state: AuctionRoomState; teamsById: Map<string, RoomTeam> }) {
  const rows = [...state.budgets].sort((a, b) => b.maxBid - a.maxBid);
  const top = Math.max(1, ...rows.map((r) => r.maxBid));
  const d = state.draft;
  const info = (
    <div className="space-y-2">
      <p>Left = {d.capEnabled ? "the lesser of budget left and cap space" : "budget left"}.</p>
      {d.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" && <p>Max bid keeps ${d.minBid} for each other open roster spot.</p>}
      {d.capEnabled && <p>Cap space is for the {d.season} season.</p>}
    </div>
  );
  return (
    <Panel title="Team budgets" subtitle="By max bid" info={info} noPad>
      {/* phones: ranked rows (max bid bar), tap for spent, cap space and players won */}
      <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
        {rows.map((b) => {
          const t = teamsById.get(b.teamId);
          const mine = b.teamId === state.myTeamId;
          const won = state.positions.filter((p) => b.wonByPosition[p]);
          return (
            <li key={b.teamId}>
              <details className={cn("group", mine && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]")}>
                <summary className={cn("flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden", mine && "bg-brand-600/[0.05] dark:bg-brand-400/[0.08]")}>
                  {t && <TeamLogo team={t} size={28} />}
                  <span className="min-w-0 flex-1">
                    <span title={t?.name} className={cn("block truncate text-[15px] font-semibold leading-5", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                      {t?.name ?? "?"}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <Meter value={b.maxBid} max={top} tone={mine ? "brand" : "neutral"} className="max-w-[140px]" label={`Max bid $${b.maxBid}`} />
                      <span className="shrink-0 text-[12px] text-muted">
                        {b.openSpots} spot{b.openSpots === 1 ? "" : "s"}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="numeral block text-[17px] font-semibold leading-5 text-ink">${b.maxBid}</span>
                    <span className="block text-[12px] text-muted">max bid</span>
                  </span>
                  <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="space-y-3 border-t border-line/70 bg-sunken px-4 py-3">
                  <StatGrid
                    cols={3}
                    items={[
                      { label: "Spent", value: <Money value={b.spent} /> },
                      { label: "Left", value: <Money value={b.remaining} />, sub: d.capEnabled && b.capSpace !== null && b.capSpace < d.budget - b.spent ? "cap-limited" : undefined },
                      d.capEnabled ? { label: "Cap space", value: <Money value={b.capSpace} /> } : { label: "Won", value: b.won },
                    ]}
                  />
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                    <span className="eyebrow">Won</span>
                    {won.length ? (
                      won.map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 text-ink">
                          <PosPill pos={p} /> {b.wonByPosition[p]}
                        </span>
                      ))
                    ) : (
                      <span>nobody yet</span>
                    )}
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {/* md+: the table */}
      <div className="scroll-thin hidden overflow-x-auto md:block">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">Spent</th>
              <th className="num">Left</th>
              <th className="num">Max bid</th>
              <th className="num">Spots</th>
              {d.capEnabled && (
                <th className="num" title={`Cap space for the ${d.season} season`}>
                  Cap space
                </th>
              )}
              <th>Won</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const t = teamsById.get(b.teamId);
              return (
                <tr key={b.teamId} className={cn(b.teamId === state.myTeamId && "row-mine")}>
                  <td className="max-w-[200px]">
                    <span className="flex min-w-0 items-center gap-2">
                      {t && <TeamLogo team={t} size={22} />}
                      <span className="truncate font-semibold" title={t?.name}>
                        {t?.name}
                      </span>
                    </span>
                  </td>
                  <td className="num">
                    <Money value={b.spent} />
                  </td>
                  <td className="num" title={d.capEnabled && b.capSpace !== null && b.capSpace < d.budget - b.spent ? "Limited by cap space" : undefined}>
                    <Money value={b.remaining} />
                  </td>
                  <td className="num font-semibold">
                    <Money value={b.maxBid} />
                  </td>
                  <td className="num">{b.openSpots}</td>
                  {d.capEnabled && (
                    <td className="num">
                      <Money value={b.capSpace} />
                    </td>
                  )}
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {state.positions.filter((p) => b.wonByPosition[p]).map((p) => (
                        <span key={p} className="inline-flex items-center gap-1 text-[12px]">
                          <PosPill pos={p} />
                          {b.wonByPosition[p]}
                        </span>
                      ))}
                      {b.won === 0 && <span className="text-faint">—</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RecentSales({ state, teamsById }: { state: AuctionRoomState; teamsById: Map<string, RoomTeam> }) {
  const [all, setAll] = useState(false);
  const rows = all ? state.recent : state.recent.slice(0, 5);
  return (
    <Panel title="Recent sales" subtitle={state.soldCount ? `${state.soldCount} sold` : undefined} noPad>
      {state.recent.length === 0 ? (
        <p className="border-t border-line/70 px-4 py-4 text-[13px] text-muted">No players sold yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-line/70 border-t border-line/70">
            {rows.map((l) => {
              const t = l.winnerTeamId ? teamsById.get(l.winnerTeamId) : null;
              return (
                <li key={l.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm" title={l.player.fullName}>
                      {l.player.fullName}
                    </span>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <PosPill pos={l.player.position} /> {l.player.team ?? "FA"}
                    </span>
                  </span>
                  {l.status === "SOLD" ? (
                    <>
                      {t && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ink" title={t.name}>
                          <TeamLogo team={t} size={20} /> {t.abbrev}
                        </span>
                      )}
                      <span className="w-12 shrink-0 text-right">
                        <span className="numeral block text-[15px] font-semibold text-ink">${l.currentBid}</span>
                        <span className="block text-[12px] text-muted">{l.contractYears} yr</span>
                      </span>
                    </>
                  ) : (
                    <Badge>Passed</Badge>
                  )}
                </li>
              );
            })}
          </ul>
          {state.recent.length > 5 && (
            <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="flex min-h-12 w-full items-center justify-center gap-1 border-t border-line/70 text-[14px] font-semibold text-brand-600 dark:text-brand-400">
              {all ? "Show less" : `Show ${state.recent.length - 5} more`} <ChevronDown size={15} className={cn("transition-transform", all && "rotate-180")} />
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function TargetsPanel({ state, myTurn, onNominate, run, pending }: { state: AuctionRoomState; myTurn: boolean; onNominate: (p: RoomPlayer) => void; run: Run; pending: string | null }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!state.myTeamId) return null;
  const save = (playerId: string) => {
    const raw = drafts[playerId];
    if (raw === undefined) return;
    const v = raw.trim() === "" ? null : Math.max(0, Math.round(Number(raw)));
    void run(`m-${playerId}`, () => setMaxBidAction({ draftId: state.draft.id, playerId, maxBid: v })).then(() =>
      setDrafts((d) => {
        const n = { ...d };
        delete n[playerId];
        return n;
      }),
    );
  };
  return (
    <Panel
      title="My targets"
      subtitle={state.draft.proxyBidding ? "Max bids auto-bid for you" : "Your private wish list"}
      info={
        <div className="space-y-2">
          <p>Star players in the list to track them here. Only you see your targets.</p>
          {state.draft.proxyBidding && <p>A max bid turns on proxy bidding for that player: the room bids for you, one step at a time, up to your max.</p>}
          {state.draft.autoNominateOnTimeout && <p>If your nomination clock runs out, your top available target is nominated for you.</p>}
        </div>
      }
      noPad
    >
      {state.targets.length === 0 ? (
        <p className="border-t border-line/70 px-4 py-4 text-[13px] text-muted">
          Tap <Star size={13} className="inline align-[-2px]" aria-label="star" /> on a player to target him.
        </p>
      ) : (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {state.targets.map((t) => (
            <li key={t.player.id} className={cn("flex min-h-[60px] items-center gap-2 py-2 pl-4 pr-2", t.status === "GONE" && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <PlayerCell
                  player={t.player}
                  size={36}
                  short
                  sub={t.status === "ON_BLOCK" ? <Badge tone="live">On block</Badge> : t.status === "GONE" ? <Badge>Gone</Badge> : null}
                />
              </div>
              {t.status !== "GONE" && state.draft.proxyBidding && (
                <label className="relative w-[72px] shrink-0">
                  <span className="sr-only">Max bid for {t.player.fullName}</span>
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[15px] text-muted">$</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="max"
                    className="input h-10 px-2 pl-6"
                    value={drafts[t.player.id] ?? (t.maxBid ?? "")}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.player.id]: e.target.value }))}
                    onBlur={() => save(t.player.id)}
                    onKeyDown={(e) => e.key === "Enter" && save(t.player.id)}
                    disabled={pending === `m-${t.player.id}`}
                  />
                </label>
              )}
              {myTurn && t.status === "AVAILABLE" && (
                <Button size="sm" className="h-10 w-10 shrink-0 px-0" onClick={() => onNominate(t.player)} title="Nominate" aria-label={`Nominate ${t.player.fullName}`}>
                  <Gavel size={16} />
                </Button>
              )}
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-loss"
                aria-label={`Remove ${t.player.fullName} from targets`}
                onClick={() => run(`t-${t.player.id}`, () => queueRemoveAction({ draftId: state.draft.id, playerId: t.player.id }), { quiet: true })}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BestAvailable({
  state,
  myTurn,
  targetIds,
  onTarget,
  onNominate,
  pending,
}: {
  state: AuctionRoomState;
  myTurn: boolean;
  targetIds: Set<string>;
  onTarget: (p: RoomPlayer) => void;
  onNominate: (p: RoomPlayer) => void;
  pending: string | null;
}) {
  const [pos, setPos] = useState("ALL");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const term = q.trim().toLowerCase();
  const list = state.bestAvailable.filter((p) => (pos === "ALL" || p.position === pos) && (!term || p.fullName.toLowerCase().includes(term)));
  const shown = list.slice(0, Math.min(limit, 200));
  const star = (p: RoomPlayer) =>
    state.myTeamId ? (
      <button
        type="button"
        onClick={() => onTarget(p)}
        disabled={pending === `t-${p.id}`}
        aria-pressed={targetIds.has(p.id)}
        className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-sunken disabled:opacity-50 sm:h-8 sm:w-8", targetIds.has(p.id) ? "text-brand-600 dark:text-brand-400" : "text-muted")}
        aria-label={targetIds.has(p.id) ? `Remove ${p.fullName} from targets` : `Add ${p.fullName} to targets`}
        title={targetIds.has(p.id) ? "Targeted" : "Add to targets"}
      >
        <Star size={18} fill={targetIds.has(p.id) ? "currentColor" : "none"} />
      </button>
    ) : null;
  return (
    <section aria-label="Best available" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold leading-6 tracking-[-0.01em]">Best available</h2>
          <p className="text-[13px] text-muted">Free agents by dynasty ADP</p>
        </div>
      </div>
      <PosChips positions={state.positions} value={pos} onChange={setPos} />
      <label className="relative block">
        <span className="sr-only">Search best available</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input h-10 rounded-full pl-9" type="search" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {list.length === 0 ? (
        <EmptyState title="Nobody matches">Use the nomination search to find any un-rostered player.</EmptyState>
      ) : (
        <>
          <ul className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card md:hidden">
            {shown.map((p) => (
              <li key={p.id} className="flex min-h-[68px] items-center gap-2 border-b border-line/70 py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <PlayerCell player={p} size={40} short sub={p.age ? <span className="text-muted">· {p.age}</span> : null} />
                </span>
                <span className="w-10 shrink-0 text-right leading-tight" title="Dynasty ADP">
                  <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-muted">ADP</span>
                  <span className="numeral block text-[15px] font-semibold text-ink">{p.adp ? Math.round(p.adp) : "—"}</span>
                </span>
                {star(p)}
                {myTurn && (
                  <Button size="md" className="shrink-0 px-3" onClick={() => onNominate(p)} aria-label={`Nominate ${p.fullName}`}>
                    <Gavel size={15} />
                  </Button>
                )}
              </li>
            ))}
            {list.length > shown.length && shown.length < 200 && (
              <li>
                <button type="button" onClick={() => setLimit((n) => n + 40)} className="flex min-h-12 w-full items-center justify-center text-[14px] font-semibold text-brand-600 dark:text-brand-400">
                  Show {Math.min(40, list.length - shown.length)} more
                </button>
              </li>
            )}
          </ul>
          <div className="card hidden md:block">
            <div className="scroll-thin max-h-[60vh] overflow-auto">
              <table className="tbl tbl-compact">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Player</th>
                    <th className="num">ADP</th>
                    <th className="num">Age</th>
                    <th className="text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, 200).map((p) => (
                    <tr key={p.id}>
                      <td className="max-w-[280px]">
                        <PlayerCell player={p} size={32} />
                      </td>
                      <td className="num">{p.adp ? Math.round(p.adp) : "—"}</td>
                      <td className="num">{p.age ?? "—"}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {star(p)}
                          {myTurn && (
                            <Button size="sm" onClick={() => onNominate(p)}>
                              <Gavel size={13} /> Nominate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
