// Read models for the recap pages: the archive (every completed week, generated or not) and a single
// week's recap (generated on demand when the week is complete but has no recap yet).
import type { WeeklyRecap } from "@prisma/client";
import { db } from "@/lib/db";
import { completedWeeks } from "./compute";
import { buildWeeklyRecap, RecapError } from "./generate";
import { isRecapContent, type RecapAward, type RecapContent, type RecapTeam } from "./types";

export interface ArchiveCard {
  week: number;
  status: "READY" | "PENDING";
  recapId: string | null;
  headline: string | null;
  intro: string | null;
  weekLabel: string;
  generatedAt: string | null;
  sentAt: string | null;
  awards: RecapAward[];
  /** high scorer of the week (from matchups, works for pending weeks too) */
  high: { teamId: string; score: number } | null;
  matchupOfWeek: { reasonLabel: string; homeId: string; awayId: string; homeScore: number; awayScore: number; winnerTeamId: string | null } | null;
  teams: Record<string, RecapTeam>;
}

export interface RecapArchive {
  season: number;
  seasons: number[];
  cards: ArchiveCard[];
  /** a week that has started but isn't final yet */
  inProgressWeek: number | null;
  decimals: number;
}

/** Every completed week of a season (newest first), with its stored recap summary when one exists. */
export async function loadRecapArchive(leagueId: string, season: number): Promise<RecapArchive> {
  const [recaps, matchups, recapSeasons, matchupSeasons, teams] = await Promise.all([
    db.weeklyRecap.findMany({ where: { leagueId, season }, orderBy: { week: "desc" } }),
    db.matchup.findMany({ where: { leagueId, season }, select: { week: true, status: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true } }),
    db.weeklyRecap.findMany({ where: { leagueId }, distinct: ["season"], select: { season: true } }),
    db.matchup.findMany({ where: { leagueId, status: "FINAL" }, distinct: ["season"], select: { season: true } }),
    db.team.findMany({ where: { leagueId }, select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } }),
  ]);
  const liveTeams: Record<string, RecapTeam> = Object.fromEntries(
    teams.map((t) => [t.id, { id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, owner: null, record: null, rank: null }]),
  );
  const done = completedWeeks(matchups);
  const byWeek = new Map<number, WeeklyRecap>(recaps.map((r) => [r.week, r]));
  const weeks = [...new Set([...done, ...recaps.map((r) => r.week)])].sort((a, b) => b - a);
  let decimals = 2;
  const cards: ArchiveCard[] = weeks.map((week) => {
    const r = byWeek.get(week);
    const content = r && isRecapContent(r.content) ? (r.content as unknown as RecapContent) : null;
    if (content) decimals = content.decimals;
    const wm = matchups.filter((m) => m.week === week && m.homeTeamId && m.awayTeamId);
    const sides = wm.flatMap((m) => [
      { teamId: m.homeTeamId!, score: m.homeScore },
      { teamId: m.awayTeamId!, score: m.awayScore },
    ]);
    const high = sides.length ? sides.reduce((a, b) => (b.score > a.score ? b : a)) : null;
    const motwM = content?.matchupOfWeek ? content.matchups.find((m) => m.id === content.matchupOfWeek!.matchupId) : null;
    return {
      week,
      status: content ? "READY" : "PENDING",
      recapId: r?.id ?? null,
      headline: content?.headline ?? r?.title ?? null,
      intro: content?.intro ?? null,
      weekLabel: content?.weekLabel ?? `Week ${week}`,
      generatedAt: content?.generatedAt ?? r?.createdAt.toISOString() ?? null,
      sentAt: r?.sentAt?.toISOString() ?? null,
      awards: content?.awards ?? [],
      high,
      matchupOfWeek:
        content?.matchupOfWeek && motwM
          ? { reasonLabel: content.matchupOfWeek.reasonLabel, homeId: motwM.home.teamId, awayId: motwM.away.teamId, homeScore: motwM.home.score, awayScore: motwM.away.score, winnerTeamId: motwM.winnerTeamId }
          : null,
      teams: { ...liveTeams, ...(content?.teams ?? {}) },
    };
  });
  const weeksWithGames = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b);
  const inProgressWeek = weeksWithGames.find((w) => !done.includes(w) && matchups.some((m) => m.week === w && m.status !== "UPCOMING")) ?? null;
  const seasons = [...new Set([season, ...recapSeasons.map((s) => s.season), ...matchupSeasons.map((s) => s.season)])].sort((a, b) => b - a);
  return { season, seasons, cards, inProgressWeek, decimals };
}

export type RecapView =
  | { state: "READY"; recap: { id: string; sentAt: Date | null; createdAt: Date }; content: RecapContent; generatedNow: boolean; weeks: number[] }
  | { state: "NOT_FINAL"; started: boolean; weeks: number[] }
  | { state: "NO_MATCHUPS"; weeks: number[] }
  | { state: "ERROR"; message: string; weeks: number[] };

/** One week's recap for the web page. Builds it on demand when the week is complete and no recap exists. */
export async function loadRecapView(leagueId: string, season: number, week: number): Promise<RecapView> {
  const [recap, matchups] = await Promise.all([
    db.weeklyRecap.findUnique({ where: { leagueId_season_week: { leagueId, season, week } } }),
    db.matchup.findMany({ where: { leagueId, season }, select: { week: true, status: true } }),
  ]);
  const weeks = completedWeeks(matchups).sort((a, b) => a - b);
  if (recap && isRecapContent(recap.content)) {
    return { state: "READY", recap: { id: recap.id, sentAt: recap.sentAt, createdAt: recap.createdAt }, content: recap.content as unknown as RecapContent, generatedNow: false, weeks };
  }
  const wm = matchups.filter((m) => m.week === week);
  if (!wm.length) return { state: "NO_MATCHUPS", weeks };
  if (wm.some((m) => m.status !== "FINAL")) return { state: "NOT_FINAL", started: wm.some((m) => m.status !== "UPCOMING"), weeks };
  try {
    const built = await buildWeeklyRecap(leagueId, season, week);
    const row = await db.weeklyRecap.findUniqueOrThrow({ where: { id: built.id }, select: { id: true, sentAt: true, createdAt: true } });
    return { state: "READY", recap: row, content: built.content, generatedNow: true, weeks };
  } catch (e) {
    if (e instanceof RecapError) return { state: "ERROR", message: e.message, weeks };
    throw e;
  }
}

/** Latest recap summary (for other modules, e.g. the league home page). */
export async function latestRecapSummary(leagueId: string, season: number): Promise<{ week: number; headline: string; sentAt: Date | null; url: string } | null> {
  const r = await db.weeklyRecap.findFirst({ where: { leagueId, season }, orderBy: { week: "desc" }, select: { week: true, title: true, sentAt: true } });
  return r ? { week: r.week, headline: r.title, sentAt: r.sentAt, url: `/recaps/${r.week}` } : null;
}
