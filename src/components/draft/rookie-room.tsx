"use client";
// Live rookie draft room — "Who's on the clock, how long is left, and who should I take?"
// Phone order: title (one line of facts, rules in ⓘ) → the clock card (team on the clock, big countdown, time bar,
// my next pick) → commissioner bar → last 5 / next 5 picks (sideways) → [Players | Board | Queue | Picks] →
// the available players as roster-style rows (search, position chips, sort; Queue ★ and Draft on every row).
// A compact clock bar pins to the top once the clock card scrolls away. lg+: queue + picks in the side rail and the
// players as a dense table.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronRight, Clock, GripVertical, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/client";
import { Alert, Badge, Button, ButtonLink, EmptyState, Meter, Panel, StatGrid, TeamLogo } from "@/components/ui/core";
import { HeadshotBadge, PosPill } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { roundPickLabel, moveItem } from "@/lib/draft/logic";
import { fmtCountdown, fmtDateTime } from "@/lib/draft/time";
import { makePickAction, queueAddAction, queueRemoveAction, queueReorderAction } from "@/lib/draft/actions";
import type { RookieBoardPick, RookieRoomState, RoomPlayer, RoomTeam } from "@/lib/draft/types";
import { useNow, useRoomAction, useRoomState } from "./use-room";
import { DraftControls } from "./draft-controls";
import { POS_TINT, PlayerCell, shortName } from "./bits";
import { FixedClockBar, PosChips, RoomHeader, RoomTabs, useScrolledPast } from "./room-bits";

type Tab = "players" | "board" | "queue" | "picks";
type SortKey = "rank" | "adp" | "board" | "age";

const AUTOPICK_TEXT: Record<RookieRoomState["draft"]["autopickSource"], string> = {
  BIG_BOARD: "your queue, then your big board, then league rankings, then ADP",
  LEAGUE_RANKINGS: "your queue, then the league rookie rankings, then ADP",
  ADP: "your queue, then ADP",
};
const SORTS: { value: SortKey; label: string }[] = [
  { value: "rank", label: "League rank" },
  { value: "adp", label: "ADP" },
  { value: "board", label: "My board" },
  { value: "age", label: "Age" },
];

const clockLabel = (minutes: number) => (minutes <= 0 ? "no clock" : minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10}h clock` : `${minutes} min clock`);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

export function RookieRoom({ initial }: { initial: RookieRoomState }) {
  const { state, refetch, offset, connected, markActed } = useRoomState(initial, {
    onEvent: (type, data, mine) => {
      if (!mine && (type === "draft.pick" || type === "draft.undo" || type === "draft.status") && typeof data.message === "string") toast(data.message);
    },
  });
  const { pending, run } = useRoomAction(refetch, markActed);
  const [tab, setTab] = useState<Tab>("players");
  const [confirm, setConfirm] = useState<RoomPlayer | null>(null);
  const [usePickId, setUsePickId] = useState<string | null>(null);

  const d = state.draft;
  const teamsById = useMemo(() => new Map(state.teams.map((t) => [t.id, t])), [state.teams]);
  const current: RookieBoardPick | undefined = d.status === "COMPLETE" ? undefined : state.picks[d.currentIndex];
  const onClockTeam = current ? teamsById.get(current.ownerTeamId) ?? null : null;
  const mineOnClock = !!current && d.status === "LIVE" && current.ownerTeamId === state.myTeamId;
  const skippedSet = useMemo(() => new Set(state.skippedPickIds), [state.skippedPickIds]);
  const skippedPicks = state.picks.filter((p) => skippedSet.has(p.pickId));
  const mySkipped = skippedPicks.filter((p) => p.ownerTeamId === state.myTeamId);
  // picks this viewer can use right now: the one on the clock (owner or commissioner) and skipped picks (owner or commissioner)
  const usablePicks = d.status !== "LIVE" ? [] : [...(current && (mineOnClock || state.isCommish) ? [current] : []), ...(state.isCommish ? skippedPicks : mySkipped)];
  const canPick = usablePicks.length > 0;
  const myUpcoming = state.picks.filter((p) => !p.selection && p.ownerTeamId === state.myTeamId && p.index >= d.currentIndex);
  const mySelections = state.picks.filter((p) => p.selection && p.ownerTeamId === state.myTeamId);
  const made = state.picks.filter((p) => p.selection).length;
  const queueIds = useMemo(() => new Set(state.queue.map((q) => q.id)), [state.queue]);
  const defaultPick = (mineOnClock ? current : mySkipped[0] ?? usablePicks[0]) ?? null;
  const chosenPick = usablePicks.find((p) => p.pickId === usePickId) ?? defaultPick;
  const chosenTeam = chosenPick ? teamsById.get(chosenPick.ownerTeamId) ?? null : null;

  const openConfirm = (p: RoomPlayer) => {
    setUsePickId(defaultPick?.pickId ?? null);
    setConfirm(p);
  };
  const draftPlayer = (p: RoomPlayer) => {
    const pick = chosenPick;
    if (!pick) return;
    const isCurrent = !!current && pick.pickId === current.pickId;
    return run("pick", () => makePickAction({ draftId: d.id, playerId: p.id, ...(isCurrent ? { expectedIndex: d.currentIndex } : { pickId: pick.pickId }) })).then((ok) => ok && setConfirm(null));
  };
  const toggleQueue = (p: RoomPlayer) =>
    queueIds.has(p.id)
      ? run(`q-${p.id}`, () => queueRemoveAction({ draftId: d.id, playerId: p.id }), { quiet: true })
      : run(`q-${p.id}`, () => queueAddAction({ draftId: d.id, playerId: p.id }));

  const tabs: { key: Tab; label: React.ReactNode; mobileOnly?: boolean }[] = [
    { key: "players", label: "Players" },
    { key: "board", label: "Board" },
    { key: "queue", label: <span>Queue{state.queue.length ? <span className="numeral ml-1 text-muted">{state.queue.length}</span> : null}</span>, mobileOnly: true },
    { key: "picks", label: "Picks", mobileOnly: true },
  ];

  const rules = (
    <div className="space-y-2">
      <p>
        {d.rounds} round{d.rounds === 1 ? "" : "s"} · {d.style === "SNAKE" ? "snake" : "linear"} order · {d.pickTimerMinutes > 0 ? `${clockLabel(d.pickTimerMinutes)} per pick` : "no pick clock"} ·{" "}
        {d.eligibility === "ROOKIES_ONLY" ? "rookies only" : "rookies and free agents"}.
      </p>
      <p>{d.onTimeout === "SKIP" ? "If the clock runs out the pick is skipped — its owner can still make it any time while the draft is live." : `If the clock runs out, autopick uses ${AUTOPICK_TEXT[d.autopickSource]}.`}</p>
      {d.pause && <p>The clock pauses {hourLabel(d.pause.startHour)}–{hourLabel(d.pause.endHour)} league time every night.</p>}
      <p>Rookie contracts run {d.rookieContractYears} years; salaries follow the league&apos;s rookie scale by pick.</p>
      <p>Queue players with ★ (your autopick list), then use the arrows in Queue to order them.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <RoomHeader
        eyebrow={`Rookie draft · ${d.season}`}
        name={d.name}
        status={d.status}
        facts={`${made}/${state.picks.length} picks · ${d.rounds} rd · ${d.style === "SNAKE" ? "snake" : "linear"} · ${clockLabel(d.pickTimerMinutes)}`}
        info={rules}
        connected={connected}
        actions={
          <>
            <ButtonLink href={`/draft/board?class=${d.season}`} variant="secondary" size="sm">
              My big board
            </ButtonLink>
            <ButtonLink href={`/draft/results?id=${d.id}`} variant="secondary" size="sm">
              Results
            </ButtonLink>
          </>
        }
      />

      <OnClockCard state={state} current={current} team={onClockTeam} teamsById={teamsById} offset={offset} mine={mineOnClock} nextMine={myUpcoming[0] ?? null} skippedLeft={skippedPicks.length} />

      {d.status === "LIVE" && mySkipped.length > 0 && (
        <Alert tone="warn" icon={<Clock size={16} />}>
          <strong>{mySkipped.map((p) => roundPickLabel(p.round, p.pickInRound)).join(", ")} skipped.</strong> You can still make {mySkipped.length === 1 ? "it" : "them"} — tap Draft on any player.
        </Alert>
      )}

      {state.isCommish && (
        <section className="card px-4 py-3" aria-label="Commissioner controls">
          <div className="eyebrow mb-2">Commissioner</div>
          <DraftControls draftId={d.id} status={d.status} type="ROOKIE" hasActivity={made > 0} onChanged={refetch} onBeforeAction={markActed} compact />
          {d.status === "LIVE" && (current || skippedPicks.length > 0) && (
            <p className="mt-2 text-[13px] text-muted">
              {current && !mineOnClock ? `Draft on any player picks for ${onClockTeam?.abbrev ?? "the team on the clock"}.` : ""}
              {skippedPicks.length > 0 ? ` ${skippedPicks.length} skipped pick${skippedPicks.length === 1 ? "" : "s"} can be made for their teams.` : ""}
            </p>
          )}
        </section>
      )}

      <PickTracker picks={state.picks} currentIndex={d.status === "COMPLETE" ? state.picks.length : d.currentIndex} teamsById={teamsById} myTeamId={state.myTeamId} skipped={skippedSet} />

      <RoomTabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {tab === "players" && <AvailablePlayers state={state} canPick={canPick} queueIds={queueIds} pendingKey={pending} onDraft={openConfirm} onQueue={toggleQueue} />}
          {tab === "board" && <DraftBoard state={state} teamsById={teamsById} skipped={skippedSet} />}
          {tab === "queue" && <QueuePanel state={state} canPick={canPick} onDraft={openConfirm} refetch={refetch} />}
          {tab === "picks" && <PicksPanel state={state} teamsById={teamsById} upcoming={[...mySkipped, ...myUpcoming]} mine={mySelections} />}
        </div>
        <aside className="hidden space-y-4 lg:block">
          <QueuePanel state={state} canPick={canPick} onDraft={openConfirm} refetch={refetch} />
          <PicksPanel state={state} teamsById={teamsById} upcoming={[...mySkipped, ...myUpcoming]} mine={mySelections} />
        </aside>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm pick"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="lg" className="flex-1 sm:flex-none" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button size="lg" className="flex-[2] sm:flex-none" onClick={() => confirm && draftPlayer(confirm)} disabled={pending === "pick" || !chosenPick}>
              {pending === "pick" ? "Drafting…" : `Draft ${confirm ? shortName(confirm.fullName, confirm.position) : "player"}`}
            </Button>
          </>
        }
      >
        {confirm && chosenPick && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <HeadshotBadge player={confirm} nflTeam={confirm.team} size={56} />
              <div className="min-w-0">
                <div className="truncate text-[20px] font-bold leading-6 tracking-[-0.01em]">{confirm.fullName}</div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                  <PosPill pos={confirm.position} />
                  <span className="font-medium text-ink">{confirm.team ?? "FA"}</span>
                  {confirm.college && <span className="truncate">· {confirm.college}</span>}
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-sunken px-4 py-3">
              <StatGrid
                cols={3}
                size="md"
                items={[
                  { label: "Pick", value: roundPickLabel(chosenPick.round, chosenPick.pickInRound), sub: `#${chosenPick.overall}` },
                  { label: "Salary", value: `$${chosenPick.salary}`, sub: "rookie scale" },
                  { label: "Years", value: confirm.isRookie ? d.rookieContractYears : "FA", sub: confirm.isRookie ? "contract" : "free agent" },
                ]}
              />
            </div>
            {usablePicks.length > 1 && (
              <label className="block">
                <span className="label">Use pick</span>
                <select className="input" value={chosenPick.pickId} onChange={(e) => setUsePickId(e.target.value)}>
                  {usablePicks.map((p) => (
                    <option key={p.pickId} value={p.pickId}>
                      {roundPickLabel(p.round, p.pickInRound)} · {teamsById.get(p.ownerTeamId)?.name ?? "?"}
                      {current && p.pickId === current.pickId ? " (on the clock)" : " (skipped)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {chosenTeam && chosenPick.ownerTeamId !== state.myTeamId && (
              <Alert tone="warn">
                Commissioner pick for <strong>{chosenTeam.name}</strong>.
              </Alert>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function OnClockCard({
  state,
  current,
  team,
  teamsById,
  offset,
  mine,
  nextMine,
  skippedLeft,
}: {
  state: RookieRoomState;
  current: RookieBoardPick | undefined;
  team: RoomTeam | null;
  teamsById: Map<string, RoomTeam>;
  offset: number;
  mine: boolean;
  nextMine: RookieBoardPick | null;
  skippedLeft: number;
}) {
  // only the clock ticks; the big lists don't re-render every second
  const now = useNow(offset, 500, state.serverNow);
  const { ref, past } = useScrolledPast<HTMLDivElement>();
  const d = state.draft;
  if (d.status === "COMPLETE") {
    return (
      <div className="card flex flex-wrap items-center gap-3 px-4 py-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-win/10 text-win" aria-hidden>
          <Check size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold">Draft complete</div>
          <div className="text-[13px] text-muted">{d.completedAt ? `Finished ${fmtDateTime(d.completedAt, state.timezone)}` : "Every pick is in."}</div>
        </div>
        <ButtonLink href={`/draft/results?id=${d.id}`} size="md">
          Full results
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
  const pausedUntil = d.pausedUntil && new Date(d.pausedUntil).getTime() > now ? d.pausedUntil : null;
  const picksUntilMine = nextMine ? nextMine.index - d.currentIndex : null;
  if (d.status === "LIVE" && !current) {
    return (
      <div className="card flex items-start gap-3 px-4 py-4" role="status" aria-live="polite">
        <Clock size={20} className="mt-0.5 shrink-0 text-muted" />
        <div>
          <div className="text-[17px] font-bold">Waiting on skipped picks</div>
          <p className="mt-0.5 text-[13px] text-muted">
            {skippedLeft} skipped pick{skippedLeft === 1 ? "" : "s"} left · the draft completes when the last one is in (or the commissioner ends it).
          </p>
        </div>
      </div>
    );
  }
  const eyebrow = d.status === "SCHEDULED" ? "First pick" : d.status === "PAUSED" ? "Paused · on the clock" : mine ? "You're on the clock" : "On the clock";
  const timer =
    d.status === "LIVE" && left !== null ? (
      <span className={cn("numeral text-[34px] font-semibold leading-none tracking-[-0.035em] sm:text-[44px]", urgent && !pausedUntil ? "text-live" : "text-ink")}>{fmtCountdown(left)}</span>
    ) : d.status === "SCHEDULED" && startsIn !== null && startsIn > 0 ? (
      <span className="numeral text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[36px]">{fmtCountdown(startsIn)}</span>
    ) : null;
  const timerSub =
    d.status === "LIVE" && left !== null
      ? pausedUntil
        ? `paused · resumes ${fmtDateTime(pausedUntil, state.timezone, { withWeekday: false, withZone: false })}`
        : d.onTimeout === "SKIP"
          ? "left · then skipped"
          : "left · then autopick"
      : d.status === "LIVE"
        ? "no pick clock"
        : d.status === "PAUSED"
          ? d.pausedRemainingMs
            ? `clock stopped · ${fmtCountdown(d.pausedRemainingMs)} left`
            : "clock stopped"
          : d.status === "SCHEDULED"
            ? startsIn !== null && startsIn > 0
              ? `starts ${fmtDateTime(d.startTime, state.timezone, { withZone: false })}`
              : "waiting for the commissioner"
            : "";
  return (
    <>
      <div
        ref={ref}
        className={cn("card px-4 pb-3 pt-3.5", mine && "mine")}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          {team ? <TeamLogo team={team} size={52} round /> : <Clock size={44} className="text-faint" />}
          <div className="min-w-0 flex-1">
            <div className={cn("eyebrow flex items-center gap-1.5", mine ? "text-brand-600 dark:text-brand-400" : d.status === "LIVE" ? "text-live" : undefined)}>
              {d.status === "LIVE" && <span aria-hidden className="live-dot h-2 w-2 bg-live" />}
              {eyebrow}
            </div>
            <div title={team?.name} className="truncate text-[20px] font-bold leading-6 tracking-[-0.01em] text-ink sm:text-[22px]">
              {team?.name ?? "—"}
            </div>
            {current && (
              <div className="mt-0.5 truncate text-[13px] text-muted">
                <span className="numeral font-semibold text-ink">{roundPickLabel(current.round, current.pickInRound)}</span> · #{current.overall} · ${current.salary}
                {orig ? ` · via ${orig.abbrev}` : ""}
              </div>
            )}
          </div>
        </div>
        {timer ? (
          <div className="mt-3 flex items-center gap-3">
            <div className="shrink-0">{timer}</div>
            <div className="min-w-0 flex-1">
              {d.status === "LIVE" && left !== null && total > 0 && !pausedUntil && (
                <Meter value={Math.max(0, left)} max={total} tone={urgent ? "bad" : mine ? "brand" : "neutral"} size="sm" label="Time left on the clock" />
              )}
              <div className="mt-1.5 truncate text-[12px] font-medium text-muted">{timerSub}</div>
            </div>
          </div>
        ) : (
          timerSub && <p className="mt-2 text-[13px] text-muted">{timerSub}</p>
        )}
        {(nextMine || (d.pause && d.status === "LIVE" && !pausedUntil)) && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/70 pt-2.5 text-[13px]">
            {nextMine && !mine ? (
              <span className="min-w-0 truncate text-muted">
                My next pick <span className="numeral font-semibold text-ink">{roundPickLabel(nextMine.round, nextMine.pickInRound)}</span>
                {picksUntilMine ? ` · in ${picksUntilMine} pick${picksUntilMine === 1 ? "" : "s"}` : ""}
              </span>
            ) : (
              <span className="min-w-0 truncate text-muted">{mine ? "Tap Draft on any player" : ""}</span>
            )}
            {d.pause && d.status === "LIVE" && !pausedUntil && (
              <span className="shrink-0 text-muted">
                Pauses {hourLabel(d.pause.startHour)}–{hourLabel(d.pause.endHour)}
              </span>
            )}
          </div>
        )}
      </div>
      <FixedClockBar show={past && d.status !== "SCHEDULED"} tone={mine ? "mine" : urgent ? "urgent" : undefined} label="Back to the clock" onTap={() => ref.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>
        {team && <TeamLogo team={team} size={28} round />}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[12px] font-semibold uppercase leading-4 tracking-[0.04em]", mine ? "text-brand-600 dark:text-brand-400" : "text-muted")}>{mine ? "You're up" : eyebrow}</span>
          <span className="block truncate text-[15px] font-bold leading-5 text-ink">
            {current ? <span className="numeral">{roundPickLabel(current.round, current.pickInRound)}</span> : null} {team?.abbrev}
          </span>
        </span>
        {d.status === "LIVE" && left !== null && <span className={cn("numeral text-[22px] font-semibold leading-none tracking-[-0.02em]", urgent && !pausedUntil ? "text-live" : "text-ink")}>{fmtCountdown(left)}</span>}
        {d.status === "PAUSED" && <Badge tone="amber">Paused</Badge>}
      </FixedClockBar>
    </>
  );
}

function PickTracker({ picks, currentIndex, teamsById, myTeamId, skipped }: { picks: RookieBoardPick[]; currentIndex: number; teamsById: Map<string, RoomTeam>; myTeamId: string | null; skipped: ReadonlySet<string> }) {
  const start = Math.max(0, currentIndex - 5);
  const slice = picks.slice(start, currentIndex + 6);
  if (!slice.length) return null;
  return (
    <div className="scroll-thin scroll-fade -mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0" aria-label="Pick tracker: last 5 and next 5 picks">
      {slice.map((p) => {
        const team = teamsById.get(p.ownerTeamId);
        const isCur = p.index === currentIndex;
        const mine = p.ownerTeamId === myTeamId;
        return (
          <div
            key={p.pickId}
            data-active={isCur || undefined}
            className={cn(
              "flex w-[152px] shrink-0 snap-start items-center gap-2 rounded-lg border-l-[3px] bg-panel px-2.5 py-2 shadow-card",
              p.selection ? POS_TINT[p.selection.position] ?? "border-l-line" : "border-l-transparent",
              isCur && "shadow-[0_0_0_2px_rgb(var(--c-live))]",
              mine && !p.selection && !isCur && "shadow-[0_0_0_1.5px_rgb(var(--c-accent))]",
            )}
          >
            <div className="w-9 shrink-0">
              <div className="numeral text-[15px] font-semibold leading-5 text-ink">{roundPickLabel(p.round, p.pickInRound)}</div>
              {team && <TeamLogo team={team} size={18} className="mt-0.5" />}
            </div>
            <div className="min-w-0 leading-tight">
              {p.selection ? (
                <>
                  <div className="truncate text-[13px] font-semibold text-ink" title={p.selection.fullName}>
                    {shortName(p.selection.fullName, p.selection.position)}
                  </div>
                  <div className="truncate text-[12px] text-muted">
                    {p.selection.position} · {p.selection.team ?? "FA"}
                    {p.selection.isAutopick ? " · auto" : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className={cn("truncate text-[13px] font-semibold", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>{team?.abbrev}</div>
                  <div className={cn("text-[12px]", isCur ? "font-semibold text-live" : skipped.has(p.pickId) ? "font-semibold text-loss" : "text-muted")}>
                    {isCur ? "On the clock" : skipped.has(p.pickId) ? "Skipped" : `#${p.overall}`}
                  </div>
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
  const [limit, setLimit] = useState(40);
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
    <th className={cn("num", cls)} aria-sort={sort === key ? "ascending" : "none"}>
      <button type="button" className={cn("inline-flex min-h-8 items-center gap-0.5 uppercase", sort === key ? "text-ink" : "hover:text-ink")} onClick={() => setSort(key)}>
        {label}
        {sort === key ? <ArrowUp size={12} aria-hidden /> : null}
      </button>
    </th>
  );
  const queueBtn = (p: RoomPlayer) => {
    const queued = queueIds.has(p.id);
    if (!state.myTeamId) return null;
    return (
      <button
        type="button"
        onClick={() => onQueue(p)}
        disabled={pendingKey === `q-${p.id}`}
        aria-pressed={queued}
        aria-label={queued ? `Remove ${p.fullName} from queue` : `Add ${p.fullName} to queue`}
        title={queued ? "In your queue" : "Add to queue"}
        className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-sunken disabled:opacity-50 sm:h-8 sm:w-8", queued ? "text-brand-600 dark:text-brand-400" : "text-muted")}
      >
        {queued ? <Star size={18} fill="currentColor" /> : <Star size={18} />}
      </button>
    );
  };
  return (
    <section aria-label="Available players" className="space-y-3">
      <div className="space-y-2">
        <PosChips positions={state.positions} value={pos} onChange={(p) => (setPos(p), setRemote(null))} />
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search players</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input h-10 rounded-full pl-9"
              type="search"
              placeholder="Search players"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setRemote(null);
              }}
            />
          </label>
          <label className="relative shrink-0">
            <span className="sr-only">Sort by</span>
            <select className="input h-10 w-auto rounded-full pr-8 text-[15px] font-semibold sm:text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
          <span className="truncate">
            {remote ? `${remote.length} result${remote.length === 1 ? "" : "s"} for “${q}”` : `${state.availableTotal} eligible${state.availableTotal > state.available.length ? ` · top ${state.available.length} loaded` : ""}`}
          </span>
          {remote ? (
            <button type="button" className="min-h-8 shrink-0 font-semibold text-brand-600 dark:text-brand-400" onClick={() => setRemote(null)}>
              Clear
            </button>
          ) : state.draft.eligibility === "ROOKIES_AND_FREE_AGENTS" ? (
            <label className="inline-flex min-h-8 shrink-0 items-center gap-2 text-ink">
              <input type="checkbox" className="h-4 w-4" checked={rookiesOnly} onChange={(e) => setRookiesOnly(e.target.checked)} /> Rookies only
            </label>
          ) : null}
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState title={term ? "No loaded players match" : "No available players"}>
          {term.length >= 2 ? (
            <Button size="md" variant="secondary" className="mt-2" onClick={searchAll} disabled={searching}>
              {searching ? "Searching…" : "Search all eligible players"}
            </Button>
          ) : (
            "Every eligible player has been drafted or rostered."
          )}
        </EmptyState>
      ) : (
        <>
          {/* phones: one white sheet of roster-style rows */}
          <ul className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card md:hidden">
            {list.slice(0, limit).map((p) => (
              <li key={p.id} className="flex min-h-[72px] items-center gap-2 border-b border-line/70 py-2 last:border-b-0">
                <span className="w-7 shrink-0 text-center leading-tight">
                  <span className="numeral block text-[15px] font-semibold text-ink">{p.rank ?? "—"}</span>
                  {p.tier ? <span className="block text-[12px] text-muted">T{p.tier}</span> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <PlayerCell
                    player={p}
                    size={40}
                    short
                    sub={
                      <span className="min-w-0 truncate text-muted">
                        {!p.isRookie ? "Vet" : p.college ?? ""}
                        {p.boardRank ? <span className="font-semibold text-brand-600 dark:text-brand-400"> · Board #{p.boardRank}</span> : null}
                      </span>
                    }
                  />
                </span>
                <span className="w-10 shrink-0 text-right leading-tight" title="Dynasty ADP">
                  <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-muted">ADP</span>
                  <span className="numeral block text-[15px] font-semibold text-ink">{p.adp ? Math.round(p.adp) : "—"}</span>
                </span>
                {queueBtn(p)}
                {canPick && (
                  <Button size="md" className="shrink-0 px-3" onClick={() => onDraft(p)}>
                    Draft
                  </Button>
                )}
              </li>
            ))}
            {list.length > limit && (
              <li>
                <button type="button" onClick={() => setLimit((n) => n + 40)} className="flex min-h-12 w-full items-center justify-center gap-1 text-[14px] font-semibold text-brand-600 dark:text-brand-400">
                  Show {Math.min(40, list.length - limit)} more <span className="font-normal text-muted">· {list.length - limit} left</span>
                </button>
              </li>
            )}
          </ul>
          {/* md+: dense table */}
          <div className="card hidden md:block">
            <div className="scroll-thin max-h-[70vh] overflow-auto">
              <table className="tbl tbl-compact">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {th("rank", "Rk", "w-12")}
                    <th>Player</th>
                    <th className="hidden xl:table-cell">College</th>
                    {th("age", "Age")}
                    {th("adp", "ADP")}
                    {th("board", "My #")}
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
                        {p.tier ? <span className="block text-[12px] text-muted">T{p.tier}</span> : null}
                      </td>
                      <td className="max-w-[280px]">
                        <PlayerCell player={p} size={32} sub={!p.isRookie ? <Badge>Vet</Badge> : null} />
                      </td>
                      <td className="hidden text-muted xl:table-cell">{p.college ?? "—"}</td>
                      <td className="num">{p.age ?? "—"}</td>
                      <td className="num">{p.adp ? Math.round(p.adp) : "—"}</td>
                      <td className="num">{p.boardRank ?? "—"}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {queueBtn(p)}
                          {canPick && (
                            <Button size="sm" onClick={() => onDraft(p)}>
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
          </div>
        </>
      )}
    </section>
  );
}

function DraftBoard({ state, teamsById, skipped }: { state: RookieRoomState; teamsById: Map<string, RoomTeam>; skipped: ReadonlySet<string> }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scroller.current;
    const cur = el?.querySelector<HTMLElement>("[data-current]");
    if (!el || !cur) return;
    const s = el.getBoundingClientRect();
    const c = cur.getBoundingClientRect();
    if (c.right > s.right || c.left < s.left + 44) el.scrollLeft += c.left - s.left - 52;
  }, []);
  const rounds = [...new Set(state.picks.map((p) => p.round))].sort((a, b) => a - b);
  const cell = new Map(state.picks.map((p) => [`${p.originalTeamId}|${p.round}`, p]));
  const currentId = state.draft.status === "COMPLETE" ? null : state.picks[state.draft.currentIndex]?.pickId;
  if (!state.picks.length) return <EmptyState title="No picks in this draft">The commissioner needs to set the draft order.</EmptyState>;
  return (
    <Panel
      noPad
      title="Draft board"
      subtitle="Swipe sideways · columns are draft slots"
      info={
        <div className="space-y-2">
          <p>Each column is a round-1 draft slot (the team that originally owned the pick); rows are rounds.</p>
          <p>A traded pick shows the team that owns it now in blue (&ldquo;via&rdquo; the original team). Your picks have a blue outline; the pick on the clock a red one.</p>
          {state.pickTradingOpen && <p>Tap ⇄ on an unused pick to offer it in a trade (or trade for it).</p>}
        </div>
      }
      infoTitle="Reading the board"
    >
      <div ref={scroller} className="scroll-thin overflow-x-auto border-t border-line/70">
        <table className="border-separate border-spacing-1.5 p-1.5" style={{ minWidth: state.teams.length * 116 + 44 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-9 bg-panel" />
              {state.teams.map((t, i) => (
                <th key={t.id} className="px-1 pb-1 text-center align-bottom">
                  <div className="flex flex-col items-center gap-0.5">
                    <TeamLogo team={t} size={28} />
                    <span className={cn("max-w-[104px] truncate text-[12px] font-semibold", t.id === state.myTeamId ? "text-brand-600 dark:text-brand-400" : "text-ink")} title={t.name}>
                      {t.abbrev}
                    </span>
                    <span className="text-[11px] font-medium text-muted">Slot {i + 1}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rounds.map((r) => (
              <tr key={r}>
                <th className="sticky left-0 z-10 bg-panel text-center text-[13px] font-semibold text-muted">R{r}</th>
                {state.teams.map((t) => {
                  const p = cell.get(`${t.id}|${r}`);
                  if (!p) return <td key={t.id} className="rounded-lg border border-dashed border-line" />;
                  const owner = teamsById.get(p.ownerTeamId);
                  const traded = p.ownerTeamId !== p.originalTeamId;
                  const isCur = p.pickId === currentId;
                  const mine = p.ownerTeamId === state.myTeamId;
                  return (
                    <td
                      key={t.id}
                      data-current={isCur || undefined}
                      className={cn(
                        "h-[78px] w-[108px] rounded-lg border-l-[3px] bg-sunken/60 p-2 align-top text-[12px]",
                        p.selection ? POS_TINT[p.selection.position] ?? "border-l-line" : "border-l-transparent",
                        isCur && "shadow-[0_0_0_2px_rgb(var(--c-live))]",
                        mine && !isCur && "shadow-[0_0_0_1.5px_rgb(var(--c-accent))]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1 text-[12px] leading-4 text-muted">
                        <span className="numeral font-semibold text-ink">{roundPickLabel(p.round, p.pickInRound)}</span>
                        {state.pickTradingOpen && !p.selection && !isCur ? (
                          <Link
                            href={`/trades/new?pick=${p.pickId}`}
                            className="-m-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
                            title={mine ? "Offer this pick in a trade" : `Trade for this pick (${owner?.name ?? "owner"})`}
                            aria-label={mine ? `Offer pick ${roundPickLabel(p.round, p.pickInRound)} in a trade` : `Trade for pick ${roundPickLabel(p.round, p.pickInRound)}`}
                          >
                            <ArrowLeftRight size={13} />
                          </Link>
                        ) : (
                          <span>#{p.overall}</span>
                        )}
                      </div>
                      {traded && owner && (
                        <div className="truncate text-[12px] font-semibold leading-4 text-brand-600 dark:text-brand-400" title={`${owner.name} (via ${t.name})`}>
                          {owner.abbrev} <span className="font-normal text-muted">via {t.abbrev}</span>
                        </div>
                      )}
                      {p.selection ? (
                        <div className="mt-1">
                          <div className="truncate font-semibold leading-4 text-ink" title={p.selection.fullName}>
                            {shortName(p.selection.fullName, p.selection.position)}
                          </div>
                          <div className="mt-0.5 truncate leading-4 text-muted">
                            {p.selection.position} · {p.selection.team ?? "FA"} · ${p.selection.salary}
                          </div>
                        </div>
                      ) : isCur ? (
                        <div className="mt-1 font-semibold text-live">On the clock</div>
                      ) : skipped.has(p.pickId) ? (
                        <div className="mt-1 font-semibold text-loss">Skipped</div>
                      ) : (
                        <div className="mt-1 text-muted">${p.salary}</div>
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
  if (!state.myTeamId) return <EmptyState title="No team">Queues belong to teams.</EmptyState>;
  const iconBtn = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-sunken disabled:opacity-30 sm:h-8 sm:w-8";
  return (
    <Panel
      title="My queue"
      subtitle={state.draft.onTimeout === "SKIP" ? "Your wish list for the next pick" : "Autopick takes the top player"}
      info={<p>{state.draft.onTimeout === "SKIP" ? "If your clock runs out, your pick is skipped — you can still make it later while the draft is live." : `If your clock runs out, autopick uses ${AUTOPICK_TEXT[state.draft.autopickSource]}.`}</p>}
      noPad
    >
      {queue.length === 0 ? (
        <p className="border-t border-line/70 px-4 py-4 text-[13px] text-muted">
          Tap <Star size={13} className="inline align-[-2px]" aria-label="star" /> on a player to queue him.
        </p>
      ) : (
        <ol className="divide-y divide-line/70 border-t border-line/70">
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
              className={cn("flex min-h-[64px] items-center gap-1.5 py-2 pl-3 pr-2 sm:pl-4", drag === i && "opacity-50")}
            >
              <GripVertical size={14} className="hidden shrink-0 cursor-grab text-faint lg:block" aria-hidden />
              <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <PlayerCell player={p} size={36} short />
              </div>
              <button type="button" className={iconBtn} aria-label={`Move ${p.fullName} up`} disabled={i === 0} onClick={() => void persist(moveItem(queue, i, i - 1))}>
                <ArrowUp size={16} />
              </button>
              <button type="button" className={iconBtn} aria-label={`Move ${p.fullName} down`} disabled={i === queue.length - 1} onClick={() => void persist(moveItem(queue, i, i + 1))}>
                <ArrowDown size={16} />
              </button>
              <button type="button" className={cn(iconBtn, "hover:text-loss")} aria-label={`Remove ${p.fullName} from queue`} onClick={() => void remove(p)}>
                <X size={16} />
              </button>
              {canPick && (
                <Button size="sm" className="shrink-0" onClick={() => onDraft(p)}>
                  Draft
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function PicksPanel({ state, teamsById, upcoming, mine }: { state: RookieRoomState; teamsById: Map<string, RoomTeam>; upcoming: RookieBoardPick[]; mine: RookieBoardPick[] }) {
  const recent = state.picks.filter((p) => p.selection).slice(-8).reverse();
  const pickBox = (label: string, tone?: "live" | "loss") => (
    <span className={cn("numeral inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-sunken text-[15px] font-semibold", tone === "live" ? "text-live" : tone === "loss" ? "text-loss" : "text-ink")}>{label}</span>
  );
  return (
    <div className="space-y-4">
      {state.myTeamId && (
        <Panel title="My picks" subtitle={`${mine.length} made · ${upcoming.length} to go`} noPad>
          {upcoming.length === 0 && mine.length === 0 ? (
            <p className="border-t border-line/70 px-4 py-4 text-[13px] text-muted">You don&apos;t own a pick in this draft.</p>
          ) : (
            <ul className="divide-y divide-line/70 border-t border-line/70">
              {mine.map((p) => (
                <li key={p.pickId} className="flex min-h-14 items-center gap-3 px-4 py-2">
                  {pickBox(roundPickLabel(p.round, p.pickInRound))}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm">{p.selection!.fullName}</span>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <PosPill pos={p.selection!.position} /> {p.selection!.team ?? "FA"}
                      {p.selection!.isAutopick ? " · auto" : ""}
                    </span>
                  </span>
                  <span className="numeral shrink-0 text-[15px] font-semibold text-ink">
                    ${p.selection!.salary}
                    <span className="text-[13px] font-normal text-muted"> × {p.selection!.contractYears}</span>
                  </span>
                </li>
              ))}
              {upcoming.map((p) => {
                const orig = p.originalTeamId !== p.ownerTeamId ? teamsById.get(p.originalTeamId) : null;
                const away = p.index - state.draft.currentIndex;
                return (
                  <li key={p.pickId} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    {pickBox(roundPickLabel(p.round, p.pickInRound), away === 0 ? "live" : away < 0 ? "loss" : undefined)}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[15px] font-semibold sm:text-sm", away === 0 ? "text-live" : away < 0 ? "text-loss" : "text-ink")}>
                        {away === 0 ? "On the clock" : away < 0 ? "Skipped · pick any time" : `In ${away} pick${away === 1 ? "" : "s"}`}
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        #{p.overall}
                        {orig ? ` · via ${orig.abbrev}` : ""}
                      </span>
                    </span>
                    <span className="numeral shrink-0 text-[15px] font-semibold text-muted">${p.salary}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
      <Panel title="Recent picks" noPad actions={<Link href={`/draft/results?id=${state.draft.id}`} className="inline-flex min-h-8 items-center gap-0.5 text-[13px] font-semibold text-brand-600 dark:text-brand-400">All <ChevronRight size={14} /></Link>}>
        {recent.length === 0 ? (
          <p className="border-t border-line/70 px-4 py-4 text-[13px] text-muted">No picks yet.</p>
        ) : (
          <ul className="divide-y divide-line/70 border-t border-line/70">
            {recent.map((p) => {
              const team = teamsById.get(p.ownerTeamId);
              return (
                <li key={p.pickId} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                  <span className="numeral w-9 shrink-0 text-[15px] font-semibold text-ink">{roundPickLabel(p.round, p.pickInRound)}</span>
                  {team && <TeamLogo team={team} size={24} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm" title={p.selection!.fullName}>
                      {p.selection!.fullName}
                    </span>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      <PosPill pos={p.selection!.position} /> {p.selection!.team ?? "FA"}
                    </span>
                  </span>
                  {p.selection!.isAutopick && <Badge>Auto</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
