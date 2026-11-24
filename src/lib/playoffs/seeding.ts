// League playoff seeding: the foundation's playoffSeeds() plus settings.playoffs.divisionWinnersQualify
// (division winners are guaranteed a spot but seeded by record). Used by the bracket, odds and pages so
// every view agrees with the simulation's seeding (sim/core.ts seedsFromOrder mirrors this).
import type { LeagueSettings } from "@/lib/settings/schema";
import { playoffSeeds, type StandingRow } from "@/lib/standings";

export function divisionWinnersGetIn(settings: LeagueSettings): boolean {
  return settings.standings.divisionWinnersTopSeeds || !!settings.playoffs.divisionWinnersQualify;
}

export function leagueSeeds(standings: StandingRow[], settings: LeagueSettings): StandingRow[] {
  const seeds = playoffSeeds(standings, settings);
  if (settings.standings.divisionWinnersTopSeeds || !settings.playoffs.divisionWinnersQualify) return seeds;
  const n = Math.min(settings.playoffs.teams, standings.length);
  const winners = standings.filter((r) => r.divisionRank === 1 && r.team.division);
  const missing = winners.filter((w) => !seeds.includes(w));
  if (!missing.length) return seeds;
  const out = [...seeds];
  // bump the last non-division-winner seed to make room; with record seeding everyone is then re-seeded by record
  for (const w of missing) {
    if (out.length >= n) {
      let idx = -1;
      for (let i = out.length - 1; i >= 0; i--) if (!winners.includes(out[i]!)) (idx = i), (i = -1);
      if (idx < 0) break;
      out.splice(idx, 1);
    }
    out.push(w);
  }
  if (settings.playoffs.seeding === "RECORD" && !(settings.playoffs.wildcardsByPoints ?? 0)) {
    const order = new Map(standings.map((r, i) => [r.team.id, i]));
    out.sort((a, b) => (order.get(a.team.id) ?? 0) - (order.get(b.team.id) ?? 0));
  }
  return out.slice(0, n);
}
