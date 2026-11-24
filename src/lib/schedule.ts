// Fantasy schedule generation (round robin, division weighting, rivalry week).
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";

/** Classic circle-method round robin. Returns rounds of [home, away] pairs. Odd counts get a bye (null). */
export function roundRobin(ids: (string | null)[]): [string | null, string | null][][] {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds: [string | null, string | null][][] = [];
  const arr = [...list];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string | null, string | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    // rotate all but the first
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

/** Build the regular season schedule for a league season (replaces existing non-playoff matchups). */
export async function generateSchedule(leagueId: string, season: number, settings: LeagueSettings) {
  const teams = await db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } });
  const ids = teams.map((t) => t.id);
  const rounds = roundRobin(ids);
  const weeks = settings.general.regularSeasonWeeks;
  const first = settings.general.firstWeek ?? 1;
  const data: { leagueId: string; season: number; week: number; homeTeamId: string | null; awayTeamId: string | null; label?: string | null }[] = [];
  for (let w = 0; w < weeks; w++) {
    const week = first + w;
    let pairs = rounds[w % rounds.length];
    if (settings.matchups.rivalryWeek === week && settings.matchups.rivalries.length) {
      const used = new Set(settings.matchups.rivalries.flat());
      const others = ids.filter((id) => !used.has(id));
      const extra = roundRobin(others)[0] ?? [];
      pairs = [...settings.matchups.rivalries.map(([a, b]) => [a, b] as [string, string]), ...extra];
    }
    for (const [h, a] of pairs) {
      if (!h && !a) continue;
      data.push({ leagueId, season, week, homeTeamId: h, awayTeamId: a, label: settings.matchups.rivalryWeek === week ? "Rivalry Week" : null });
    }
  }
  await db.$transaction([
    db.matchup.deleteMany({ where: { leagueId, season, isPlayoff: false } }),
    db.matchup.createMany({ data }),
  ]);
  return data.length;
}
