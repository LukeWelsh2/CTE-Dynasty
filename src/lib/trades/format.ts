// Display helpers shared by trade pages and components (pure, client-safe).

export type TradeStatusKey = "PROPOSED" | "COUNTERED" | "ACCEPTED" | "COMPLETED" | "REJECTED" | "CANCELLED" | "VETOED" | "EXPIRED" | "REVERSED";
export type BadgeTone = "neutral" | "brand" | "gold" | "green" | "red" | "amber" | "purple" | "live";

export const STATUS_META: Record<TradeStatusKey, { label: string; tone: BadgeTone; description: string }> = {
  PROPOSED: { label: "Pending", tone: "amber", description: "Waiting for a response" },
  COUNTERED: { label: "Countered", tone: "purple", description: "Replaced by a counter offer" },
  ACCEPTED: { label: "In review", tone: "brand", description: "Accepted — in the review period" },
  COMPLETED: { label: "Completed", tone: "green", description: "Processed" },
  REJECTED: { label: "Rejected", tone: "red", description: "Turned down" },
  CANCELLED: { label: "Cancelled", tone: "neutral", description: "Withdrawn or cancelled" },
  VETOED: { label: "Vetoed", tone: "red", description: "Blocked in review" },
  EXPIRED: { label: "Expired", tone: "neutral", description: "No response in time" },
  REVERSED: { label: "Reversed", tone: "purple", description: "Undone by the commissioner" },
};

export function fmtWhen(d: Date | string | null | undefined, tz: string, opts: { withYear?: boolean } = {}): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(opts.withYear ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit" });
}

export function fmtDay(d: Date | string | null | undefined, tz: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
}

/** "2d 4h left", "45m left", "ended" */
export function timeLeft(d: Date | string | null | undefined, now: number = Date.now()): string | null {
  if (!d) return null;
  const ms = new Date(d).getTime() - now;
  if (ms <= 0) return "ended";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)}m left`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ${min % 60}m left`;
  return `${Math.floor(h / 24)}d ${h % 24}h left`;
}

export function signed(n: number, digits = 0): string {
  const r = Number(n.toFixed(digits));
  if (r === 0) return digits ? (0).toFixed(digits) : "0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(digits)}`;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n < 0 ? `−$${Math.abs(Math.round(n))}` : `$${Math.round(n)}`;
}

export function contractText(salary: number | null | undefined, years: number | null | undefined): string {
  if (salary === null || salary === undefined) return "—";
  return `$${salary}${years ? ` · ${years} yr${years === 1 ? "" : "s"}` : ""}`;
}

export const COMPONENT_COLORS: Record<string, string> = {
  production: "bg-brand-600",
  age: "bg-sky-500",
  rookie: "bg-emerald-500",
  superflex: "bg-fuchsia-600",
  contract: "bg-gold-500",
  injury: "bg-red-500",
  slot: "bg-brand-600",
  year: "bg-slate-400",
  outlook: "bg-sky-500",
  faab: "bg-emerald-600",
};
