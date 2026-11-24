"use client";
// Commissioner season controls: phase, keeper window, week override and the typed-confirmation rollover.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { lockKeepersNowAction, rolloverAction, setKeeperWindowAction, setPhaseAction, setWeekOverrideAction } from "@/lib/season/actions";
import { cn } from "@/lib/utils";

type Result = { ok: true; message?: string } | { ok: false; error: string };

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error);
        else {
          toast.success(r.message ?? "Saved.");
          after?.();
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

export function PhaseForm({ current, phases }: { current: string; phases: { key: string; label: string; description: string }[] }) {
  const [phase, setPhase] = useState(current);
  const { pending, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const label = phases.find((p) => p.key === phase)?.label ?? phase;
        if (!window.confirm(`Move the league to the ${label} phase?`)) return;
        run(() => setPhaseAction({ phase: phase as "PRESEASON" }));
      }}
    >
      <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <legend className="sr-only">League phase</legend>
        {phases.map((p) => (
          <label
            key={p.key}
            className={cn(
              "flex cursor-pointer gap-2 rounded-md border px-3 py-2 transition-colors",
              phase === p.key ? "border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30" : "border-line bg-panel hover:bg-sunken",
            )}
          >
            <input type="radio" name="phase" value={p.key} checked={phase === p.key} onChange={() => setPhase(p.key)} className="mt-1 accent-brand-600" />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                {p.label}
                {p.key === current && <span className="rounded bg-gold-300/40 px-1 text-[10px] font-bold uppercase text-gold-600 dark:text-gold-300">Current</span>}
              </span>
              <span className="mt-0.5 block text-xs text-muted">{p.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={pending || phase === current} className={buttonClass("primary", "sm")}>
          {pending && <Loader2 size={14} className="animate-spin" />}
          Set phase
        </button>
      </div>
    </form>
  );
}

export function KeeperWindowForm({ opens, deadline, tzLabel, canLock }: { opens: string; deadline: string; tzLabel: string; canLock: boolean }) {
  const [o, setO] = useState(opens);
  const [d, setD] = useState(deadline);
  const [notifyLeague, setNotify] = useState(true);
  const { pending, run } = useAction();
  const lock = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setKeeperWindowAction({ windowOpens: o, deadline: d, notifyLeague }));
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="label">Window opens ({tzLabel})</span>
          <input type="datetime-local" value={o} onChange={(e) => setO(e.target.value)} className="input" />
        </label>
        <label>
          <span className="label">Keeper deadline ({tzLabel})</span>
          <input type="datetime-local" value={d} onChange={(e) => setD(e.target.value)} className="input" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={notifyLeague} onChange={(e) => setNotify(e.target.checked)} className="accent-brand-600" />
        Notify every manager when the window is open
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            disabled={pending}
            onClick={() => run(() => setKeeperWindowAction({ windowOpens: "", deadline: d, openNow: true, notifyLeague }))}
            title="Open the window right now with the deadline above"
          >
            Open now
          </button>
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            disabled={pending}
            onClick={() => {
              setO("");
              setD("");
            }}
          >
            Clear dates
          </button>
          {canLock && (
            <button
              type="button"
              className={buttonClass("ghost", "sm", "text-loss")}
              disabled={lock.pending}
              onClick={() => {
                if (!window.confirm("Lock every keeper designation now (as if the deadline passed)?")) return;
                lock.run(() => lockKeepersNowAction());
              }}
            >
              {lock.pending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
              Lock keepers now
            </button>
          )}
        </div>
        <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
          {pending && <Loader2 size={14} className="animate-spin" />}
          Save keeper window
        </button>
      </div>
    </form>
  );
}

export function WeekOverrideForm({ current, nflWeek }: { current: number | null; nflWeek: number }) {
  const [week, setWeek] = useState(current === null ? "" : String(current));
  const { pending, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setWeekOverrideAction({ week: week === "" ? null : Number(week) }));
      }}
    >
      <label className="min-w-[200px] flex-1">
        <span className="label">Current fantasy week</span>
        <select value={week} onChange={(e) => setWeek(e.target.value)} className="input">
          <option value="">Follow the NFL (Week {nflWeek})</option>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Pin to Week {w}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending || week === (current === null ? "" : String(current))} className={buttonClass("primary", "md")}>
        {pending && <Loader2 size={14} className="animate-spin" />}
        Save
      </button>
    </form>
  );
}

export function RolloverForm({ toSeason, confirmText, needsForce, resumable }: { toSeason: number; confirmText: string; needsForce: boolean; resumable: boolean }) {
  const [text, setText] = useState("");
  const [force, setForce] = useState(false);
  const { pending, run } = useAction();
  const ok = text.trim().toUpperCase() === confirmText && (!needsForce || force || resumable);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        run(
          () => rolloverAction({ confirm: text, force }),
          () => setText(""),
        );
      }}
    >
      {needsForce && !resumable && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5 accent-amber-600" />
          <span>Force the rollover even though the league isn&apos;t in the Offseason or Keeper phase.</span>
        </label>
      )}
      <label className="block">
        <span className="label">
          Type <b className="font-mono text-ink">{confirmText}</b> to confirm
        </span>
        <input value={text} onChange={(e) => setText(e.target.value)} className="input font-mono uppercase" autoComplete="off" spellCheck={false} aria-label="Rollover confirmation" />
      </label>
      <div className="flex justify-end">
        <button type="submit" disabled={!ok || pending} className={buttonClass("danger", "md")}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
          {resumable ? "Finish rollover" : `Roll over to ${toSeason}`}
        </button>
      </div>
    </form>
  );
}
