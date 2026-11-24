// Players search: filters every NFL player, scores them with league settings and sorts server-side.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { searchName } from "@/lib/utils";
import { availabilityFor, loadFantasyContext, type FantasyContext } from "@/lib/players/context";
import type { PlayerFilters } from "@/lib/players/filters";
import { fmtDateTime, fmtWeekday } from "@/lib/players/format";
import { latestInjuryReports } from "@/lib/players/injury-data";
import {
  byeWeeksByTeam,
  compareValues,
  effectiveInjury,
  gameResult,
  opponentLabel,
  rawPositionsFor,
  restOfSeasonFrom,
  statColumnsFor,
  type EffectiveInjury,
} from "@/lib/players/logic";
import { getLeagueIndexes, seasonAverage, timeframePoints, timeframeStats, type PlayerIndexes, type TimeframeWindow } from "@/lib/players/stats-index";

export const PER_PAGE = 50;

export interface RowGame {
  label: string;
  opp: string;
  home: boolean;
  startTime: string;
  state: string;
  statusDetail: string | null;
  result: string | null;
}

export interface PlayerRow {
  rank: number;
  player: { id: string; fullName: string; position: string; team: string | null; number: number | null; age: number | null; yearsExp: number | null };
  injury: EffectiveInjury;
  news: { headline: string; publishedAt: string } | null;
  owner: { teamId: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; isMine: boolean } | null;
  contract: { salary: number; years: number; status: string } | null;
  waiver: { processAt: string | null; processAtLabel: string | null; weekday: string | null; reason: string } | null;
  action: "add" | "claim" | "blocked" | "drop" | "trade" | null;
  blockedReason: string | null;
  pendingClaim: { id: string; bid: number } | null;
  watched: boolean;
  bye: number | null;
  game: RowGame | null;
  pts: number | null;
  avg: number | null;
  proj: number | null;
  stats: Record<string, number | null>;
}

export interface PlayerSearchResult {
  rows: PlayerRow[];
  total: number;
  page: number;
  pages: number;
  columns: string[];
  window: TimeframeWindow;
  teams: { id: string; name: string; abbrev: string }[];
  maxWeek: number;
}

/** Every-request timeframe window for the league */
export function timeframeWindow(ctx: LeagueContext, f: Pick<PlayerFilters, "tf" | "wk">, games: FantasyContext["games"]): TimeframeWindow {
  const lastWeek = lastFantasyWeek(ctx.settings);
  const anyRemaining = [...games.values()].some((g) => g.state === "pre");
  const specific = Math.min(ctx.week, Math.max(1, f.wk ?? ctx.week));
  return { tf: f.tf, week: ctx.week, specificWeek: specific, rosFrom: restOfSeasonFrom(ctx.week, anyRemaining, lastWeek), rosTo: lastWeek };
}

export async function searchPlayers(ctx: LeagueContext, f: PlayerFilters): Promise<PlayerSearchResult> {
  const leagueId = ctx.league.id;
  const fc = await loadFantasyContext(ctx);
  const w = timeframeWindow(ctx, f, fc.games);

  // ── candidate set (DB filters)
  const and: Prisma.PlayerWhereInput[] = [
    { position: { in: rawPositionsFor(f.pos, ctx.settings) } },
    { OR: [{ active: true }, { rosterSpots: { some: { leagueId } } }] },
  ];
  if (f.nfl === "FA") and.push({ team: null });
  else if (f.nfl) and.push({ team: f.nfl });
  // Sleeper keeps many retired players "active" without a team: unless searched by name or explicitly filtered,
  // only show teamless players who played this season or are rostered in the league.
  if (!f.q && f.nfl !== "FA" && f.status !== "watch")
    and.push({ OR: [{ team: { not: null } }, { rosterSpots: { some: { leagueId } } }, { weekStats: { some: { season: ctx.season, seasonType: "REG" } } }] });
  if (f.q) {
    const sn = searchName(f.q);
    if (sn) and.push({ OR: [{ searchName: { contains: sn } }, { fullName: { contains: f.q, mode: "insensitive" } }] });
  }
  if (f.rookies) and.push({ OR: [{ rookieYear: ctx.season }, { yearsExp: 0 }] });
  switch (f.status) {
    case "available":
    case "fa":
    case "waivers":
      and.push({ rosterSpots: { none: { leagueId } } });
      break;
    case "rostered":
      and.push({ rosterSpots: { some: { leagueId } } });
      break;
    case "mine":
      and.push({ rosterSpots: { some: { leagueId, teamId: ctx.myTeam?.id ?? "__none__" } } });
      break;
    case "team":
      and.push({ rosterSpots: { some: { leagueId, teamId: f.owner ?? "__none__" } } });
      break;
    case "watch":
      and.push({ id: { in: [...fc.watch] } });
      break;
  }

  const [candidates, latest, idx, schedule] = await Promise.all([
    db.player.findMany({
      where: { AND: and },
      select: {
        id: true,
        fullName: true,
        lastName: true,
        position: true,
        team: true,
        number: true,
        age: true,
        yearsExp: true,
        searchRank: true,
        injuryStatus: true,
        injuryBodyPart: true,
        injuryNotes: true,
      },
    }),
    latestInjuryReports(),
    getLeagueIndexes(leagueId, ctx.season, ctx.settings, ctx.week),
    db.nflGame.findMany({ where: { season: ctx.season, seasonType: "REG" }, select: { week: true, homeTeam: true, awayTeam: true } }),
  ]);
  const byes = byeWeeksByTeam(schedule);

  // ── derived values + in-memory filters
  type Cand = (typeof candidates)[number] & { injury: EffectiveInjury; avail: ReturnType<typeof availabilityFor> };
  let list: Cand[] = candidates.map((c) => ({ ...c, injury: effectiveInjury(c, latest.get(c.id), fc.now), avail: availabilityFor(ctx, fc, c) }));
  if (f.status === "fa") list = list.filter((c) => !c.avail.onWaivers);
  if (f.status === "waivers") list = list.filter((c) => c.avail.onWaivers);
  if (f.health === "healthy") list = list.filter((c) => !c.injury.status);
  if (f.health === "injured") list = list.filter((c) => !!c.injury.status);

  // ── sort
  const sortVal = sortValueFn(f.sort, idx, w, ctx.week, byes, fc.games);
  list.sort((a, b) => {
    const c = compareValues(sortVal(a), sortVal(b), f.dir);
    if (c) return c;
    return compareValues(a.searchRank ?? 99999, b.searchRank ?? 99999, "asc") || a.fullName.localeCompare(b.fullName);
  });

  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(f.page, pages);
  const slice = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const columns = statColumnsFor(f.pos);
  const tz = ctx.settings.general.timezone;

  // ── per-row details for the visible page only
  const since = new Date(fc.now.getTime() - 48 * 3600_000);
  const news = await db.newsPlayer.findMany({
    where: { playerId: { in: slice.map((s) => s.id) }, news: { publishedAt: { gte: since } } },
    select: { playerId: true, news: { select: { headline: true, publishedAt: true } } },
  });
  const newsBy = new Map<string, { headline: string; publishedAt: Date }>();
  for (const n of news) {
    const cur = newsBy.get(n.playerId);
    if (!cur || cur.publishedAt < n.news.publishedAt) newsBy.set(n.playerId, n.news);
  }

  const rows: PlayerRow[] = slice.map((c, i) => {
    const a = c.avail;
    const spot = a.spot;
    const game = c.team ? fc.games.get(c.team) : undefined;
    const stats = timeframeStats(idx, c.id, w);
    const bye = c.team ? (byes.get(c.team)?.[0] ?? null) : null;
    let action: PlayerRow["action"] = null;
    if (ctx.myTeam) {
      if (spot) action = a.isMine ? "drop" : ctx.settings.trades.enabled ? "trade" : null;
      else action = a.mode?.kind ?? null;
    }
    const claim = fc.myClaims.get(c.id);
    return {
      rank: (page - 1) * PER_PAGE + i + 1,
      player: { id: c.id, fullName: c.fullName, position: c.position, team: c.team, number: c.number, age: c.age, yearsExp: c.yearsExp },
      injury: c.injury,
      news: newsBy.has(c.id) ? { headline: newsBy.get(c.id)!.headline, publishedAt: newsBy.get(c.id)!.publishedAt.toISOString() } : null,
      owner: spot
        ? {
            teamId: spot.teamId,
            name: spot.team.name,
            abbrev: spot.team.abbrev,
            logoUrl: spot.team.logoUrl,
            primaryColor: spot.team.primaryColor,
            secondaryColor: spot.team.secondaryColor,
            isMine: a.isMine,
          }
        : null,
      contract: spot ? { salary: spot.salary, years: spot.contractYears, status: spot.status } : null,
      waiver:
        !spot && a.onWaivers
          ? {
              processAt: a.processAt?.toISOString() ?? null,
              processAtLabel: a.processAt ? fmtDateTime(a.processAt, tz) : null,
              weekday: a.processAt ? fmtWeekday(a.processAt, tz) : null,
              reason: a.mode?.kind === "claim" || a.mode?.kind === "blocked" ? a.mode.reason : "",
            }
          : null,
      action,
      blockedReason: a.mode?.kind === "blocked" ? a.mode.reason : null,
      pendingClaim: claim ? { id: claim.id, bid: claim.bidAmount } : null,
      watched: fc.watch.has(c.id),
      bye,
      game: game && c.team ? rowGame(c.team, game) : null,
      pts: timeframePoints(idx, c.id, w),
      avg: seasonAverage(idx, c.id, ctx.week),
      proj: idx.points.proj.get(c.id)?.get(ctx.week) ?? null,
      stats: Object.fromEntries(columns.map((k) => [k, stats ? (stats[k] ?? 0) : null])),
    };
  });

  return {
    rows,
    total,
    page,
    pages,
    columns,
    window: w,
    teams: fc.teams.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev })),
    maxWeek: ctx.week,
  };
}

export function rowGame(team: string, game: { homeTeam: string; awayTeam: string; startTime: Date; state: string; statusDetail: string | null; homeScore: number; awayScore: number }): RowGame {
  const o = opponentLabel(team, game);
  return { label: o.label, opp: o.opp, home: o.home, startTime: game.startTime.toISOString(), state: game.state, statusDetail: game.statusDetail, result: gameResult(team, game) };
}

function sortValueFn(
  sort: string,
  idx: PlayerIndexes,
  w: TimeframeWindow,
  week: number,
  byes: Map<string, number[]>,
  games: FantasyContext["games"],
): (c: { id: string; fullName: string; lastName: string; team: string | null; age: number | null; searchRank: number | null; position: string; avail: { spot: { salary: number; team: { abbrev: string } } | null } }) => number | string | null {
  switch (sort) {
    case "rank":
      return (c) => c.searchRank;
    case "name":
      return (c) => `${c.lastName} ${c.fullName}`.toLowerCase();
    case "owner":
      return (c) => c.avail.spot?.team.abbrev ?? null;
    case "salary":
      return (c) => c.avail.spot?.salary ?? null;
    case "age":
      return (c) => c.age;
    case "bye":
      return (c) => (c.team ? (byes.get(c.team)?.[0] ?? null) : null);
    case "opp":
      return (c) => (c.team ? (games.get(c.team)?.startTime.getTime() ?? null) : null);
    case "avg":
      return (c) => seasonAverage(idx, c.id, week);
    case "proj":
      return (c) => idx.points.proj.get(c.id)?.get(week) ?? null;
    case "pts":
      return (c) => timeframePoints(idx, c.id, w);
    default: {
      const key = sort.startsWith("stat:") ? sort.slice(5) : null;
      if (!key) return () => null;
      return (c) => {
        const s = timeframeStats(idx, c.id, w);
        return s ? (s[key] ?? 0) : null;
      };
    }
  }
}
