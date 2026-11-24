"use client";
// Browser side of live updates. One shared EventSource per page; components subscribe to topics.
//   useLiveEvents(["league:abc"], (e) => { if (e.type === "score.update") ... })
import { useEffect, useRef } from "react";

export interface LiveEvent<T = unknown> {
  topic: string;
  type: string;
  data: T;
  at: string;
}

type Handler = (e: LiveEvent) => void;

const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let currentKey = "";
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  const topicList = [...handlers.keys()].filter((t) => (handlers.get(t)?.size ?? 0) > 0).sort();
  const key = topicList.join(",");
  if (key === currentKey && source) return;
  currentKey = key;
  source?.close();
  source = null;
  if (typeof window === "undefined") return;
  source = new EventSource(`/api/stream?topics=${encodeURIComponent(key)}`);
  source.onmessage = (msg) => {
    try {
      const evt = JSON.parse(msg.data) as LiveEvent;
      handlers.get(evt.topic)?.forEach((h) => h(evt));
      handlers.get("*")?.forEach((h) => h(evt));
    } catch {}
  };
  source.onerror = () => {
    // EventSource auto-reconnects; nothing to do
  };
}

function scheduleConnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 50);
}

export function useLiveEvents(topics: (string | null | undefined)[], handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  const key = topics.filter(Boolean).join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const h: Handler = (e) => ref.current(e);
    for (const t of list) {
      if (!handlers.has(t)) handlers.set(t, new Set());
      handlers.get(t)!.add(h);
    }
    scheduleConnect();
    return () => {
      for (const t of list) handlers.get(t)?.delete(h);
      scheduleConnect();
    };
  }, [key]);
}
