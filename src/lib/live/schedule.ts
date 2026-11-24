// Season schedule data (team view, league view, upcoming opponents, key dates). Server only.
import "server-only";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { winProbability, type TeamWeekScore } from "@/lib/scoreboard";
import { playoffGameOdds, playoffGamesFor, weekBoard } from "@/lib/live/board";
import type { PlayoffGameContext } from "@/lib/playoffs/bracket";
import { leagueKeyDates, matchupRoundLabel, playoffWeekInfo, regularSeasonLastWeek } from "@/lib/live/format";
import { standingsMap, teamRef } from "@/lib/live/queries";
import type { TeamRef } from "@/lib/live/types";

export interface ScheduleSide {
  team: TeamRef;
  score: number;
  projected: number | null;
  seed: number | null;
  pfRank: number | null;
}

export interface ScheduleGame {
  id: string;
  week: number;
  status: string;
  label: string | null;
  isPlayoff: boolean;
  /** the game's winner (a week of a multi-week playoff game carries the whole game's, once it is decided) */
  winnerTeamId: string | null;
  /**
   * home win probability (live / final from the stored row, pre-game from projections when available; a week of a
   * multi-week playoff game: the chance to win the whole game)
   */
  homeWinProb: number | null;
  home: ScheduleSide | null;
  away: ScheduleSide | null;
  /** a week of a multi-week playoff game: its combined score and week-of-game */
  game: PlayoffGameContext | null;
}

export interface WeekInfo {
  week: number;
  start: string | null;
  end: string | null;
  playoffLabel: string | null;
  isRegular: boolean;
}

const teamInclude = { owner: { select: { id: true, name: true } }, member: { select: { user: { select: { id: true, name: true } } } } } as const;

export async function loadSchedule(ctx: LeagueContext) {
  const { league, season, settings } = ctx;
  const [rows, standings, weekDates] = await Promise.all([
    db.matchup.findMany({
      where: { leagueId: league.id, season },
      include: { homeTeam: { include: teamInclude }, awayTeam: { include: teamInclude } },
      orderBy: [{ week: "asc" }, { isConsolation: "asc" }, { id: "asc" }],
    }),
    standingsMap(ctx),
    db.nflGame.groupBy({ by: ["week"], where: { season, seasonType: "REG" }, _min: { startTime: true }, _max: { startTime: true } }),
  ]);

  // points-for rank (1 = most points)
  const pfRank = new Map([...standings.values()].sort((a, b) => b.pointsFor - a.pointsFor).map((s, i) => [s.team.id, i + 1]));

  // pre-game projections for the current and next week (one batched board per week)
  const projWeeks = [ctx.week, ctx.week + 1].filter((w) => w <= 18 && rows.some((m) => m.week === w && m.status !== "FINAL"));
  const boards = new Map<number, Map<string, TeamWeekScore>>();
  for (const w of projWeeks) {
    const teamIds = rows.filter((m) => m.week === w).flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x);
    boards.set(w, (await weekBoard(league.id, season, w, settings, { teamIds })).teams);
  }

  // weeks of multi-week playoff games: combined score + whole-game odds
  const contexts = await playoffGamesFor(league.id, season, rows);
  const gameOdds = contexts.size ? await playoffGameOdds(league.id, season, settings, rows.filter((m) => contexts.has(m.id)), contexts, boards) : new Map<string, number>();

  const games: ScheduleGame[] = rows.map((m) => {
    const board = boards.get(m.week);
    const hs = m.homeTeamId ? board?.get(m.homeTeamId) : undefined;
    const as = m.awayTeamId ? board?.get(m.awayTeamId) : undefined;
    const upcoming = m.status === "UPCOMING";
    const side = (t: (typeof m)["homeTeam"], score: number, stored: number, b: TeamWeekScore | undefined, seed: number | null): ScheduleSide | null =>
      t
        ? {
            team: teamRef(t, standings),
            score,
            projected: upcoming ? (b ? b.projected : null) : m.status === "LIVE" ? stored : null,
            seed,
            pfRank: pfRank.get(t.id) ?? null,
          }
        : null;
    const homeWinProb =
      gameOdds.get(m.id) ?? (upcoming ? (hs && as ? winProbability({ liveProjected: hs.projected, variance: hs.variance }, { liveProjected: as.projected, variance: as.variance }) : null) : m.homeWinProb);
    return {
      id: m.id,
      week: m.week,
      status: m.status,
      label: matchupRoundLabel(m, settings),
      isPlayoff: m.isPlayoff,
      winnerTeamId: m.winnerTeamId,
      homeWinProb,
      home: side(m.homeTeam, m.homeScore, m.homeProjected, hs, m.homeSeed),
      away: side(m.awayTeam, m.awayScore, m.awayProjected, as, m.awaySeed),
      game: contexts.get(m.id) ?? null,
    };
  });

  const firstWeek = settings.general.firstWeek;
  const lastWeek = Math.max(lastFantasyWeek(settings), ...rows.map((m) => m.week));
  const regEnd = regularSeasonLastWeek(settings);
  const dateBy = new Map(weekDates.map((d) => [d.week, d]));
  const weeks: WeekInfo[] = [];
  for (let w = firstWeek; w <= lastWeek; w++) {
    const d = dateBy.get(w);
    weeks.push({
      week: w,
      start: d?._min.startTime?.toISOString() ?? null,
      end: d?._max.startTime?.toISOString() ?? null,
      playoffLabel: playoffWeekInfo(w, settings)?.label ?? null,
      isRegular: w <= regEnd,
    });
  }

  const teams = [...standings.values()].map((s) => s.team).sort((a, b) => a.name.localeCompare(b.name));
  // deadlines fall at the END of their week (last kickoff); everything else starts with the week's first game
  const endOfWeek = new Set(["trade", "regend", "taxi"]);
  const keyDates = leagueKeyDates(settings).map((k) => {
    const d = dateBy.get(k.week);
    const at = endOfWeek.has(k.key) ? d?._max.startTime : d?._min.startTime;
    return { ...k, start: at?.toISOString() ?? null };
  });
  return { games, weeks, teams: teams.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev })), standings, pfRank, keyDates };
}
