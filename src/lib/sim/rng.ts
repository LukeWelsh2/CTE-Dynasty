// Small, fast, seedable PRNG for Monte Carlo simulations (reproducible results with a stored seed).

export interface Rng {
  /** uniform [0, 1) */
  next(): number;
  /** standard normal N(0, 1) */
  normal(): number;
}

/** mulberry32: 32-bit state, good statistical quality for simulation work, very fast. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  let spare: number | null = null;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    // Box-Muller (polar form avoids trig)
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
  return { next, normal };
}

/** Stable 32-bit hash of a string (FNV-1a) — used to derive seeds and pick phrasing variants. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
