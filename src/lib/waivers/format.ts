// Date/time formatting in the league time zone (pure, client-safe).

export function fmtDateTime(d: Date | string | null | undefined, tz: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    timeZone: tz,
    ...(opts.weekday === false ? {} : { weekday: "short" }),
    month: "short",
    day: "numeric",
    ...(opts.year ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDate(d: Date | string | null | undefined, tz: string, opts: { year?: boolean } = {}): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) });
}

export function fmtTime(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/** "EST" / "PDT" for the zone at a moment */
export function tzAbbrev(tz: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
}

const DAY_NAMES: Record<string, string> = { SUN: "Sun", MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat" };

export function daysLabel(days: string[]): string {
  if (!days.length) return "no days";
  if (days.length === 7) return "every day";
  return days.map((d) => DAY_NAMES[d] ?? d).join(", ");
}

/** Relative "in 2d 3h" / "3h ago" */
export function relative(d: Date | string, now = Date.now()): string {
  const ms = new Date(d).getTime() - now;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  let s: string;
  if (min < 1) s = "moments";
  else if (min < 60) s = `${min}m`;
  else if (min < 48 * 60) s = `${Math.floor(min / 60)}h ${min % 60}m`;
  else s = `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
  return ms >= 0 ? `in ${s}` : `${s} ago`;
}
