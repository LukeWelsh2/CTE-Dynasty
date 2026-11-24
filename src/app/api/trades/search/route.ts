// GET /api/trades/search?q= — any NFL player (rostered or free agent) for the calculator's free mode.
import { db } from "@/lib/db";
import { getLeagueContextOrNull } from "@/lib/league";
import { getLeagueValues, valuePlayer, valuePlayers } from "@/lib/value/context";
import { searchName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return Response.json({ players: [] });
  const sn = searchName(q);
  const players = await db.player.findMany({
    where: { position: { in: ["QB", "RB", "WR", "TE", "K", "DEF", ...(ctx.settings.roster.idpEnabled ? ["DL", "LB", "DB"] : [])] }, OR: [{ searchName: { contains: sn } }, { lastName: { startsWith: q, mode: "insensitive" } }] },
    orderBy: [{ active: "desc" }, { searchRank: { sort: "asc", nulls: "last" } }],
    take: 12,
    include: { rosterSpots: { where: { leagueId: ctx.league.id }, include: { team: { select: { id: true, name: true, abbrev: true } } } } },
  });
  const values = await getLeagueValues(ctx.league.id);
  const valued = await valuePlayers(values, players.map((p) => p.id));
  return Response.json({
    players: players.map((p) => {
      const vp = valued.get(p.id);
      const spot = p.rosterSpots[0];
      const v = vp ? valuePlayer(values, vp, "balanced") : null;
      return {
        id: p.id,
        fullName: p.fullName,
        position: p.position,
        team: p.team,
        injuryStatus: p.injuryStatus,
        age: p.age,
        salary: spot?.salary ?? null,
        contractYears: spot?.contractYears ?? null,
        fantasyTeam: spot ? { id: spot.team.id, name: spot.team.name, abbrev: spot.team.abbrev } : null,
        seasonPoints: vp?.seasonPoints ?? 0,
        value: v ? Math.round(v.value * 10) / 10 : 0,
      };
    }),
  });
}
