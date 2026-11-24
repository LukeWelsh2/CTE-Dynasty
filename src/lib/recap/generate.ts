// Weekly recap builder: loads one league week from the database (batched queries), reconstructs each
// team's roster as of its lineup locks, runs the pure recap computations and copywriting, renders the
// email HTML and upserts the WeeklyRecap row. Safe to call from jobs/scripts (no request context).
import type { Matchup, Player, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { getLineup, weekGamesByTeam } from "@/lib/lineup";
import { POSITION_SD, teamWeekScore, winProbability } from "@/lib/scoreboard";
import { computeStandings } from "@/lib/standings";
import { lastFantasyWeek } from "@/lib/league-week";
import { playoffGameContexts, type PlayoffGameContext } from "@/lib/playoffs/bracket";
import {
  analyzeTeamWeek,
  commissionerRosterEvent,
  computeAwards,
  downsample,
  efficiencyBoard,
  gameScores,
  injurySeverity,
  isInjuryConcern,
  lockTimeFor,
  marqueeGames,
  median,
  oddsMovement,
  optimalFlips,
  ownershipAtLock,
  pickMatchupOfWeek,
  pickOddsSnapshots,
  previewWinProb,
  round2,
  sideResults,
  standingsMovement,
  statLine,
  wpFacts,
  type AwardGame,
  type AwardMatchup,
  type MotwCandidate,
  type RosterEvent,
  type SlotStart,
  type TeamWeekAnalysis,
  type WaiverPickup,
} from "./compute";
import { buildHeadline, buildIntro, legBlurb, matchupBlurb, motwCopy, type NarrativeFacts, type ScoreFact } from "./narrative";
import { renderRecapEmail } from "./html";
import {
  CONFIGURABLE_AWARDS,
  RECAP_VERSION,
  isRecapContent,
  type ConfigurableAward,
  type InjuryWatchRow,
  type MatchupKind,
  type PlayerPerf,
  type RecapContent,
  type RecapMatchup,
  type RecapMove,
  type RecapNextWeek,
  type RecapPlayer,
  type RecapPlayoffGame,
  type RecapPlayoffOdds,
  type RecapSide,
  type RecapTeam,
  type RecapTrade,
  type RecapTransactions,
  type TopPerformer,
} from "./types";

/** User-facing build failure (e.g. the week isn't final yet). */
export class RecapError extends Error {}

const DAY = 86_400_000;
const GAME_LENGTH_MS = 4 * 3_600_000;
const WAIVER_HERO_WINDOW_DAYS = 21;
const ADD_TYPES = new Set(["ADD", "WAIVER", "AUCTION", "ROOKIE_DRAFT"]);

export interface BuiltRecap {
  id: string;
  content: RecapContent;
  html: string;
  text: string;
  sentAt: Date | null;
}

function dateLabel(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function isSundayIn(d: Date, tz: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(d) === "Sun";
  } catch {
    return d.getUTCDay() === 0;
  }
}

function matchupKind(m: Pick<Matchup, "isPlayoff" | "isConsolation">): MatchupKind {
  return m.isConsolation ? "CONSOLATION" : m.isPlayoff ? "PLAYOFF" : "REGULAR";
}

/**
 * A week of a multi-week playoff game as of the end of that week (the recap is a snapshot of its week): the
 * combined score through the week, decided only in the game's last week (with the bracket's winner).
 */
export function recapGameOf(c: PlayoffGameContext | undefined): RecapPlayoffGame | null {
  if (!c) return null;
  const decided = c.leg === c.legs && c.status === "FINAL";
  return { leg: c.leg, legs: c.legs, weeks: c.weeks, homeTotal: c.homeThrough, awayTotal: c.awayThrough, decided, winnerTeamId: decided ? c.winnerTeamId : null };
}

function awardGame(g: RecapPlayoffGame | null): AwardGame | null {
  return g ? { leg: g.leg, legs: g.legs, homeScore: g.homeTotal, awayScore: g.awayTotal, decided: g.decided, winnerTeamId: g.winnerTeamId } : null;
}

function rivalryLabel(settings: LeagueSettings, a: string, b: string): string | null {
  const trophy = (settings.niche.rivalryTrophies ?? []).find((r) => (r.teamA === a && r.teamB === b) || (r.teamA === b && r.teamB === a));
  if (trophy?.name) return trophy.name;
  const rival = (settings.matchups.rivalries ?? []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  return rival ? "Rivalry game" : null;
}

type TradeWithAssets = Prisma.TradeGetPayload<{ include: { assets: { include: { player: true; pick: { include: { originalTeam: true } } } }; teams: true } }>;

function assetLabel(a: TradeWithAssets["assets"][number]): string {
  if (a.type === "PLAYER" && a.player) return `${a.player.fullName} (${a.player.position}${a.player.team ? " " + a.player.team : ""})`;
  if (a.type === "FAAB") return `$${a.faabAmount ?? 0} FAB`;
  if (a.label) return a.label;
  if (a.pick) {
    const r = a.pick.round;
    const ord = r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : `${r}th`;
    return `${a.pick.season} ${ord} (${a.pick.originalTeam.name})`;
  }
  return "Draft pick";
}

function isTradeReversal(details: unknown): boolean {
  return !!details && typeof details === "object" && (details as { reversal?: unknown }).reversal === true;
}

/**
 * Build (or rebuild) the recap for a completed league week and upsert WeeklyRecap.
 * Throws RecapError when the week has no matchups or isn't final.
 */
export async function buildWeeklyRecap(leagueId: string, season: number, week: number): Promise<BuiltRecap> {
  const league = await db.league.findUnique({ where: { id: leagueId } });
  if (!league) throw new RecapError("League not found.");
  const settings = resolveSettings(league.settings);
  const tz = settings.general.timezone || "America/New_York";
  const decimals = Math.max(0, Math.min(2, settings.scoring.decimals ?? 2));
  const leagueName = settings.general.leagueName || league.name;

  const [teams, matchups, games, lineupRows, rosterSpots, existing] = await Promise.all([
    db.team.findMany({ where: { leagueId }, include: { owner: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.matchup.findMany({ where: { leagueId, season, week }, orderBy: [{ bracketSlot: "asc" }, { id: "asc" }] }),
    db.nflGame.findMany({ where: { season, week, seasonType: "REG" } }),
    db.lineupSlot.findMany({ where: { leagueId, season, week } }),
    db.rosterSpot.findMany({ where: { leagueId }, select: { teamId: true, playerId: true, status: true } }),
    db.weeklyRecap.findUnique({ where: { leagueId_season_week: { leagueId, season, week } }, select: { content: true } }),
  ]);
  const prior = existing && isRecapContent(existing.content) ? (existing.content as unknown as RecapContent) : null;
  const pairs = matchups.filter((m): m is Matchup & { homeTeamId: string; awayTeamId: string } => !!m.homeTeamId && !!m.awayTeamId);
  if (!pairs.length) throw new RecapError(`Week ${week} has no matchups.`);
  if (matchups.some((m) => m.status !== "FINAL")) throw new RecapError(`Week ${week} isn't final yet. Recaps are generated once every matchup is final.`);

  // ── week timing ──
  const gameByTeam = new Map<string, (typeof games)[number]>();
  for (const g of games) {
    gameByTeam.set(g.homeTeam, g);
    gameByTeam.set(g.awayTeam, g);
  }
  const kicks = games.map((g) => g.startTime.getTime());
  const lastUpdate = Math.max(...matchups.map((m) => m.updatedAt.getTime()));
  const firstKickoff = kicks.length ? Math.min(...kicks) : lastUpdate;
  const cut = kicks.length ? Math.max(...kicks) + GAME_LENGTH_MS : lastUpdate;
  const sundayKicks = games.filter((g) => isSundayIn(g.startTime, tz)).map((g) => g.startTime.getTime());
  const firstSundayKickoff = sundayKicks.length ? Math.min(...sundayKicks) : null;
  const firstLock = lockTimeFor(firstKickoff, { firstKickoff, firstSundayKickoff }, settings.lineup);
  const eventsSince = Math.min(firstLock, cut - WAIVER_HERO_WINDOW_DAYS * DAY);

  // every playoff row of the season: a multi-week game's other weeks give its combined score
  const playoffRows = pairs.some((m) => m.isPlayoff) ? await db.matchup.findMany({ where: { leagueId, season, isPlayoff: true } }) : [];
  const gameContexts = playoffGameContexts(playoffRows);
  const gameOf = (m: Matchup) => recapGameOf(gameContexts.get(m.id));

  const [txSince, weekTx, wpPoints, statRows, snapshots] = await Promise.all([
    db.transaction.findMany({
      where: { leagueId, createdAt: { gt: new Date(eventsSince) }, type: { in: [...ADD_TYPES, "DROP", "TRADE", "COMMISSIONER", "KEEPER"] } },
      orderBy: { createdAt: "asc" },
    }),
    db.transaction.findMany({ where: { leagueId, season, week, type: { in: ["ADD", "DROP", "WAIVER", "TRADE", "COMMISSIONER"] } }, orderBy: { createdAt: "asc" } }),
    db.winProbPoint.findMany({ where: { matchupId: { in: pairs.map((m) => m.id) } }, orderBy: { at: "asc" } }),
    db.playerWeekStat.findMany({ where: { season, week, seasonType: "REG" }, select: { playerId: true, stats: true, team: true } }),
    db.playoffOddsSnapshot.findMany({ where: { leagueId, season }, orderBy: { computedAt: "desc" }, take: 40, select: { week: true, computedAt: true, data: true } }),
  ]);

  const tradeIds = [...new Set([...txSince, ...weekTx].filter((t) => t.type === "TRADE").map((t) => t.tradeId ?? ((t.details as { tradeId?: string } | null)?.tradeId ?? null)).filter((x): x is string => !!x))];
  const trades: TradeWithAssets[] = tradeIds.length
    ? await db.trade.findMany({ where: { id: { in: tradeIds } }, include: { assets: { include: { player: true, pick: { include: { originalTeam: true } } } }, teams: true } })
    : [];
  const tradeById = new Map(trades.map((t) => [t.id, t]));

  // ── roster events (for reconstructing rosters at each lineup lock) ──
  const events: RosterEvent[] = [];
  const seenTradeEvents = new Set<string>();
  for (const t of txSince) {
    const at = t.createdAt.getTime();
    if (t.type === "TRADE") {
      const tid = t.tradeId ?? (t.details as { tradeId?: string } | null)?.tradeId;
      const trade = tid ? tradeById.get(tid) : null;
      if (!trade) continue;
      const reversal = isTradeReversal(t.details);
      const key = `${trade.id}:${reversal}`;
      if (seenTradeEvents.has(key)) continue;
      seenTradeEvents.add(key);
      for (const a of trade.assets) {
        if (a.type !== "PLAYER" || !a.playerId) continue;
        events.push(reversal ? { at, kind: "MOVE", fromTeamId: a.toTeamId, toTeamId: a.fromTeamId, playerId: a.playerId } : { at, kind: "MOVE", fromTeamId: a.fromTeamId, toTeamId: a.toTeamId, playerId: a.playerId });
      }
      continue;
    }
    if (!t.teamId || !t.playerId) continue;
    if (t.type === "COMMISSIONER") {
      const ev = commissionerRosterEvent({ at, teamId: t.teamId, relatedTeamId: t.relatedTeamId, playerId: t.playerId, description: t.description });
      if (ev) events.push(ev);
      continue;
    }
    // KEEPER rows are season-rollover releases of expired contracts (kept players never change teams)
    const rolloverRelease = t.type === "KEEPER" && (((t.details as { rolloverRelease?: unknown } | null)?.rolloverRelease === true) || /^released\b/i.test(t.description));
    const kind = t.type === "DROP" || rolloverRelease ? "DROP" : ADD_TYPES.has(t.type) ? "ADD" : null;
    if (kind) events.push({ at, kind, teamId: t.teamId, playerId: t.playerId });
  }

  // ── players, stats, projections ──
  const statByPlayer = new Map(statRows.map((s) => [s.playerId, s]));
  const relevantIds = new Set<string>([...rosterSpots.map((r) => r.playerId), ...lineupRows.map((l) => l.playerId).filter((x): x is string => !!x), ...events.map((e) => e.playerId)]);
  const allIds = new Set<string>([...relevantIds, ...statRows.map((s) => s.playerId)]);
  const [players, projRows] = await Promise.all([
    db.player.findMany({ where: { id: { in: [...allIds] } }, select: { id: true, fullName: true, position: true, team: true } }),
    db.playerWeekProjection.findMany({ where: { season, week, seasonType: "REG", playerId: { in: [...relevantIds] } }, select: { playerId: true, stats: true, team: true } }),
  ]);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const projByPlayer = new Map(projRows.map((p) => [p.playerId, p]));
  const perfCache = new Map<string, PlayerPerf>();
  const perf = (pid: string): PlayerPerf | null => {
    const hit = perfCache.get(pid);
    if (hit) return hit;
    const p = playerById.get(pid);
    if (!p) return null;
    const st = statByPlayer.get(pid);
    const pr = projByPlayer.get(pid);
    const out: PlayerPerf = {
      id: p.id,
      name: p.fullName,
      position: p.position,
      nflTeam: st?.team ?? pr?.team ?? p.team ?? null,
      points: st ? calcPoints(st.stats as StatMap, p.position, settings.scoring).points : 0,
      projected: pr ? calcPoints(pr.stats as StatMap, p.position, settings.scoring).points : 0,
    };
    perfCache.set(pid, out);
    return out;
  };
  const playerRef = (pid: string | null | undefined): RecapPlayer | null => {
    if (!pid) return null;
    const p = perf(pid);
    return p ? { id: p.id, name: p.name, position: p.position, nflTeam: p.nflTeam } : null;
  };

  // ── ownership at each player's lineup lock ──
  const current = new Map(rosterSpots.map((r) => [r.playerId, r.teamId]));
  const statusByPlayer = new Map(rosterSpots.map((r) => [r.playerId, r]));
  const lockByPlayer = new Map<string, number>();
  for (const pid of relevantIds) {
    const nfl = perf(pid)?.nflTeam;
    const g = nfl ? gameByTeam.get(nfl) : undefined;
    if (g) lockByPlayer.set(pid, lockTimeFor(g.startTime.getTime(), { firstKickoff, firstSundayKickoff }, settings.lineup));
  }
  const ownership = ownershipAtLock(current, events, lockByPlayer, cut);

  // ── starters per team ──
  const slotDefs = expandSlots(settings);
  const lineupByTeam = new Map<string, typeof lineupRows>();
  for (const r of lineupRows) {
    if (!lineupByTeam.has(r.teamId)) lineupByTeam.set(r.teamId, []);
    lineupByTeam.get(r.teamId)!.push(r);
  }
  const teamIds = [...new Set(pairs.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
  for (const tid of teamIds) {
    if (lineupByTeam.has(tid)) continue;
    // a final week should always have lineups; fall back to the carry-forward lineup
    const view = await getLineup(tid, leagueId, season, week, settings);
    lineupByTeam.set(
      tid,
      view.map((v) => ({ id: `${tid}:${v.slot}:${v.slotIndex}`, leagueId, teamId: tid, season, week, slot: v.slot, slotIndex: v.slotIndex, playerId: v.playerId, updatedAt: new Date() })),
    );
  }
  const startersByTeam = new Map<string, SlotStart[]>();
  const startedBy = new Map<string, string>();
  for (const tid of teamIds) {
    const rows = [...(lineupByTeam.get(tid) ?? [])].sort((a, b) => {
      const ia = slotDefs.findIndex((s) => s.key === a.slot && s.index === a.slotIndex);
      const ib = slotDefs.findIndex((s) => s.key === b.slot && s.index === b.slotIndex);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    const starters: SlotStart[] = rows.map((r) => {
      const def = slotDefs.find((s) => s.key === r.slot && s.index === r.slotIndex);
      const p = r.playerId ? perf(r.playerId) : null;
      if (p) startedBy.set(p.id, tid);
      return { slot: r.slot, slotIndex: r.slotIndex, label: def?.label ?? r.slot, eligible: def?.eligible ?? (p ? [normalizePosition(p.position)] : []), player: p ? { ...p, slot: def?.label ?? r.slot } : null };
    });
    startersByTeam.set(tid, starters);
  }

  // ── bench per team (owned at lock, eligible to start) ──
  const benchByTeam = new Map<string, PlayerPerf[]>(teamIds.map((t) => [t, []]));
  for (const [pid, tid] of ownership) {
    const list = benchByTeam.get(tid);
    // a player in anyone's starting lineup can't also be someone's bench option
    if (!list || startedBy.has(pid)) continue;
    const spot = statusByPlayer.get(pid);
    const status = spot && spot.teamId === tid ? spot.status : "ACTIVE";
    if (status === "IR" || (status === "TAXI" && !settings.roster.taxiPlayersCanStart)) continue;
    const p = perf(pid);
    if (p) list.push(p);
  }

  const analyses = new Map<string, TeamWeekAnalysis>();
  for (const tid of teamIds) analyses.set(tid, analyzeTeamWeek({ teamId: tid, starters: startersByTeam.get(tid) ?? [], bench: benchByTeam.get(tid) ?? [] }, settings));

  // ── standings ──
  const isPlayoffWeek = pairs.every((m) => m.isPlayoff);
  const [curStandings, prevStandings] = await Promise.all([
    computeStandings(leagueId, season, settings, { throughWeek: week }),
    week > 1 ? computeStandings(leagueId, season, settings, { throughWeek: week - 1 }) : Promise.resolve(null),
  ]);
  const prevPlayed = prevStandings?.some((r) => r.wins + r.losses + r.ties > 0) ?? false;
  const standingByTeam = new Map(curStandings.map((r) => [r.team.id, r]));

  // ── teams dictionary ──
  const teamMap: Record<string, RecapTeam> = {};
  for (const t of teams) {
    const s = standingByTeam.get(t.id);
    const played = s ? s.wins + s.losses + s.ties > 0 : false;
    teamMap[t.id] = {
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      owner: t.owner?.name ?? null,
      record: s && played ? (s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`) : null,
      rank: s && played ? s.rank : null,
    };
  }
  const name = (id: string) => teamMap[id]?.name ?? "Unknown team";

  // ── matchups ──
  const wpByMatchup = new Map<string, number[]>();
  const wpFirst = new Map<string, (typeof wpPoints)[number]>();
  for (const p of wpPoints) {
    if (!wpByMatchup.has(p.matchupId)) {
      wpByMatchup.set(p.matchupId, []);
      wpFirst.set(p.matchupId, p);
    }
    wpByMatchup.get(p.matchupId)!.push(p.homeWinProb);
  }
  const variance = (tid: string) =>
    (startersByTeam.get(tid) ?? []).reduce((a, s) => {
      if (!s.player) return a;
      const sd = POSITION_SD[normalizePosition(s.player.position)] ?? 6;
      return a + sd * sd;
    }, 0);
  const awardMatchups: AwardMatchup[] = pairs.map((m) => ({
    id: m.id,
    home: { teamId: m.homeTeamId, score: m.homeScore },
    away: { teamId: m.awayTeamId, score: m.awayScore },
    winnerTeamId: m.winnerTeamId,
    game: awardGame(gameOf(m)),
  }));
  const results = sideResults(awardMatchups);
  const resultByTeam = new Map(results.map((r) => [r.teamId, r]));

  const motwCands: MotwCandidate[] = pairs.map((m) => {
    const game = awardGame(gameOf(m));
    // a week's win-probability track says nothing about a multi-week game: no comeback / upset for those
    if (game) return { id: m.id, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, homeScore: m.homeScore, awayScore: m.awayScore, winnerTeamId: m.winnerTeamId, wpHome: [], preGameHomeWinProb: null, game };
    const first = wpFirst.get(m.id);
    const ha = analyses.get(m.homeTeamId)!;
    const aa = analyses.get(m.awayTeamId)!;
    // weeks without stored projections (e.g. before projections were synced) have no meaningful pre-game odds
    const projPre =
      ha.projected > 0 && aa.projected > 0
        ? winProbability({ liveProjected: ha.projected, variance: variance(m.homeTeamId) }, { liveProjected: aa.projected, variance: variance(m.awayTeamId) })
        : null;
    return {
      id: m.id,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      winnerTeamId: m.winnerTeamId,
      wpHome: wpByMatchup.get(m.id) ?? [],
      preGameHomeWinProb: first && first.homeScore === 0 && first.awayScore === 0 ? first.homeWinProb : projPre,
    };
  });

  const seedBase = `${leagueId}:${season}:${week}`;
  const recapMatchups: RecapMatchup[] = pairs.map((m, i) => {
    const cand = motwCands[i];
    const wf = wpFacts(cand);
    const game = gameOf(m);
    const side = (tid: string): RecapSide => {
      const a = analyses.get(tid)!;
      const r = resultByTeam.get(tid)!;
      return {
        teamId: tid,
        score: r.score,
        projected: a.projected,
        starterPoints: a.starterPoints,
        optimalPoints: a.optimalPoints,
        efficiency: a.efficiency,
        pointsLeft: a.pointsLeft,
        top: a.top,
        benchMiss: a.biggestMiss,
        won: r.result === "W",
        optimalWouldWin: r.result === "L" && optimalFlips(r, a.optimalPoints, a.starterPoints),
      };
    };
    const home = side(m.homeTeamId);
    const away = side(m.awayTeamId);
    const winner = results.find((r) => r.matchupId === m.id && r.result === "W");
    let blurb: string;
    if (game) {
      // a = the game's winner, or the leader so far (home when level)
      const homeFirst = game.decided ? game.winnerTeamId === home.teamId : game.homeTotal >= game.awayTotal;
      const [a, b] = homeFirst ? [home, away] : [away, home];
      const [aTotal, bTotal] = homeFirst ? [game.homeTotal, game.awayTotal] : [game.awayTotal, game.homeTotal];
      blurb = legBlurb({
        seed: `${seedBase}:${m.id}`,
        decimals,
        leg: game.leg,
        legs: game.legs,
        decided: game.decided,
        tiebreak: game.decided && aTotal === bTotal,
        aName: name(a.teamId),
        bName: name(b.teamId),
        aWeek: a.score,
        bWeek: b.score,
        aTotal,
        bTotal,
        aTop: a.top,
        bFlip: game.decided && b.optimalWouldWin ? { pointsLeft: b.pointsLeft } : null,
      });
    } else {
      const tie = !winner;
      const w = winner ? (winner.teamId === home.teamId ? home : away) : home;
      const l = w === home ? away : home;
      blurb = matchupBlurb({
        seed: `${seedBase}:${m.id}`,
        decimals,
        winnerName: name(w.teamId),
        loserName: name(l.teamId),
        winnerScore: w.score,
        loserScore: l.score,
        tie,
        winnerTop: w.top,
        loserTop: l.top,
        loserFlip: !tie && l.optimalWouldWin && l.benchMiss ? { benched: l.benchMiss.benched, started: l.benchMiss.started, diff: l.benchMiss.diff, pointsLeft: l.pointsLeft } : null,
      });
    }
    const label = m.label ?? (m.isChampionship ? "Championship" : null);
    return {
      id: m.id,
      label,
      kind: matchupKind(m),
      home,
      away,
      winnerTeamId: winner?.teamId ?? null,
      margin: round2(Math.abs(m.homeScore - m.awayScore)),
      combined: round2(m.homeScore + m.awayScore),
      game,
      preGameHomeWinProb: cand.preGameHomeWinProb,
      winnerLowWinProb: wf.winnerLow,
      wpSeries: downsample(cand.wpHome),
      rivalry: rivalryLabel(settings, m.homeTeamId, m.awayTeamId),
      blurb,
    };
  });

  // ── matchup of the week ──
  const motwPick = pickMatchupOfWeek(motwCands);
  let matchupOfWeek: RecapContent["matchupOfWeek"] = null;
  if (motwPick) {
    const rm = recapMatchups.find((m) => m.id === motwPick.matchupId)!;
    const g = rm.game ?? null;
    const homeFirst = g ? (g.decided ? g.winnerTeamId === rm.home.teamId : g.homeTotal >= g.awayTotal) : rm.winnerTeamId !== rm.away.teamId;
    const w = homeFirst ? rm.home : rm.away;
    const l = w === rm.home ? rm.away : rm.home;
    const copy = motwCopy(motwPick.reason, {
      seed: seedBase,
      decimals,
      winnerName: name(w.teamId),
      loserName: name(l.teamId),
      // a multi-week game: the combined score through this week
      winnerScore: g ? (homeFirst ? g.homeTotal : g.awayTotal) : w.score,
      loserScore: g ? (homeFirst ? g.awayTotal : g.homeTotal) : l.score,
      lowWinProb: motwPick.winnerLowWinProb,
      preGameWinProb: motwPick.winnerPreGameWinProb,
      tie: !g && rm.winnerTeamId === null,
      game: g ? { leg: g.leg, legs: g.legs, decided: g.decided, weekCombined: rm.combined } : null,
    });
    matchupOfWeek = { matchupId: rm.id, reason: motwPick.reason, reasonLabel: copy.label, summary: copy.summary, wpSwing: motwPick.wpSwing };
  }

  // ── waiver / free-agent pickups in the last 21 days ──
  const pickups: WaiverPickup[] = [];
  const seenPickup = new Set<string>();
  for (const t of [...txSince].reverse()) {
    if ((t.type !== "WAIVER" && t.type !== "ADD") || !t.teamId || !t.playerId) continue;
    const at = t.createdAt.getTime();
    if (at < cut - WAIVER_HERO_WINDOW_DAYS * DAY || at > cut) continue;
    const key = `${t.teamId}:${t.playerId}`;
    if (seenPickup.has(key)) continue;
    seenPickup.add(key);
    const p = perf(t.playerId);
    if (!p) continue;
    const starterSlot = (startersByTeam.get(t.teamId) ?? []).find((s) => s.player?.id === t.playerId);
    pickups.push({
      teamId: t.teamId,
      player: { ...p, slot: starterSlot?.label ?? null },
      started: !!starterSlot,
      via: t.type === "WAIVER" ? "WAIVER" : "FREE_AGENT",
      faab: t.faabAmount ?? null,
      acquiredLabel: dateLabel(t.createdAt, tz),
    });
  }

  // ── awards ──
  const enabled = new Set<ConfigurableAward>((settings.niche.weeklyAwards ?? []).filter((k): k is ConfigurableAward => (CONFIGURABLE_AWARDS as readonly string[]).includes(k)));
  const awards = computeAwards({ matchups: awardMatchups, analyses, name, decimals, enabled, pickups, highScorePrize: settings.niche.weeklyHighScorePrize ?? 0 });
  const efficiency = efficiencyBoard(teamIds.map((t) => analyses.get(t)!));

  // ── top NFL performers (positions this league can start) ──
  const startable = new Set(slotDefs.flatMap((s) => s.eligible.map((e) => normalizePosition(e))));
  const topPerformers: TopPerformer[] = statRows
    .map((s) => perf(s.playerId))
    .filter((p): p is PlayerPerf => !!p && p.points > 0 && startable.has(normalizePosition(p.position)))
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)
    .map((p) => {
      const starterTeam = startedBy.get(p.id) ?? null;
      const owner = starterTeam ?? ownership.get(p.id) ?? null;
      return { ...p, ownerTeamId: owner, started: !!starterTeam, statLine: statLine(statByPlayer.get(p.id)?.stats as Record<string, number> | null, p.position) };
    });

  // ── transactions of the week ──
  const transactions = buildTransactions(weekTx, tradeById, playerRef);

  // ── standings movement + last place ──
  const resultsMap = new Map(results.flatMap((r) => (r.result === "P" ? [] : [[r.teamId, r.result] as const])));
  const standings = isPlayoffWeek
    ? []
    : standingsMovement(
        curStandings.map((r) => ({ teamId: r.team.id, rank: r.rank, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor, streak: r.streak })),
        prevStandings && prevPlayed ? new Map(prevStandings.map((r) => [r.team.id, r.rank])) : null,
        resultsMap,
      );
  const lastRow = standings.length ? standings[standings.length - 1] : null;
  const lastPlace = settings.niche.tacoTrophy && lastRow ? { teamId: lastRow.teamId, trophy: settings.niche.lastPlaceTrophyName || "Last place" } : null;

  // ── playoff odds movers ──
  let playoffOdds: RecapPlayoffOdds | null = null;
  if (!isPlayoffWeek && snapshots.length) {
    const snaps = snapshots.map((s) => {
      const data = Array.isArray(s.data) ? (s.data as { teamId: string; playoffPct: number; champPct?: number; throughWeek?: number }[]) : [];
      const tw = typeof data[0]?.throughWeek === "number" ? data[0].throughWeek : s.week - 1;
      return { throughWeek: tw, computedAt: s.computedAt.getTime(), data };
    });
    const { before, after } = pickOddsSnapshots(snaps, week);
    if (after && after.throughWeek === week && after.data.length) {
      playoffOdds = {
        fromWeek: before?.throughWeek ?? null,
        toWeek: after.throughWeek,
        rows: oddsMovement(before?.data ?? null, after.data).filter((r) => !!teamMap[r.teamId]),
      };
    }
  }

  // ── next week preview + injuries ──
  const { nextWeek, injuries } = await buildNextWeek(leagueId, season, week, settings, prior);

  // ── narrative ──
  const scores = results.map((r) => r.score);
  const byScore = [...results].sort((a, b) => b.score - a.score);
  // a week's score (with its game's result) / a game's result (a multi-week game: its combined score)
  const asFact = (r: (typeof results)[number] | undefined): ScoreFact | null =>
    r ? { teamId: r.teamId, opponentId: r.opponentId, score: r.score, opponentScore: r.opponentScore, result: r.result, ...(r.game ? { legs: r.game.legs } : {}) } : null;
  const gameFact = (r: (typeof results)[number] | undefined): ScoreFact | null => {
    if (!r) return null;
    const g = gameScores(r);
    return { teamId: r.teamId, opponentId: r.opponentId, score: g.score, opponentScore: g.opponentScore, result: r.result, ...(g.weeks > 1 ? { weeks: g.weeks } : {}) };
  };
  // games decided this week, winner's side first (earlier weeks of a multi-week game decided nothing yet)
  const decidedWinners = results.filter((r) => r.result === "W" || r.result === "T");
  const uniqueGames = [...new Map(decidedWinners.map((r) => [r.matchupId, r])).values()];
  const margin = (r: (typeof results)[number]) => {
    const g = gameScores(r);
    return g.score - g.opponentScore;
  };
  const closest = [...uniqueGames].sort((a, b) => margin(a) - margin(b))[0];
  const blowout = [...uniqueGames].filter((r) => r.result === "W").sort((a, b) => margin(b) - margin(a))[0];
  // multi-week playoff games still going: the leader of each (biggest lead first)
  const leads = recapMatchups
    .filter((m) => m.kind === "PLAYOFF" && m.game && !m.game.decided)
    .map((m): ScoreFact => {
      const g = m.game!;
      const homeFirst = g.homeTotal >= g.awayTotal;
      return { teamId: homeFirst ? m.home.teamId : m.away.teamId, opponentId: homeFirst ? m.away.teamId : m.home.teamId, score: Math.max(g.homeTotal, g.awayTotal), opponentScore: Math.min(g.homeTotal, g.awayTotal), result: "P", weeks: g.leg };
    })
    .sort((a, b) => b.score - b.opponentScore - (a.score - a.opponentScore));
  const bracketLegs = recapMatchups.filter((m) => m.kind === "PLAYOFF" && m.game).map((m) => m.game!);
  const playoffLeg = isPlayoffWeek && bracketLegs.length && bracketLegs.every((g) => !g.decided) ? { leg: bracketLegs[0].leg, legs: bracketLegs[0].legs } : null;
  const comebackCand = motwCands
    .map((c) => ({ c, f: wpFacts(c) }))
    .filter((x) => x.f.winnerLow !== null && x.f.winnerLow <= 0.25)
    .sort((a, b) => a.f.winnerLow! - b.f.winnerLow!)[0];
  const upsetCand = motwCands
    .map((c) => ({ c, f: wpFacts(c) }))
    .filter((x) => x.f.winnerPre !== null && x.f.winnerPre <= 0.3)
    .sort((a, b) => a.f.winnerPre! - b.f.winnerPre!)[0];
  const winnerFact = (matchupId: string) => asFact(results.find((r) => r.matchupId === matchupId && r.result === "W"));
  const leaderRow = standings[0];
  const prevLeader = prevStandings && prevPlayed ? prevStandings[0]?.team.id : null;
  const blunder = [...analyses.values()].sort((a, b) => b.pointsLeft - a.pointsLeft)[0];
  const blunderSide = blunder ? recapMatchups.flatMap((m) => [m.home, m.away]).find((s) => s.teamId === blunder.teamId) : null;
  const champ = pairs.find((m) => m.isChampionship);
  const champLeg = champ ? gameOf(champ) : bracketLegs[0] ?? null;
  const weekLabel = isPlayoffWeek ? `Week ${week} · ${champ ? "Championship" : "Playoffs"}${champLeg ? ` (week ${champLeg.leg} of ${champLeg.legs})` : ""}` : `Week ${week}`;
  const facts: NarrativeFacts = {
    seed: seedBase,
    series: `${leagueId}:${season}`,
    week,
    weekLabel: `Week ${week}`,
    isPlayoffs: isPlayoffWeek,
    decimals,
    name,
    high: asFact(byScore[0]),
    low: asFact(byScore[byScore.length - 1]),
    highTop: byScore[0] ? analyses.get(byScore[0].teamId)?.top ?? null : null,
    average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    closest: gameFact(closest),
    blowout: gameFact(blowout),
    comeback: comebackCand ? { winner: winnerFact(comebackCand.c.id)!, lowWinProb: comebackCand.f.winnerLow! } : null,
    upset: upsetCand && winnerFact(upsetCand.c.id) ? { winner: winnerFact(upsetCand.c.id)!, preGameWinProb: upsetCand.f.winnerPre! } : null,
    leader: leaderRow ? { teamId: leaderRow.teamId, record: leaderRow.ties ? `${leaderRow.wins}-${leaderRow.losses}-${leaderRow.ties}` : `${leaderRow.wins}-${leaderRow.losses}`, streak: leaderRow.streak, isNew: !!prevLeader && prevLeader !== leaderRow.teamId } : null,
    benchBlunder: blunder && blunder.pointsLeft > 0 ? { teamId: blunder.teamId, pointsLeft: blunder.pointsLeft, wouldHaveWon: !!blunderSide?.optimalWouldWin } : null,
    topPerformer: topPerformers[0] ? { name: topPerformers[0].name, points: topPerformers[0].points, ownerName: topPerformers[0].ownerTeamId ? name(topPerformers[0].ownerTeamId) : null, started: topPerformers[0].started } : null,
    // the title is won in the final's last week (a multi-week final: its combined score)
    championship: champ ? gameFact(results.find((r) => r.matchupId === champ.id && r.result === "W")) : null,
    playoffLeg,
    leads,
  };
  if (facts.comeback && !facts.comeback.winner) facts.comeback = null;
  const headline = buildHeadline(facts);
  const intro = buildIntro(facts);

  const notes: string[] = [];
  if (settings.niche.chaosWeek === week && settings.niche.chaosWeekRule?.trim()) notes.push(`Chaos Week: ${settings.niche.chaosWeekRule.trim()}`);
  if (settings.niche.reverseScoringWeek === week) notes.push("Reverse Scoring Week: the lower score won every matchup.");
  if (settings.matchups.rivalryWeek === week) notes.push("Rivalry Week: every rivalry pairing met this week.");
  if (!isPlayoffWeek && scores.length) {
    const med = median(scores);
    const fmt = (x: number) => x.toFixed(decimals);
    if (settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN") {
      const beat = results.filter((r) => r.score > med).length;
      notes.push(`Median game: ${beat} of ${results.length} teams beat the league median of ${fmt(med)} for an extra win.`);
    }
    if (settings.niche.weeklyHighScoreBonusWin && byScore[0]) notes.push(`${name(byScore[0].teamId)} earned the high-score bonus win with ${fmt(byScore[0].score)}.`);
  }

  const content: RecapContent = {
    version: RECAP_VERSION,
    leagueId,
    leagueName,
    season,
    week,
    weekLabel,
    decimals,
    timezone: tz,
    generatedAt: new Date().toISOString(),
    headline,
    intro,
    specialNote: notes.length ? notes.join(" ") : null,
    teams: teamMap,
    stats: {
      teams: scores.length,
      highScore: scores.length ? Math.max(...scores) : 0,
      lowScore: scores.length ? Math.min(...scores) : 0,
      average: round2(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0),
      median: round2(median(scores)),
      totalPoints: round2(scores.reduce((a, b) => a + b, 0)),
      averageEfficiency: efficiency.length ? efficiency.reduce((a, e) => a + e.efficiency, 0) / efficiency.length : 1,
    },
    matchupOfWeek,
    matchups: recapMatchups,
    awards,
    efficiency,
    topPerformers,
    transactions,
    standings,
    lastPlace,
    playoffOdds,
    nextWeek,
    injuries,
  };

  const email = renderRecapEmail(content, leagueName);
  const data = { title: headline, content: content as unknown as Prisma.InputJsonValue, html: email.html };
  const where = { leagueId_season_week: { leagueId, season, week } };
  let row;
  try {
    row = await db.weeklyRecap.upsert({ where, create: { leagueId, season, week, ...data }, update: data });
  } catch (e) {
    // two viewers opened a brand-new recap at the same moment: the other request created the row first
    if ((e as { code?: string }).code !== "P2002") throw e;
    row = await db.weeklyRecap.update({ where, data });
  }
  return { id: row.id, content, html: email.html, text: email.text, sentAt: row.sentAt };
}

function buildTransactions(
  weekTx: {
    type: string;
    teamId: string | null;
    relatedTeamId: string | null;
    playerId: string | null;
    tradeId: string | null;
    faabAmount: number | null;
    description: string;
    details: Prisma.JsonValue;
    createdAt: Date;
  }[],
  tradeById: Map<string, TradeWithAssets>,
  playerRef: (pid: string | null | undefined) => RecapPlayer | null,
): RecapTransactions {
  const moves: RecapMove[] = [];
  const tradeEvents = new Map<string, { at: Date; reversed: boolean }>();
  const activity = new Map<string, number>();
  let faabSpent = 0;
  let biggestFaab: RecapTransactions["biggestFaab"] = null;
  for (const t of weekTx) {
    if (t.type === "TRADE") {
      const tid = t.tradeId ?? (t.details as { tradeId?: string } | null)?.tradeId;
      if (!tid) continue;
      const e = tradeEvents.get(tid) ?? { at: t.createdAt, reversed: false };
      if (isTradeReversal(t.details)) e.reversed = true;
      if (t.createdAt < e.at) e.at = t.createdAt;
      tradeEvents.set(tid, e);
      continue;
    }
    let type: RecapMove["type"];
    if (t.type === "COMMISSIONER") {
      // only commissioner roster moves (force add / drop / move); contract edits and FAB adjustments are skipped
      const ev = commissionerRosterEvent({ at: t.createdAt.getTime(), teamId: t.teamId, relatedTeamId: t.relatedTeamId, playerId: t.playerId, description: t.description });
      if (!ev) continue;
      type = ev.kind;
    } else type = t.type as RecapMove["type"];
    moves.push({
      at: t.createdAt.toISOString(),
      type,
      teamId: t.teamId,
      player: playerRef(t.playerId),
      faab: t.type === "COMMISSIONER" ? null : t.faabAmount ?? null,
      description: t.description,
      ...(t.type === "COMMISSIONER" ? { byCommissioner: true } : {}),
    });
    if (t.type === "COMMISSIONER") continue; // listed, but not a manager's own activity, FAB or add/drop count
    if (t.teamId) activity.set(t.teamId, (activity.get(t.teamId) ?? 0) + 1);
    if ((type === "WAIVER" || type === "ADD") && t.faabAmount) {
      faabSpent += t.faabAmount;
      if (t.teamId && (!biggestFaab || t.faabAmount > biggestFaab.amount)) biggestFaab = { teamId: t.teamId, player: playerRef(t.playerId), amount: t.faabAmount };
    }
  }
  const trades: RecapTrade[] = [];
  for (const [tid, e] of tradeEvents) {
    const trade = tradeById.get(tid);
    if (!trade) continue;
    const teamIds = [...new Set([...trade.teams.map((t) => t.teamId), ...trade.assets.flatMap((a) => [a.fromTeamId, a.toTeamId])])];
    trades.push({
      tradeId: tid,
      at: e.at.toISOString(),
      status: e.reversed || trade.status === "REVERSED" ? "REVERSED" : "COMPLETED",
      sides: teamIds.map((teamId) => ({ teamId, received: trade.assets.filter((a) => a.toTeamId === teamId).map(assetLabel) })),
    });
    for (const t of teamIds) activity.set(t, (activity.get(t) ?? 0) + 1);
  }
  trades.sort((a, b) => a.at.localeCompare(b.at));
  const most = [...activity.entries()].sort((a, b) => b[1] - a[1])[0];
  const managerMoves = moves.filter((m) => !m.byCommissioner);
  return {
    trades,
    moves,
    adds: managerMoves.filter((m) => m.type === "ADD" || m.type === "WAIVER").length,
    drops: managerMoves.filter((m) => m.type === "DROP").length,
    faabSpent,
    mostActiveTeamId: most && most[1] >= 2 ? most[0] : null,
    biggestFaab,
  };
}

/**
 * Next week's matchup projections / win probabilities (teamWeekScore), marquee NFL games and starter injuries.
 * Once next week has kicked off, a refreshed recap keeps the preview it was published with (the preview is a
 * snapshot of the outlook going into the week, not a live view). A recap first written after next week kicked
 * off (backfill) gets a "historical" preview from the stored pre-game projections and no injury report (today's
 * designations say nothing about that week), or no preview at all when no projections were ever stored.
 */
async function buildNextWeek(
  leagueId: string,
  season: number,
  week: number,
  settings: LeagueSettings,
  prior: RecapContent | null,
): Promise<{ nextWeek: RecapNextWeek | null; injuries: InjuryWatchRow[] }> {
  const next = week + 1;
  if (next > lastFantasyWeek(settings) || next > 18) return { nextWeek: null, injuries: [] };
  const [matchups, games] = await Promise.all([
    db.matchup.findMany({ where: { leagueId, season, week: next }, orderBy: [{ bracketSlot: "asc" }, { id: "asc" }] }),
    weekGamesByTeam(season, next),
  ]);
  const pairs = matchups.filter((m): m is Matchup & { homeTeamId: string; awayTeamId: string } => !!m.homeTeamId && !!m.awayTeamId);
  const contexts = pairs.some((m) => m.isPlayoff) ? playoffGameContexts(await db.matchup.findMany({ where: { leagueId, season, isPlayoff: true } })) : new Map<string, PlayoffGameContext>();
  const kickoffs = [...games.values()].map((g) => g.startTime.getTime());
  const firstKick = kickoffs.length ? Math.min(...kickoffs) : null;
  const started = matchups.some((m) => m.status !== "UPCOMING") || (firstKick !== null && firstKick <= Date.now());
  if (started && prior?.nextWeek && prior.nextWeek.week === next && prior.nextWeek.matchups.length) {
    // keep the published outlook only if it was a real pre-game preview (computed before kickoff, with projections)
    const builtAt = Date.parse(prior.nextWeek.builtAt ?? prior.generatedAt);
    const beforeKickoff = firstKick !== null && Number.isFinite(builtAt) ? builtAt < firstKick : !prior.nextWeek.historical;
    const projected = prior.nextWeek.matchups.some((m) => m.home.projected > 0 && m.away.projected > 0);
    if (beforeKickoff && projected) return { nextWeek: prior.nextWeek, injuries: prior.injuries };
  }
  if (!pairs.length) return { nextWeek: null, injuries: [] };
  const historical = started;
  const teamIds = [...new Set(pairs.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
  const scores = new Map(await Promise.all(teamIds.map(async (t) => [t, await teamWeekScore(t, leagueId, season, next, settings, { games })] as const)));
  const fullVariance = (t: string) =>
    (scores.get(t)?.starters ?? []).reduce((a, s) => {
      if (!s.player) return a;
      const sd = POSITION_SD[normalizePosition(s.player.position)] ?? 6;
      return a + sd * sd;
    }, 0);
  const previews = pairs.map((m) => {
    const h = scores.get(m.homeTeamId)!;
    const a = scores.get(m.awayTeamId)!;
    // a multi-week playoff game: the odds are for the whole game — the lead from earlier weeks plus this and the
    // remaining weeks, each projected like this one
    const c = contexts.get(m.id);
    const remaining = c ? c.legs - c.leg + 1 : 1;
    const hp = previewWinProb(h.projected, a.projected, () =>
      winProbability(
        { liveProjected: (c?.homeBefore ?? 0) + h.projected * remaining, variance: fullVariance(m.homeTeamId) * remaining },
        { liveProjected: (c?.awayBefore ?? 0) + a.projected * remaining, variance: fullVariance(m.awayTeamId) * remaining },
      ),
    );
    return {
      id: m.id,
      label: m.label ?? (m.isChampionship ? "Championship" : null) ?? rivalryLabel(settings, m.homeTeamId, m.awayTeamId),
      home: { teamId: m.homeTeamId, projected: round2(h.projected), winProb: hp },
      away: { teamId: m.awayTeamId, projected: round2(a.projected), winProb: hp === null ? null : 1 - hp },
      game: c ? { leg: c.leg, legs: c.legs, homeBefore: c.homeBefore, awayBefore: c.awayBefore } : null,
    };
  });
  // after the fact and nothing was ever projected for that week: there is no outlook to show
  if (historical && previews.every((p) => p.home.winProb === null)) return { nextWeek: null, injuries: [] };

  const starterAgg = new Map<string, { count: number; projected: number }>();
  const injuries: InjuryWatchRow[] = [];
  for (const [teamId, s] of scores) {
    for (const st of s.starters) {
      const p: Player | null = st.player;
      if (!p) continue;
      if (p.team) {
        const e = starterAgg.get(p.team) ?? { count: 0, projected: 0 };
        e.count++;
        e.projected += st.projected;
        starterAgg.set(p.team, e);
      }
      if (!historical && isInjuryConcern(p.injuryStatus)) {
        injuries.push({
          teamId,
          player: { id: p.id, name: p.fullName, position: p.position, nflTeam: p.team },
          status: p.injuryStatus!,
          bodyPart: p.injuryBodyPart ?? null,
          practice: p.practiceParticipation ?? null,
          projected: round2(st.projected),
          slot: st.label,
        });
      }
    }
  }
  injuries.sort((a, b) => injurySeverity(b.status) - injurySeverity(a.status) || b.projected - a.projected);
  // after the fact, only games with a stored betting line are worth listing
  const uniqueGames = [...new Map([...games.values()].map((g) => [g.id, g])).values()].filter(
    (g) => !historical || g.spread !== null || g.overUnder !== null || !!g.oddsDetails,
  );
  const marquee = marqueeGames(
    uniqueGames.map((g) => ({ id: g.id, homeTeam: g.homeTeam, awayTeam: g.awayTeam, startTime: g.startTime.getTime(), spread: g.spread, overUnder: g.overUnder, oddsDetails: g.oddsDetails })),
    starterAgg,
  );
  return { nextWeek: { week: next, matchups: previews, marquee, builtAt: new Date().toISOString(), ...(historical ? { historical: true } : {}) }, injuries };
}
