// Small in-memory rate limiter (single Node process — matches the in-process realtime bus).
// Enforces a minimum interval between actions plus a burst cap over a sliding window.

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly burst: { count: number; windowMs: number } | null = null,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const windowMs = Math.max(this.minIntervalMs, this.burst?.windowMs ?? 0);
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const last = list[list.length - 1];
    if (last !== undefined && now - last < this.minIntervalMs) {
      this.hits.set(key, list);
      return { ok: false, retryAfterMs: this.minIntervalMs - (now - last) };
    }
    if (this.burst && list.length >= this.burst.count) {
      const oldest = list[list.length - this.burst.count];
      this.hits.set(key, list);
      return { ok: false, retryAfterMs: Math.max(1, this.burst.windowMs - (now - oldest)) };
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.prune(now, windowMs);
    return { ok: true, retryAfterMs: 0 };
  }

  private prune(now: number, windowMs: number) {
    for (const [k, v] of this.hits) if (!v.length || now - v[v.length - 1] > windowMs) this.hits.delete(k);
  }
}

/** Process-wide limiter instances that survive dev hot reloads. */
export function sharedLimiter(name: string, make: () => RateLimiter): RateLimiter {
  const g = globalThis as unknown as { __cteLimiters?: Map<string, RateLimiter> };
  g.__cteLimiters ??= new Map();
  let l = g.__cteLimiters.get(name);
  if (!l) {
    l = make();
    g.__cteLimiters.set(name, l);
  }
  return l;
}
