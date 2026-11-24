// League playoff seeding. The foundation's playoffSeeds() honors divisionWinnersTopSeeds,
// playoffs.divisionWinnersQualify, seeding and wildcardsByPoints (sim/core.ts seedsFromOrder mirrors it);
// this wrapper is the single entry point used by the bracket, odds, pages and the draft order.
import type { LeagueSettings } from "@/lib/settings/schema";
import { playoffSeeds, type StandingRow } from "@/lib/standings";

export function divisionWinnersGetIn(settings: LeagueSettings): boolean {
  return settings.standings.divisionWinnersTopSeeds || !!settings.playoffs.divisionWinnersQualify;
}

export function leagueSeeds(standings: StandingRow[], settings: LeagueSettings): StandingRow[] {
  return playoffSeeds(standings, settings).slice(0, Math.min(settings.playoffs.teams, standings.length));
}
