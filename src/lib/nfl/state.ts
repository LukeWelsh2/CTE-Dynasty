// Current NFL season/week state (from Sleeper), cached in the KeyValue table.
import { db } from "@/lib/db";
import { fetchJson } from "@/lib/sync/http";

export interface NflState {
  season: number;
  week: number; // current scoring week (1-18 regular season)
  displayWeek: number;
  seasonType: "pre" | "regular" | "post" | "off";
  previousSeason: number;
  seasonStartDate: string | null;
  fetchedAt: string;
}

const KEY = "nfl_state";
const TTL_MS = 30 * 60_000;

const g = globalThis as unknown as { __nflState?: NflState };

export async function getNflState(force = false): Promise<NflState> {
  const mem = g.__nflState;
  if (!force && mem && Date.now() - new Date(mem.fetchedAt).getTime() < TTL_MS) return mem;
  const row = await db.keyValue.findUnique({ where: { key: KEY } }).catch(() => null);
  if (!force && row) {
    const v = row.value as unknown as NflState;
    if (Date.now() - new Date(v.fetchedAt).getTime() < TTL_MS) {
      g.__nflState = v;
      return v;
    }
  }
  try {
    const s = await fetchJson<Record<string, unknown>>("https://api.sleeper.app/v1/state/nfl");
    const state: NflState = {
      season: Number(s.season),
      week: Math.max(1, Number(s.week) || 1),
      displayWeek: Math.max(1, Number(s.display_week ?? s.week) || 1),
      seasonType: (String(s.season_type) as NflState["seasonType"]) || "regular",
      previousSeason: Number(s.previous_season),
      seasonStartDate: (s.season_start_date as string) ?? null,
      fetchedAt: new Date().toISOString(),
    };
    await db.keyValue.upsert({ where: { key: KEY }, create: { key: KEY, value: state as never }, update: { value: state as never } });
    g.__nflState = state;
    return state;
  } catch (e) {
    if (row) return row.value as unknown as NflState;
    const now = new Date();
    const season = now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
    return { season, week: 1, displayWeek: 1, seasonType: "regular", previousSeason: season - 1, seasonStartDate: null, fetchedAt: now.toISOString() };
  }
}
