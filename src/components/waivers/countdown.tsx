"use client";
// Live countdown to a date ("2d 4h 12m"). Renders the static label on the server, ticks on the client.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvents } from "@/lib/realtime/client";
import { cn } from "@/lib/utils";

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (totalMin > 0) return `${m}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

export function Countdown({ to, className, doneText = "now", initialNow }: { to: string; className?: string; doneText?: string; initialNow: number }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    setNow(Date.now());
    const ms = new Date(to).getTime() - Date.now();
    const id = setInterval(() => setNow(Date.now()), ms < 3600_000 ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [to]);
  const left = new Date(to).getTime() - now;
  return (
    <span className={cn("tabular-nums", className)} suppressHydrationWarning>
      {left > 0 ? formatCountdown(left) : doneText}
    </span>
  );
}

/** Refreshes the page when the league publishes one of the given live event types. */
export function LiveRefresh({ leagueId, types }: { leagueId: string; types: string[] }) {
  const router = useRouter();
  useLiveEvents([`league:${leagueId}`], (e) => {
    if (types.includes(e.type)) router.refresh();
  });
  return null;
}
