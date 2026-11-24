"use client";
// Roster table + easy lineup setup: two-tap moves with highlighted valid destinations, per-row slot <select> on
// desktop, optimize / reset / save, lineup warnings with one-click fixes, lock countdowns and live refresh.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Info, Loader2, Lock, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { Button, PlayerHeadshot, PlayerLink, PosBadge } from "@/components/ui/core";
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
import { ContractBadges, DifficultyChip } from "./bits";
import { RosterActionsMenu } from "./roster-actions";

export interface DeadCapRow {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  current: number;
  bySeason: { season: number; amount: number }[];
}

type Selection = { kind: "player"; id: string } | { kind: "slot"; id: string } | null;

export function LineupEditor({ data, deadCap = [] }: { data: LineupEditorData; deadCap?: DeadCapRow[] }) {
  const { slots, saved, optimal, rows, editable, manage, teamId, week } = data;
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

  const anyTarget = !!sel;
  const lockedCount = rows.filter((r) => r.locked && starters.has(r.playerId)).length;
  const showActions = manage;
  const colCount = 9 + (showActions ? 1 : 0);

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
      opts.push({ value: id, label: `→ ${s.label}${occ ? ` (swap ${shortName(byId.get(occ)?.name ?? "")})` : " (empty)"}` });
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
      pickerOptions.push({ key: id, label: `${s.label}${o ? ` ⇄ ${shortName(o.name)} (${fmtPts(o.liveProjected, 1)})` : " (empty)"}`, onPick: () => doMove(selectedPlayer, { kind: "slot", slot: id }) });
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
    const projText = r.projected || r.liveProjected ? fmtPts(r.game.state === "in" ? r.liveProjected : r.projected, 1) : "—";
    return (
      <tr
        key={`${ctxRow.id ?? ctxRow.group}-${r.playerId}`}
        className={cn(
          "transition-colors",
          isSel && "[&>td]:bg-gold-300/25 dark:[&>td]:bg-gold-500/15",
          isTarget && "[&>td]:bg-brand-50 dark:[&>td]:bg-brand-900/30",
          dim && "opacity-55",
          r.rosterStatus === "GONE" && "opacity-70",
        )}
      >
        <td className="w-12 pr-0">
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
        </td>
        <td className="w-full max-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <PlayerHeadshot player={{ id: r.playerId, fullName: r.name, position: r.position }} size={28} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1">
                <PlayerLink player={{ id: r.playerId, fullName: r.name, position: r.position, team: r.nflTeam, injuryStatus: r.injuryStatus }} showMeta={false} className="min-w-0" />
                {r.hasNews && <Link href={`/players/${r.playerId}`} title="Recent news" aria-label={`Recent news on ${r.name}`} className="inline-block h-2 w-2 shrink-0 rounded-full bg-gold-500 ring-2 ring-gold-300/40" />}
                {isTarget && <span className="ml-1 hidden shrink-0 rounded bg-brand-600 px-1 text-[9px] font-bold uppercase leading-4 text-white sm:inline">{benchLike ? "Swap" : "Move here"}</span>}
                {r.irIneligible && <span className="ml-1 shrink-0 rounded bg-amber-100 px-1 text-[9px] font-bold uppercase leading-4 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Healthy</span>}
              </div>
              <div className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-muted">
                <span className="shrink-0 font-semibold">{r.position}</span>
                <span className="shrink-0">· {r.nflTeam ?? "FA"}</span>
                {r.game.state !== "bye" && (
                  <span className="truncate sm:hidden">
                    · {r.game.opp} <GameStatus r={r} compact />
                  </span>
                )}
                {r.rosterStatus === "GONE" && <span className="shrink-0 italic">· no longer rostered</span>}
                {r.onBye && <span className="shrink-0 font-bold text-loss">· BYE</span>}
                {lockIn && soon && <span className="hidden shrink-0 sm:inline">· locks in {lockIn}</span>}
              </div>
            </div>
          </div>
        </td>
        <td className="hidden whitespace-nowrap sm:table-cell">
          <div className={cn("text-xs font-semibold", r.game.state === "bye" && "text-loss")}>{r.game.opp}</div>
          <div className="text-[11px] text-muted">
            <GameStatus r={r} />
          </div>
        </td>
        <td className="hidden lg:table-cell">{r.oprk ? <DifficultyChip rank={r.oprk.rank} of={r.oprk.of} tone={r.oprk.tone} perGame={r.oprk.perGame} /> : <span className="text-muted">—</span>}</td>
        <td className="num whitespace-nowrap">
          <span className={cn("font-bold tabular-nums", r.game.state === "in" && "text-live", r.game.state === "pre" && "text-muted font-medium")}>{r.game.state === "pre" || r.game.state === "bye" ? "—" : fmtPts(r.points)}</span>
          <span className="block text-[10px] tabular-nums text-muted sm:hidden">p {projText}</span>
        </td>
        <td className="num hidden whitespace-nowrap text-muted sm:table-cell">
          <span className="tabular-nums">{projText}</span>
        </td>
        <td className="num hidden whitespace-nowrap md:table-cell">
          <span className="tabular-nums">{fmtPts(r.seasonTotal, 1)}</span>
          <span className="block text-[11px] tabular-nums text-muted">{fmtPts(r.seasonAvg, 1)}/g</span>
        </td>
        <td className="num hidden lg:table-cell">
          <span className={cn("tabular-nums", r.onBye && "font-bold text-loss")}>{r.byeWeek ?? "—"}</span>
        </td>
        <td className="num hidden whitespace-nowrap md:table-cell">
          {data.showSalary && r.salary !== null ? (
            <>
              <span className="font-semibold tabular-nums">{fmtMoney(r.salary)}</span>
              {data.showContracts && (
                <span className="block text-[11px] text-muted">
                  <ContractBadges isRookie={r.isRookie} isTagged={r.isTagged} years={r.contractYears} className="mr-1 align-middle" />
                  {r.contractYears}y · {r.contractEnd}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        {showActions && (
          <td className="w-px whitespace-nowrap pl-0 text-right">
            <div className="flex items-center justify-end gap-1">
              {so && (
                <select
                  aria-label={`Move ${r.name} to`}
                  className="hidden h-7 w-[150px] rounded border border-line bg-panel px-1 text-xs text-ink focus:border-brand-500 focus:outline-none lg:block"
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
              {movable && (
                <button
                  type="button"
                  onClick={tap}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold lg:hidden",
                    isSel ? "border-gold-500 bg-gold-500 text-brand-950" : "border-line bg-panel text-ink hover:bg-sunken",
                  )}
                  aria-label={isSel ? "Cancel move" : `Move ${r.name}`}
                >
                  {isSel ? <X size={12} /> : <ArrowLeftRight size={12} />}
                  <span className="hidden sm:inline">{isSel ? "Cancel" : "Move"}</span>
                </button>
              )}
              <RosterActionsMenu teamId={teamId} row={r} salaryCapOn={data.showSalary} />
            </div>
          </td>
        )}
      </tr>
    );
  };

  const emptyRow = (s: (typeof slots)[number]) => {
    const id = slotId(s.key, s.index);
    const isTarget = !!targets?.slots.has(id);
    const isSel = sel?.kind === "slot" && sel.id === id;
    const dim = anyTarget && !isTarget && !isSel;
    return (
      <tr key={`empty-${id}`} className={cn(isTarget && "[&>td]:bg-brand-50 dark:[&>td]:bg-brand-900/30", isSel && "[&>td]:bg-gold-300/25 dark:[&>td]:bg-gold-500/15", dim && "opacity-55")}>
        <td className="w-12 pr-0">
          <SlotButton slotKey={s.key} label={s.label} onClick={() => onSlotTap(id)} interactive={editable} selected={isSel} target={isTarget} ariaLabel={`${s.label} slot (empty)`} />
        </td>
        <td colSpan={colCount - 1}>
          {editable ? (
            <button type="button" onClick={() => onSlotTap(id)} className="text-left text-sm italic text-loss hover:underline">
              {isTarget ? `Move ${byId.get(selectedPlayer!)?.name ?? "player"} here` : isSel ? "Now tap an eligible bench player…" : `Empty ${s.label} slot — tap to fill`}
            </button>
          ) : (
            <span className="text-sm italic text-muted">Empty</span>
          )}
        </td>
      </tr>
    );
  };

  const groupRow = (label: React.ReactNode, right?: React.ReactNode, key?: string) => (
    <tr className="group-row" key={key}>
      <td colSpan={colCount}>
        <div className="flex items-center justify-between gap-2">
          <span>{label}</span>
          {right && <span className="normal-case tracking-normal">{right}</span>}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {editable ? (
            errors.length ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-200">
                <AlertTriangle size={14} /> {errors.length} lineup issue{errors.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs font-bold text-green-700 dark:bg-green-900/30 dark:text-green-200">
                <CheckCircle2 size={14} /> Lineup set
              </span>
            )
          ) : (
            data.readOnlyReason && (
              <span className="inline-flex items-center gap-1 rounded-md bg-sunken px-2 py-1 text-xs font-semibold text-muted">
                <Lock size={13} /> {data.readOnlyReason}
              </span>
            )
          )}
          {editable && lockedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Lock size={12} /> {lockedCount} starter{lockedCount === 1 ? "" : "s"} locked
            </span>
          )}
          {editable && optimal && optimalGain > 0.05 && (
            <span className="text-xs text-muted">
              Optimal lineup: <b className="text-win">+{optimalGain.toFixed(1)}</b> proj
            </span>
          )}
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button variant="gold" size="sm" onClick={optimize} disabled={saving || !optimal} title="Best lineup by projection (keeps locked players, skips Out/IR/bye)">
              <Sparkles size={14} /> Optimize
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setAssign(saved); setSel(null); }} disabled={saving || !dirty}>
              <RotateCcw size={14} /> Reset
            </Button>
            <Button variant="primary" size="sm" onClick={() => save()} disabled={saving || !dirty}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save{dirty ? ` (${dirty})` : ""}
            </Button>
          </div>
        )}
      </div>

      {editable && issues.length > 0 && <IssueBanner issues={issues} onFix={fixIssue} saving={saving} />}

      {manage && healthyIr.length > 0 && data.irPolicy !== "NONE" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-100" role="status">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <b>{healthyIr.map((r) => r.name).join(", ")}</b> {healthyIr.length === 1 ? "is" : "are"} no longer IR-eligible.{" "}
            {data.irPolicy === "BLOCK_MOVES" ? "Activate or drop " + (healthyIr.length === 1 ? "him" : "them") + " from the ⋯ menu — other IR and taxi moves are blocked until then." : "Activate " + (healthyIr.length === 1 ? "him" : "them") + " from the ⋯ menu when you have room on the active roster."}
          </span>
        </div>
      )}

      {sel && (
        <div className="hidden items-center justify-between gap-2 rounded-md border border-gold-400/60 bg-gold-300/20 px-3 py-2 text-sm text-ink lg:flex" role="status">
          <span className="flex items-center gap-2">
            <ArrowLeftRight size={15} className="text-gold-600" />
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

      <div className="rounded-lg border border-line bg-panel shadow-panel">
        <table className="tbl">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-12 rounded-tl-lg">Slot</th>
              <th>Player</th>
              <th className="hidden sm:table-cell">Opp</th>
              <th className="hidden lg:table-cell" title="Opponent rank vs position (1 = toughest)">
                OPRK
              </th>
              <th className="num">Pts</th>
              <th className="num hidden sm:table-cell">Proj</th>
              <th className="num hidden md:table-cell">Season</th>
              <th className="num hidden lg:table-cell">Bye</th>
              <th className="num hidden md:table-cell">{data.showSalary ? "Salary" : ""}</th>
              {showActions && <th className="rounded-tr-lg text-right">{editable ? <span className="hidden lg:inline">Move to</span> : ""}</th>}
            </tr>
          </thead>
          <tbody>
            {groupRow(
              `Starters`,
              <span className="tabular-nums">
                {fmtPts(totalPts)} pts · <span className="opacity-80">proj {fmtPts(totalProj, 1)}</span>
              </span>,
              "g-starters",
            )}
            {slots.map((s) => {
              const id = slotId(s.key, s.index);
              const pid = assign[id];
              const r = pid ? byId.get(pid) : undefined;
              return r ? <Fragment key={id}>{renderRow(r, { group: "starter", slotKey: s.key, slotLabel: s.label, id })}</Fragment> : emptyRow(s);
            })}
            {groupRow(
              <span className="flex items-center gap-2">
                Bench{" "}
                <span className="opacity-75">
                  {bench.length}/{data.benchSize}
                </span>
                {selectedPlayer && targets?.bench && (
                  <button type="button" onClick={() => doMove(selectedPlayer, { kind: "bench" })} className="rounded bg-gold-500 px-2 py-0.5 text-[10px] font-bold text-brand-950 hover:bg-gold-400">
                    Move {shortName(byId.get(selectedPlayer)?.name ?? "")} to bench
                  </button>
                )}
              </span>,
              <span className="tabular-nums opacity-80">{fmtPts(bench.reduce((a, b) => a + b.points, 0))} pts</span>,
              "g-bench",
            )}
            {bench.length ? bench.map((r) => <Fragment key={`b-${r.playerId}`}>{renderRow(r, { group: "bench" })}</Fragment>) : (
              <tr>
                <td colSpan={colCount} className="text-sm italic text-muted">
                  No bench players.
                </td>
              </tr>
            )}
            {(data.limits.irSlots > 0 || ir.length > 0) && groupRow(<span>Injured reserve <span className="opacity-75">{ir.length}/{data.limits.irSlots}</span></span>, undefined, "g-ir")}
            {ir.map((r) => (
              <Fragment key={`ir-${r.playerId}`}>{renderRow(r, { group: "ir" })}</Fragment>
            ))}
            {(data.limits.irSlots > 0 || ir.length > 0) && !ir.length && (
              <tr>
                <td colSpan={colCount} className="text-xs text-muted">
                  No players on IR.{manage ? ` ${data.irEligibleLabel ? `Players listed ${data.irEligibleLabel}` : "Any player"} can be moved here from the ⋯ menu to free a roster spot.` : ""}
                </td>
              </tr>
            )}
            {(data.limits.taxiSlots > 0 || taxi.length > 0) && groupRow(<span>Taxi squad <span className="opacity-75">{taxi.length}/{data.limits.taxiSlots}</span></span>, undefined, "g-taxi")}
            {taxi.map((r) => (
              <Fragment key={`tx-${r.playerId}`}>{renderRow(r, { group: "taxi" })}</Fragment>
            ))}
            {(data.limits.taxiSlots > 0 || taxi.length > 0) && !taxi.length && (
              <tr>
                <td colSpan={colCount} className="text-xs text-muted">
                  Taxi squad is empty.
                </td>
              </tr>
            )}
            {deadCap.length > 0 && groupRow(<span>Dead cap</span>, <span className="tabular-nums">{fmtMoney(deadCap.reduce((a, d) => a + d.current, 0))} this season</span>, "g-dead")}
            {deadCap.map((d) => (
              <tr key={`dc-${d.playerId}`} className="text-muted">
                <td className="w-12 pr-0">
                  <span className="inline-flex h-5 min-w-[30px] items-center justify-center rounded border border-dashed border-loss/60 px-1 text-[10px] font-bold text-loss">DC</span>
                </td>
                <td colSpan={colCount - 3}>
                  <Link href={`/players/${d.playerId}`} className="font-medium hover:underline">
                    {d.name}
                  </Link>{" "}
                  <span className="text-[11px]">
                    {d.position} · {d.nflTeam ?? "FA"} · dead cap
                  </span>
                </td>
                <td colSpan={2} className="num whitespace-nowrap">
                  <span className="font-semibold tabular-nums text-loss">{fmtMoney(d.current)}</span>
                  {d.bySeason.filter((x) => x.amount && x.season !== data.season).length > 0 && (
                    <span className="block text-[11px]">+{d.bySeason.filter((x) => x.season > data.season).map((x) => `${fmtMoney(x.amount)} '${String(x.season).slice(2)}`).join(", ")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          {editable && <>Tap a player&apos;s slot (or Move) and then a highlighted destination to swap. Changes aren&apos;t saved until you press Save. </>}
          A lock icon means the player&apos;s game has started{data.lockOffsetMinutes > 0 ? ` (players lock ${data.lockOffsetMinutes} min before kickoff)` : ""}. OPRK = opponent rank vs the position (1 = toughest defense, green = easy matchup).
        </span>
      </p>

      {/* phones / tablets: the highlighted targets are often scrolled out of view, so list them in a floating sheet */}
      {sel && (
        <div className="fixed inset-x-0 bottom-[60px] z-40 px-3 md:bottom-4 lg:hidden" role="dialog" aria-label="Choose where to move">
          <div className="mx-auto max-w-md rounded-xl border border-gold-400/70 bg-panel p-2.5 shadow-pop">
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <ArrowLeftRight size={15} className="shrink-0 text-gold-600" />
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
              <Button size="xs" variant="ghost" onClick={() => setSel(null)} aria-label="Cancel move">
                <X size={13} /> Cancel
              </Button>
            </div>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {pickerOptions.map((o) => (
                <button key={o.key} type="button" onClick={o.onPick} className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 text-xs font-semibold text-brand-900 hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-100">
                  {o.label}
                </button>
              ))}
              {pickerOptions.length === 0 && <span className="text-xs text-muted">No valid destination — every eligible slot is locked.</span>}
            </div>
          </div>
        </div>
      )}

      {/* sticky save bar on phones */}
      {editable && dirty > 0 && !sel && (
        <div className="fixed inset-x-0 bottom-[60px] z-40 px-3 md:hidden">
          <div className="mx-auto flex max-w-md items-center justify-between gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-pop">
            <span className="text-sm font-semibold">
              {dirty} unsaved change{dirty === 1 ? "" : "s"}
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setAssign(saved); setSel(null); }} disabled={saving}>
                Reset
              </Button>
              <Button size="sm" onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </Button>
            </span>
          </div>
        </div>
      )}
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
  return <span>{r.game.status}</span>;
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
      <PosBadge pos={slotKey} className={cn(target && "ring-2 ring-brand-500 ring-offset-1 ring-offset-panel", selected && "ring-2 ring-gold-500 ring-offset-1 ring-offset-panel")} />
      {locked && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-panel p-px text-muted" title="Locked — game started">
          <Lock size={10} />
        </span>
      )}
    </span>
  );
  if (!interactive || !onClick)
    return (
      <span title={label} aria-label={ariaLabel}>
        {content}
      </span>
    );
  return (
    <button type="button" onClick={onClick} title={label ? `${label}${target ? " — move here" : ""}` : undefined} aria-label={ariaLabel ?? label} aria-pressed={selected} className={cn("rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50", target && "animate-pulse")}>
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
    <div className={cn("rounded-md border px-3 py-2 text-sm", errors ? "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/25 dark:text-red-100" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-100")} role="alert">
      <div className="mb-1 flex items-center gap-1.5 font-bold">
        <AlertTriangle size={15} /> {errors ? "Fix your lineup before kickoff" : "Heads up"}
      </div>
      <ul className="space-y-1">
        {issues.map((i) => (
          <li key={i.slot} className="flex flex-wrap items-center justify-between gap-2">
            <span>{text(i)}.</span>
            {i.fix ? (
              <Button size="xs" variant={i.severity === "error" ? "danger" : "secondary"} onClick={() => onFix(i)} disabled={saving}>
                Start {shortName(i.fix.name)} ({fmtPts(i.fix.projected, 1)})
              </Button>
            ) : (
              <Link href="/players?status=available" className="text-xs font-semibold underline">
                No healthy bench option — find a free agent
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
