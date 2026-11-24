// Regular season schedule generator honoring settings.matchups (round robin / division weighted,
// division games twice, late-season division games, rivalry week). Pure: returns week -> pairings.

import type { LeagueSettings } from "@/lib/settings/schema";

export interface SchedTeam {
  id: string;
  division: string | null;
}

export interface PlannedMatchup {
  week: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  label: string | null;
}

type Pair = [string | null, string | null];

/** Circle-method round robin: n-1 rounds (n rounded up to even; odd counts get a null bye). */
export function circleRounds(ids: (string | null)[]): Pair[][] {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  if (n < 2) return [];
  const arr = [...list];
  const rounds: Pair[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Pair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

/** One round per division round-robin round; teams left without a division opponent are paired across divisions. */
export function divisionRounds(teams: SchedTeam[]): Pair[][] {
  const groups = new Map<string, string[]>();
  for (const t of teams) {
    const k = t.division ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t.id);
  }
  const perGroup = [...groups.values()].map((ids) => circleRounds(ids));
  const count = Math.max(0, ...perGroup.map((r) => r.length));
  const rounds: Pair[][] = [];
  for (let d = 0; d < count; d++) {
    const pairs: Pair[] = [];
    const leftovers: string[] = [];
    perGroup.forEach((g, gi) => {
      const round = g[d];
      if (!round) {
        leftovers.push(...[...groups.values()][gi]);
        return;
      }
      for (const [a, b] of round) {
        if (a && b) pairs.push([a, b]);
        else if (a || b) leftovers.push((a ?? b)!);
      }
    });
    for (let i = 0; i + 1 < leftovers.length; i += 2) pairs.push([leftovers[i], leftovers[i + 1]]);
    if (leftovers.length % 2) pairs.push([leftovers[leftovers.length - 1], null]);
    rounds.push(pairs);
  }
  return rounds;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Spread `inserts` evenly through `base` */
function interleave<T>(base: T[], inserts: T[]): T[] {
  if (!inserts.length) return base;
  const out: T[] = [];
  const every = (base.length + inserts.length) / inserts.length;
  let bi = 0;
  let ii = 0;
  for (let i = 0; i < base.length + inserts.length; i++) {
    const wantInsert = ii < inserts.length && Math.floor((i + 1) / every) > ii;
    if (wantInsert || bi >= base.length) out.push(inserts[ii++]);
    else out.push(base[bi++]);
  }
  return out;
}

/**
 * Build the full regular season. Teams must be passed in a stable order (e.g. creation order) so a
 * partial regeneration ("weeks 12+") lines up with earlier weeks.
 */
export function buildSeasonSchedule(teams: SchedTeam[], s: Pick<LeagueSettings, "general" | "matchups">): PlannedMatchup[] {
  const weeks = s.general.regularSeasonWeeks;
  const first = s.general.firstWeek ?? 1;
  const ids = teams.map((t) => t.id);
  const full = circleRounds(ids);
  if (!full.length || weeks <= 0) return [];

  const useDivisions = (s.matchups.scheduleType === "DIVISION_WEIGHTED" || s.matchups.divisionGamesTwice) && new Set(teams.map((t) => t.division ?? "")).size >= 1;
  const division = useDivisions ? divisionRounds(teams) : [];

  // Pick which rounds fill the season
  let sequence: Pair[][];
  if (division.length && weeks > full.length) {
    const nDiv = Math.min(division.length, weeks - full.length);
    const divPart = division.slice(0, nDiv);
    sequence = s.matchups.divisionGamesLate ? [...full, ...divPart] : interleave(full, divPart);
  } else {
    sequence = [...full];
  }
  // Longer seasons cycle again (home/away flipped on repeat meetings below)
  const pool = [...sequence];
  while (sequence.length < weeks) sequence.push(pool[(sequence.length - pool.length) % pool.length]);
  sequence = sequence.slice(0, weeks);

  // Flip home/away for repeat meetings
  const lastHome = new Map<string, string>();
  const planned: PlannedMatchup[] = [];
  const rivalryWeek = s.matchups.rivalryWeek;
  const rivalries = s.matchups.rivalries.filter(([a, b]) => a !== b && ids.includes(a) && ids.includes(b));

  sequence.forEach((round, i) => {
    const week = first + i;
    let pairs: Pair[] = round;
    let label: string | null = null;
    if (rivalryWeek === week && rivalries.length) {
      const used = new Set(rivalries.flat());
      const others = ids.filter((id) => !used.has(id));
      pairs = [...rivalries.map(([a, b]) => [a, b] as Pair), ...(circleRounds(others)[0] ?? [])];
      label = "Rivalry Week";
    }
    for (let [h, a] of pairs) {
      if (!h && !a) continue;
      if (!h) [h, a] = [a, null];
      if (h && a) {
        const k = pairKey(h, a);
        if (lastHome.get(k) === h) [h, a] = [a, h];
        lastHome.set(k, h!);
      }
      planned.push({ week, homeTeamId: h, awayTeamId: a, label: a ? label : s.matchups.oddTeamCountPolicy === "MEDIAN_OPPONENT" ? "vs. League Median" : "Bye" });
    }
  });
  return planned;
}

/** Validate a commissioner-edited week: every team at most once, nobody plays itself. */
export function weekPairingErrors(
  pairs: { homeTeamId: string | null; awayTeamId: string | null }[],
  teamIds: string[],
  names: Map<string, string> = new Map(),
): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const p of pairs) {
    if (!p.homeTeamId && !p.awayTeamId) {
      errors.push("A matchup has no teams.");
      continue;
    }
    if (p.homeTeamId && p.homeTeamId === p.awayTeamId) errors.push("A team can't play itself.");
    for (const id of [p.homeTeamId, p.awayTeamId]) {
      if (!id) continue;
      if (!teamIds.includes(id)) errors.push("Unknown team in a matchup.");
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
  }
  for (const [id, n] of seen) if (n > 1) errors.push(`${names.get(id) ?? "A team"} is scheduled ${n} times this week.`);
  return [...new Set(errors)];
}
