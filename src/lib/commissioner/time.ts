// Timezone helpers for commissioner forms (datetime-local inputs are entered in the league timezone).
// Pure + client-safe.

function partsInZone(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

/** Offset (ms) of `tz` from UTC at `date` (e.g. -5h for New York in winter). */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = partsInZone(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-12-01T13:30" in `tz` -> ISO string (UTC). Returns null for blank/invalid input. */
export function localInputToIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  // second pass handles DST transitions
  ts = guess - tzOffsetMs(new Date(ts), tz);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO string -> "YYYY-MM-DDTHH:mm" in `tz` for a datetime-local input. */
export function isoToLocalInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partsInZone(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Human date/time in the league timezone, e.g. "Tue, Dec 1, 1:30 PM EST" */
export function fmtDateTime(iso: string | Date | null | undefined, tz: string, opts: { withYear?: boolean; dateOnly?: boolean } = {}): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(opts.withYear ? { year: "numeric" } : {}),
    ...(opts.dateOnly ? {} : { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
  }).format(d);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 0-23 -> "3 AM" */
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  if (hh === 0) return "12 AM";
  if (hh === 12) return "12 PM";
  return hh < 12 ? `${hh} AM` : `${hh - 12} PM`;
}
