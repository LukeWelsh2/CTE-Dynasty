// Player news feed queries (league-aware: fantasy owners on player chips, "my players" highlighting).
import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import type { NewsCardItem, NewsCardPlayer } from "@/components/players/news-card";
import { latestInjuryReports } from "@/lib/players/injury-data";
import { effectiveInjury, parsePositionFilter, rawPositionsFor, type PositionFilter } from "@/lib/players/logic";

export const NEWS_PER_PAGE = 25;

export interface NewsFilters {
  scope: "all" | "mine" | "myteams";
  pos: PositionFilter;
  nfl: string | null;
  category: "NEWS" | "INJURY" | null;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseNewsFilters(sp: RawParams, ctx: Pick<LeagueContext, "settings">): NewsFilters {
  const scope = first(sp.scope);
  const cat = (first(sp.category) ?? "").toUpperCase();
  const nfl = (first(sp.nfl) ?? "").toUpperCase();
  return {
    scope: scope === "mine" || scope === "myteams" ? scope : "all",
    pos: parsePositionFilter(first(sp.pos), ctx.settings),
    nfl: /^[A-Z]{2,3}$/.test(nfl) ? nfl : null,
    category: cat === "NEWS" || cat === "INJURY" ? cat : null,
    page: z.coerce.number().int().min(1).max(1000).catch(1).parse(first(sp.page) ?? 1),
  };
}

export function newsHref(f: NewsFilters, patch: Partial<NewsFilters>): string {
  const n = { ...f, page: 1, ...patch };
  const p = new URLSearchParams();
  if (n.scope !== "all") p.set("scope", n.scope);
  if (n.pos !== "ALL") p.set("pos", n.pos);
  if (n.nfl) p.set("nfl", n.nfl);
  if (n.category) p.set("category", n.category);
  if (n.page > 1) p.set("page", String(n.page));
  const s = p.toString();
  return `/news${s ? `?${s}` : ""}`;
}

export interface FeedEntry {
  item: NewsCardItem;
  players: NewsCardPlayer[];
  highlight: boolean;
}

/** Attach league owners + current injury tags to news items' linked players */
export async function decorateNews(
  ctx: LeagueContext,
  items: (NewsCardItem & { players: { player: { id: string; fullName: string; position: string; team: string | null; injuryStatus: string | null; injuryBodyPart: string | null; injuryNotes: string | null } }[] })[],
): Promise<FeedEntry[]> {
  const ids = [...new Set(items.flatMap((i) => i.players.map((p) => p.player.id)))];
  const [spots, latest] = await Promise.all([
    ids.length ? db.rosterSpot.findMany({ where: { leagueId: ctx.league.id, playerId: { in: ids } }, include: { team: true } }) : Promise.resolve([]),
    latestInjuryReports(ids),
  ]);
  const owner = new Map(spots.map((s) => [s.playerId, s]));
  const rosterable = new Set(rawPositionsFor("ALL", ctx.settings));
  return items.map(({ players, ...item }) => {
    const chips: NewsCardPlayer[] = players.filter(({ player: p }) => rosterable.has(p.position)).map(({ player: p }) => {
      const s = owner.get(p.id);
      return {
        id: p.id,
        fullName: p.fullName,
        position: p.position,
        team: p.team,
        injuryStatus: effectiveInjury(p, latest.get(p.id)).status,
        owner: s
          ? { teamId: s.teamId, name: s.team.name, abbrev: s.team.abbrev, logoUrl: s.team.logoUrl, primaryColor: s.team.primaryColor, secondaryColor: s.team.secondaryColor, isMine: s.teamId === ctx.myTeam?.id }
          : null,
      };
    });
    // my players first on the chip row
    chips.sort((a, b) => Number(!!b.owner?.isMine) - Number(!!a.owner?.isMine));
    return { item, players: chips, highlight: chips.some((c) => c.owner?.isMine) };
  });
}

const PLAYER_SELECT = { id: true, fullName: true, position: true, team: true, injuryStatus: true, injuryBodyPart: true, injuryNotes: true } as const;
const ITEM_SELECT = {
  id: true,
  headline: true,
  summary: true,
  analysis: true,
  url: true,
  imageUrl: true,
  source: true,
  category: true,
  publishedAt: true,
  players: { select: { player: { select: PLAYER_SELECT } } },
} as const;

export async function loadNewsFeed(ctx: LeagueContext, f: NewsFilters) {
  const and: Prisma.NewsItemWhereInput[] = [];
  let myTeams: string[] = [];
  if (f.scope !== "all") {
    const mine = ctx.myTeam ? await db.rosterSpot.findMany({ where: { teamId: ctx.myTeam.id }, select: { playerId: true, player: { select: { team: true } } } }) : [];
    if (f.scope === "mine") and.push({ players: { some: { playerId: { in: mine.map((m) => m.playerId) } } } });
    else {
      myTeams = [...new Set(mine.map((m) => m.player.team).filter((t): t is string => !!t))];
      and.push({ OR: [{ team: { in: myTeams } }, { players: { some: { player: { team: { in: myTeams } } } } }] });
    }
  }
  // positions the league can roster (e.g. no defensive-player notes unless IDP is enabled); team/league stories always show
  if (f.pos !== "ALL") and.push({ players: { some: { player: { position: { in: rawPositionsFor(f.pos, ctx.settings) } } } } });
  else and.push({ OR: [{ players: { none: {} } }, { players: { some: { player: { position: { in: rawPositionsFor("ALL", ctx.settings) } } } } }] });
  if (f.nfl) and.push({ OR: [{ team: f.nfl }, { players: { some: { player: { team: f.nfl } } } }] });
  if (f.category) and.push({ category: f.category });
  const where: Prisma.NewsItemWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    db.newsItem.count({ where }),
    db.newsItem.findMany({ where, orderBy: { publishedAt: "desc" }, skip: (f.page - 1) * NEWS_PER_PAGE, take: NEWS_PER_PAGE, select: ITEM_SELECT }),
  ]);
  return { entries: await decorateNews(ctx, rows), total, pages: Math.max(1, Math.ceil(total / NEWS_PER_PAGE)), myTeams };
}

/** All news linked to one player (profile News tab / overview). Team defenses also get their NFL team's news. */
export async function playerNews(ctx: LeagueContext, playerId: string, take: number, skip = 0, opts: { teamNews?: string | null } = {}) {
  const linked: Prisma.NewsItemWhereInput = { players: { some: { playerId } } };
  const where: Prisma.NewsItemWhereInput = opts.teamNews ? { OR: [linked, { team: opts.teamNews }] } : linked;
  const [total, rows] = await Promise.all([
    db.newsItem.count({ where }),
    db.newsItem.findMany({ where, orderBy: { publishedAt: "desc" }, take, skip, select: ITEM_SELECT }),
  ]);
  return { total, entries: await decorateNews(ctx, rows) };
}
