"use client";
// Re-renders the page (router.refresh) when scores or odds change. Score ticks are throttled.
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useLiveEvents } from "@/lib/realtime/client";

export function LiveRefresh({ leagueId, scoreTicks = false, throttleMs = 15_000 }: { leagueId: string; scoreTicks?: boolean; throttleMs?: number }) {
  const router = useRouter();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents([`league:${leagueId}`], (e) => {
    const refreshNow = e.type === "scores.refresh" || e.type === "playoffs.odds";
    const tick = scoreTicks && e.type === "score.update";
    if (!refreshNow && !tick) return;
    const wait = refreshNow ? 250 : Math.max(0, throttleMs - (Date.now() - last.current));
    if (timer.current) {
      if (!refreshNow) return;
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  });
  return null;
}
