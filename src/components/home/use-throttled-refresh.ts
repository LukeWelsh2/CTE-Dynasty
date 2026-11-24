"use client";
// router.refresh() at most once per `ms`, coalescing bursts of live events into one server re-render.
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function useThrottledRefresh(ms = 20_000) {
  const router = useRouter();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (immediate = false) => {
    if (timer.current) return;
    const wait = immediate ? 0 : Math.max(0, last.current + ms - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  };
}
