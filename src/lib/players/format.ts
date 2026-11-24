// Date/time formatting in the league time zone (pure; client + server).

/** "Sun 1:00 PM"; games whose time is not set yet (scheduled at local midnight) read "Sun · TBD" */
export function fmtKickoff(d: Date | string, tz: string): string {
  const date = new Date(d);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? 1) % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? 1);
  if (hh === 0 && mm === 0) return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date)} · TBD`;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

export function fmtWeekday(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export function fmtDate(d: Date | string, tz: string, opts: { year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) }).format(new Date(d));
}

/** Calendar date that is stored as noon UTC (e.g. return dates, birth dates) — format without shifting days */
export function fmtCalendarDate(d: Date | string, opts: { year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) }).format(new Date(d));
}

export const SOURCE_LABELS: Record<string, string> = {
  ESPN: "ESPN",
  ROTOWIRE: "RotoWire via ESPN",
  SLEEPER: "Sleeper",
  LEAGUE: "League",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
