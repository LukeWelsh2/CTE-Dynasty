"use client";
// Live rookie draft room: on-the-clock banner, pick tracker, available players, board grid, queue.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Clock, GripVertical, LayoutGrid, ListOrdered, Plus, Search, Star, Trophy, Users, X, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/client";
import { Badge, Button, ButtonLink, EmptyState, Panel, PosBadge, TeamLogo, PlayerHeadshot } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { roundPickLabel, moveItem } from "@/lib/draft/logic";
import { fmtCountdown, fmtDateTime } from "@/lib/draft/time";
import { makePickAction, queueAddAction, queueRemoveAction, queueReorderAction } from "@/lib/draft/actions";
import type { RookieBoardPick, RookieRoomState, RoomPlayer, RoomTeam } from "@/lib/draft/types";
import { useNow, useRoomAction, useRoomState } from "./use-room";
import { DraftControls } from "./draft-controls";
import { POS_TINT, PlayerCell, StatusBadge } from "./bits";

type Tab = "players" | "board" | "queue" | "picks";
type SortKey = "rank" | "adp" | "board" | "age";

const AUTOPICK_TEXT: Record<RookieRoomState["draft"]["autopickSource"], string> = {
  BIG_BOARD: "your queue, then your big board, then league rankings, then ADP",
  LEAGUE_RANKINGS: "your queue, then the league rookie rankings, then ADP",
  ADP: "your queue, then ADP",
};

export function RookieRoom({ initial }: { initial: RookieRoomState }) {
  const { state, refetch, offset, connected, markActed } = useRoomState(initial, {
    onEvent: (type, data, mine) => {
      if (!mine && (type === "draft.pick" || type === "draft.undo" || type === "draft.status") && typeof data.message === "string") toast(data.message);
    },
  });
  const { pending, run } = useRoomAction(refetch, markActed);
  const [tab, setTab] = useState<Tab>("players");
  const [confirm, setConfirm] = useState<RoomPlayer | null>(null);

  const d = state.draft;
  const teamsById = useMemo(() => new Map(state.teams.map((t) => [t.id, t])), [state.teams]);
  const current: RookieBoardPick | undefined = d.status === "COMPLETE" ? undefined : state.picks[d.currentIndex];
  const onClockTeam = current ? teamsById.get(current.ownerTeamId) ?? null : null;
  const mineOnClock = !!current && d.status === "LIVE" && current.ownerTeamId === state.myTeamId;
  const canPick = d.status === "LIVE" && !!current && (mineOnClock || state.isCommish);
  const myUpcoming = state.picks.filter((p) => !p.selection && p.ownerTeamId === state.myTeamId && p.index >= d.currentIndex);
  const mySelections = state.picks.filter((p) => p.selection && p.ownerTeamId === state.myTeamId);
  const made = state.picks.filter((p) => p.selection).length;
  const queueIds = useMemo(() => new Set(state.queue.map((q) => q.id)), [state.queue]);

  const draftPlayer = (p: RoomPlayer) =>
    run("pick", () => makePickAction({ draftId: d.id, playerId: p.id, expectedIndex: d.currentIndex })).then((ok) => ok && setConfirm(null));
  const toggleQueue = (p: RoomPlayer) =>
    queueIds.has(p.id)
      ? run(`q-${p.id}`, () => queueRemoveAction({ draftId: d.id, playerId: p.id }), { quiet: true })
      : run(`q-${p.id}`, () => queueAddAction({ draftId: d.id, playerId: p.id }));

  const tabs: { key: Tab; label: string; icon: React.ReactNode; mobileOnly?: boolean }[] = [
    { key: "players", label: "Players", icon: <Users size={14} /> },
    { key: "board", label: "Board", icon: <LayoutGrid size={14} /> },
    { key: "queue", label: `Queue (${state.queue.length})`, icon: <ListOrdered size={14} />, mobileOnly: true },
    { key: "picks", label: "Picks", icon: <Trophy size={14} />, mobileOnly: true },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">Rookie draft room</div>
          <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">
            {d.name} <StatusBadge status={d.status} />
          </h1>
          <p className="text-xs text-muted">
            {d.rounds} round{d.rounds === 1 ? "" : "s"} · {d.style === "SNAKE" ? "Snake" : "Linear"} · {d.pickTimerMinutes > 0 ? `${d.pickTimerMinutes >= 60 ? `${Math.round((d.pickTimerMinutes / 60) * 10) / 10}h` : `${d.pickTimerMinutes} min`} pick clock` : "No pick clock"} ·{" "}
            {d.eligibility === "ROOKIES_ONLY" ? "Rookies only" : "Rookies + free agents"} · {made}/{state.picks.length} picks made
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", connected ? "text-win" : "text-loss")} title={connected ? "Live updates connected" : "Reconnecting…"}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />} {connected ? "Live" : "Offline"}
          </span>
          <ButtonLink href={`/draft/board?class=${d.season}`} variant="secondary" size="sm">
            My big board
          </ButtonLink>
          <ButtonLink href={`/draft/results?id=${d.id}`} variant="secondary" size="sm">
            Results
          </ButtonLink>
        </div>
      </div>

      <OnClockBanner state={state} current={current} team={onClockTeam} teamsById={teamsById} offset={offset} mine={mineOnClock} picksUntilMine={myUpcoming[0] ? myUpcoming[0].index - d.currentIndex : null} />

      {state.isCommish && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gold-400/60 bg-gold-300/10 px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gold-600 dark:text-gold-300">Commissioner</span>
          <DraftControls draftId={d.id} status={d.status} type="ROOKIE" hasActivity={made > 0} onChanged={refetch} onBeforeAction={markActed} />
          {d.status === "LIVE" && current && !mineOnClock && <span className="text-xs text-muted">Use “Draft” on any player to pick for {onClockTeam?.name}.</span>}
        </div>
      )}

      <PickTracker picks={state.picks} currentIndex={d.status === "COMPLETE" ? state.picks.length : d.currentIndex} teamsById={teamsById} myTeamId={state.myTeamId} />

      <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold",
              t.mobileOnly && "lg:hidden",
              tab === t.key ? "border-gold-500 text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {tab === "players" && (
            <AvailablePlayers state={state} canPick={canPick} queueIds={queueIds} pendingKey={pending} onDraft={(p) => setConfirm(p)} onQueue={toggleQueue} />
          )}
          {tab === "board" && <DraftBoard state={state} teamsById={teamsById} />}
          {tab === "queue" && <QueuePanel state={state} canPick={canPick} onDraft={(p) => setConfirm(p)} refetch={refetch} />}
          {tab === "picks" && <PicksPanel state={state} teamsById={teamsById} upcoming={myUpcoming} mine={mySelections} />}
        </div>
        <aside className="hidden space-y-3 lg:block">
          <QueuePanel state={state} canPick={canPick} onDraft={(p) => setConfirm(p)} refetch={refetch} />
          <PicksPanel state={state} teamsById={teamsById} upcoming={myUpcoming} mine={mySelections} />
        </aside>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm pick"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="gold" onClick={() => confirm && draftPlayer(confirm)} disabled={pending === "pick"}>
              {pending === "pick" ? "Drafting…" : "Draft player"}
            </Button>
          </>
        }
      >
        {confirm && current && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <PlayerHeadshot player={confirm} size={56} />
              <div>
                <div className="font-display text-xl font-bold">{confirm.fullName}</div>
                <div className="text-sm text-muted">
                  {confirm.position} · {confirm.team ?? "FA"}
                  {confirm.college ? ` · ${confirm.college}` : ""}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-sunken p-2">
                <div className="text-[10px] font-semibold uppercase text-muted">Pick</div>
                <div className="font-display text-lg font-bold">{roundPickLabel(current.round, current.pickInRound)}</div>
              </div>
              <div className="rounded-md bg-sunken p-2">
                <div className="text-[10px] font-semibold uppercase text-muted">Salary</div>
                <div className="font-display text-lg font-bold">${current.salary}</div>
              </div>
              <div className="rounded-md bg-sunken p-2">
                <div className="text-[10px] font-semibold uppercase text-muted">Years</div>
                <div className="font-display text-lg font-bold">{confirm.isRookie ? d.rookieContractYears : "FA"}</div>
              </div>
            </div>
            {!mineOnClock && onClockTeam && (
              <p className="rounded-md border border-gold-400/50 bg-gold-300/20 px-2 py-1.5 text-xs">
                Commissioner pick on behalf of <strong>{onClockTeam.name}</strong>.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function OnClockBanner({
  state,
  current,
  team,
  teamsById,
  offset,
  mine,
  picksUntilMine,
}: {
  state: RookieRoomState;
  current: RookieBoardPick | undefined;
  team: RoomTeam | null;
  teamsById: Map<string, RoomTeam>;
  offset: number;
  mine: boolean;
  picksUntilMine: number | null;
}) {
  // only the banner ticks; the big tables don't re-render every second
  const now = useNow(offset, 500, state.serverNow);
  const d = state.draft;
  if (d.status === "COMPLETE") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-gradient-to-r from-brand-900 to-brand-800 px-4 py-4 text-white">
        <div className="flex items-center gap-3">
          <Check className="text-gold-400" />
          <div>
            <div className="font-display text-xl font-bold uppercase">Draft complete</div>
            <div className="text-sm text-white/75">{d.completedAt ? `Finished ${fmtDateTime(d.completedAt, state.timezone)}` : "Every pick is in."}</div>
          </div>
        </div>
        <ButtonLink href={`/draft/results?id=${d.id}`} variant="gold" size="sm">
          View full results
        </ButtonLink>
      </div>
    );
  }
  const deadline = d.pickDeadline ? new Date(d.pickDeadline).getTime() : null;
  const left = deadline ? deadline - now : null;
  const total = d.pickTimerMinutes * 60_000;
  const urgent = left !== null && (left < 60_000 || (total > 0 && left < total * 0.1));
  const orig = current && current.originalTeamId !== current.ownerTeamId ? teamsById.get(current.originalTeamId) : null;
  const startsIn = d.startTime ? new Date(d.startTime).getTime() - now : null;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border px-4 py-3 text-white shadow-panel sm:py-4",
        mine ? "border-gold-400 bg-gradient-to-r from-gold-600 via-amber-600 to-brand-900 ring-2 ring-gold-400/60" : "border-brand-800 bg-gradient-to-r from-brand-950 via-brand-900 to-brand-800",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {team ? <TeamLogo team={team} size={52} className="ring-2 ring-white/30" /> : <Clock size={40} className="text-white/60" />}
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-300">
              {d.status === "SCHEDULED" ? "First pick" : d.status === "PAUSED" ? "Paused — on the clock" : mine ? "You're on the clock!" : "On the clock"}
            </div>
            <div className="truncate font-display text-2xl font-extrabold uppercase leading-tight sm:text-3xl">{team?.name ?? "—"}</div>
            {current && (
              <div className="text-sm text-white/80">
                Pick <strong className="text-white">{roundPickLabel(current.round, current.pickInRound)}</strong> · #{current.overall} overall · ${current.salary} rookie scale
                {orig ? <span className="ml-1 rounded bg-white/15 px-1.5 py-px text-[11px] font-semibold">via {orig.name}</span> : null}
              </div>
            )}
          </div>
        </div>
        <div className="text-right">
          {d.status === "LIVE" && left !== null && (
            <>
              <div className={cn("font-display text-4xl font-extrabold tabular-nums leading-none sm:text-5xl", urgent && "animate-pulseDot text-red-300")}>{fmtCountdown(left)}</div>
              <div className="text-[11px] uppercase tracking-wide text-white/70">left to pick · autopick at 0:00</div>
            </>
          )}
          {d.status === "LIVE" && left === null && <div className="text-sm text-white/80">No pick clock — take your time</div>}
          {d.status === "PAUSED" && (
            <div className="text-sm text-white/80">
              Clock stopped{d.pausedRemainingMs ? ` with ${fmtCountdown(d.pausedRemainingMs)} left` : ""}
            </div>
          )}
          {d.status === "SCHEDULED" && (
            <>
              {startsIn !== null && startsIn > 0 ? (
                <>
                  <div className="font-display text-3xl font-extrabold tabular-nums leading-none sm:text-4xl">{fmtCountdown(startsIn)}</div>
                  <div className="text-[11px] uppercase tracking-wide text-white/70">Starts {fmtDateTime(d.startTime, state.timezone)}</div>
                </>
              ) : (
                <div className="text-sm text-white/80">Waiting for the commissioner to start the draft</div>
              )}
            </>
          )}
          {!mine && picksUntilMine !== null && picksUntilMine > 0 && d.status !== "SCHEDULED" && (
            <div className="mt-1 text-xs text-gold-200">
              Your next pick in {picksUntilMine} pick{picksUntilMine === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PickTracker({ picks, currentIndex, teamsById, myTeamId }: { picks: RookieBoardPick[]; currentIndex: number; teamsById: Map<string, RoomTeam>; myTeamId: string | null }) {
  const start = Math.max(0, currentIndex - 5);
  const slice = picks.slice(start, currentIndex + 6);
  if (!slice.length) return null;
  return (
    <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Pick tracker: last 5 and next 5 picks">
      {slice.map((p) => {
        const team = teamsById.get(p.ownerTeamId);
        const isCur = p.index === currentIndex;
        return (
          <div
            key={p.pickId}
            className={cn(
              "flex min-w-[150px] shrink-0 items-center gap-2 rounded-lg border px-2 py-1.5",
              p.selection ? POS_TINT[p.selection.position] ?? "border-line bg-panel" : "border-line bg-panel",
              isCur && "border-gold-500 ring-2 ring-gold-400/50",
              p.ownerTeamId === myTeamId && !p.selection && "border-brand-400",
            )}
          >
            <div className="text-center">
              <div className="font-display text-sm font-bold leading-none">{roundPickLabel(p.round, p.pickInRound)}</div>
              <div className="text-[10px] text-muted">#{p.overall}</div>
            </div>
            {team && <TeamLogo team={team} size={22} />}
            <div className="min-w-0 text-xs leading-tight">
              {p.selection ? (
                <>
                  <div className="truncate font-semibold">{p.selection.fullName}</div>
                  <div className="text-[10px] text-muted">
                    {p.selection.position} · {p.selection.team ?? "FA"}
                    {p.selection.isAutopick ? " · auto" : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className="truncate font-semibold">{team?.abbrev}</div>
                  <div className={cn("text-[10px]", isCur ? "font-bold text-gold-600 dark:text-gold-300" : "text-muted")}>{isCur ? "On the clock" : "Up next"}</div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AvailablePlayers({
  state,
  canPick,
  queueIds,
  pendingKey,
  onDraft,
  onQueue,
}: {
  state: RookieRoomState;
  canPick: boolean;
  queueIds: Set<string>;
  pendingKey: string | null;
  onDraft: (p: RoomPlayer) => void;
  onQueue: (p: RoomPlayer) => void;
}) {
  const [pos, setPos] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [rookiesOnly, setRookiesOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("rank");
  const [remote, setRemote] = useState<RoomPlayer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const term = q.trim().toLowerCase();
  const local = useMemo(() => {
    let list = state.available;
    if (pos !== "ALL") list = list.filter((p) => p.position === pos);
    if (rookiesOnly) list = list.filter((p) => p.isRookie);
    if (term) list = list.filter((p) => p.fullName.toLowerCase().includes(term) || (p.college ?? "").toLowerCase().includes(term) || (p.team ?? "").toLowerCase() === term);
    const key = (p: RoomPlayer) => (sort === "rank" ? p.rank : sort === "adp" ? p.adp : sort === "board" ? p.boardRank : p.age) ?? 1e6;
    return [...list].sort((a, b) => key(a) - key(b) || (a.rank ?? 1e6) - (b.rank ?? 1e6) || (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9));
  }, [state.available, pos, rookiesOnly, term, sort]);
  const list = remote ?? local;
  const searchAll = async () => {
    setSearching(true);
    try {
      const res = await fetch(`/api/draft/${state.draft.id}/players?q=${encodeURIComponent(q)}${pos !== "ALL" ? `&pos=${pos}` : ""}`);
      const json = (await res.json()) as { players?: RoomPlayer[] };
      setRemote(json.players ?? []);
    } finally {
      setSearching(false);
    }
  };
  const th = (key: SortKey, label: string, cls = "") => (
    <th className={cn("num cursor-pointer select-none", cls)} onClick={() => setSort(key)} aria-sort={sort === key ? "ascending" : "none"}>
      {label}
      {sort === key ? " ▲" : ""}
    </th>
  );
  return (
    <Panel
      noPad
      title="Available players"
      subtitle={`${state.availableTotal} eligible${state.availableTotal > state.available.length ? ` · top ${state.available.length} loaded — search to find anyone else` : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by position">
          {["ALL", ...state.positions].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPos(p);
                setRemote(null);
              }}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", pos === p ? "border-brand-600 bg-brand-700 text-white" : "border-line bg-panel text-muted hover:text-ink")}
            >
              {p === "ALL" ? "All" : p}
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-56">
          <span className="sr-only">Search players</span>
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input h-8 py-1 pl-8 text-xs"
            placeholder="Name, college or NFL team"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setRemote(null);
            }}
          />
        </label>
        {state.draft.eligibility === "ROOKIES_AND_FREE_AGENTS" && (
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={rookiesOnly} onChange={(e) => setRookiesOnly(e.target.checked)} /> Rookies only
          </label>
        )}
      </div>
      {remote && (
        <div className="flex items-center justify-between border-b border-line bg-sunken/60 px-3 py-1.5 text-xs">
          <span>
            {remote.length} search result{remote.length === 1 ? "" : "s"} for “{q}”
          </span>
          <button type="button" className="link" onClick={() => setRemote(null)}>
            Clear
          </button>
        </div>
      )}
      {list.length === 0 ? (
        <div className="p-3">
          <EmptyState title={term ? "No loaded players match" : "No available players"}>
            {term.length >= 2 ? (
              <Button size="sm" variant="secondary" className="mt-2" onClick={searchAll} disabled={searching}>
                {searching ? "Searching…" : "Search all eligible players"}
              </Button>
            ) : (
              "Every eligible player has been drafted or rostered."
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="scroll-thin max-h-[68vh] overflow-auto">
          <table className="tbl tbl-compact">
            <thead className="sticky top-0 z-10">
              <tr>
                {th("rank", "Rk", "w-10")}
                <th>Player</th>
                <th className="hidden md:table-cell">College</th>
                {th("age", "Age", "hidden sm:table-cell")}
                {th("adp", "ADP")}
                {th("board", "My #", "hidden sm:table-cell")}
                <th className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="num">
                    <span className="font-semibold">{p.rank ?? "—"}</span>
                    {p.tier ? <span className="block text-[9px] text-muted">T{p.tier}</span> : null}
                  </td>
                  <td className="max-w-[160px] sm:max-w-[220px]">
                    <PlayerCell player={p} sub={!p.isRookie ? <Badge className="ml-1">Vet</Badge> : null} />
                  </td>
                  <td className="hidden text-xs text-muted md:table-cell">{p.college ?? "—"}</td>
                  <td className="num hidden text-xs sm:table-cell">{p.age ?? "—"}</td>
                  <td className="num text-xs">{p.adp ? Math.round(p.adp) : "—"}</td>
                  <td className="num hidden text-xs sm:table-cell">{p.boardRank ?? "—"}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onQueue(p)}
                        disabled={pendingKey === `q-${p.id}`}
                        aria-label={queueIds.has(p.id) ? `Remove ${p.fullName} from queue` : `Add ${p.fullName} to queue`}
                        title={queueIds.has(p.id) ? "In your queue" : "Add to queue"}
                        className={cn("rounded p-1.5 hover:bg-sunken", queueIds.has(p.id) ? "text-gold-500" : "text-muted")}
                      >
                        {queueIds.has(p.id) ? <Star size={15} fill="currentColor" /> : <Plus size={15} />}
                      </button>
                      {canPick && (
                        <Button size="xs" variant="gold" onClick={() => onDraft(p)}>
                          Draft
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

function DraftBoard({ state, teamsById }: { state: RookieRoomState; teamsById: Map<string, RoomTeam> }) {
  const rounds = [...new Set(state.picks.map((p) => p.round))].sort((a, b) => a - b);
  const cell = new Map(state.picks.map((p) => [`${p.originalTeamId}|${p.round}`, p]));
  const currentId = state.draft.status === "COMPLETE" ? null : state.picks[state.draft.currentIndex]?.pickId;
  if (!state.picks.length) return <EmptyState title="No picks in this draft">The commissioner needs to set the draft order.</EmptyState>;
  return (
    <Panel noPad title="Draft board" subtitle="Columns are draft slots (original team). Traded picks show the team that owns them.">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 p-1" style={{ minWidth: state.teams.length * 112 + 40 }}>
          <thead>
            <tr>
              <th className="w-8" />
              {state.teams.map((t, i) => (
                <th key={t.id} className="px-1 pb-1 text-center align-bottom">
                  <div className="flex flex-col items-center gap-0.5">
                    <TeamLogo team={t} size={26} />
                    <span className="max-w-[104px] truncate text-[11px] font-semibold" title={t.name}>
                      {t.abbrev}
                    </span>
                    <span className="text-[10px] text-muted">Slot {i + 1}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r}>
                <th className="text-center font-display text-sm font-bold text-muted">R{r}</th>
                {state.teams.map((t) => {
                  const p = cell.get(`${t.id}|${r}`);
                  if (!p) return <td key={t.id} className="rounded-md border border-dashed border-line" />;
                  const owner = teamsById.get(p.ownerTeamId);
                  const traded = p.ownerTeamId !== p.originalTeamId;
                  const isCur = p.pickId === currentId;
                  return (
                    <td
                      key={t.id}
                      className={cn(
                        "h-[74px] rounded-md border p-1.5 align-top text-xs",
                        p.selection ? POS_TINT[p.selection.position] ?? "border-line bg-panel" : "border-line bg-panel",
                        isCur && "border-gold-500 ring-2 ring-gold-400/60",
                        p.ownerTeamId === state.myTeamId && "outline outline-1 outline-brand-400",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1 text-[10px] text-muted">
                        <span className="font-bold text-ink">{roundPickLabel(p.round, p.pickInRound)}</span>
                        <span>#{p.overall}</span>
                      </div>
                      {traded && owner && (
                        <div className="truncate text-[10px] font-semibold text-brand-700 dark:text-brand-300" title={`${owner.name} (via ${t.name})`}>
                          {owner.abbrev} <span className="font-normal text-muted">via {t.abbrev}</span>
                        </div>
                      )}
                      {p.selection ? (
                        <div className="mt-0.5">
                          <div className="truncate font-semibold leading-tight" title={p.selection.fullName}>
                            {p.selection.fullName}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-muted">
                            <PosBadge pos={p.selection.position} className="h-3.5 min-w-[22px] text-[8px]" />
                            {p.selection.team ?? "FA"} · ${p.selection.salary}
                          </div>
                        </div>
                      ) : isCur ? (
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-gold-600 dark:text-gold-300">On the clock</div>
                      ) : (
                        <div className="mt-1 text-[10px] text-muted">${p.salary}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function QueuePanel({ state, canPick, onDraft, refetch }: { state: RookieRoomState; canPick: boolean; onDraft: (p: RoomPlayer) => void; refetch: () => Promise<void> }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [local, setLocal] = useState<RoomPlayer[] | null>(null);
  const queue = local ?? state.queue;
  const persist = async (next: RoomPlayer[]) => {
    setLocal(next);
    const res = await queueReorderAction({ draftId: state.draft.id, playerIds: next.map((p) => p.id) });
    if (!res.ok) toast.error(res.error);
    await refetch();
    setLocal(null);
  };
  const remove = async (p: RoomPlayer) => {
    setLocal(queue.filter((x) => x.id !== p.id));
    const res = await queueRemoveAction({ draftId: state.draft.id, playerId: p.id });
    if (!res.ok) toast.error(res.error);
    await refetch();
    setLocal(null);
  };
  if (!state.myTeamId) return null;
  return (
    <Panel title="My queue" subtitle="Your next-pick wish list" noPad>
      {queue.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted">Line up your next picks with the + button; drag or use the arrows to set the order.</p>
      ) : (
        <ol className="divide-y divide-line">
          {queue.map((p, i) => (
            <li
              key={p.id}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null && drag !== i) void persist(moveItem(queue, drag, i));
                setDrag(null);
              }}
              className={cn("flex items-center gap-1.5 px-2 py-1.5", drag === i && "opacity-50")}
            >
              <GripVertical size={13} className="hidden shrink-0 cursor-grab text-muted sm:block" aria-hidden />
              <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <PlayerCell player={p} size={24} />
              </div>
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${p.fullName} up`} disabled={i === 0} onClick={() => void persist(moveItem(queue, i, i - 1))}>
                <ArrowUp size={13} />
              </button>
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${p.fullName} down`} disabled={i === queue.length - 1} onClick={() => void persist(moveItem(queue, i, i + 1))}>
                <ArrowDown size={13} />
              </button>
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-loss" aria-label={`Remove ${p.fullName}`} onClick={() => void remove(p)}>
                <X size={13} />
              </button>
              {canPick && (
                <Button size="xs" variant="gold" onClick={() => onDraft(p)}>
                  Draft
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="border-t border-line px-3 py-2 text-[11px] text-muted">If your clock runs out, autopick uses {AUTOPICK_TEXT[state.draft.autopickSource]}.</p>
    </Panel>
  );
}

function PicksPanel({ state, teamsById, upcoming, mine }: { state: RookieRoomState; teamsById: Map<string, RoomTeam>; upcoming: RookieBoardPick[]; mine: RookieBoardPick[] }) {
  const recent = state.picks.filter((p) => p.selection).slice(-8).reverse();
  return (
    <div className="space-y-3">
      {state.myTeamId && (
        <Panel title="My picks" noPad>
          {upcoming.length === 0 && mine.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">You don't own a pick in this draft.</p>
          ) : (
            <table className="tbl tbl-compact">
              <tbody>
                {mine.map((p) => (
                  <tr key={p.pickId}>
                    <td className="w-12 font-display font-bold">{roundPickLabel(p.round, p.pickInRound)}</td>
                    <td>
                      <span className="font-semibold">{p.selection!.fullName}</span> <span className="text-[11px] text-muted">{p.selection!.position}</span>
                    </td>
                    <td className="num text-xs">
                      ${p.selection!.salary} × {p.selection!.contractYears}
                    </td>
                  </tr>
                ))}
                {upcoming.map((p) => {
                  const orig = p.originalTeamId !== p.ownerTeamId ? teamsById.get(p.originalTeamId) : null;
                  const away = p.index - state.draft.currentIndex;
                  return (
                    <tr key={p.pickId}>
                      <td className="w-12 font-display font-bold">{roundPickLabel(p.round, p.pickInRound)}</td>
                      <td className="text-xs text-muted">
                        #{p.overall}
                        {orig ? ` · via ${orig.abbrev}` : ""} · {away === 0 ? <strong className="text-gold-600 dark:text-gold-300">on the clock</strong> : `in ${away}`}
                      </td>
                      <td className="num text-xs">${p.salary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}
      <Panel title="Recent picks" noPad>
        {recent.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">No picks yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((p) => {
              const team = teamsById.get(p.ownerTeamId);
              return (
                <li key={p.pickId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="w-10 font-display font-bold">{roundPickLabel(p.round, p.pickInRound)}</span>
                  {team && <TeamLogo team={team} size={20} />}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{p.selection!.fullName}</span> <span className="text-[11px] text-muted">{p.selection!.position}</span>
                  </span>
                  {p.selection!.isAutopick && <Badge>Auto</Badge>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-line px-3 py-1.5 text-right text-xs">
          <Link href={`/draft/results?id=${state.draft.id}`} className="link">
            All picks →
          </Link>
        </div>
      </Panel>
    </div>
  );
}
