"use client";
// Client widgets for /commissioner/schedule: week pairing editor, score adjustments, regenerate, week pin.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, RotateCcw, Save, X } from "lucide-react";
import { Badge, buttonClass, chipClass } from "@/components/ui/core";
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
    <select aria-label={label} className="input min-w-0 py-1.5 sm:text-sm" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
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
      <ol className="space-y-2">
        {v.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className="rounded-lg bg-sunken p-2.5">
            <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="eyebrow shrink-0">Game {i + 1}</span>
                {r.label && <span className="truncate text-[12px] font-semibold uppercase tracking-[0.04em] text-ink">{r.label}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
                {r.status && r.status !== "UPCOMING" ? (
                  <>
                    <span className="numeral">
                      {(r.awayScore ?? 0).toFixed(2)}–{(r.homeScore ?? 0).toFixed(2)}
                    </span>
                    <Badge tone={r.status === "LIVE" ? "live" : "neutral"}>{r.status === "LIVE" ? "Live" : "Final"}</Badge>
                  </>
                ) : r.id ? (
                  "Upcoming"
                ) : (
                  <Badge tone="brand">New</Badge>
                )}
                {editable && (
                  <button
                    type="button"
                    className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-loss sm:h-7 sm:w-7"
                    onClick={() => setV(v.filter((_, j) => j !== i))}
                    aria-label={`Remove game ${i + 1}`}
                  >
                    <X size={15} />
                  </button>
                )}
              </span>
            </div>
            {/* phones: away over home; sm+: side by side */}
            <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-2">
              <span className="flex items-center gap-2">
                <span className="w-4 shrink-0 sm:hidden" aria-hidden />
                <span className="min-w-0 flex-1">
                  <TeamPick label={`Game ${i + 1} away team`} value={r.awayTeamId} teams={teams} disabled={!editable} onChange={(id) => set(i, { awayTeamId: id })} />
                </span>
              </span>
              <span className="hidden text-[13px] font-bold text-muted sm:block">@</span>
              <span className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-center text-[13px] font-bold text-muted sm:hidden" aria-hidden>
                  @
                </span>
                <span className="min-w-0 flex-1">
                  <TeamPick label={`Game ${i + 1} home team`} value={r.homeTeamId} teams={teams} disabled={!editable} onChange={(id) => set(i, { homeTeamId: id })} />
                </span>
              </span>
            </div>
          </li>
        ))}
        {!v.length && <li className="text-[15px] text-muted sm:text-sm">No regular season games this week.</li>}
      </ol>
      {idle.length > 0 && <p className="text-[13px] text-muted">Not scheduled: {idle.map((t) => t.abbrev).join(", ")}</p>}
      {errors.length > 0 && dirty && <p className="text-[13px] font-semibold text-loss">{errors[0]}</p>}
      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className={chipClass(false, "sm")}
            onClick={() => setV([...v, { homeTeamId: idle[0]?.id ?? null, awayTeamId: idle[1]?.id ?? null, label: null }])}
            disabled={v.length >= 16}
          >
            <Plus size={13} /> Add game
          </button>
          <div className="flex gap-2">
            {dirty && (
              <button type="button" className={buttonClass("secondary", "md")} onClick={() => setV(rows)}>
                <RotateCcw size={14} /> Reset
              </button>
            )}
            <button
              type="button"
              className={buttonClass("primary", "md")}
              disabled={!dirty || pending || errors.length > 0}
              onClick={() => run(() => saveWeekMatchups({ week, pairs: v.map((r) => ({ id: r.id, homeTeamId: r.homeTeamId, awayTeamId: r.awayTeamId, label: r.label })) }))}
            >
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save Week {week}
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
      className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_6rem_7rem_2fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addScoreAdjustment(f), () => setF({ ...f, points: 0, reason: "" }));
      }}
    >
      <label className="col-span-2 block sm:col-span-1">
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
      <label className="col-span-2 block sm:col-span-1">
        <span className="label">Reason</span>
        <input className="input py-1.5" value={f.reason} maxLength={200} placeholder="e.g. Stat correction after cutoff" onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </label>
      <button type="submit" className={buttonClass("primary", "md", "col-span-2 sm:col-span-1")} disabled={pending || !f.points || Number.isNaN(f.points) || f.reason.trim().length < 3}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add adjustment
      </button>
    </form>
  );
}

export function RegenerateForm({ firstWeek, lastWeek, defaultFrom, playedThrough }: { firstWeek: number; lastWeek: number; defaultFrom: number; playedThrough: number; /** shown in the page's ⓘ */ generatorLabel?: string }) {
  const { pending, run } = useRun();
  const [from, setFrom] = useState(defaultFrom);
  const overwrite = from <= playedThrough;
  return (
    <div className="space-y-2">
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
          className={buttonClass(overwrite ? "danger" : "secondary", "md")}
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
      {overwrite && <p className="text-[13px] font-semibold text-loss">This includes weeks that were already played.</p>}
    </div>
  );
}

export function WeekOverrideForm({ override, nflWeek, maxWeek, current }: { override: number | null; nflWeek: number; maxWeek: number; current: number }) {
  const { pending, run } = useRun();
  const [w, setW] = useState(override ?? current);
  return (
    <div className="space-y-2">
      <p className="text-[15px] sm:text-sm">
        The league is on <b>Week {current}</b> {override ? <Badge tone="brand">Pinned</Badge> : <span className="text-muted">(NFL week {nflWeek})</span>}
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
        <button type="button" className={buttonClass("secondary", "md")} disabled={pending || w === override} onClick={() => run(() => setWeekOverride({ week: w }))}>
          {pending && <Loader2 size={13} className="animate-spin" />} Pin
        </button>
        {override !== null && (
          <button type="button" className={buttonClass("ghost", "md")} disabled={pending} onClick={() => run(() => setWeekOverride({ week: null }))}>
            Follow NFL calendar
          </button>
        )}
      </div>
    </div>
  );
}
