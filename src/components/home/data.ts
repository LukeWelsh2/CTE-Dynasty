// League Home data loaders. Shared lookups (standings, this week's games and matchups, members, my lineup)
// start once as promises; every dashboard module awaits only what it needs so all queries run in parallel.
// Each module is wrapped in settle() so one failing widget renders an inline error instead of a 500.
import "server-only";
import type { Matchup, NflGame, Player, Team } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { getLineup, isLocked, weekGamesByTeam } from "@/lib/lineup";
import { capSummary } from "@/lib/roster";
import { teamWeekScore, winProbability, type StarterLine, type TeamWeekScore } from "@/lib/scoreboard";
import { computeStandings, playoffSeeds, type StandingRow } from "@/lib/standings";
import { nextWaiverRun } from "@/lib/waiver-schedule";
import {
  buildKeyDates,
  checkLineup,
  groupFeed,
  injuryRank,
  isInSeason,
  lineupSummary,
  nextOpponents,
  parseOdds,
  phaseLabel,
  pickLineupWeek,
  pickStandingsRows,
  playoffCutRank,
  playoffRoundLabel,
  recapTeaser,
  recordString,
  tradeReceipts,
  weekStatus,
  type LineupSlotInput,
} from "./logic";
import type {
  ChatAuthor,
  ChatModule,
  FeedEntry,
  HeroActionItem,
  HeroData,
  LineupAlertData,
  Loaded,
  MatchupModule,
  MatchupPlayerLite,
  MatchupSide,
  NewsModule,
  PlayerLite,
  PowerLite,
  PulseData,
  ScoreboardData,
  StandingsSnapshotData,
  TeamLite,
  UpcomingData,
} from "./types";

type MatchupWithTeams = Matchup & { homeTeam: Team | null; awayTeam: Team | null };

interface MemberLite {
  userId: string;
  name: string;
  avatarUrl: string | null;
  teamId: string | null;
  team: { abbrev: string; primaryColor: string } | null;
}

interface MyLineup {
  week: number;
  games: Map<string, NflGame>;
  slots: LineupSlotInput[];
  weekLocked: boolean;
}

export interface HomeShared {
  ctx: LeagueContext;
  now: Date;
  standings: Promise<StandingRow[]>;
  games: Promise<Map<string, NflGame>>;
  weekMatchups: Promise<MatchupWithTeams[]>;
  members: Promise<MemberLite[]>;
  /** my team's score / lineup for the league week (null without a team) */
  myWeekScore: Promise<TeamWeekScore | null>;
  /** my lineup for the week I should be setting (current week, or next once this one is final) */
  myLineup: Promise<MyLineup | null>;
}

const PLAYER_SELECT = { id: true, fullName: true, position: true, team: true, injuryStatus: true } as const;

export const teamLite = (t: Pick<Team, "id" | "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor">): TeamLite => ({
  id: t.id,
  name: t.name,
  abbrev: t.abbrev,
  logoUrl: t.logoUrl,
  primaryColor: t.primaryColor,
  secondaryColor: t.secondaryColor,
});

const playerLite = (p: Pick<Player, "id" | "fullName" | "position" | "team" | "injuryStatus">): PlayerLite => ({
  id: p.id,
  fullName: p.fullName,
  position: p.position,
  team: p.team,
  injuryStatus: p.injuryStatus,
});

/** Run a module loader, logging and swallowing failures so the rest of the dashboard still renders. */
export async function settle<T>(name: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error(`[home] ${name} failed:`, e);
    return { ok: false };
  }
}

/** Keep a shared promise from tripping unhandled-rejection warnings before a module awaits it. */
function shared<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

function uniqueGames(games: Map<string, NflGame>): NflGame[] {
  return [...new Set(games.values())];
}

function lineupSlotsFrom(starters: StarterLine[], games: Map<string, NflGame>, ctx: LeagueContext, now: Date): LineupSlotInput[] {
  return starters.map((s) => ({
    slotLabel: s.label,
    player: s.player ? playerLite(s.player) : null,
    onBye: !!s.player?.team && !games.has(s.player.team),
    locked: s.player ? isLocked(s.player.team, games, ctx.settings, now) : false,
  }));
}

function weekIsLocked(games: Map<string, NflGame>, ctx: LeagueContext, now: Date): boolean {
  const all = uniqueGames(games);
  return all.length > 0 && all.every((g) => isLocked(g.homeTeam, games, ctx.settings, now));
}

export function createShared(ctx: LeagueContext): HomeShared {
  const now = new Date();
  const { league, settings, season, week, myTeam } = ctx;
  const games = shared(weekGamesByTeam(season, week));
  const myWeekScore = shared(myTeam ? games.then((g) => teamWeekScore(myTeam.id, league.id, season, week, settings, { games: g })) : Promise.resolve(null));

  const myLineup = shared(
    (async (): Promise<MyLineup | null> => {
      if (!myTeam) return null;
      const curGames = await games;
      const lineupWeek = pickLineupWeek(week, uniqueGames(curGames).map((g) => g.state), lastFantasyWeek(settings));
      if (lineupWeek === week) {
        const score = await myWeekScore;
        if (!score) return null;
        return { week, games: curGames, slots: lineupSlotsFrom(score.starters, curGames, ctx, now), weekLocked: weekIsLocked(curGames, ctx, now) };
      }
      const [nextGames, lineup] = await Promise.all([weekGamesByTeam(season, lineupWeek), getLineup(myTeam.id, league.id, season, lineupWeek, settings)]);
      const ids = lineup.map((l) => l.playerId).filter((x): x is string => !!x);
      const players = ids.length ? await db.player.findMany({ where: { id: { in: ids } }, select: PLAYER_SELECT }) : [];
      const byId = new Map(players.map((p) => [p.id, p]));
      const slots: LineupSlotInput[] = lineup.map((l) => {
        const p = l.playerId ? byId.get(l.playerId) ?? null : null;
        return {
          slotLabel: l.label,
          player: p ? playerLite(p) : null,
          onBye: !!p?.team && !nextGames.has(p.team),
          locked: p ? isLocked(p.team, nextGames, settings, now) : false,
        };
      });
      return { week: lineupWeek, games: nextGames, slots, weekLocked: weekIsLocked(nextGames, ctx, now) };
    })(),
  );

  return {
    ctx,
    now,
    standings: shared(computeStandings(league.id, season, settings)),
    games,
    weekMatchups: shared(
      db.matchup.findMany({ where: { leagueId: league.id, season, week }, include: { homeTeam: true, awayTeam: true }, orderBy: [{ isPlayoff: "desc" }, { bracketSlot: "asc" }, { id: "asc" }] }),
    ),
    members: shared(
      db.leagueMember
        .findMany({
          where: { leagueId: league.id },
          include: {
            user: { select: { id: true, name: true, avatarUrl: true, profile: { select: { displayName: true } } } },
            team: { select: { id: true, abbrev: true, primaryColor: true } },
          },
        })
        .then((rows) =>
          rows.map((m) => ({
            userId: m.userId,
            name: m.user.profile?.displayName?.trim() || m.user.name,
            avatarUrl: m.user.avatarUrl,
            teamId: m.team?.id ?? null,
            team: m.team ? { abbrev: m.team.abbrev, primaryColor: m.team.primaryColor } : null,
          })),
        ),
    ),
    myWeekScore,
    myLineup,
  };
}

const recordOf = (r: StandingRow | undefined) => (r ? recordString(r.wins, r.losses, r.ties) : null);

// ───────────────────────────── Hero ─────────────────────────────

async function actionItems(sh: HomeShared): Promise<HeroActionItem[]> {
  const { ctx, now } = sh;
  const { league, settings, myTeam, user } = ctx;
  const items: HeroActionItem[] = [];
  const [offers, votes, claims, rules, drafts, commishQueue] = await Promise.all([
    myTeam
      ? db.trade.count({
          where: {
            leagueId: league.id,
            status: "PROPOSED",
            proposerTeamId: { not: myTeam.id },
            teams: { some: { teamId: myTeam.id, accepted: false } },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        })
      : 0,
    myTeam && settings.trades.reviewType === "LEAGUE_VOTE"
      ? db.trade.count({
          where: { leagueId: league.id, status: "ACCEPTED", reviewEndsAt: { gt: now }, teams: { none: { teamId: myTeam.id } }, votes: { none: { teamId: myTeam.id } } },
        })
      : 0,
    myTeam ? db.waiverClaim.count({ where: { teamId: myTeam.id, status: "PENDING" } }) : 0,
    db.ruleProposal.count({ where: { leagueId: league.id, status: "VOTING", votes: { none: { userId: user.id } } } }),
    db.draft.findMany({ where: { leagueId: league.id, status: { in: ["LIVE", "PAUSED"] } }, select: { type: true, status: true, name: true } }),
    ctx.isCommish && settings.trades.reviewType === "COMMISSIONER" ? db.trade.count({ where: { leagueId: league.id, status: "ACCEPTED" } }) : 0,
  ]);
  for (const d of drafts) {
    items.push({ key: `draft-${d.type}`, label: d.status === "LIVE" ? `${d.name} is live` : `${d.name} (paused)`, href: d.type === "AUCTION" ? "/draft/auction" : "/draft/rookie", count: 0, tone: "red" });
  }
  if (offers) items.push({ key: "offers", label: offers === 1 ? "Trade offer awaiting you" : "Trade offers awaiting you", href: "/trades", count: offers, tone: "gold" });
  if (votes) items.push({ key: "trade-votes", label: votes === 1 ? "Trade needs your vote" : "Trades need your vote", href: "/trades", count: votes, tone: "brand" });
  if (commishQueue) items.push({ key: "commish-trades", label: commishQueue === 1 ? "Trade awaiting your approval" : "Trades awaiting your approval", href: "/commissioner/trades", count: commishQueue, tone: "gold" });
  if (claims) items.push({ key: "claims", label: claims === 1 ? "Pending waiver claim" : "Pending waiver claims", href: "/waivers", count: claims, tone: "green" });
  if (rules) items.push({ key: "rules", label: rules === 1 ? "Rule vote open" : "Rule votes open", href: "/rules/suggestions", count: rules, tone: "brand" });
  return items;
}

export async function loadHero(sh: HomeShared): Promise<HeroData> {
  const { ctx, now } = sh;
  const { league, settings, myTeam, season, week } = ctx;
  const [standings, games, announcements, actions, cap] = await Promise.all([
    sh.standings,
    sh.games,
    db.leagueAnnouncement.findMany({ where: { leagueId: league.id, pinned: true }, orderBy: { createdAt: "desc" }, take: 3, include: { author: { select: { name: true } } } }),
    actionItems(sh),
    myTeam && settings.salaryCap.enabled ? capSummary(league.id, myTeam.id, season, settings) : Promise.resolve(null),
  ]);
  const mine = myTeam ? standings.find((r) => r.team.id === myTeam.id) : undefined;
  return {
    leagueName: league.name,
    logoUrl: league.logoUrl,
    season,
    week,
    phase: league.phase,
    phaseLabel: phaseLabel(league.phase),
    roundLabel: league.phase === "PLAYOFFS" ? playoffRoundLabel(week, settings) : null,
    weekStatus: weekStatus(uniqueGames(games), now),
    commissionerMessage: settings.general.commissionerMessage?.trim() ?? "",
    announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, author: a.author?.name ?? null, createdAt: a.createdAt.toISOString() })),
    myTeam: myTeam
      ? {
          ...teamLite(myTeam),
          record: recordOf(mine) ?? "0-0",
          rank: mine && mine.wins + mine.losses + mine.ties > 0 ? mine.rank : null,
          pointsFor: mine?.pointsFor ?? 0,
          teams: standings.length,
        }
      : null,
    faab: myTeam && settings.waivers.type === "FAB" ? myTeam.faabBalance : null,
    capSpace: cap ? cap.space : null,
    actions,
  };
}

// ───────────────────────────── My matchup ─────────────────────────────

function playerLine(s: StarterLine): MatchupPlayerLite {
  return {
    id: s.player!.id,
    name: s.player!.fullName,
    position: s.player!.position,
    nflTeam: s.player!.team,
    points: s.points,
    projected: s.projected,
    kickoff: s.game?.startTime ? s.game.startTime.toISOString() : null,
  };
}

export async function loadMyMatchup(sh: HomeShared): Promise<MatchupModule> {
  const { ctx } = sh;
  const { league, settings, season, week, myTeam } = ctx;
  if (!myTeam) return { week, hasTeam: false, matchup: null, nextUp: null };
  const [matchups, games, standings, members] = await Promise.all([sh.weekMatchups, sh.games, sh.standings, sh.members]);
  const m = matchups.find((x) => x.homeTeamId === myTeam.id || x.awayTeamId === myTeam.id);

  const needNext = !m || m.status === "FINAL";
  const next = needNext
    ? await db.matchup.findFirst({
        where: { leagueId: league.id, season, week: { gt: week }, OR: [{ homeTeamId: myTeam.id }, { awayTeamId: myTeam.id }] },
        orderBy: { week: "asc" },
        include: { homeTeam: true, awayTeam: true },
      })
    : null;
  const nextUp = next
    ? { week: next.week, matchupId: next.id, opponent: (() => { const o = next.homeTeamId === myTeam.id ? next.awayTeam : next.homeTeam; return o ? teamLite(o) : null; })() }
    : null;
  if (!m) return { week, hasTeam: true, matchup: null, nextUp };

  const [home, away] = await Promise.all([
    m.homeTeamId ? (m.homeTeamId === myTeam.id ? sh.myWeekScore : teamWeekScore(m.homeTeamId, league.id, season, week, settings, { games })) : Promise.resolve(null),
    m.awayTeamId ? (m.awayTeamId === myTeam.id ? sh.myWeekScore : teamWeekScore(m.awayTeamId, league.id, season, week, settings, { games })) : Promise.resolve(null),
  ]);
  const final = m.status === "FINAL";
  const byTeam = new Map(standings.map((r) => [r.team.id, r]));
  const ownerOf = (teamId: string) => members.find((x) => x.teamId === teamId)?.name ?? null;

  const side = (team: Team, score: TeamWeekScore | null, stored: { score: number; projected: number }, seed: number | null): MatchupSide => {
    const starters = (score?.starters ?? []).filter((s) => s.player);
    const scored = starters.filter((s) => s.gameState === "in" || s.gameState === "post");
    const topPool = scored.length ? scored : m.status === "UPCOMING" ? starters : [];
    const top = topPool.length
      ? topPool.reduce((a, b) => ((scored.length ? b.points > a.points : b.projected > a.projected) ? b : a))
      : null;
    const pending = starters
      .filter((s) => s.gameState === "pre")
      .sort((a, b) => (a.game?.startTime.getTime() ?? 0) - (b.game?.startTime.getTime() ?? 0))
      .map(playerLine);
    const row = byTeam.get(team.id);
    return {
      team: teamLite(team),
      ownerName: ownerOf(team.id),
      record: recordOf(row),
      rank: row && row.wins + row.losses + row.ties > 0 ? row.rank : null,
      seed,
      score: final || !score ? stored.score : score.points,
      projected: final ? stored.score : score ? score.liveProjected : stored.projected,
      yetToPlay: score?.yetToPlay ?? 0,
      inProgress: score?.inProgress ?? 0,
      starters: score?.starters.length ?? 0,
      top: top ? playerLine(top) : null,
      pending,
    };
  };

  const homeSide = m.homeTeam ? side(m.homeTeam, home, { score: m.homeScore, projected: m.homeProjected }, m.isPlayoff ? m.homeSeed : null) : null;
  const awaySide = m.awayTeam ? side(m.awayTeam, away, { score: m.awayScore, projected: m.awayProjected }, m.isPlayoff ? m.awaySeed : null) : null;
  const myIsHome = m.homeTeamId === myTeam.id;
  let homeWinProb = m.homeWinProb;
  if (final) homeWinProb = m.winnerTeamId ? (m.winnerTeamId === m.homeTeamId ? 1 : 0) : m.homeScore === m.awayScore ? 0.5 : m.homeScore > m.awayScore ? 1 : 0;
  else if (home && away) homeWinProb = winProbability(home, away);
  else if (home && !m.awayTeamId) homeWinProb = 1;
  else if (away && !m.homeTeamId) homeWinProb = 0;

  const me = myIsHome ? homeSide : awaySide;
  if (!me) return { week, hasTeam: true, matchup: null, nextUp };
  return {
    week,
    hasTeam: true,
    nextUp,
    matchup: {
      id: m.id,
      week: m.week,
      status: m.status,
      label: m.label,
      isPlayoff: m.isPlayoff,
      homeTeamId: m.homeTeamId,
      homeWinProb,
      winnerTeamId: m.winnerTeamId,
      me,
      opponent: myIsHome ? awaySide : homeSide,
      myIsHome,
      decimals: settings.scoring.decimals,
    },
  };
}

// ───────────────────────────── Lineup alert ─────────────────────────────

export async function loadLineupAlert(sh: HomeShared): Promise<LineupAlertData | null> {
  const { ctx } = sh;
  const { settings, league, myTeam, season, week } = ctx;
  if (!myTeam || !(isInSeason(league.phase) || league.phase === "PRESEASON")) return null;
  const lineup = await sh.myLineup;
  if (!lineup) return null;
  if (league.phase === "PLAYOFFS") {
    // eliminated / idle teams have nothing to set
    const playing = await db.matchup.count({ where: { leagueId: league.id, season, week: lineup.week, OR: [{ homeTeamId: myTeam.id }, { awayTeamId: myTeam.id }] } });
    if (!playing) return null;
  }
  const check = checkLineup(lineup.slots.map((s) => (s.player ? s : { ...s, locked: lineup.weekLocked })));
  const isNextWeek = lineup.week !== week;
  return {
    week: lineup.week,
    isNextWeek,
    href: isNextWeek ? `/team?week=${lineup.week}` : "/team",
    issues: check.issues,
    actionable: check.actionable,
    watch: check.watch,
    summary: lineupSummary(check.counts),
    emptySlotPenalty: settings.lineup.emptySlotPenalty ?? 0,
    bestBall: settings.lineup.bestBall,
    weekLocked: lineup.weekLocked,
  };
}

// ───────────────────────────── Scoreboard ─────────────────────────────

export async function loadScoreboard(sh: HomeShared): Promise<ScoreboardData> {
  const { ctx } = sh;
  const [matchups, standings] = await Promise.all([sh.weekMatchups, sh.standings]);
  const byTeam = new Map(standings.map((r) => [r.team.id, r]));
  const side = (t: Team | null, score: number, projected: number) => (t ? { team: teamLite(t), record: recordOf(byTeam.get(t.id)), score, projected } : null);
  return {
    week: ctx.week,
    decimals: ctx.settings.scoring.decimals,
    tiles: matchups.map((m) => ({
      id: m.id,
      status: m.status,
      label: m.label,
      isPlayoff: m.isPlayoff,
      homeWinProb: m.homeWinProb,
      winnerTeamId: m.winnerTeamId,
      home: side(m.homeTeam, m.homeScore, m.homeProjected),
      away: side(m.awayTeam, m.awayScore, m.awayProjected),
    })),
  };
}

// ───────────────────────────── Standings snapshot ─────────────────────────────

export async function loadStandings(sh: HomeShared): Promise<StandingsSnapshotData> {
  const { ctx } = sh;
  const { league, settings, season, myTeam } = ctx;
  const [standings, snapshot] = await Promise.all([
    sh.standings,
    db.playoffOddsSnapshot.findFirst({ where: { leagueId: league.id, season }, orderBy: { computedAt: "desc" }, select: { data: true, computedAt: true } }),
  ]);
  const anyGames = standings.some((r) => r.wins + r.losses + r.ties > 0);
  const seeds = anyGames ? playoffSeeds(standings, settings) : [];
  const seedOf = new Map(seeds.map((r, i) => [r.team.id, i + 1]));
  const odds = parseOdds(snapshot?.data);
  const limit = Math.min(8, Math.max(6, settings.playoffs.teams + 2));
  const picked = pickStandingsRows(
    standings.map((r) => ({ ...r, teamId: r.team.id })),
    myTeam?.id,
    limit,
  );
  return {
    rows: picked.rows.map((r) => {
      const o = odds.get(r.team.id);
      return {
        team: teamLite(r.team),
        rank: r.rank,
        record: recordString(r.wins, r.losses, r.ties),
        pointsFor: r.pointsFor,
        streak: r.streak,
        gamesBack: r.gamesBack,
        seed: seedOf.get(r.team.id) ?? null,
        playoffPct: o?.playoffPct ?? null,
        marker: o?.marker ?? null,
        isMine: r.team.id === myTeam?.id,
      };
    }),
    myRowDetached: picked.myRowDetached,
    cutAfterRank: anyGames ? playoffCutRank(standings.map((r) => ({ teamId: r.team.id, rank: r.rank })), seeds.map((r) => r.team.id)) : null,
    playoffTeams: settings.playoffs.teams,
    byes: settings.playoffs.byes,
    hasOdds: odds.size > 0,
    oddsAsOf: snapshot && odds.size ? snapshot.computedAt.toISOString() : null,
    totalTeams: standings.length,
    anyGames,
    decimals: settings.scoring.decimals,
  };
}

// ───────────────────────────── Upcoming schedule & key dates ─────────────────────────────

export async function loadUpcoming(sh: HomeShared): Promise<UpcomingData> {
  const { ctx, now } = sh;
  const { league, settings, season, week, myTeam } = ctx;
  const [standings, myMatchups, windows, drafts] = await Promise.all([
    sh.standings,
    myTeam
      ? db.matchup.findMany({
          where: { leagueId: league.id, season, week: { gt: week }, OR: [{ homeTeamId: myTeam.id }, { awayTeamId: myTeam.id }] },
          orderBy: { week: "asc" },
          take: 6,
          select: { id: true, week: true, homeTeamId: true, awayTeamId: true, label: true, isPlayoff: true },
        })
      : Promise.resolve([]),
    db.nflGame.groupBy({ by: ["week"], where: { season, seasonType: "REG" }, _min: { startTime: true }, _max: { startTime: true } }),
    db.draft.findMany({ where: { leagueId: league.id, status: { in: ["SCHEDULED", "LIVE", "PAUSED"] } }, select: { type: true, status: true, startTime: true, name: true } }),
  ]);
  const teamsById = new Map(standings.map((r) => [r.team.id, r.team]));
  const weekWindows = new Map<number, { first: Date; last: Date }>();
  for (const w of windows) if (w._min.startTime && w._max.startTime) weekWindows.set(w.week, { first: w._min.startTime, last: w._max.startTime });
  const opponents = myTeam
    ? nextOpponents(
        myMatchups,
        myTeam.id,
        week,
        standings.map((r) => ({ teamId: r.team.id, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor, rank: r.rank })),
        3,
      ).map((o) => {
        const t = o.opponentId ? teamsById.get(o.opponentId) : undefined;
        return { ...o, team: t ? teamLite(t) : null };
      })
    : [];
  return {
    opponents,
    keyDates: buildKeyDates({ now, phase: league.phase, week, settings, weekWindows, nextWaiver: nextWaiverRun(settings, now), drafts, lastWeek: lastFantasyWeek(settings) }),
    timezone: settings.general.timezone || "America/New_York",
    hasTeam: !!myTeam,
  };
}

// ───────────────────────────── Transactions & trades ─────────────────────────────

export async function loadFeed(sh: HomeShared, limit = 8): Promise<FeedEntry[]> {
  const { ctx } = sh;
  const rows = await db.transaction.findMany({
    where: { leagueId: ctx.league.id },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 60,
    include: { team: true, player: { select: PLAYER_SELECT } },
  });
  const groups = groupFeed(rows, limit);
  const tradeIds = groups.map((g) => g.tradeId).filter((x): x is string => !!x);
  const trades = tradeIds.length
    ? await db.trade.findMany({
        where: { id: { in: tradeIds } },
        include: { teams: { include: { team: true } }, assets: { include: { player: { select: { fullName: true } } } } },
      })
    : [];
  const tradeById = new Map(trades.map((t) => [t.id, t]));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  return groups.map((g): FeedEntry => {
    const grows = g.rowIds.map((id) => rowById.get(id)!).filter(Boolean);
    const at = g.createdAt.toISOString();
    if (g.kind === "trade" && g.tradeId) {
      const t = tradeById.get(g.tradeId);
      if (t) {
        const order = [t.proposerTeamId, ...t.teams.map((x) => x.teamId).filter((id) => id !== t.proposerTeamId)];
        const teamOf = new Map(t.teams.map((x) => [x.teamId, x.team]));
        const sides = tradeReceipts(
          order,
          t.assets.map((a) => ({ fromTeamId: a.fromTeamId, toTeamId: a.toTeamId, type: a.type, label: a.label, playerName: a.player?.fullName ?? null, faabAmount: a.faabAmount })),
        ).map((s) => ({ team: teamOf.get(s.teamId) ? teamLite(teamOf.get(s.teamId)!) : null, items: s.items }));
        return { kind: "trade", key: g.key, tradeId: t.id, status: t.status, at, sides };
      }
      return { kind: "trade", key: g.key, tradeId: g.tradeId, status: "COMPLETED", at, sides: grows.map((r) => ({ team: r.team ? teamLite(r.team) : null, items: [r.description] })) };
    }
    const first = grows[0];
    return {
      kind: "move",
      key: g.key,
      at,
      type: first?.type ?? "COMMISSIONER",
      team: first?.team ? teamLite(first.team) : null,
      lines: grows.map((r) => ({ type: r.type, text: r.description, player: r.player ? playerLite(r.player) : null })),
    };
  });
}

// ───────────────────────────── My players' news & injuries ─────────────────────────────

export async function loadNews(sh: HomeShared): Promise<NewsModule> {
  const { ctx } = sh;
  const { myTeam } = ctx;
  if (!myTeam) return { hasTeam: false, news: [], injuries: [] };
  const roster = await db.rosterSpot.findMany({
    where: { teamId: myTeam.id },
    include: { player: { select: { ...PLAYER_SELECT, injuryBodyPart: true, injuryNotes: true, practiceParticipation: true } } },
  });
  const ids = roster.map((r) => r.playerId);
  const [news, lineup] = await Promise.all([
    ids.length
      ? db.newsItem.findMany({
          where: { players: { some: { playerId: { in: ids } } } },
          orderBy: { publishedAt: "desc" },
          take: 6,
          include: { players: { where: { playerId: { in: ids } }, include: { player: { select: PLAYER_SELECT } } } },
        })
      : Promise.resolve([]),
    sh.myLineup.catch(() => null),
  ]);
  const starting = new Set((lineup?.slots ?? []).map((s) => s.player?.id).filter((x): x is string => !!x));
  const injuries = roster
    .filter((r) => !!r.player.injuryStatus && injuryRank(r.player.injuryStatus) < 3)
    .map((r) => ({
      player: playerLite(r.player),
      bodyPart: r.player.injuryBodyPart,
      practice: r.player.practiceParticipation,
      notes: r.player.injuryNotes,
      starting: starting.has(r.playerId),
      rosterStatus: r.status,
    }))
    .sort((a, b) => Number(b.starting) - Number(a.starting) || injuryRank(a.player.injuryStatus) - injuryRank(b.player.injuryStatus) || a.player.fullName.localeCompare(b.player.fullName));
  return {
    hasTeam: true,
    news: news.map((n) => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary,
      url: n.url,
      source: n.source,
      category: n.category,
      publishedAt: n.publishedAt.toISOString(),
      players: n.players.map((p) => playerLite(p.player)),
    })),
    injuries,
  };
}

// ───────────────────────────── League chat preview ─────────────────────────────

export async function loadChat(sh: HomeShared): Promise<ChatModule> {
  const { ctx } = sh;
  const [channel, members] = await Promise.all([db.chatChannel.findUnique({ where: { leagueId_slug: { leagueId: ctx.league.id, slug: "general" } } }), sh.members]);
  const authors: Record<string, ChatAuthor> = {};
  for (const m of members) authors[m.userId] = { name: m.name, avatarUrl: m.avatarUrl, team: m.team };
  if (!channel) return { channelId: null, channelName: "General", messages: [], authors };
  const rows = await db.chatMessage.findMany({
    where: { channelId: channel.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });
  for (const r of rows) if (r.user && !authors[r.user.id]) authors[r.user.id] = { name: r.user.name, avatarUrl: r.user.avatarUrl, team: null };
  return {
    channelId: channel.id,
    channelName: channel.name,
    messages: rows.reverse().map((r) => ({ id: r.id, userId: r.userId, kind: r.kind, body: r.body, createdAt: r.createdAt.toISOString() })),
    authors,
  };
}

// ───────────────────────────── League pulse: rule votes, recap, power ─────────────────────────────

const WEEKDAY_NAMES: Record<string, string> = { SUN: "Sundays", MON: "Mondays", TUE: "Tuesdays", WED: "Wednesdays", THU: "Thursdays", FRI: "Fridays", SAT: "Saturdays" };

function hourLabel(h: number): string {
  const hr = ((h % 24) + 24) % 24;
  return `${hr % 12 === 0 ? 12 : hr % 12} ${hr < 12 ? "AM" : "PM"}`;
}

export async function loadPulse(sh: HomeShared): Promise<PulseData> {
  const { ctx } = sh;
  const { league, settings, season, user } = ctx;
  const [proposals, members, recap, standings] = await Promise.all([
    db.ruleProposal.findMany({
      where: { leagueId: league.id, status: "VOTING" },
      orderBy: [{ votingEndsAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 3,
      include: { votes: { select: { userId: true, value: true } } },
    }),
    sh.members,
    settings.notifications.weeklyRecapEnabled ? db.weeklyRecap.findFirst({ where: { leagueId: league.id, season }, orderBy: { week: "desc" } }) : Promise.resolve(null),
    sh.standings,
  ]);
  const teams: Record<string, TeamLite> = {};
  for (const r of standings) teams[r.team.id] = teamLite(r.team);
  const anyGames = standings.some((r) => r.wins + r.losses + r.ties > 0);
  const power: PowerLite[] = anyGames
    ? [...standings]
        .sort((a, b) => a.powerRank - b.powerRank)
        .slice(0, 3)
        .map((r) => ({ team: teamLite(r.team), powerRank: r.powerRank, powerScore: r.powerScore, record: recordString(r.wins, r.losses, r.ties), rank: r.rank }))
    : [];
  return {
    votes: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      votingEndsAt: p.votingEndsAt ? p.votingEndsAt.toISOString() : null,
      support: p.votes.filter((v) => v.value > 0).length,
      oppose: p.votes.filter((v) => v.value < 0).length,
      abstain: p.votes.filter((v) => v.value === 0).length,
      myVote: p.votes.find((v) => v.userId === user.id)?.value ?? null,
    })),
    totalVoters: members.length,
    recap: recap ? { ...recapTeaser(recap.title, recap.content), week: recap.week, season: recap.season, title: recap.title, createdAt: recap.createdAt.toISOString(), teams } : null,
    recapsEnabled: settings.notifications.weeklyRecapEnabled,
    recapSchedule: `${WEEKDAY_NAMES[settings.notifications.weeklyRecapDay] ?? settings.notifications.weeklyRecapDay} at ${hourLabel(settings.notifications.weeklyRecapHour)}`,
    power,
    showPower: settings.standings.showPowerRankings,
  };
}
