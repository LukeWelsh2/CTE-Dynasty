// Shared live-scoring pipeline: stat snapshots in → scoring events, matchup refresh, live events,
// win-probability history and touchdown alerts out. Used by the real poller and the simulation.
import type { Matchup, NflGame } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";
import type { PlayerPointsEvent, ScoreUpdateEvent, ScoringPlayEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { calcPoints, TOUCHDOWN_KEYS, type StatMap } from "@/lib/scoring/engine";
import type { LeagueSettings } from "@/lib/settings/schema";
import {
  BIG_PLAY_COUNT_KEYS,
  describePlay,
  detectPlays,
  diffStatMaps,
  matchupChanged,
  newEventCount,
  pairPassingTouchdowns,
  playPoints,
  shouldRecordWinProb,
  type DetectedPlay,
} from "@/lib/live/diff";
import { sendPendingTouchdownAlerts } from "@/lib/live/alerts";
import { possessionTeam } from "@/lib/live/format";
import type { GameLite, NflGamesEvent } from "@/lib/live/types";

export interface PipelineLeague {
  id: string;
  settings: LeagueSettings;
}

export interface PipelineInput {
  season: number;
  week: number;
  previous: Map<string, StatMap>;
  next: Map<string, StatMap>;
  leagues: PipelineLeague[];
  /** NFL games after this update (published as "nfl.games" when they changed) */
  games?: NflGame[];
  gamesChanged?: boolean;
  simulated?: boolean;
  sendAlerts?: boolean;
  /** minimum spacing of WinProbPoint rows per matchup */
  wpMinIntervalMs?: number;
  now?: Date;
}

export interface PipelineResult {
  changedPlayers: number;
  plays: number;
  events: number;
  matchupsChanged: number;
  alerts: number;
}

const COUNT_KEYS = new Set<string>([...TOUCHDOWN_KEYS, ...BIG_PLAY_COUNT_KEYS.map((k) => k.key)]);

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Cumulative value of a counting play stat (TDs, INTs, 50+ FGs ...) */
function cumulative(stats: StatMap, key: string): number {
  if (key === "fgm_50p") return Math.max(num(stats.fgm_50p), num(stats.fgm_50_59) + num(stats.fgm_60p));
  return num(stats[key]);
}

export function toGameLite(g: NflGame): GameLite {
  return {
    id: g.id,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    state: g.state,
    statusDetail: g.statusDetail,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    period: g.period,
    clock: g.clock,
    possession: possessionTeam(g.possession, g),
    redZone: g.redZone,
    startTime: g.startTime.toISOString(),
    spread: g.spread,
    overUnder: g.overUnder,
    oddsDetails: g.oddsDetails,
    broadcast: g.broadcast,
  };
}

export async function processWeekUpdate(input: PipelineInput): Promise<PipelineResult> {
  const { season, week, previous, next } = input;
  const now = input.now ?? new Date();
  const deltas = diffStatMaps(previous, next);
  const changedIds = [...deltas.keys()];
  const result: PipelineResult = { changedPlayers: changedIds.length, plays: 0, events: 0, matchupsChanged: 0, alerts: 0 };

  // ── detect plays across the whole feed (pairing QB ↔ receiver needs every player)
  const rawPlays = new Map<string, DetectedPlay[]>();
  for (const pid of changedIds) {
    const plays = detectPlays(pid, previous.get(pid), next.get(pid)!);
    if (plays.length) rawPlays.set(pid, plays);
  }
  const playPlayers = rawPlays.size
    ? await db.player.findMany({ where: { id: { in: [...rawPlays.keys()] } }, select: { id: true, fullName: true, position: true, team: true } })
    : [];
  const playerInfo = new Map(playPlayers.map((p) => [p.id, p]));
  const flat = [...rawPlays.values()].flat().map((p) => Object.assign(p, { nflTeam: playerInfo.get(p.playerId)?.team ?? null }));
  pairPassingTouchdowns(flat);
  const names = new Map(playPlayers.map((p) => [p.id, { name: p.fullName, position: p.position }]));
  result.plays = flat.length;

  const gamesPayload: NflGamesEvent | null = input.games && input.gamesChanged ? { season, week, games: input.games.map(toGameLite) } : null;
  const gameRows = input.games ?? (rawPlays.size ? await db.nflGame.findMany({ where: { season, week, seasonType: "REG" } }) : []);
  const gameIdByTeam = new Map<string, string>();
  for (const g of gameRows) {
    gameIdByTeam.set(g.homeTeam, g.id);
    gameIdByTeam.set(g.awayTeam, g.id);
  }

  for (const league of input.leagues) {
    const topic = topics.league(league.id);
    if (gamesPayload) publish(topic, "nfl.games", gamesPayload);

    const [before, rostered] = await Promise.all([
      db.matchup.findMany({ where: { leagueId: league.id, season, week } }),
      changedIds.length
        ? db.rosterSpot.findMany({
            where: { leagueId: league.id, playerId: { in: changedIds } },
            select: { playerId: true, teamId: true, player: { select: { id: true, fullName: true, position: true, team: true } } },
          })
        : Promise.resolve([]),
    ]);

    // ── scoring events (idempotent against what the DB already recorded)
    const withPlays = rostered.filter((r) => rawPlays.has(r.playerId));
    const created: { id: string; playerId: string; statKey: string; points: number; description: string; createdAt: Date }[] = [];
    if (withPlays.length) {
      const existing = await db.scoringEvent.findMany({
        where: { leagueId: league.id, season, week, playerId: { in: withPlays.map((r) => r.playerId) } },
        select: { playerId: true, statKey: true, delta: true },
      });
      const sums = new Map<string, number>();
      const seenYards = new Set<string>();
      for (const e of existing) {
        const k = `${e.playerId}:${e.statKey}`;
        sums.set(k, (sums.get(k) ?? 0) + e.delta);
        seenYards.add(`${k}:${e.delta}`);
      }
      const rows: { leagueId: string; playerId: string; season: number; week: number; statKey: string; delta: number; points: number; description: string; gameId: string | null; createdAt: Date }[] = [];
      for (const r of withPlays) {
        const plays = rawPlays.get(r.playerId)!;
        const nextStats = next.get(r.playerId)!;
        const pts = playPoints(previous.get(r.playerId), nextStats, plays, r.player.position, league.settings.scoring);
        plays.forEach((play, i) => {
          const k = `${r.playerId}:${play.statKey}`;
          let delta = play.delta;
          if (COUNT_KEYS.has(play.statKey)) {
            const fresh = newEventCount(cumulative(nextStats, play.statKey), sums.get(k) ?? 0);
            if (fresh <= 0) return;
            delta = Math.min(delta, fresh);
          } else if (seenYards.has(`${k}:${play.delta}`)) return;
          rows.push({
            leagueId: league.id,
            playerId: r.playerId,
            season,
            week,
            statKey: play.statKey,
            delta,
            points: pts[i] ?? 0,
            description: describePlay(delta === play.delta ? play : { ...play, delta }, names),
            gameId: r.player.team ? gameIdByTeam.get(r.player.team) ?? null : null,
            createdAt: now, // same clock as the win-probability point of this update
          });
        });
      }
      if (rows.length) {
        const ins = await db.scoringEvent.createManyAndReturn({ data: rows, select: { id: true, playerId: true, statKey: true, points: true, description: true, createdAt: true } });
        for (const e of ins) created.push({ ...e, description: e.description ?? "" });
        result.events += ins.length;
      }
    }

    // ── recompute matchups
    const refreshed = await refreshWeekMatchups(league.id, season, week, league.settings);
    const beforeById = new Map(before.map((m) => [m.id, m]));
    let statusChanged = false;
    for (const { matchup: m } of refreshed) {
      const b = beforeById.get(m.id);
      if (b && b.status !== m.status) statusChanged = true;
      if (!b || matchupChanged(b, m)) {
        result.matchupsChanged++;
        const evt: ScoreUpdateEvent = {
          matchupId: m.id,
          week: m.week,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          homeProjected: m.homeProjected,
          awayProjected: m.awayProjected,
          homeWinProb: m.homeWinProb,
          status: m.status,
        };
        publish(topic, "score.update", evt);
      }
    }

    // ── per-player point changes
    const descByPlayer = new Map<string, string>();
    for (const e of created) if (!descByPlayer.has(e.playerId)) descByPlayer.set(e.playerId, e.description);
    for (const r of rostered) {
      const scoring = league.settings.scoring;
      const after = calcPoints(next.get(r.playerId) ?? {}, r.player.position, scoring).points;
      const beforePts = calcPoints(previous.get(r.playerId) ?? {}, r.player.position, scoring).points;
      const delta = Math.round((after - beforePts) * 100) / 100;
      if (Math.abs(delta) < 0.005) continue;
      const evt: PlayerPointsEvent = { playerId: r.playerId, week, points: after, delta, description: descByPlayer.get(r.playerId), teamIds: [r.teamId] };
      publish(topic, "player.points", evt);
    }

    // ── scoring plays ticker
    const teamByPlayer = new Map(rostered.map((r) => [r.playerId, r]));
    for (const e of created) {
      const r = teamByPlayer.get(e.playerId);
      const evt: ScoringPlayEvent = {
        id: e.id,
        week,
        playerId: e.playerId,
        playerName: r?.player.fullName ?? "",
        position: r?.player.position ?? "",
        nflTeam: r?.player.team ?? null,
        statKey: e.statKey,
        points: e.points,
        description: e.description,
        fantasyTeamId: r?.teamId ?? null,
        at: e.createdAt.toISOString(),
      };
      publish(topic, "scoring.play", evt);
    }

    // ── win probability history
    await recordWinProbPoints(refreshed.map((x) => x.matchup), beforeById, now, input.wpMinIntervalMs ?? 60_000);

    // ── touchdown alerts
    result.alerts += await sendPendingTouchdownAlerts({
      leagueId: league.id,
      settings: league.settings,
      season,
      week,
      matchups: refreshed.map((x) => x.matchup),
      send: input.sendAlerts !== false,
      simulated: input.simulated,
      now,
    });

    if (statusChanged) {
      const evt: ScoresRefreshEvent = { week };
      publish(topic, "scores.refresh", evt);
    }
  }
  return result;
}

async function recordWinProbPoints(matchups: Matchup[], before: Map<string, Matchup>, now: Date, minIntervalMs: number) {
  const live = matchups.filter((m) => m.status !== "UPCOMING" && m.homeTeamId && m.awayTeamId);
  if (!live.length) return;
  const last = await db.winProbPoint.findMany({
    where: { matchupId: { in: live.map((m) => m.id) } },
    orderBy: [{ matchupId: "asc" }, { at: "desc" }],
    distinct: ["matchupId"],
  });
  const lastBy = new Map(last.map((p) => [p.matchupId, p]));
  const rows: { matchupId: string; homeWinProb: number; homeScore: number; awayScore: number; at: Date }[] = [];
  for (const m of live) {
    const prev = lastBy.get(m.id) ?? null;
    const b = before.get(m.id);
    if (!prev && b) {
      // baseline: where the matchup stood before this update (pre-game odds on the first live tick)
      rows.push({ matchupId: m.id, homeWinProb: b.homeWinProb, homeScore: b.homeScore, awayScore: b.awayScore, at: new Date(now.getTime() - 1000) });
    }
    const justFinal = m.status === "FINAL" && b?.status !== "FINAL";
    const ref = prev ?? (b ? { at: new Date(now.getTime() - 1000), homeWinProb: b.homeWinProb, homeScore: b.homeScore, awayScore: b.awayScore } : null);
    if (justFinal || shouldRecordWinProb(ref, m, now, prev ? minIntervalMs : 0)) {
      rows.push({ matchupId: m.id, homeWinProb: m.homeWinProb, homeScore: m.homeScore, awayScore: m.awayScore, at: now });
    }
  }
  if (rows.length) await db.winProbPoint.createMany({ data: rows });
}
