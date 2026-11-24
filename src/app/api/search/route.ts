import { db } from "@/lib/db";
import { getLeagueContextOrNull } from "@/lib/league";
import { MAIN_NAV } from "@/components/layout/nav-config";
import { searchName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return Response.json({ results: [] });
  const sn = searchName(q);
  const [players, teams, members] = await Promise.all([
    db.player.findMany({
      where: { OR: [{ searchName: { contains: sn } }, { lastName: { startsWith: q, mode: "insensitive" } }] },
      orderBy: [{ active: "desc" }, { searchRank: { sort: "asc", nulls: "last" } }],
      take: 10,
      include: { rosterSpots: { where: { leagueId: ctx.league.id }, include: { team: true } } },
    }),
    db.team.findMany({ where: { leagueId: ctx.league.id, name: { contains: q, mode: "insensitive" } }, take: 5 }),
    db.leagueMember.findMany({ where: { leagueId: ctx.league.id, user: { name: { contains: q, mode: "insensitive" } } }, include: { user: true, team: true }, take: 5 }),
  ]);
  const pages = MAIN_NAV.flatMap((n) => [{ label: n.label, href: n.href }, ...(n.children ?? [])])
    .filter((p) => p.label.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 5);
  const results = [
    ...players.map((p) => ({
      type: "player" as const,
      id: p.id,
      label: p.fullName,
      position: p.position,
      sub: `${p.position} · ${p.team ?? "FA"}${p.rosterSpots[0] ? ` · ${p.rosterSpots[0].team.name} ($${p.rosterSpots[0].salary})` : " · Free agent"}`,
      href: `/players/${p.id}`,
    })),
    ...teams.map((t) => ({ type: "team" as const, id: t.id, label: t.name, sub: "Fantasy team", href: `/teams/${t.id}` })),
    ...members.map((m) => ({ type: "manager" as const, id: m.userId, label: m.user.name, sub: m.team?.name ?? "Manager", href: `/managers/${m.userId}` })),
    ...pages.map((p) => ({ type: "page" as const, id: p.href, label: p.label, sub: p.href, href: p.href })),
  ];
  return Response.json({ results });
}
