"use client";
// Live salary auction room: the block (current lot + bidding), nominations, budgets, sales ticker, targets.
import { useEffect, useMemo, useState } from "react";
import { Gavel, Search, Star, Plus, X, Wifi, WifiOff, Check, Clock, Target } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, ButtonLink, EmptyState, Panel, PlayerHeadshot, TeamLogo, PosBadge } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { fmtCountdown, fmtDateTime } from "@/lib/draft/time";
import { bidAction, nominateAction, queueAddAction, queueRemoveAction, setMaxBidAction } from "@/lib/draft/actions";
import type { AuctionLotView, AuctionRoomState, RoomPlayer, RoomTeam } from "@/lib/draft/types";
import { useNow, useRoomAction, useRoomState } from "./use-room";
import { DraftControls } from "./draft-controls";
import { Money, PlayerCell, StatusBadge, TeamChip } from "./bits";

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">{d.auctionKind === "FREE_AGENT" ? "Free-agent auction" : "Salary auction"} room</div>
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">
            {d.name} <StatusBadge status={d.status} />
          </h1>
          <p className="text-xs text-muted">
            ${d.budget} budget{d.capEnabled ? " (or cap space, if lower)" : ""} · min bid ${d.minBid} · +${d.bidIncrement} increments · {d.bidSeconds}s bid clock, resets to {d.resetSecondsOnBid}s · {d.rosterSpotsToFill} roster spots ·{" "}
            {d.contractYearsMode === "WINNER_CHOOSES" ? "winner picks contract years" : `${d.yearOptions[0]}-year contracts`} · {state.soldCount} sold
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", connected ? "text-win" : "text-loss")}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />} {connected ? "Live" : "Offline"}
          </span>
          <ButtonLink href={`/draft/results?id=${d.id}`} variant="secondary" size="sm">
            Results
          </ButtonLink>
        </div>
      </div>

      {state.isCommish && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gold-400/60 bg-gold-300/10 px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gold-600 dark:text-gold-300">Commissioner</span>
          <DraftControls draftId={d.id} status={d.status} type="AUCTION" hasActivity={state.soldCount > 0 || state.recent.length > 0 || !!lot} onChanged={refetch} onBeforeAction={markActed} />
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-muted">Bid / nominate as</span>
            <select className="input h-8 w-auto py-0 text-xs" value={actAs ?? ""} onChange={(e) => setActAs(e.target.value || null)}>
              {state.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === state.myTeamId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div id="auction-block" className="min-w-0 space-y-3">
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
          <NominationStrip state={state} teamsById={teamsById} />
          <BudgetsTable state={state} teamsById={teamsById} />
        </div>
        <aside className="space-y-3">
          <TargetsPanel state={state} myTurn={myTurn} onNominate={pickNominee} run={run} pending={pending} />
          <RecentSales state={state} teamsById={teamsById} />
        </aside>
      </div>

      <BestAvailable state={state} myTurn={myTurn} targetIds={targetIds} onTarget={toggleTarget} onNominate={pickNominee} pending={pending} />
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
  const d = state.draft;
  const minNext = lot.currentBid + Math.max(1, d.bidIncrement);
  const [amount, setAmount] = useState(minNext);
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
  const pct = left !== null ? Math.min(100, (left / (Math.max(d.bidSeconds, d.resetSecondsOnBid) * 1000)) * 100) : 0;
  const quick = [Math.max(1, d.bidIncrement), 5, 10].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <section className="overflow-hidden rounded-xl border border-brand-800 bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 text-white shadow-panel" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <PlayerHeadshot player={lot.player} size={72} className="ring-2 ring-white/40" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-300">On the block · lot #{lot.sequence}</div>
            <div className="truncate font-display text-2xl font-extrabold uppercase leading-tight sm:text-3xl">{lot.player.fullName}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-white/80">
              <PosBadge pos={lot.player.position} />
              <span>{lot.player.team ?? "FA"}</span>
              {lot.player.adp ? <span>· ADP {Math.round(lot.player.adp)}</span> : null}
              {lot.player.age ? <span>· Age {lot.player.age}</span> : null}
              <span>· nominated by {teamsById.get(lot.nominatedByTeamId)?.name ?? "?"}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("font-display text-5xl font-extrabold tabular-nums leading-none", left !== null && left < 5000 && "text-red-300")}>{left !== null ? fmtCountdown(left) : d.status === "PAUSED" ? "Paused" : "—"}</div>
          <div className="text-[11px] uppercase tracking-wide text-white/70">{d.status === "PAUSED" ? "clock stopped" : left === 0 ? "closing…" : "until sold"}</div>
        </div>
      </div>
      <div className="h-1.5 bg-white/10">
        <div className={cn("h-full transition-[width] duration-200", left !== null && left < 5000 ? "bg-red-400" : "bg-gold-400")} style={{ width: `${pct}%` }} />
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-[auto_1fr]">
        <div className="rounded-lg bg-white/10 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">High bid</div>
          <div className="font-display text-5xl font-extrabold tabular-nums leading-none text-gold-300">${lot.currentBid}</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm">
            {leader && <TeamLogo team={leader} size={20} />}
            <span className="font-semibold">{iLead ? "You" : leader?.name ?? "—"}</span>
            {d.contractYearsMode === "WINNER_CHOOSES" && <span className="text-white/70">· {lot.contractYears} yr{lot.contractYears === 1 ? "" : "s"}</span>}
          </div>
          {iLead && (
            <div className="mt-2 inline-flex items-center gap-1 rounded bg-win px-2 py-0.5 text-xs font-bold">
              <Check size={12} /> You're winning
            </div>
          )}
        </div>
        <div className="space-y-2">
          {acting ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {quick.map((inc) => {
                  const v = lot.currentBid + inc;
                  return (
                    <Button key={inc} variant="gold" size="md" disabled={!canBid || v > maxBid || pending === "bid"} onClick={() => bid(v)}>
                      +${inc} <span className="font-normal opacity-80">→ ${v}</span>
                    </Button>
                  );
                })}
              </div>
              <form
                className="flex flex-wrap items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canBid) void bid(amount);
                }}
              >
                <label className="sr-only" htmlFor="bid-amount">
                  Custom bid
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                  <input
                    id="bid-amount"
                    type="number"
                    inputMode="numeric"
                    className="input h-9 w-24 pl-5 text-ink"
                    min={minNext}
                    max={maxBid}
                    value={amount}
                    onChange={(e) => setAmount(Math.round(Number(e.target.value) || 0))}
                  />
                </div>
                {d.contractYearsMode === "WINNER_CHOOSES" && (
                  <label className="inline-flex items-center gap-1 text-xs text-white/80">
                    <span>Years</span>
                    <select className="input h-9 w-auto py-0 text-ink" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Button type="submit" variant="success" disabled={!canBid || amount < minNext || amount > maxBid || pending === "bid"}>
                  <Gavel size={15} /> Bid ${amount}
                </Button>
              </form>
              <p className="text-xs text-white/75">
                Max you can bid: <strong className="text-white">${maxBid}</strong> · {budget?.openSpots ?? 0} roster spot{budget?.openSpots === 1 ? "" : "s"} left · ${budget?.remaining ?? 0} remaining
                {!iLead && (budget?.openSpots ?? 0) === 0 ? " — your roster is full" : ""}
                {d.contractYearsMode === "WINNER_CHOOSES" && budget && budget.maxYears < d.yearOptions[d.yearOptions.length - 1] ? ` · long-contract limit: up to ${budget.maxYears} yrs` : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-white/80">You don't manage a team in this league, so you can watch but not bid.</p>
          )}
          {lot.bids.length > 0 && (
            <ol className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-white/80" aria-label="Bid history">
              {lot.bids.slice(0, 8).map((b, i) => (
                <li key={`${b.at}-${i}`} className="flex items-center gap-1.5">
                  <span className="w-10 font-semibold tabular-nums text-white">${b.amount}</span>
                  <span className="truncate">{teamsById.get(b.teamId)?.name ?? "?"}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-gradient-to-r from-brand-900 to-brand-800 px-4 py-4 text-white">
        <div className="flex items-center gap-3">
          <Check className="text-gold-400" />
          <div>
            <div className="font-display text-xl font-bold uppercase">Auction complete</div>
            <div className="text-sm text-white/75">{state.soldCount} players sold{d.completedAt ? ` · finished ${fmtDateTime(d.completedAt, timezone)}` : ""}</div>
          </div>
        </div>
        <ButtonLink href={`/draft/results?id=${d.id}`} variant="gold" size="sm">
          View results
        </ButtonLink>
      </div>
    );
  }
  if (d.status === "SCHEDULED") {
    const startsIn = d.startTime ? new Date(d.startTime).getTime() - now : null;
    return (
      <div className="rounded-xl border border-brand-800 bg-gradient-to-r from-brand-950 to-brand-800 px-4 py-5 text-white">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-300">Auction not started</div>
        {startsIn !== null && startsIn > 0 ? (
          <div className="mt-1 flex flex-wrap items-end gap-3">
            <div className="font-display text-4xl font-extrabold tabular-nums">{fmtCountdown(startsIn)}</div>
            <div className="pb-1 text-sm text-white/80">Starts {fmtDateTime(d.startTime, timezone)}</div>
          </div>
        ) : (
          <div className="mt-1 text-lg font-semibold">Waiting for the commissioner to open bidding</div>
        )}
        <p className="mt-2 text-sm text-white/75">
          First to nominate: <strong>{nominator?.name ?? "—"}</strong>.{" "}
          {d.proxyBidding ? "Set targets and max bids below — auto-bids work even if you're away." : "Star your targets below — if your nomination clock runs out, your top available target is nominated for you."}
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
  return (
    <section className={cn("rounded-xl border p-4 shadow-panel", myTurn ? "border-gold-400 bg-gold-300/15 ring-2 ring-gold-400/40" : "border-line bg-panel")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {nominator ? <TeamLogo team={nominator} size={44} /> : <Clock size={36} className="text-muted" />}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-600 dark:text-gold-400">
              {d.status === "PAUSED" ? "Paused" : nominator && nominator.id === state.myTeamId ? "Your turn to nominate!" : "Now nominating"}
            </div>
            <div className="font-display text-2xl font-extrabold uppercase leading-tight">{nominator?.name ?? "No team can nominate"}</div>
            {budget && (
              <div className="text-xs text-muted">
                Max bid ${budget.maxBid} · {budget.openSpots} spots left
              </div>
            )}
          </div>
        </div>
        {d.status === "LIVE" && left !== null && (
          <div className="text-right">
            <div className={cn("font-display text-4xl font-extrabold tabular-nums leading-none", left < 10_000 && "text-loss")}>{fmtCountdown(left)}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted">to nominate · {d.autoNominateOnTimeout ? "then auto-nominate" : "then the turn is skipped"}</div>
          </div>
        )}
      </div>
      {myTurn && actingNominator && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {nominee ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel p-2">
              <PlayerCell player={nominee} size={36} sub={nominee.adp ? <span>· ADP {Math.round(nominee.adp)}</span> : null} />
              <button type="button" className="ml-auto rounded p-1 text-muted hover:bg-sunken" aria-label="Choose a different player" onClick={() => setNominee(null)}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="relative">
              <label className="relative block">
                <span className="sr-only">Find a player to nominate</span>
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input className="input pl-8" placeholder="Search any un-rostered player to nominate…" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              {list.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-panel shadow-pop">
                  {list.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sunken" onClick={() => setNominee(p)}>
                        <PosBadge pos={p.position} />
                        <span className="font-semibold">{p.fullName}</span>
                        <span className="text-xs text-muted">{p.team ?? "FA"}</span>
                        {p.adp ? <span className="ml-auto text-xs text-muted">ADP {Math.round(p.adp)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {term.length >= 2 && remote && remote.length === 0 && <p className="mt-1 text-xs text-muted">No un-rostered player matches “{q}”.</p>}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label>
              <span className="label">{fixedOpening ? "Opening bid (league minimum)" : "Opening bid"}</span>
              <input
                type="number"
                inputMode="numeric"
                className="input h-9 w-24"
                min={d.minBid}
                max={budget?.maxBid}
                value={fixedOpening ? d.minBid : opening}
                disabled={fixedOpening}
                onChange={(e) => setOpening(Math.round(Number(e.target.value) || 0))}
              />
            </label>
            {d.contractYearsMode === "WINNER_CHOOSES" && (
              <label>
                <span className="label">Contract years</span>
                <select className="input h-9 w-auto py-0" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y} yr{y === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button variant="gold" disabled={!nominee || pending === "nominate" || (!fixedOpening && (opening < d.minBid || (budget ? opening > budget.maxBid : false)))} onClick={() => nominee && nominate(nominee)}>
              <Gavel size={15} /> {pending === "nominate" ? "Nominating…" : "Nominate"}
            </Button>
          </div>
          {state.isCommish && nominator && nominator.id !== state.myTeamId && <p className="text-xs text-muted">Commissioner nomination on behalf of {nominator.name}.</p>}
        </div>
      )}
    </section>
  );
}

function NominationStrip({ state, teamsById }: { state: AuctionRoomState; teamsById: Map<string, RoomTeam> }) {
  if (!state.nominatorTeamId) return null;
  const ids = [state.nominatorTeamId, ...state.upNext];
  return (
    <div className="scroll-thin -mx-1 flex items-center gap-1.5 overflow-x-auto px-1" aria-label="Nomination order">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted">{state.openLot ? "Next to nominate" : "Nominating"}</span>
      {ids.map((id, i) => {
        const t = teamsById.get(id);
        if (!t) return null;
        return (
          <span key={`${id}-${i}`} className={cn("chip shrink-0", i === 0 && "border-gold-500 bg-gold-300/20 font-bold", id === state.myTeamId && "border-brand-400")}>
            <TeamLogo team={t} size={18} /> {t.abbrev}
          </span>
        );
      })}
      <span className="shrink-0 text-[11px] text-muted">· {state.draft.nominationOrder === "RANDOM" ? "random order" : state.draft.nominationOrder === "REVERSE_STANDINGS" ? "reverse standings" : "custom order"}</span>
    </div>
  );
}

function BudgetsTable({ state, teamsById }: { state: AuctionRoomState; teamsById: Map<string, RoomTeam> }) {
  const rows = [...state.budgets].sort((a, b) => b.maxBid - a.maxBid);
  return (
    <Panel
      title="Team budgets"
      subtitle={`Left = ${state.draft.capEnabled ? "lesser of budget left and cap space" : "budget left"}${state.draft.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" ? ` · max bid keeps $${state.draft.minBid} for each other open spot` : ""}`}
      noPad
    >
      <div className="scroll-thin max-h-[480px] overflow-auto">
        <table className="tbl tbl-compact">
          <thead className="sticky top-0 z-10">
            <tr>
              <th>Team</th>
              <th className="num hidden sm:table-cell">Spent</th>
              <th className="num">Left</th>
              <th className="num">Max bid</th>
              <th className="num">Spots</th>
              {state.draft.capEnabled && <th className="num hidden md:table-cell" title={`Cap space for the ${state.draft.season} season`}>Cap space</th>}
              <th className="hidden sm:table-cell">Won</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const t = teamsById.get(b.teamId);
              return (
                <tr key={b.teamId} className={cn(b.teamId === state.myTeamId && "bg-gold-300/10")}>
                  <td className="max-w-[180px]">
                    <TeamChip team={t} />
                  </td>
                  <td className="num hidden sm:table-cell">
                    <Money value={b.spent} />
                  </td>
                  <td className="num" title={state.draft.capEnabled && b.capSpace !== null && b.capSpace < state.draft.budget - b.spent ? "Limited by cap space" : undefined}>
                    <Money value={b.remaining} />
                  </td>
                  <td className="num font-bold">
                    <Money value={b.maxBid} />
                  </td>
                  <td className="num">{b.openSpots}</td>
                  {state.draft.capEnabled && (
                    <td className="num hidden text-xs md:table-cell">
                      <Money value={b.capSpace} />
                    </td>
                  )}
                  <td className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {state.positions.filter((p) => b.wonByPosition[p]).map((p) => (
                        <span key={p} className="inline-flex items-center gap-0.5 text-[11px]">
                          <PosBadge pos={p} className="h-4 min-w-[24px] text-[9px]" />
                          {b.wonByPosition[p]}
                        </span>
                      ))}
                      {b.won === 0 && <span className="text-[11px] text-muted">—</span>}
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
  return (
    <Panel title="Recent sales" noPad>
      {state.recent.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">No players sold yet.</p>
      ) : (
        <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto">
          {state.recent.map((l) => {
            const t = l.winnerTeamId ? teamsById.get(l.winnerTeamId) : null;
            return (
              <li key={l.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <PosBadge pos={l.player.position} />
                <span className="min-w-0 flex-1 truncate font-semibold">{l.player.fullName}</span>
                {l.status === "SOLD" ? (
                  <>
                    {t && <TeamLogo team={t} size={18} />}
                    <span className="w-10 text-right font-bold tabular-nums">${l.currentBid}</span>
                    <span className="w-8 text-right text-[11px] text-muted">{l.contractYears}y</span>
                  </>
                ) : (
                  <Badge>Passed</Badge>
                )}
              </li>
            );
          })}
        </ul>
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
    <Panel title="My targets" subtitle={state.draft.proxyBidding ? "Max bids auto-bid for you" : "Your private wish list"} noPad>
      {state.targets.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">
          Star players in the list below to track them.{state.draft.proxyBidding ? " A max bid turns on proxy bidding for that player." : ""}
          {state.draft.autoNominateOnTimeout ? " When you time out on a nomination, your top available target is nominated for you." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {state.targets.map((t) => (
            <li key={t.player.id} className={cn("flex items-center gap-2 px-3 py-1.5", t.status === "GONE" && "opacity-50")}>
              <div className="min-w-0 flex-1">
                <PlayerCell player={t.player} size={24} />
              </div>
              {t.status === "ON_BLOCK" && <Badge tone="live">On block</Badge>}
              {t.status === "GONE" && <Badge>Gone</Badge>}
              {t.status !== "GONE" && state.draft.proxyBidding && (
                <label className="relative">
                  <span className="sr-only">Max bid for {t.player.fullName}</span>
                  <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="max"
                    className="input h-7 w-16 px-1 pl-4 text-xs"
                    value={drafts[t.player.id] ?? (t.maxBid ?? "")}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.player.id]: e.target.value }))}
                    onBlur={() => save(t.player.id)}
                    onKeyDown={(e) => e.key === "Enter" && save(t.player.id)}
                    disabled={pending === `m-${t.player.id}`}
                  />
                </label>
              )}
              {myTurn && t.status === "AVAILABLE" && (
                <Button size="xs" variant="gold" onClick={() => onNominate(t.player)} title="Nominate">
                  <Gavel size={12} />
                </Button>
              )}
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-loss" aria-label={`Remove ${t.player.fullName} from targets`} onClick={() => run(`t-${t.player.id}`, () => queueRemoveAction({ draftId: state.draft.id, playerId: t.player.id }), { quiet: true })}>
                <X size={13} />
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
  const term = q.trim().toLowerCase();
  const list = state.bestAvailable.filter((p) => (pos === "ALL" || p.position === pos) && (!term || p.fullName.toLowerCase().includes(term)));
  return (
    <Panel noPad title="Best available" subtitle="Un-rostered players by dynasty ADP">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by position">
          {["ALL", ...state.positions].map((p) => (
            <button key={p} type="button" onClick={() => setPos(p)} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", pos === p ? "border-brand-600 bg-brand-700 text-white" : "border-line bg-panel text-muted hover:text-ink")}>
              {p === "ALL" ? "All" : p}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-56">
          <span className="sr-only">Search best available</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input h-8 py-1 pl-8 text-xs" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {list.length === 0 ? (
        <div className="p-3">
          <EmptyState title="Nobody matches">Use the nomination search to find any un-rostered player.</EmptyState>
        </div>
      ) : (
        <div className="scroll-thin max-h-[60vh] overflow-auto">
          <table className="tbl tbl-compact">
            <thead className="sticky top-0 z-10">
              <tr>
                <th>Player</th>
                <th className="num">ADP</th>
                <th className="num hidden sm:table-cell">Age</th>
                <th className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[240px]">
                    <PlayerCell player={p} size={26} />
                  </td>
                  <td className="num text-xs">{p.adp ? Math.round(p.adp) : "—"}</td>
                  <td className="num hidden text-xs sm:table-cell">{p.age ?? "—"}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {state.myTeamId && (
                        <button
                          type="button"
                          onClick={() => onTarget(p)}
                          disabled={pending === `t-${p.id}`}
                          className={cn("rounded p-1.5 hover:bg-sunken", targetIds.has(p.id) ? "text-gold-500" : "text-muted")}
                          aria-label={targetIds.has(p.id) ? `Remove ${p.fullName} from targets` : `Add ${p.fullName} to targets`}
                          title={targetIds.has(p.id) ? "Targeted" : "Add to targets"}
                        >
                          {targetIds.has(p.id) ? <Star size={15} fill="currentColor" /> : <Target size={15} />}
                        </button>
                      )}
                      {myTurn && (
                        <Button size="xs" variant="gold" onClick={() => onNominate(p)}>
                          <Plus size={12} /> Nominate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
