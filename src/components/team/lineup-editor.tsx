"use client";
// Roster + easy lineup setup — the canonical "Roster" pattern (docs/DESIGN.md §6.2): "Week 12 ▾" with a view picker
// (Overview / Season / Contracts) and Optimize; grey section bars (Active players · PROJ, Bench, IR, Taxi, Dead cap);
// rows = outlined slot pill (tap it to start a move) · headshot with NFL badge · name / position pill + team /
// opponent line · right-aligned stat columns (two on phones, chosen by the view; all of them from lg). Two-tap moves
// with highlighted valid destinations, a per-row "Move to" select on desktop, optimize / reset / save, lineup
// warnings with one-click fixes, lock countdowns and live refresh.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, Loader2, Lock, Newspaper, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { Button, InfoButton } from "@/components/ui/core";
import { BarTotal, OppLine, RosterRow as RosterRowView, RosterStat, SectionBar, SlotPill } from "@/components/ui/fantasy";
import { useLiveEvents } from "@/lib/realtime/client";
import type { PlayerPointsEvent, ScoreUpdateEvent } from "@/lib/realtime/events";
import { saveLineupAction } from "@/lib/team/actions";
import { countdown, positionRank } from "@/lib/team/format";
import {
  applyFix,
  applyMove,
  changedSlotCount,
  lineupIssues,
  moveTargets,
  slotAccepts,
  slotId,
  starterSet,
  sumStarters,
  toList,
  type Assignment,
  type LineupIssue,
  type LineupPlayerInfo,
  type MoveTarget,
} from "@/lib/team/lineup-model";
import type { LineupEditorData, RosterRow } from "@/lib/team/types";
import { cn, fmtMoney, fmtPts } from "@/lib/utils";
import { ContractBadges } from "./bits";
import { RosterActionsMenu } from "./roster-actions";
import { WeekTitle, type WeekNav } from "./week-picker";

export interface DeadCapRow {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  current: number;
  bySeason: { season: number; amount: number }[];
}

type Selection = { kind: "player"; id: string } | { kind: "slot"; id: string } | null;

type View = "overview" | "season" | "contracts";

export function LineupEditor({ data, deadCap = [], weekNav }: { data: LineupEditorData; deadCap?: DeadCapRow[]; weekNav?: WeekNav }) {
  const { slots, saved, optimal, rows, editable, manage, teamId, week } = data;
  const [view, setView] = useState<View>("overview");
  const router = useRouter();
  const [assign, setAssign] = useState<Assignment>(saved);
  const [sel, setSel] = useState<Selection>(null);
  const [saving, startSave] = useTransition();
  const [now, setNow] = useState<Date | null>(null);

  // keep local state in sync with the server's saved lineup when there are no unsaved edits
  const savedKey = JSON.stringify(saved);
  const lastSaved = useRef(savedKey);
  const dirtyRef = useRef(false);
  const dirty = changedSlotCount(assign, saved);
  dirtyRef.current = dirty > 0;
  useEffect(() => {
    if (lastSaved.current === savedKey) return;
    lastSaved.current = savedKey;
    if (!dirtyRef.current) setAssign(JSON.parse(savedKey) as Assignment);
  }, [savedKey]);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel]);

  // live scoring: refresh server data (throttled) when my players or my matchup change
  const rowIds = useMemo(() => new Set(rows.map((r) => r.playerId)), [rows]);
  const lastRefresh = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    const wait = Math.max(0, 4000 - (Date.now() - lastRefresh.current));
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      lastRefresh.current = Date.now();
      router.refresh();
    }, wait);
  }, [router]);
  useEffect(() => () => void (refreshTimer.current && clearTimeout(refreshTimer.current)), []);
  useLiveEvents([`league:${data.leagueId}`], (e) => {
    if (e.type === "player.points") {
      const d = e.data as PlayerPointsEvent;
      if (d.week === week && (d.teamIds?.includes(teamId) || rowIds.has(d.playerId))) scheduleRefresh();
    } else if (e.type === "score.update") {
      const d = e.data as ScoreUpdateEvent;
      if (d.week === week && (d.homeTeamId === teamId || d.awayTeamId === teamId)) scheduleRefresh();
    } else if (e.type === "scores.refresh") {
      const d = e.data as { week?: number };
      if (!d?.week || d.week === week) scheduleRefresh();
    }
  });

  const byId = useMemo(() => new Map(rows.map((r) => [r.playerId, r])), [rows]);
  const players = useMemo(() => {
    const m = new Map<string, LineupPlayerInfo>();
    for (const r of rows) {
      if (r.rosterStatus === "GONE") continue;
      const startable = r.rosterStatus === "ACTIVE" || (r.rosterStatus === "TAXI" && data.taxiCanStart);
      m.set(r.playerId, { id: r.playerId, name: r.name, pos: r.pos, rosterStatus: r.rosterStatus, startable, locked: r.locked, onBye: r.onBye, injuryStatus: r.injuryStatus, projected: r.liveProjected });
    }
    return m;
  }, [rows, data.taxiCanStart]);

  const starters = starterSet(assign);
  const bench = rows
    .filter((r) => r.rosterStatus === "ACTIVE" && !starters.has(r.playerId))
    .sort((a, b) => positionRank(a.pos) - positionRank(b.pos) || b.liveProjected - a.liveProjected || b.seasonTotal - a.seasonTotal);
  const ir = rows.filter((r) => r.rosterStatus === "IR");
  const taxi = rows.filter((r) => r.rosterStatus === "TAXI" && !starters.has(r.playerId));
  const healthyIr = ir.filter((r) => r.irIneligible);

  const canMove = (pid: string | null | undefined) => {
    if (!editable || !pid) return false;
    const p = players.get(pid);
    return !!p && !!p.startable && !p.locked;
  };
  const selectedPlayer = sel?.kind === "player" ? sel.id : null;
  const targets = selectedPlayer ? moveTargets(assign, slots, players, selectedPlayer) : null;
  const emptySlotSel = sel?.kind === "slot" ? slots.find((s) => slotId(s.key, s.index) === sel.id) ?? null : null;
  const reserves = data.taxiCanStart ? [...bench, ...taxi] : bench;
  const benchTargetsForEmpty = emptySlotSel ? new Set(reserves.filter((b) => canMove(b.playerId) && slotAccepts(emptySlotSel, b.pos)).map((b) => b.playerId)) : null;

  const issues = editable ? lineupIssues(assign, slots, players) : [];
  const errors = issues.filter((i) => i.severity === "error");
  const empties = slots.filter((s) => !assign[slotId(s.key, s.index)]).length;
  const valueOf = (key: "points" | "liveProjected") => (pid: string) => byId.get(pid)?.[key] ?? 0;
  const base = data.adjustments - empties * data.emptyPenalty;
  const totalPts = sumStarters(assign, valueOf("points")) + base;
  const totalProj = sumStarters(assign, valueOf("liveProjected")) + base;
  const optimalGain = optimal ? Math.round((sumStarters(optimal, valueOf("liveProjected")) - sumStarters(assign, valueOf("liveProjected"))) * 10) / 10 : 0;

  const doMove = (playerId: string, target: MoveTarget) => {
    setAssign((a) => applyMove(a, slots, players, playerId, target));
    setSel(null);
  };

  const onSlotTap = (id: string) => {
    if (!editable) return;
    const occ = assign[id];
    if (selectedPlayer) {
      if (occ === selectedPlayer) return setSel(null);
      if (targets?.slots.has(id)) return doMove(selectedPlayer, { kind: "slot", slot: id });
      if (canMove(occ)) return setSel({ kind: "player", id: occ! });
      return setSel(null);
    }
    if (sel?.kind === "slot" && sel.id === id) return setSel(null);
    if (occ) {
      if (canMove(occ)) setSel({ kind: "player", id: occ });
      else toast.info(`${byId.get(occ)?.name ?? "That player"} is locked — his game has started.`);
      return;
    }
    setSel({ kind: "slot", id });
  };

  const onBenchTap = (pid: string) => {
    if (!editable) return;
    if (sel?.kind === "slot") {
      if (benchTargetsForEmpty?.has(pid)) {
        setAssign((a) => applyFix(a, sel.id, pid));
        return setSel(null);
      }
    }
    if (selectedPlayer) {
      if (selectedPlayer === pid) return setSel(null);
      if (targets?.players.has(pid)) return doMove(selectedPlayer, { kind: "player", playerId: pid });
    }
    if (canMove(pid)) setSel({ kind: "player", id: pid });
    else if (byId.get(pid)?.locked) toast.info(`${byId.get(pid)?.name} is locked — his game has started.`);
    else setSel(null);
  };

  const save = (next: Assignment = assign, label?: string) =>
    startSave(async () => {
      try {
        const res = await saveLineupAction({ teamId, week, lineup: toList(next, slots) });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(label ?? res.message ?? "Lineup saved");
        setAssign(next);
        lastSaved.current = "";
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  const optimize = () => {
    if (!optimal) return;
    const n = changedSlotCount(optimal, assign);
    if (!n) {
      toast.success("Your lineup is already optimal by projection.");
      return;
    }
    setAssign(optimal);
    setSel(null);
    toast.info(`Optimized ${n} slot${n === 1 ? "" : "s"} (${optimalGain >= 0 ? "+" : ""}${optimalGain.toFixed(1)} proj). Review and save.`);
  };

  const fixIssue = (issue: LineupIssue) => {
    if (!issue.fix) return;
    const next = applyFix(assign, issue.slot, issue.fix.playerId);
    save(next, `Started ${issue.fix.name} at ${issue.slotLabel}.`);
  };

  const savedProj = sumStarters(saved, valueOf("liveProjected")) + data.adjustments - slots.filter((s) => !saved[slotId(s.key, s.index)]).length * data.emptyPenalty;

  // height of the floating picker / save bar on phones, so a spacer can keep the last rows reachable
  const floatRef = useRef<HTMLDivElement | null>(null);
  const [floatH, setFloatH] = useState(0);
  const floatShown = !!sel || (editable && dirty > 0);
  useLayoutEffect(() => {
    const el = floatRef.current;
    if (!floatShown || !el) {
      setFloatH(0);
      return;
    }
    const measure = () => setFloatH(getComputedStyle(el).display === "none" ? 0 : Math.max(0, el.getBoundingClientRect().height - 24));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [floatShown, sel]);

  const anyTarget = !!sel;
  const lockedCount = rows.filter((r) => r.locked && starters.has(r.playerId)).length;
  const showActions = manage;
  // once any of this week's games has kicked off, points lead; before that, projections + matchup difficulty
  const weekStarted = rows.some((r) => r.game.state === "in" || r.game.state === "post");

  /** would the occupant of a target slot fit the slot this player leaves? (bench → slot always reads as a swap) */
  const swapsBack = (pid: string, occPos: string) => {
    const from = Object.entries(assign).find(([, v]) => v === pid)?.[0];
    if (!from) return true;
    const def = slots.find((s) => slotId(s.key, s.index) === from);
    return !!def && slotAccepts(def, occPos);
  };

  const slotOptions = (r: RosterRow) => {
    if (!canMove(r.playerId)) return null;
    const t = moveTargets(assign, slots, players, r.playerId);
    const from = Object.entries(assign).find(([, v]) => v === r.playerId)?.[0] ?? "BN";
    const rest = r.rosterStatus === "TAXI" ? "Taxi" : "Bench";
    const opts: { value: string; label: string }[] = [{ value: from, label: from === "BN" ? rest : slots.find((s) => slotId(s.key, s.index) === from)?.label ?? from }];
    if (from !== "BN") opts.push({ value: "BN", label: `→ ${rest}` });
    for (const s of slots) {
      const id = slotId(s.key, s.index);
      if (!t.slots.has(id)) continue;
      const occ = assign[id];
      const o = occ ? byId.get(occ) : undefined;
      opts.push({ value: id, label: `→ ${s.label}${o ? (swapsBack(r.playerId, o.pos) ? ` (swap ${shortName(o.name)})` : ` (${shortName(o.name)} to bench)`) : " (empty)"}` });
    }
    return { from, opts };
  };

  // destinations for the floating picker (same rules as the highlighted rows)
  const pickerOptions: { key: string; label: string; onPick: () => void }[] = [];
  if (selectedPlayer && targets) {
    for (const s of slots) {
      const id = slotId(s.key, s.index);
      if (!targets.slots.has(id)) continue;
      const occ = assign[id];
      const o = occ ? byId.get(occ) : undefined;
      // a starter moving into an occupied slot swaps only when the occupant fits the slot he leaves; else the
      // occupant goes to the bench (applyMove) — say so instead of promising a swap
      const label = !o ? `${s.label} (empty)` : swapsBack(selectedPlayer, o.pos) ? `${s.label} ⇄ ${shortName(o.name)} (${fmtPts(o.liveProjected, 1)})` : `${s.label} · ${shortName(o.name)} to bench`;
      pickerOptions.push({ key: id, label, onPick: () => doMove(selectedPlayer, { kind: "slot", slot: id }) });
    }
    if (targets.bench) pickerOptions.push({ key: "bench", label: byId.get(selectedPlayer)?.rosterStatus === "TAXI" ? "Taxi squad" : "Bench", onPick: () => doMove(selectedPlayer, { kind: "bench" }) });
    for (const r of reserves) {
      if (!targets.players.has(r.playerId)) continue;
      pickerOptions.push({ key: `p-${r.playerId}`, label: `⇄ ${shortName(r.name)} (${r.pos} · ${fmtPts(r.liveProjected, 1)})`, onPick: () => doMove(selectedPlayer, { kind: "player", playerId: r.playerId }) });
    }
  } else if (sel?.kind === "slot" && benchTargetsForEmpty) {
    for (const r of reserves) {
      if (!benchTargetsForEmpty.has(r.playerId)) continue;
      pickerOptions.push({
        key: `f-${r.playerId}`,
        label: `${shortName(r.name)} (${r.pos} · ${fmtPts(r.liveProjected, 1)})`,
        onPick: () => {
          setAssign((a) => applyFix(a, sel.id, r.playerId));
          setSel(null);
        },
      });
    }
  }

  /** the stat columns of one row: the view's two on phones / tablets, all of them from lg */
  const statCols = (r: RosterRow) => {
    const projText = r.projected || r.liveProjected ? fmtPts(r.game.state === "in" ? r.liveProjected : r.projected, 1) : "—";
    const started = r.game.state === "in" || r.game.state === "post";
    const pts = <RosterStat key="pts" label="Pts" value={started ? fmtPts(r.points) : "—"} tone={!started ? "muted" : undefined} className={cn("w-11", r.game.state === "in" && "[&>span:last-child]:text-live")} />;
    const proj = <RosterStat key="proj" label="Proj" value={projText} className="w-11" />;
    const oprk = (
      <RosterStat
        key="oprk"
        label="Oprk"
        title={r.oprk ? `${r.oprk.rank} of ${r.oprk.of} vs ${r.pos} · ${r.oprk.perGame.toFixed(1)} FPts allowed/game (1 = toughest)` : undefined}
        value={r.oprk ? r.oprk.rank : "—"}
        tone={!r.oprk ? "muted" : r.oprk.tone === "easy" ? "good" : r.oprk.tone === "tough" ? "bad" : undefined}
        className="w-11"
      />
    );
    const total = <RosterStat key="total" label="Season" value={fmtPts(r.seasonTotal, 1)} className="w-[52px]" />;
    const avg = <RosterStat key="avg" label="Avg" value={fmtPts(r.seasonAvg, 1)} className="w-11" />;
    const bye = <RosterStat key="bye" label="Bye" value={r.byeWeek ?? "—"} tone={r.onBye ? "bad" : undefined} className="w-10 sm:w-10" />;
    const salary = data.showSalary ? <RosterStat key="sal" label="Salary" value={r.salary !== null ? fmtMoney(r.salary) : "—"} /> : null;
    const yrs = data.showSalary && data.showContracts ? <RosterStat key="yrs" label="Thru" value={r.contractEnd ? `'${String(r.contractEnd).slice(2)}` : "—"} title={r.contractYears !== null ? `${r.contractYears} year${r.contractYears === 1 ? "" : "s"} left` : undefined} className="w-10 sm:w-10" /> : null;
    const phone = view === "season" ? [total, avg] : view === "contracts" ? [salary, yrs] : weekStarted ? [pts, proj] : [proj, oprk];
    return (
      <>
        <div className="flex gap-1 lg:hidden">{phone}</div>
        <div className="hidden gap-2 lg:flex">{[pts, proj, oprk, total, avg, bye, salary, yrs]}</div>
      </>
    );
  };

  const renderRow = (r: RosterRow, ctxRow: { group: "starter" | "bench" | "ir" | "taxi"; slotKey?: string; slotLabel?: string; id?: string }) => {
    const isSel = selectedPlayer === r.playerId;
    // taxi players act like bench players when the league lets them start
    const benchLike = ctxRow.group === "bench" || (ctxRow.group === "taxi" && data.taxiCanStart);
    const lineupRow = ctxRow.group === "starter" || benchLike;
    const isTarget =
      (ctxRow.group === "starter" && !!ctxRow.id && !!targets?.slots.has(ctxRow.id)) ||
      (benchLike && (!!targets?.players.has(r.playerId) || !!benchTargetsForEmpty?.has(r.playerId)));
    const dim = anyTarget && !isSel && !isTarget && lineupRow;
    const movable = canMove(r.playerId) && lineupRow;
    const tap = ctxRow.group === "starter" && ctxRow.id ? () => onSlotTap(ctxRow.id!) : benchLike ? () => onBenchTap(r.playerId) : undefined;
    const so = lineupRow && editable ? slotOptions(r) : null;
    const lockIn = now && r.kickoff && !r.locked ? countdown(r.kickoff, now) : null;
    const soon = lockIn && new Date(r.kickoff!).getTime() - (now?.getTime() ?? 0) < 24 * 3600_000;
    const badgeKey = ctxRow.group === "starter" ? ctxRow.slotKey! : ctxRow.group === "bench" ? "BN" : ctxRow.group === "ir" ? "IR" : "TAXI";
    return (
      <RosterRowView
        key={`${ctxRow.id ?? ctxRow.group}-${r.playerId}`}
        className={cn("transition-[background-color,opacity]", isSel && "bg-brand-600/[0.08] dark:bg-brand-400/15", isTarget && "bg-brand-600/[0.04] dark:bg-brand-400/10", dim && "opacity-55", r.rosterStatus === "GONE" && "opacity-70")}
        slot={
          <SlotButton
            slotKey={badgeKey}
            label={ctxRow.group === "starter" ? ctxRow.slotLabel! : undefined}
            onClick={tap}
            interactive={editable && (movable || isTarget)}
            selected={isSel}
            target={isTarget}
            locked={r.locked && lineupRow}
            ariaLabel={isTarget ? `Move here (${ctxRow.slotLabel ?? "bench"})` : movable ? `Move ${r.name}` : undefined}
          />
        }
        player={{ id: r.playerId, name: r.name, short: r.pos === "DEF" ? `${r.nflTeam ?? ""} DEF`.trim() : shortName(r.name), position: r.position, nflTeam: r.nflTeam, injury: r.injuryStatus }}
        href={`/players/${r.playerId}`}
        nameExtra={
          <>
            {r.hasNews && (
              <Link href={`/players/${r.playerId}?tab=news`} title="Recent news" aria-label={`Recent news on ${r.name}`} className="-m-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-600 hover:bg-sunken dark:text-amber-400">
                <Newspaper size={14} aria-hidden />
              </Link>
            )}
            {data.showContracts && <ContractBadges isRookie={r.isRookie} isTagged={r.isTagged} years={r.contractYears} className={cn("shrink-0", view !== "contracts" && "hidden lg:inline-flex")} />}
            {isTarget && <span className="shrink-0 rounded bg-brand-600 px-1 text-[11px] font-bold uppercase leading-4 text-white">{benchLike ? "Swap" : "Here"}</span>}
            {r.irIneligible && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[11px] font-bold uppercase leading-4 text-amber-800 dark:text-amber-200">Healthy</span>}
          </>
        }
        opp={
          <span className="flex min-w-0 items-center gap-1 text-muted">
            <OppLine opp={r.game.state === "bye" ? "BYE" : r.game.opp} when={<GameStatus r={r} compact />} difficulty={r.oprk?.tone === "easy" ? "easy" : r.oprk?.tone === "tough" ? "hard" : null} className="min-w-0" />
            {r.rosterStatus === "GONE" && <span className="shrink-0 italic">· no longer rostered</span>}
            {lockIn && soon && <span className="hidden shrink-0 sm:inline">· locks in {lockIn}</span>}
          </span>
        }
        stats={statCols(r)}
        trailing={
          showActions ? (
            <>
              {so && (
                <select
                  aria-label={`Move ${r.name} to`}
                  className="input mr-1 hidden h-9 w-[150px] py-0 text-xs lg:block"
                  value={so.from}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === so.from) return;
                    doMove(r.playerId, v === "BN" ? { kind: "bench" } : { kind: "slot", slot: v });
                  }}
                >
                  {so.opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <RosterActionsMenu teamId={teamId} row={r} salaryCapOn={data.showSalary} />
            </>
          ) : undefined
        }
      />
    );
  };

  const emptyRow = (s: (typeof slots)[number]) => {
    const id = slotId(s.key, s.index);
    const isTarget = !!targets?.slots.has(id);
    const isSel = sel?.kind === "slot" && sel.id === id;
    const dim = anyTarget && !isTarget && !isSel;
    return (
      <div key={`empty-${id}`} className={cn("flex min-h-[76px] items-center gap-2.5 border-b border-line/70 py-2.5 last:border-b-0 sm:gap-3", isTarget && "bg-brand-600/[0.04] dark:bg-brand-400/10", isSel && "bg-brand-600/[0.08] dark:bg-brand-400/15", dim && "opacity-55")}>
        <SlotButton slotKey={s.key} label={s.label} onClick={() => onSlotTap(id)} interactive={editable} selected={isSel} target={isTarget} ariaLabel={`${s.label} slot (empty)`} />
        {editable ? (
          <button type="button" onClick={() => onSlotTap(id)} className="min-h-[44px] flex-1 text-left text-[15px] font-semibold text-loss hover:underline">
            {isTarget ? `Move ${byId.get(selectedPlayer!)?.name ?? "player"} here` : isSel ? "Now tap an eligible bench player…" : `Empty ${s.label} — tap to fill`}
          </button>
        ) : (
          <span className="text-[15px] font-semibold text-muted">Empty</span>
        )}
      </div>
    );
  };

  const sum = (list: RosterRow[], k: "points" | "liveProjected") => list.reduce((a, b) => a + b[k], 0);

  return (
    <div className="space-y-3">
      {/* Week 12 ▾ · view · Optimize */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {weekNav ? <WeekTitle {...weekNav} /> : <h2 className="text-[26px] font-bold tracking-[-0.02em] text-ink">Week {week}</h2>}
          <InfoButton title="Setting your lineup">
            {editable && <p>Tap a player&apos;s slot pill, then a highlighted destination to move or swap. Changes aren&apos;t saved until you press Save.</p>}
            <p>A lock means the player&apos;s game has started{data.lockOffsetMinutes > 0 ? ` (players lock ${data.lockOffsetMinutes} min before kickoff)` : ""}.</p>
            <p>OPRK is the opponent&apos;s rank against the position (1 = toughest defense). The opponent is green for an easy matchup and red for a hard one.</p>
            <p>Optimize picks the best lineup by projection (it keeps locked players and skips Out / IR / bye).</p>
          </InfoButton>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="relative lg:hidden">
            <span className="sr-only">Columns</span>
            <select
              className="h-10 appearance-none rounded-full border border-line bg-panel pl-4 pr-9 text-[15px] font-medium text-ink focus:border-brand-600 focus:outline-none"
              value={view}
              onChange={(e) => setView(e.target.value as View)}
            >
              <option value="overview">Overview</option>
              <option value="season">Season</option>
              {data.showSalary && <option value="contracts">Contracts</option>}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink" aria-hidden />
          </label>
          {editable && (
            <button
              type="button"
              onClick={optimize}
              disabled={saving || !optimal}
              title="Best lineup by projection (keeps locked players, skips Out/IR/bye)"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-brand-600/40 bg-panel px-4 text-[15px] font-semibold text-brand-600 transition-colors hover:bg-brand-600/[0.06] disabled:opacity-50 dark:border-brand-400/40 dark:text-brand-400"
            >
              <Sparkles size={16} aria-hidden /> Optimize
            </button>
          )}
          {editable && dirty > 0 && (
            <span className="hidden items-center gap-2 md:flex">
              <Button variant="secondary" size="sm" className="h-10" onClick={() => { setAssign(saved); setSel(null); }} disabled={saving}>
                <RotateCcw size={14} /> Reset
              </Button>
              <Button variant="primary" size="sm" className="h-10" onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save ({dirty})
              </Button>
            </span>
          )}
        </div>
      </div>

      {/* one quiet status line */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {editable ? (
          errors.length ? (
            <span className="inline-flex items-center gap-1 font-semibold text-loss">
              <AlertTriangle size={14} aria-hidden /> {errors.length} lineup issue{errors.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-win">
              <CheckCircle2 size={14} aria-hidden /> Lineup set
            </span>
          )
        ) : (
          data.readOnlyReason && (
            <span className="inline-flex items-center gap-1 font-medium text-muted">
              <Lock size={13} aria-hidden /> {data.readOnlyReason}
            </span>
          )
        )}
        {editable && lockedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-muted">
            <Lock size={12} aria-hidden /> {lockedCount} locked
          </span>
        )}
        {editable && optimal && optimalGain > 0.05 && (
          <span className="text-muted">
            Optimal <b className="numeral text-win">+{optimalGain.toFixed(1)}</b> proj
          </span>
        )}
      </div>

      {editable && issues.length > 0 && <IssueBanner issues={issues} onFix={fixIssue} saving={saving} />}

      {manage && healthyIr.length > 0 && data.irPolicy !== "NONE" && (
        <div className="flex items-start gap-2 rounded-card bg-amber-400/10 px-4 py-3 text-[13px] text-ink" role="status">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <b>{healthyIr.map((r) => r.name).join(", ")}</b> {healthyIr.length === 1 ? "is" : "are"} no longer IR-eligible.{" "}
            {data.irPolicy === "BLOCK_MOVES" ? "Activate or drop " + (healthyIr.length === 1 ? "him" : "them") + " from the ⋯ menu — other IR and taxi moves are blocked until then." : "Activate " + (healthyIr.length === 1 ? "him" : "them") + " from the ⋯ menu when you have room on the active roster."}
          </span>
        </div>
      )}

      {sel && (
        <div className="hidden items-center justify-between gap-2 rounded-lg bg-brand-600/[0.06] px-3 py-2 text-sm text-ink dark:bg-brand-400/15 lg:flex" role="status">
          <span className="flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-brand-600 dark:text-brand-400" />
            {selectedPlayer ? (
              <span>
                Moving <b>{byId.get(selectedPlayer)?.name}</b> — tap a highlighted slot{targets?.bench ? ", a bench player to swap, or move to bench" : ""}.
              </span>
            ) : (
              <span>
                Filling <b>{emptySlotSel?.label}</b> — tap a highlighted bench player.
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {selectedPlayer && targets?.bench && (
              <Button size="xs" variant="secondary" onClick={() => doMove(selectedPlayer, { kind: "bench" })}>
                To bench
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => setSel(null)} aria-label="Cancel move">
              <X size={13} /> Cancel
            </Button>
          </span>
        </div>
      )}

      {/* the roster: one white sheet (edge to edge on phones), grey section bars, hairline rows */}
      <div className="-mx-3 space-y-3 bg-panel px-4 py-3 sm:mx-0 sm:rounded-card sm:px-5 sm:shadow-card">
        <SectionBar
          title="Active players"
          right={
            <span className="flex items-center gap-3">
              {weekStarted && <BarTotal label="Pts" value={fmtPts(totalPts)} />}
              <BarTotal label="Proj" value={fmtPts(totalProj, 1)} />
            </span>
          }
        />
        <div role="list" aria-label="Starters">
          {slots.map((s) => {
            const id = slotId(s.key, s.index);
            const pid = assign[id];
            const r = pid ? byId.get(pid) : undefined;
            return r ? <Fragment key={id}>{renderRow(r, { group: "starter", slotKey: s.key, slotLabel: s.label, id })}</Fragment> : emptyRow(s);
          })}
        </div>

        <SectionBar
          title={
            <span className="flex items-center gap-2">
              Bench{" "}
              <span className="numeral font-normal text-muted">
                {bench.length}/{data.benchSize}
              </span>
            </span>
          }
          right={
            selectedPlayer && targets?.bench ? (
              <button type="button" onClick={() => doMove(selectedPlayer, { kind: "bench" })} className="inline-flex h-8 items-center rounded-full bg-brand-600 px-3 text-[13px] font-semibold text-white hover:bg-brand-700">
                Move {shortName(byId.get(selectedPlayer)?.name ?? "")} here
              </button>
            ) : weekStarted ? (
              <BarTotal label="Pts" value={fmtPts(sum(bench, "points"))} />
            ) : (
              <BarTotal label="Proj" value={fmtPts(sum(bench, "liveProjected"), 1)} />
            )
          }
        />
        <div role="list" aria-label="Bench">
          {bench.length ? bench.map((r) => <Fragment key={`b-${r.playerId}`}>{renderRow(r, { group: "bench" })}</Fragment>) : <p className="py-3 text-[13px] text-muted">No bench players.</p>}
        </div>

        {(data.limits.irSlots > 0 || ir.length > 0) && (
          <>
            <SectionBar
              title={
                <span className="flex items-center gap-1">
                  IR{" "}
                  <span className="numeral font-normal text-muted">
                    {ir.length}/{data.limits.irSlots}
                  </span>
                  {manage && (
                    <InfoButton title="Injured reserve">
                      <p>{data.irEligibleLabel ? `Players listed ${data.irEligibleLabel}` : "Any player"} can be moved here from the ⋯ menu to free a roster spot.</p>
                    </InfoButton>
                  )}
                </span>
              }
            />
            <div role="list" aria-label="Injured reserve">
              {ir.map((r) => (
                <Fragment key={`ir-${r.playerId}`}>{renderRow(r, { group: "ir" })}</Fragment>
              ))}
              {!ir.length && <p className="py-3 text-[13px] text-muted">No players on IR{manage ? " · move injured players here from the ⋯ menu" : ""}</p>}
            </div>
          </>
        )}

        {(data.limits.taxiSlots > 0 || taxi.length > 0) && (
          <>
            <SectionBar
              title={
                <span>
                  Taxi{" "}
                  <span className="numeral font-normal text-muted">
                    {taxi.length}/{data.limits.taxiSlots}
                  </span>
                </span>
              }
            />
            <div role="list" aria-label="Taxi squad">
              {taxi.map((r) => (
                <Fragment key={`tx-${r.playerId}`}>{renderRow(r, { group: "taxi" })}</Fragment>
              ))}
              {!taxi.length && <p className="py-3 text-[13px] text-muted">Taxi squad is empty</p>}
            </div>
          </>
        )}

        {deadCap.length > 0 && (
          <>
            <SectionBar title="Dead cap" right={<BarTotal label={String(data.season)} value={fmtMoney(deadCap.reduce((a, d) => a + d.current, 0))} />} />
            <div role="list" aria-label="Dead cap">
              {deadCap.map((d) => {
                const later = d.bySeason.filter((x) => x.amount && x.season > data.season);
                return (
                  <div key={`dc-${d.playerId}`} role="listitem" className="flex min-h-[60px] items-center gap-2.5 border-b border-line/70 py-2 last:border-b-0 sm:gap-3">
                    <SlotPill slot="DC" label="DC" className="border-dashed text-loss" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/players/${d.playerId}`} className="block truncate text-[15px] font-bold text-ink hover:underline">
                        {d.name}
                      </Link>
                      <div className="truncate text-[13px] text-muted">
                        {d.position} · {d.nflTeam ?? "FA"} · dead cap
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="numeral text-[17px] font-semibold text-loss">{fmtMoney(d.current)}</div>
                      {later.length > 0 && <div className="numeral text-[12px] text-muted">+{later.map((x) => `${fmtMoney(x.amount)} '${String(x.season).slice(2)}`).join(", ")}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* phones / tablets: the highlighted targets are often scrolled out of view, so list them in a floating sheet
          above the bottom tab bar */}
      {sel && (
        <div ref={floatRef} className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 px-3 md:bottom-4 lg:hidden" role="dialog" aria-label="Choose where to move">
          <div className="mx-auto max-w-md rounded-2xl bg-raised p-3 shadow-pop">
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <ArrowLeftRight size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />
                <span className="truncate">
                  {selectedPlayer ? (
                    <>
                      Move <b>{byId.get(selectedPlayer)?.name}</b> to…
                    </>
                  ) : (
                    <>
                      Fill <b>{emptySlotSel?.label}</b> with…
                    </>
                  )}
                </span>
              </span>
              <Button size="sm" variant="secondary" className="h-10 shrink-0 md:h-8" onClick={() => setSel(null)} aria-label="Cancel move">
                <X size={14} /> Cancel
              </Button>
            </div>
            <div className="scroll-thin flex max-h-[min(13rem,40vh)] flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
              {pickerOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={o.onPick}
                  className="inline-flex min-h-[40px] max-w-full items-center gap-1 rounded-full bg-brand-600/[0.08] px-3 text-left text-[13px] font-semibold text-brand-700 hover:bg-brand-600/[0.14] dark:bg-brand-400/15 dark:text-brand-300 md:min-h-[32px] md:text-xs"
                >
                  {o.label}
                </button>
              ))}
              {pickerOptions.length === 0 && <span className="text-xs text-muted">No valid destination — every eligible slot is locked.</span>}
            </div>
          </div>
        </div>
      )}

      {/* sticky save bar on phones (above the bottom tab bar) */}
      {editable && dirty > 0 && !sel && (
        <div ref={floatRef} className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 px-3 md:hidden" role="region" aria-label="Unsaved lineup changes">
          <div className="mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl bg-raised px-3 py-2 shadow-pop">
            <span className="min-w-0 text-sm font-semibold leading-tight">
              {dirty} unsaved change{dirty === 1 ? "" : "s"}
              {totalProj !== savedProj && (
                <span className={cn("block text-xs font-medium tabular-nums", totalProj > savedProj ? "text-win" : "text-loss")}>
                  {totalProj > savedProj ? "+" : ""}
                  {fmtPts(totalProj - savedProj, 1)} proj
                </span>
              )}
            </span>
            <span className="flex shrink-0 gap-2">
              <Button variant="secondary" className="h-10" onClick={() => { setAssign(saved); setSel(null); }} disabled={saving}>
                Reset
              </Button>
              <Button className="h-10" onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </Button>
            </span>
          </div>
        </div>
      )}
      {/* keep the end of the roster scrollable past the floating bar */}
      {floatH > 0 && <div aria-hidden className="md:hidden" style={{ height: floatH }} />}
    </div>
  );
}

function shortName(name: string) {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}

function GameStatus({ r, compact }: { r: RosterRow; compact?: boolean }) {
  if (r.game.state === "bye") return compact ? null : <span>{r.game.status}</span>;
  if (r.game.state === "in")
    return (
      <span className="font-semibold text-live">
        {r.game.status}
        {r.game.score ? ` · ${r.game.score}` : ""}
      </span>
    );
  if (r.game.state === "post") return <span>{r.game.score ?? "Final"}</span>;
  return <span>{compact ? compactKickoff(r.game.status) : r.game.status}</span>;
}

/** "Sun 1:00 PM" → "Sun 1pm", "Thu 8:20 PM" → "Thu 8:20pm" (phone rows) */
function compactKickoff(s: string) {
  return s.replace(/:00\s?([AP]M)/, "$1").replace(/\s?([AP]M)\b/, (_, m: string) => m.toLowerCase());
}

function SlotButton({
  slotKey,
  label,
  onClick,
  interactive,
  selected,
  target,
  locked,
  ariaLabel,
}: {
  slotKey: string;
  label?: string;
  onClick?: () => void;
  interactive: boolean;
  selected?: boolean;
  target?: boolean;
  locked?: boolean;
  ariaLabel?: string;
}) {
  const content = (
    <span className="relative inline-flex items-center">
      <SlotPill slot={slotKey} active={selected} className={cn(target && "ring-2 ring-brand-600 ring-offset-2 ring-offset-panel dark:ring-brand-400")} />
      {locked && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-panel p-0.5 text-muted shadow-[0_0_0_1px_rgb(var(--c-line))]" title="Locked — game started">
          <Lock size={10} />
        </span>
      )}
    </span>
  );
  if (!interactive || !onClick)
    return (
      <span title={label} aria-label={ariaLabel} className="inline-flex min-h-[44px] items-center">
        {content}
      </span>
    );
  // 44px-tall hit area around the 32px pill
  return (
    <button
      type="button"
      onClick={onClick}
      title={label ? `${label}${target ? " — move here" : ""}` : undefined}
      aria-label={ariaLabel ?? label}
      aria-pressed={selected}
      className={cn("inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/50", target && "motion-safe:animate-pulse")}
    >
      {content}
    </button>
  );
}

function IssueBanner({ issues, onFix, saving }: { issues: LineupIssue[]; onFix: (i: LineupIssue) => void; saving: boolean }) {
  const text = (i: LineupIssue) => {
    if (i.kind === "empty") return <>Your <b>{i.slotLabel}</b> slot is empty</>;
    if (i.kind === "bye") return <><b>{i.playerName}</b> ({i.slotLabel}) is on a bye</>;
    if (i.kind === "doubtful") return <><b>{i.playerName}</b> ({i.slotLabel}) is Doubtful</>;
    return <><b>{i.playerName}</b> ({i.slotLabel}) is {i.status === "IR" ? "on IR" : `listed ${i.status}`}</>;
  };
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <div className={cn("rounded-card px-4 py-3 text-[15px] text-ink sm:text-sm", errors ? "bg-red-500/[0.07] dark:bg-red-400/10" : "bg-amber-400/10 dark:bg-amber-400/10")} role="alert">
      <div className={cn("mb-1 flex items-center gap-1.5 font-semibold", errors ? "text-loss" : "text-amber-800 dark:text-amber-300")}>
        <AlertTriangle size={15} aria-hidden /> {errors ? "Fix your lineup before kickoff" : "Heads up"}
      </div>
      <ul className="divide-y divide-line/70">
        {issues.map((i) => (
          <li key={i.slot} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-1.5">
            <span className="min-w-0">{text(i)}</span>
            {i.fix ? (
              <Button size="xs" variant={i.severity === "error" ? "primary" : "secondary"} className="h-10 px-3 text-[13px] sm:h-7 sm:px-2.5 sm:text-xs" onClick={() => onFix(i)} disabled={saving}>
                Start {shortName(i.fix.name)} ({fmtPts(i.fix.projected, 1)})
              </Button>
            ) : (
              <Link href="/players?status=available" className="inline-flex min-h-10 items-center text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
                No bench option · find a free agent ›
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
