// ESPN public scoreboard: NFL schedule, live game state and betting lines (spread / over-under / moneyline).
import { SeasonType } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchJson } from "@/lib/sync/http";
import { fromEspnAbbr } from "@/lib/nfl/teams";

type EspnCompetitor = { homeAway: "home" | "away"; score?: string; team: { abbreviation: string } };
type EspnEvent = {
  id: string;
  date: string;
  status: { period?: number; displayClock?: string; type: { state: string; detail?: string; shortDetail?: string; completed?: boolean } };
  competitions: {
    venue?: { fullName?: string };
    broadcast?: string;
    broadcasts?: { names?: string[] }[];
    competitors: EspnCompetitor[];
    situation?: { possession?: string; isRedZone?: boolean };
    odds?: {
      details?: string;
      overUnder?: number;
      spread?: number;
      homeTeamOdds?: { moneyLine?: number };
      awayTeamOdds?: { moneyLine?: number };
      moneyline?: { home?: { close?: { odds?: string } }; away?: { close?: { odds?: string } } };
    }[];
  }[];
};

type Scoreboard = { events: EspnEvent[] };

function espnSeasonType(t: SeasonType) {
  return t === "PRE" ? 1 : t === "POST" ? 3 : 2;
}

function parseMoneyline(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^[+-]?\d+$/.test(v)) return Number(v);
  return null;
}

/** Fetch one week of games and upsert them. Returns the parsed games. */
export async function syncWeekGames(season: number, week: number, seasonType: SeasonType = "REG") {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=${espnSeasonType(seasonType)}&dates=${season}`;
  const sb = await fetchJson<Scoreboard>(url);
  const games = [];
  for (const e of sb.events ?? []) {
    const c = e.competitions?.[0];
    if (!c) continue;
    const home = c.competitors.find((x) => x.homeAway === "home");
    const away = c.competitors.find((x) => x.homeAway === "away");
    if (!home || !away) continue;
    const odds = c.odds?.[0];
    const homeTeamId = home.team.abbreviation;
    const data = {
      season,
      week,
      seasonType,
      homeTeam: fromEspnAbbr(home.team.abbreviation),
      awayTeam: fromEspnAbbr(away.team.abbreviation),
      startTime: new Date(e.date),
      state: e.status?.type?.state ?? "pre",
      statusDetail: e.status?.type?.shortDetail ?? e.status?.type?.detail ?? null,
      homeScore: Number(home.score ?? 0) || 0,
      awayScore: Number(away.score ?? 0) || 0,
      period: e.status?.period ?? null,
      clock: e.status?.displayClock ?? null,
      possession: c.situation?.possession ?? null,
      redZone: !!c.situation?.isRedZone,
      spread: typeof odds?.spread === "number" ? odds.spread : null,
      overUnder: typeof odds?.overUnder === "number" ? odds.overUnder : null,
      oddsDetails: odds?.details ?? null,
      homeMoneyline: parseMoneyline(odds?.homeTeamOdds?.moneyLine ?? odds?.moneyline?.home?.close?.odds),
      awayMoneyline: parseMoneyline(odds?.awayTeamOdds?.moneyLine ?? odds?.moneyline?.away?.close?.odds),
      venue: c.venue?.fullName ?? null,
      broadcast: c.broadcast ?? c.broadcasts?.[0]?.names?.[0] ?? null,
    };
    void homeTeamId;
    // Keep previously known odds when ESPN drops them after kickoff
    const existing = await db.nflGame.findUnique({ where: { id: e.id } });
    const merged = existing
      ? {
          ...data,
          spread: data.spread ?? existing.spread,
          overUnder: data.overUnder ?? existing.overUnder,
          oddsDetails: data.oddsDetails ?? existing.oddsDetails,
          homeMoneyline: data.homeMoneyline ?? existing.homeMoneyline,
          awayMoneyline: data.awayMoneyline ?? existing.awayMoneyline,
        }
      : data;
    const g = await db.nflGame.upsert({ where: { id: e.id }, create: { id: e.id, ...merged }, update: merged });
    games.push(g);
  }
  return games;
}

/** Full season schedule (regular season weeks 1-18). */
export async function syncSeasonSchedule(season: number) {
  let n = 0;
  for (let w = 1; w <= 18; w++) n += (await syncWeekGames(season, w, "REG")).length;
  return n;
}
