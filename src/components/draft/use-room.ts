"use client";
// Live draft room state: initial server render + refetch on draft:<id> events, deadline expiry and a slow poll.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLiveEvents } from "@/lib/realtime/client";
import type { RoomState } from "@/lib/draft/types";

export function useRoomState<T extends RoomState>(initial: T, opts: { onEvent?: (type: string, data: Record<string, unknown>, mine: boolean) => void } = {}) {
  const [state, setState] = useState<T>(initial);
  // events caused by this browser's own action (already toasted by the action) are flagged as "mine"
  const actedAt = useRef(0);
  const markActed = useCallback(() => {
    actedAt.current = Date.now();
  }, []);
  const [connected, setConnected] = useState(true);
  const inflight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // server clock offset so every browser counts down to the same instant
  const offset = useMemo(() => new Date(state.serverNow).getTime() - Date.now(), [state.serverNow]);

  useEffect(() => setState(initial), [initial]);

  const refetch = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    try {
      const res = await fetch(`/api/draft/${initial.draft.id}/state`, { cache: "no-store" });
      if (res.ok) {
        setState((await res.json()) as T);
        setConnected(true);
      } else setConnected(false);
    } catch {
      setConnected(false);
    } finally {
      inflight.current = false;
      if (again.current) {
        again.current = false;
        void refetch();
      }
    }
  }, [initial.draft.id]);

  const schedule = useCallback(
    (ms = 120) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refetch(), ms);
    },
    [refetch],
  );

  const onEvent = opts.onEvent;
  useLiveEvents([`draft:${initial.draft.id}`], (e) => {
    onEvent?.(e.type, (e.data ?? {}) as Record<string, unknown>, Date.now() - actedAt.current < 4000);
    schedule();
  });

  // refetch right after the visible deadline passes (the state endpoint advances the clock)
  const deadlines = [state.draft.pickDeadline, state.kind === "AUCTION" ? state.openLot?.endsAt : null, state.draft.status === "SCHEDULED" ? state.draft.startTime : null].filter(Boolean) as string[];
  const nextDeadline = deadlines.map((d) => new Date(d).getTime() - offset).sort((a, b) => a - b)[0];
  useEffect(() => {
    if (!nextDeadline) return;
    const ms = nextDeadline - Date.now() + 700;
    if (ms > 2_147_000_000) return;
    const t = setTimeout(() => void refetch(), Math.max(300, ms));
    return () => clearTimeout(t);
  }, [nextDeadline, refetch]);

  // slow safety poll (also covers a dropped event stream); faster while an auction lot is open
  const fast = state.kind === "AUCTION" && !!state.openLot;
  const live = state.draft.status === "LIVE";
  useEffect(() => {
    const t = setInterval(() => void refetch(), fast ? 5_000 : live ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [fast, live, refetch]);

  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && void refetch();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  return { state, setState, refetch, offset, connected, markActed };
}

/**
 * Ticking "now" (corrected for server offset). The first render uses the server's timestamp so the
 * server-rendered countdown and the hydrating client agree; it starts ticking right after mount.
 */
export function useNow(offset: number, intervalMs = 250, serverNow?: string) {
  const [now, setNow] = useState(() => (serverNow ? new Date(serverNow).getTime() : Date.now() + offset));
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = setInterval(() => setNow(Date.now() + offset), intervalMs);
    return () => clearInterval(t);
  }, [offset, intervalMs]);
  return now;
}

/** Run a server action with toast feedback; refetch the room afterwards. */
export function useRoomAction(refetch: () => Promise<void> | void, markActed?: () => void) {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, opts: { quiet?: boolean } = {}) => {
      setPending(key);
      markActed?.();
      try {
        const res = await fn();
        if (!res.ok) toast.error(res.error ?? "Something went wrong");
        else if (res.message && !opts.quiet) toast.success(res.message);
        await refetch();
        return res.ok;
      } catch (e) {
        toast.error((e as Error).message);
        return false;
      } finally {
        setPending(null);
      }
    },
    [refetch, markActed],
  );
  return { pending, run };
}
