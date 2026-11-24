// Stat-correction cutoff (settings.general.statCorrectionDay / statCorrectionHour, league timezone): after
// it, stat corrections no longer change a week's results. Pure + client-safe.
import type { LeagueSettings, Weekday } from "@/lib/settings/schema";
import { WEEKDAYS } from "@/lib/settings/schema";
import { localInputToIso } from "@/lib/commissioner/time";

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar date (y, m, d) and weekday of an instant in `tz` */
function localDay(at: Date, tz: string): { y: number; m: number; d: number; dow: Weekday } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), dow: get("weekday").slice(0, 3).toUpperCase() as Weekday };
}

/**
 * The cutoff for a week whose last game kicked off at `lastKickoff`: the first statCorrectionDay at
 * statCorrectionHour:00 (league timezone) that is at least 12 hours after that kickoff (so a game still in
 * progress never hits the cutoff the same night).
 */
export function statCorrectionCutoff(lastKickoff: Date, settings: Pick<LeagueSettings, "general">): Date {
  const g = settings.general;
  const tz = g.timezone;
  const earliest = lastKickoff.getTime() + 12 * 3600_000;
  const start = localDay(lastKickoff, tz);
  const target = WEEKDAYS.indexOf(g.statCorrectionDay);
  const startIdx = WEEKDAYS.indexOf(start.dow);
  for (let add = 0; add <= 14; add++) {
    if ((startIdx + add) % 7 !== target) continue;
    // calendar arithmetic in UTC on the local date, then convert that local wall time back to an instant
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + add));
    const local = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(((g.statCorrectionHour % 24) + 24) % 24)}:00`;
    const iso = localInputToIso(local, tz);
    if (iso && new Date(iso).getTime() >= earliest) return new Date(iso);
  }
  // unreachable with a valid weekday; fall back to a week after kickoff
  return new Date(lastKickoff.getTime() + 7 * 864e5);
}

/** Can stat corrections still change this week's results? (null kickoff = no games yet: open) */
export function statCorrectionsOpen(lastKickoff: Date | null, settings: Pick<LeagueSettings, "general">, now: Date = new Date()): boolean {
  if (!lastKickoff) return true;
  return now.getTime() < statCorrectionCutoff(lastKickoff, settings).getTime();
}
