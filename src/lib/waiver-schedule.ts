// Waiver timing helpers shared by free agency (players module) and waiver processing.
import type { LeagueSettings, Weekday } from "@/lib/settings/schema";
import { WEEKDAYS } from "@/lib/settings/schema";

/** Parts of a Date in a time zone */
function zonedParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    weekday: (parts.weekday as string).toUpperCase().slice(0, 3) as Weekday,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/**
 * Next scheduled waiver processing time strictly after `from`, per settings.waivers.processDays / processHour
 * in the league time zone. Returns null when no process days are configured.
 */
export function nextWaiverRun(settings: LeagueSettings, from = new Date()): Date | null {
  const days = settings.waivers.processDays;
  if (!days?.length) return null;
  const tz = settings.general.timezone || "America/New_York";
  // Walk forward hour by hour (max 8 days) to find the next matching day/hour boundary.
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);
  for (let h = 1; h <= 24 * 8; h++) {
    const t = new Date(start.getTime() + h * 3600_000);
    const p = zonedParts(t, tz);
    if (days.includes(p.weekday) && p.hour === settings.waivers.processHour) return t;
  }
  return null;
}

/** Most recent scheduled waiver processing time at or before `now`. */
export function lastWaiverRun(settings: LeagueSettings, now = new Date()): Date | null {
  const days = settings.waivers.processDays;
  if (!days?.length) return null;
  const tz = settings.general.timezone || "America/New_York";
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  for (let h = 0; h <= 24 * 8; h++) {
    const t = new Date(start.getTime() - h * 3600_000);
    const p = zonedParts(t, tz);
    if (days.includes(p.weekday) && p.hour === settings.waivers.processHour) return t;
  }
  return null;
}

/** Is a player currently on waivers (recently dropped, or game-locked until the next run)? */
export function isOnWaivers(state: { waiverClearsAt: Date | null } | null | undefined, now = new Date()): boolean {
  return !!state?.waiverClearsAt && state.waiverClearsAt > now;
}

export { WEEKDAYS };
