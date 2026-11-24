// Time-zone helpers for draft scheduling (league timezone <-> UTC). Pure; safe on client and server.

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/** "2027-05-02T19:30" interpreted in `timeZone` → UTC Date (null when malformed). */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off1 = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - off1;
  const off2 = tzOffsetMs(new Date(utc), timeZone);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

/** UTC Date → "YYYY-MM-DDTHH:mm" wall time in `timeZone` (for datetime-local inputs). */
export function utcToZonedLocal(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`;
}

/** "Sat, May 2, 7:30 PM EDT" in the league timezone. */
export function fmtDateTime(date: Date | string | null | undefined, timeZone: string, opts: { withZone?: boolean; withWeekday?: boolean } = {}): string {
  if (!date) return "—";
  const d = new Date(date);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: opts.withWeekday === false ? undefined : "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: opts.withZone === false ? undefined : "short",
  }).format(d);
}

/** "4:12", "1:02:09" or "2d 4h" countdown text. */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
