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

// ───────────────────────────── Overnight clock pause ─────────────────────────────

/** Daily window (league time) during which a slow draft's pick clock stops (settings.draft.rookie.overnightPause). */
export interface PauseWindow {
  startHour: number;
  endHour: number;
  timeZone: string;
}

function localDateParts(t: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function localInstant(y: number, m: number, d: number, hour: number, timeZone: string): number {
  const day = new Date(Date.UTC(y, m - 1, d));
  const iso = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00`;
  return zonedLocalToUtc(iso, timeZone)!.getTime();
}

/** The pause window containing `t`, else the next one that starts after `t` (null when the window is empty). */
export function pauseWindowAt(t: number, w: PauseWindow): { start: number; end: number; active: boolean } | null {
  const sh = Math.max(0, Math.min(23, Math.round(w.startHour)));
  const eh = Math.max(0, Math.min(23, Math.round(w.endHour)));
  if (sh === eh) return null;
  const { y, m, d } = localDateParts(t, w.timeZone);
  let next: { start: number; end: number } | null = null;
  for (const off of [-1, 0, 1, 2]) {
    const start = localInstant(y, m, d + off, sh, w.timeZone);
    const end = localInstant(y, m, d + off + (eh <= sh ? 1 : 0), eh, w.timeZone);
    if (t >= start && t < end) return { start, end, active: true };
    if (start > t && (!next || start < next.start)) next = { start, end };
  }
  return next ? { ...next, active: false } : null;
}

/** `from` + `ms` of running clock, skipping the daily pause window when one is set. */
export function addClockTime(from: Date, ms: number, pause: PauseWindow | null): Date {
  const left0 = Math.max(0, ms);
  if (!pause) return new Date(from.getTime() + left0);
  let t = from.getTime();
  let left = left0;
  for (let guard = 0; guard < 1000; guard++) {
    const w = pauseWindowAt(t, pause);
    if (!w) break;
    if (w.active) {
      t = w.end;
      continue;
    }
    if (t + left <= w.start) return new Date(t + left);
    left -= w.start - t;
    t = w.end;
  }
  return new Date(t + left);
}

/** Running clock between `from` and `to` (the inverse of addClockTime): wall time minus the pause windows. */
export function clockTimeBetween(from: Date, to: Date, pause: PauseWindow | null): number {
  let t = from.getTime();
  const end = to.getTime();
  if (end <= t) return 0;
  if (!pause) return end - t;
  let total = 0;
  for (let guard = 0; guard < 1000 && t < end; guard++) {
    const w = pauseWindowAt(t, pause);
    if (!w) return total + (end - t);
    if (w.active) {
      t = Math.min(end, w.end);
      continue;
    }
    if (end <= w.start) return total + (end - t);
    total += w.start - t;
    t = w.end;
  }
  return total;
}
