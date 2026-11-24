import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { League, LeagueMember, Team } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { getNflState, type NflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";

export const LEAGUE_COOKIE = "cte_league";

export interface LeagueContext {
  user: SessionUser;
  league: League;
  settings: LeagueSettings;
  member: LeagueMember;
  myTeam: Team | null;
  isCommish: boolean;
  season: number;
  /** Current fantasy week (1-based). In the offseason this is the last week of the season. */
  week: number;
  nfl: NflState;
  memberships: (LeagueMember & { league: League; team: Team | null })[];
}

export { leagueWeekFor as leagueWeek } from "@/lib/league-week";

const loadContext = cache(async (): Promise<LeagueContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const memberships = await db.leagueMember.findMany({
    where: { userId: user.id },
    include: { league: true, team: true },
    orderBy: { joinedAt: "asc" },
  });
  if (!memberships.length) return null;
  const jar = await cookies();
  const activeId = jar.get(LEAGUE_COOKIE)?.value;
  const member = memberships.find((m) => m.leagueId === activeId) ?? memberships[0];
  const league = member.league;
  const settings = resolveSettings(league.settings);
  const nfl = await getNflState();
  return {
    user,
    league,
    settings,
    member,
    myTeam: member.team,
    isCommish: member.role === "COMMISSIONER" || member.role === "CO_COMMISSIONER" || user.isSiteAdmin,
    season: league.season,
    week: leagueWeekFor(league, settings, nfl),
    nfl,
    memberships,
  };
});

/** For pages: requires login + league membership (redirects otherwise). */
export async function getLeagueContext(): Promise<LeagueContext> {
  await requireUser();
  const ctx = await loadContext();
  if (!ctx) redirect("/join");
  return ctx;
}

/** For route handlers / server actions that must not redirect. */
export async function getLeagueContextOrNull(): Promise<LeagueContext | null> {
  return loadContext();
}

/** For commissioner-only pages and actions. */
export async function requireCommissioner(): Promise<LeagueContext> {
  const ctx = await getLeagueContext();
  if (!ctx.isCommish) redirect("/");
  return ctx;
}

/** Throws (for server actions) when the current user is not a commissioner of the active league. */
export async function assertCommissioner(): Promise<LeagueContext> {
  const ctx = await loadContext();
  if (!ctx || !ctx.isCommish) throw new Error("Commissioner access required");
  return ctx;
}

/** Throws when not logged into a league (for server actions). */
export async function assertLeagueMember(): Promise<LeagueContext> {
  const ctx = await loadContext();
  if (!ctx) throw new Error("You must be signed in to a league");
  return ctx;
}

/** Throws unless the active user manages `teamId` (or is commissioner when allowCommish). */
export async function assertTeamManager(teamId: string, allowCommish = true): Promise<LeagueContext> {
  const ctx = await assertLeagueMember();
  if (ctx.myTeam?.id === teamId) return ctx;
  if (allowCommish && ctx.isCommish) {
    const team = await db.team.findUnique({ where: { id: teamId } });
    if (team?.leagueId === ctx.league.id) return ctx;
  }
  throw new Error("You can only manage your own team");
}
