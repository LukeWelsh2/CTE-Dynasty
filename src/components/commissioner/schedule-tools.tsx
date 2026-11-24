"use client";
// Client widgets for /commissioner/schedule: week pairing editor, score adjustments, regenerate, week pin.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Save, X } from "lucide-react";
import { Badge, buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { addScoreAdjustment, regenerateSchedule, saveWeekMatchups, setWeekOverride } from "@/lib/commissioner/schedule-actions";
import { weekPairingErrors } from "@/lib/commissioner/schedule-gen";
import { NumberInput } from "./fields";

type Result = { ok: boolean; error?: string; message?: string };
interface TeamOpt {
  id: string;
  name: string;
  abbrev: string;
}

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error ?? "Something went wrong");
        else {
          toast.success(r.message ?? "Saved");
          after?.();
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

export interface WeekRow {
  id?: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  label: string | null;
  status?: string;
  homeScore?: number;
  awayScore?: number;
}

function TeamPick({ value, teams, onChange, label, disabled }: { value: string | null; teams: TeamOpt[]; onChange: (v: string | null) => void; label: string; disabled?: boolean }) {
  return (
    <select aria-label={label} className="input min-w-0 py-1.5 text-sm" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Bye —</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

export function WeekEditor({ week, rows, teams, editable }: { week: number; rows: WeekRow[]; teams: TeamOpt[]; editable: boolean }) {
  const { pending, run } = useRun();
  const [v, setV] = useState<WeekRow[]>(rows);
  const dirty = JSON.stringify(v.map((r) => [r.id, r.homeTeamId, r.awayTeamId, r.label])) !== JSON.stringify(rows.map((r) => [r.id, r.homeTeamId, r.awayTeamId, r.label]));
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const errors = weekPairingErrors(v, teams.map((t) => t.id), names);
  const used = new Set(v.flatMap((r) => [r.homeTeamId, r.awayTeamId]).filter(Boolean));
  const idle = teams.filter((t) => !used.has(t.id));
  const set = (i: number, patch: Partial<WeekRow>) => setV(v.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {v.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-md border border-line bg-sunken/30 p-2 sm:grid-cols-[1fr_auto_1fr_7rem_auto]">
            <TeamPick label={`Matchup ${i + 1} away team`} value={r.awayTeamId} teams={teams} disabled={!editable} onChange={(id) => set(i, { awayTeamId: id })} />
            <span className="text-xs font-bold text-muted">@</span>
            <TeamPick label={`Matchup ${i + 1} home team`} value={r.homeTeamId} teams={teams} disabled={!editable} onChange={(id) => set(i, { homeTeamId: id })} />
            <span className="hidden text-right text-xs tabular-nums text-muted sm:block">
              {r.status && r.status !== "UPCOMING" ? (
                <>
                  {(r.awayScore ?? 0).toFixed(2)}–{(r.homeScore ?? 0).toFixed(2)} <Badge tone={r.status === "LIVE" ? "live" : "neutral"}>{r.status}</Badge>
                </>
              ) : r.id ? (
                "Upcoming"
              ) : (
                <Badge tone="gold">New</Badge>
              )}
            </span>
            {editable ? (
              <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded border border-line text-muted hover:text-loss" onClick={() => setV(v.filter((_, j) => j !== i))} aria-label={`Remove matchup ${i + 1}`}>
                <X size={13} />
              </button>
            ) : (
              <span />
            )}
            {r.label && <span className="col-span-full text-[11px] font-semibold uppercase tracking-wide text-gold-600 dark:text-gold-400">{r.label}</span>}
          </div>
        ))}
        {!v.length && <p className="text-sm text-muted">No regular season matchups this week.</p>}
      </div>
      {idle.length > 0 && <p className="text-xs text-muted">Not scheduled: {idle.map((t) => t.abbrev).join(", ")}</p>}
      {errors.length > 0 && dirty && <p className="text-xs font-semibold text-loss">{errors[0]}</p>}
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="chip hover:bg-sunken"
            onClick={() => setV([...v, { homeTeamId: idle[0]?.id ?? null, awayTeamId: idle[1]?.id ?? null, label: null }])}
            disabled={v.length >= 16}
          >
            <Plus size={12} /> Add matchup
          </button>
          <div className="flex gap-2">
            {dirty && (
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setV(rows)}>
                <RotateCcw size={13} /> Reset
              </button>
            )}
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={!dirty || pending || errors.length > 0}
              onClick={() => run(() => saveWeekMatchups({ week, pairs: v.map((r) => ({ id: r.id, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, label: r.label })) }))}
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Week {week}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdjustmentForm({ teams, defaultWeek, maxWeek, minWeek }: { teams: TeamOpt[]; defaultWeek: number; maxWeek: number; minWeek: number }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ teamId: teams[0]?.id ?? "", week: defaultWeek, points: 0, reason: "" });
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1.4fr_6rem_7rem_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addScoreAdjustment(f), () => setF({ ...f, points: 0, reason: "" }));
      }}
    >
      <label className="block">
        <span className="label">Team</span>
        <select className="input py-1.5" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Week</span>
        <select className="input py-1.5" value={f.week} onChange={(e) => setF({ ...f, week: Number(e.target.value) })}>
          {Array.from({ length: maxWeek - minWeek + 1 }, (_, i) => minWeek + i).map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Points (±)</span>
        <NumberInput value={f.points} min={-500} max={500} step={0.01} onChange={(n) => setF({ ...f, points: n })} />
      </label>
      <label className="block">
        <span className="label">Reason</span>
        <input className="input py-1.5" value={f.reason} maxLength={200} placeholder="e.g. Stat correction after cutoff" onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </label>
      <button type="submit" className={buttonClass("primary", "sm", "sm:mb-0.5")} disabled={pending || !f.points || Number.isNaN(f.points) || f.reason.trim().length < 3}>
        {pending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
      </button>
    </form>
  );
}

export function RegenerateForm({ firstWeek, lastWeek, defaultFrom, playedThrough, generatorLabel }: { firstWeek: number; lastWeek: number; defaultFrom: number; playedThrough: number; generatorLabel: string }) {
  const { pending, run } = useRun();
  const [from, setFrom] = useState(defaultFrom);
  const overwrite = from <= playedThrough;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Builds a new {generatorLabel} schedule from the current settings (Matchups tab) and team list. Weeks before the start week are kept.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">Start at week</span>
          <select className="input w-32 py-1.5" value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {Array.from({ length: lastWeek - firstWeek + 1 }, (_, i) => firstWeek + i).map((w) => (
              <option key={w} value={w}>
                Week {w}
                {w <= playedThrough ? " (played)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={buttonClass(overwrite ? "danger" : "secondary", "sm", "mb-0.5")}
          disabled={pending}
          onClick={() =>
            window.confirm(
              overwrite
                ? `Weeks ${from}-${playedThrough} have been played. Regenerating replaces those results and changes the standings. Continue?`
                : `Replace the schedule for Weeks ${from}-${lastWeek}?`,
            ) && run(() => regenerateSchedule({ fromWeek: from, overwriteResults: overwrite }))
          }
        >
          {pending && <Loader2 size={13} className="animate-spin" />} Regenerate Weeks {from}-{lastWeek}
        </button>
      </div>
      {overwrite && <p className="text-xs font-semibold text-loss">This includes weeks that were already played.</p>}
    </div>
  );
}

export function WeekOverrideForm({ override, nflWeek, maxWeek, current }: { override: number | null; nflWeek: number; maxWeek: number; current: number }) {
  const { pending, run } = useRun();
  const [w, setW] = useState(override ?? current);
  return (
    <div className="space-y-2">
      <p className="text-sm">
        The league is on <b>Week {current}</b> {override ? <Badge tone="gold">Pinned</Badge> : <span className="text-muted">(NFL week {nflWeek})</span>}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">Pin to week</span>
          <select className="input w-28 py-1.5" value={w} onChange={(e) => setW(Number(e.target.value))}>
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((x) => (
              <option key={x} value={x}>
                Week {x}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass("secondary", "sm", "mb-0.5")} disabled={pending || w === override} onClick={() => run(() => setWeekOverride({ week: w }))}>
          {pending && <Loader2 size={13} className="animate-spin" />} Pin
        </button>
        {override !== null && (
          <button type="button" className={buttonClass("ghost", "sm", "mb-0.5")} disabled={pending} onClick={() => run(() => setWeekOverride({ week: null }))}>
            Follow NFL calendar
          </button>
        )}
      </div>
      <p className={cn("text-xs text-muted")}>Pinning changes the week shown everywhere (lineups, scoreboard, waivers) until you switch back.</p>
    </div>
  );
}
