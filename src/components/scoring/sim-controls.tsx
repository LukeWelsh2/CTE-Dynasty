"use client";
// Commissioner-only live-game simulation controls (demos / offseason testing).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FlaskConical, Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useLiveEvents } from "@/lib/realtime/client";
import type { SimStatusEvent } from "@/lib/live/types";
import { timeLabel } from "@/lib/live/format";
import { resetSimulationAction, startSimulationAction } from "@/lib/live/actions";
import { buttonClass } from "@/components/ui/core";
import { Toggle } from "@/components/ui/client";
import { cn } from "@/lib/utils";

export interface SimControlProps {
  leagueId: string;
  /** league timezone (settings.general.timezone) */
  tz: string;
  viewWeek: number;
  /** simulation currently stored (any week) */
  status: SimStatusEvent;
  /** can the viewed week be simulated right now? */
  available: boolean;
  reason: string | null;
  /** next week that could be simulated, when the viewed one can't */
  suggestWeek: number | null;
  speeds: { key: string; label: string }[];
}

export function SimControls({ leagueId, tz, viewWeek, status: initial, available, reason, suggestWeek, speeds }: SimControlProps) {
  const [status, setStatus] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setStatus(initial);
  }
  const [speed, setSpeed] = useState(speeds[1]?.key ?? speeds[0]?.key ?? "normal");
  const [alerts, setAlerts] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type === "sim.status") setStatus(e.data as SimStatusEvent);
  });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message ?? "Done");
      else toast.error(res.error ?? "Something went wrong");
      router.refresh();
    });

  const pct = status.totalSteps ? Math.round((status.step / status.totalSteps) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-lg border border-dashed border-brand-300 bg-brand-50/40 dark:border-brand-800 dark:bg-brand-900/10" aria-labelledby="sim-title">
      <header className="flex items-center gap-2 border-b border-brand-200/70 px-3 py-2 dark:border-brand-800">
        <FlaskConical size={15} className="text-brand-700 dark:text-brand-300" aria-hidden />
        <h2 id="sim-title" className="font-display text-[14px] font-bold uppercase tracking-wide text-ink">
          Live simulation
        </h2>
        <span className="ml-auto rounded bg-sunken px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-muted">Commissioner</span>
      </header>
      <div className="space-y-3 p-3 text-sm">
        {status.active ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">
                Week {status.week} · {status.status === "running" ? "simulating" : "final (simulated)"}
              </span>
              <span className="tabular-nums text-xs text-muted">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Simulation progress">
              <div className={cn("h-full rounded-full transition-[width] duration-700", status.status === "running" ? "bg-live" : "bg-brand-600")} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted">
              {status.status === "running"
                ? "Simulated stats, game clocks and touchdown alerts are flowing through the real live-scoring pipeline."
                : `Simulated results clear automatically${status.clearsAt ? ` at ${timeLabel(status.clearsAt, tz)}` : ""}.`}{" "}
              Everyone in the league sees simulated scores until it&apos;s reset.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {status.week !== viewWeek && (
                <Link href={`/scoring?week=${status.week}`} className={buttonClass("secondary", "sm")}>
                  View week {status.week}
                </Link>
              )}
              <button
                type="button"
                className={buttonClass("danger", "sm")}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Stop the simulation and delete all simulated week ${status.week} stats, plays and alerts?`)) return;
                  run(() => resetSimulationAction());
                }}
              >
                {pending ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Stop &amp; reset
              </button>
            </div>
          </>
        ) : available ? (
          <>
            <p className="text-xs text-muted">
              Week {viewWeek} hasn&apos;t kicked off. Simulate every game with realistic play-by-play stats for rostered players to demo live scoring, win probability and touchdown alerts.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block">
                <span className="label">Speed</span>
                <select className="input py-1.5" value={speed} onChange={(e) => setSpeed(e.target.value)}>
                  {speeds.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pb-1.5">
                <Toggle checked={alerts} onChange={setAlerts} label="Send TD alerts" />
              </div>
            </div>
            <button type="button" className={buttonClass("primary", "sm", "w-full")} disabled={pending} onClick={() => run(() => startSimulationAction({ week: viewWeek, speed, alerts }))}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Simulate week {viewWeek} live
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">{reason ?? `Week ${viewWeek} can't be simulated.`}</p>
            {suggestWeek && (
              <Link href={`/scoring?week=${suggestWeek}`} className={buttonClass("secondary", "sm")}>
                <Play size={14} /> Simulate week {suggestWeek} instead
              </Link>
            )}
          </>
        )}
      </div>
    </section>
  );
}
