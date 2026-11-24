// In-process pub/sub used for live scoring, chat, drafts and notifications.
// Server-Sent Events (src/app/api/stream/route.ts) forward these events to browsers.
// Topics:
//   league:<leagueId>   scores, transactions, trades, announcements
//   chat:<channelId>    chat messages / reactions / typing
//   draft:<draftId>     draft picks, auction bids, timers
//   user:<userId>       personal notifications
import { EventEmitter } from "node:events";

export interface LiveEvent<T = unknown> {
  topic: string;
  type: string; // e.g. "score.update", "chat.message", "draft.pick", "notification"
  data: T;
  at: string;
}

const g = globalThis as unknown as { __cteBus?: EventEmitter };
const bus: EventEmitter = g.__cteBus ?? new EventEmitter();
bus.setMaxListeners(10_000);
g.__cteBus = bus;

export function publish<T>(topic: string, type: string, data: T) {
  const evt: LiveEvent<T> = { topic, type, data, at: new Date().toISOString() };
  bus.emit(topic, evt);
  bus.emit("*", evt);
}

export function subscribe(topics: string[], handler: (e: LiveEvent) => void): () => void {
  for (const t of topics) bus.on(t, handler);
  return () => {
    for (const t of topics) bus.off(t, handler);
  };
}

export const topics = {
  league: (id: string) => `league:${id}`,
  chat: (id: string) => `chat:${id}`,
  draft: (id: string) => `draft:${id}`,
  user: (id: string) => `user:${id}`,
};
