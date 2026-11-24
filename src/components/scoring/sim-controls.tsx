"use client";
// Commissioner-only live-game simulation controls (demos / offseason testing).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useLiveEvents } from "@/lib/realtime/client";
import type { SimStatusEvent } from "@/lib/live/types";
import { timeLabel } from "@/lib/live/format";
import { resetSimulationAction, startSimulationAction } from "@/lib/live/actions";
import { Badge, buttonClass, Panel } from "@/components/ui/core";
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
    <Panel
      title="Live simulation"
      actions={<Badge tone="neutral">Commissioner</Badge>}
      info={
        <>
          <p>Simulates every NFL game of a week that hasn&apos;t kicked off, with realistic play-by-play stats for rostered players, through the real live-scoring pipeline: scores, win probability, big plays and touchdown alerts.</p>
          <p>Everyone in the league sees the simulated scores until it&apos;s reset; finished simulations clear automatically.</p>
        </>
      }
      infoTitle="Live simulation"
    >
      <div className="space-y-3 text-[14px]">
        {status.active ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">
                Week {status.week} · {status.status === "running" ? "simulating" : "final (simulated)"}
              </span>
              <span className="numeral text-[13px] text-muted">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Simulation progress">
              <div className={cn("h-full rounded-full transition-[width] duration-700", status.status === "running" ? "bg-live" : "bg-brand-600")} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[13px] text-muted">
              {status.status === "running" ? "Everyone sees simulated scores until it's reset." : `Clears automatically${status.clearsAt ? ` at ${timeLabel(status.clearsAt, tz)}` : ""}.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {status.week !== viewWeek && (
                <Link href={`/scoring?week=${status.week}`} className={buttonClass("secondary", "md")}>
                  View week {status.week}
                </Link>
              )}
              <button
                type="button"
                className={buttonClass("danger", "md")}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Stop the simulation and delete all simulated week ${status.week} stats, plays and alerts?`)) return;
                  run(() => resetSimulationAction());
                }}
              >
                {pending ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Stop &amp; reset
              </button>
            </div>
          </>
        ) : available ? (
          <>
            <p className="text-[13px] text-muted">Week {viewWeek} hasn&apos;t kicked off. Play it out with simulated stats.</p>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <label className="block min-w-0">
                <span className="label">Speed</span>
                <select className="input" value={speed} onChange={(e) => setSpeed(e.target.value)}>
                  {speeds.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pb-2">
                <Toggle checked={alerts} onChange={setAlerts} label="TD alerts" />
              </div>
            </div>
            <button type="button" className={buttonClass("primary", "md", "w-full")} disabled={pending} onClick={() => run(() => startSimulationAction({ week: viewWeek, speed, alerts }))}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Simulate week {viewWeek} live
            </button>
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted">{reason ?? `Week ${viewWeek} can't be simulated.`}</p>
            {suggestWeek && (
              <Link href={`/scoring?week=${suggestWeek}`} className={buttonClass("secondary", "md")}>
                <Play size={15} /> Simulate week {suggestWeek} instead
              </Link>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
