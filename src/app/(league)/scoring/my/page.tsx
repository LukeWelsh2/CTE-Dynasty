import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";

// /scoring/my → my matchup for the current week (or the scoreboard when I have none)
export default async function MyMatchupPage() {
  const ctx = await getLeagueContext();
  const teamId = ctx.myTeam?.id;
  const m = teamId
    ? await db.matchup.findFirst({
        where: { leagueId: ctx.league.id, season: ctx.season, week: ctx.week, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
        orderBy: [{ isPlayoff: "desc" }, { isConsolation: "asc" }],
        select: { id: true },
      })
    : null;
  redirect(m ? `/scoring/${m.id}` : "/scoring");
}
