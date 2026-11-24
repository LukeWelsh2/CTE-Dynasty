// Player quick card + full profile data (league-aware: ownership, contract, points under league scoring).
import "server-only";
import type { NflGame } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { calcPoints, type PointsLine as BreakdownLine, type StatMap } from "@/lib/scoring/engine";
import { normalizePosition, STAT_BY_KEY } from "@/lib/settings/stat-catalog";
import { teamFullName } from "@/lib/nfl/teams";
import { bidVisible } from "@/lib/waivers/logic";
import { availabilityFor, loadFantasyContext, rowAction } from "@/lib/players/context";
import { fmtDateTime, fmtKickoff } from "@/lib/players/format";
import { latestInjuryReports } from "@/lib/players/injury-data";
import {
  byeWeeksByTeam,
  effectiveInjury,
  gameResult,
  lastNAverage,
  opponentLabel,
  round,
  statColumnsForPosition,
  statLabel,
  teamSpread,
  type EffectiveInjury,
} from "@/lib/players/logic";
import { timeframeWindow } from "@/lib/players/search";
import { getLeagueIndexes, meaningfulProjection, positionMap, type PlayerIndexes, type TimeframeWindow } from "@/lib/players/stats-index";

export type CardAction = "add" | "claim" | "blocked" | "drop" | "trade" | null;

export interface GameInfo {
  week: number;
  label: string;
  opp: string;
  home: boolean;
  kickoff: string;
  kickoffLabel: string;
  state: string;
  statusDetail: string | null;
  result: string | null;
  spread: string | null;
  overUnder: number | null;
  venue: string | null;
  broadcast: string | null;
}

export interface NewsLite {
  id: string;
  headline: string;
  summary: string | null;
  analysis: string | null;
  url: string | null;
  imageUrl: string | null;
  source: string;
  category: string;
  publishedAt: string;
}

export interface PlayerCore {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  position: string;
  team: string | null;
  teamName: string;
  number: number | null;
  age: number | null;
  birthDate: string | null;
  height: string | null;
  weight: string | null;
  college: string | null;
  yearsExp: number | null;
  rookieYear: number | null;
  status: string | null;
  depthChartPosition: string | null;
  depthChartOrder: number | null;
  practiceParticipation: string | null;
  practiceDescription: string | null;
}

export interface OwnerInfo {
  teamId: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  isMine: boolean;
  salary: number;
  contractYears: number;
  thru: number;
  status: string;
  acquiredVia: string;
  acquiredAt: string;
  isRookieContract: boolean;
}

export interface FantasySummary {
  owner: OwnerInfo | null;
  waiver: { processAtLabel: string | null; reason: string } | null;
  action: CardAction;
  blockedReason: string | null;
  /** shown on other teams' players when trading is closed */
  tradeClosedReason: string | null;
  pendingClaim: { id: string; bid: number } | null;
  watched: boolean;
  seasonPts: number;
  avg: number | null;
  last3: number | null;
  games: number;
  posRank: { rank: number; of: number; pos: string } | null;
  thisWeek: { week: number; game: GameInfo | null; bye: boolean; proj: number | null; pts: number | null };
  byeWeek: number | null;
}

export interface CardData {
  player: PlayerCore;
  injury: Omit<EffectiveInjury, "returnDate" | "updatedAt"> & { returnDate: string | null; updatedAt: string | null };
  fantasy: FantasySummary;
  seasonLine: { key: string; label: string; short: string; value: number }[];
  last5: { week: number; opp: string; result: string | null; pts: number; line: string }[];
  news: NewsLite[];
  timezone: string;
}

function core(p: {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  position: string;
  team: string | null;
  number: number | null;
  age: number | null;
  birthDate: Date | null;
  height: string | null;
  weight: string | null;
  college: string | null;
  yearsExp: number | null;
  rookieYear: number | null;
  status: string | null;
  depthChartPosition: string | null;
  depthChartOrder: number | null;
  practiceParticipation: string | null;
  practiceDescription: string | null;
}): PlayerCore {
  return {
    id: p.id,
    fullName: p.fullName,
    firstName: p.firstName,
    lastName: p.lastName,
    position: p.position,
    team: p.team,
    teamName: teamFullName(p.team),
    number: p.number,
    age: p.age,
    birthDate: p.birthDate?.toISOString() ?? null,
    height: p.height,
    weight: p.weight,
    college: p.college,
    yearsExp: p.yearsExp,
    rookieYear: p.rookieYear,
    status: p.status,
    depthChartPosition: p.depthChartPosition,
    depthChartOrder: p.depthChartOrder,
    practiceParticipation: p.practiceParticipation,
    practiceDescription: p.practiceDescription,
  };
}

export function gameInfo(team: string, g: NflGame, tz: string): GameInfo {
  const o = opponentLabel(team, g);
  return {
    week: g.week,
    label: o.label,
    opp: o.opp,
    home: o.home,
    kickoff: g.startTime.toISOString(),
    kickoffLabel: fmtKickoff(g.startTime, tz),
    state: g.state,
    statusDetail: g.statusDetail,
    result: gameResult(team, g),
    spread: teamSpread(team, g),
    overUnder: g.overUnder,
    venue: g.venue,
    broadcast: g.broadcast,
  };
}

function newsLite(n: { id: string; headline: string; summary: string | null; analysis: string | null; url: string | null; imageUrl: string | null; source: string; category: string; publishedAt: Date }): NewsLite {
  return { ...n, publishedAt: n.publishedAt.toISOString() };
}

/** "21 rec · 245 yds · 2 TD" style key stat summary */
export function keyStatLine(stats: StatMap | null | undefined, position: string, max = 4): string {
  if (!stats) return "";
  const cols = statColumnsForPosition(position);
  const parts: string[] = [];
  for (const k of cols) {
    const v = Number(stats[k] ?? 0);
    if (!v) continue;
    const d = STAT_BY_KEY[k];
    const label = d ? (d.group === "Passing" ? `pass ${d.short.toLowerCase()}` : d.group === "Rushing" ? `rush ${d.short.toLowerCase()}` : d.group === "Receiving" ? d.short.toLowerCase() : d.short) : k;
    parts.push(`${Math.round(v * 10) / 10} ${label}`);
    if (parts.length >= max) break;
  }
  return parts.join(" · ");
}

/** League position rank by season points (through the current week) */
async function positionRank(idx: PlayerIndexes, playerId: string, position: string, week: number) {
  const positions = await positionMap();
  const pos = normalizePosition(position);
  const total = (id: string) => {
    let t = 0;
    for (const [wk, v] of idx.points.actual.get(id)?.byWeek ?? []) if (wk <= week) t += v;
    return t;
  };
  if (!idx.points.actual.has(playerId)) return null;
  const mine = total(playerId);
  let better = 0;
  let of = 0;
  for (const id of idx.points.actual.keys()) {
    if (normalizePosition(positions.get(id)) !== pos) continue;
    const t = total(id);
    if (t <= 0 && id !== playerId) continue;
    of++;
    if (t > mine) better++;
  }
  return { rank: better + 1, of, pos };
}

interface Loaded {
  player: NonNullable<Awaited<ReturnType<typeof db.player.findUnique>>>;
  fantasy: FantasySummary;
  injury: EffectiveInjury;
  idx: PlayerIndexes;
  window: TimeframeWindow;
  games: Map<string, NflGame>;
  byes: Map<string, number[]>;
}

async function loadBase(ctx: LeagueContext, playerId: string): Promise<Loaded | null> {
  const player = await db.player.findUnique({ where: { id: playerId } });
  if (!player) return null;
  const fc = await loadFantasyContext(ctx);
  const w = timeframeWindow(ctx, { tf: "season", wk: null }, fc.games);
  const [idx, latest, schedule] = await Promise.all([
    getLeagueIndexes(ctx.league.id, ctx.season, ctx.settings, ctx.week),
    latestInjuryReports([playerId]),
    db.nflGame.findMany({ where: { season: ctx.season, seasonType: "REG" }, select: { week: true, homeTeam: true, awayTeam: true } }),
  ]);
  const byes = byeWeeksByTeam(schedule);
  const a = availabilityFor(ctx, fc, player);
  const tz = ctx.settings.general.timezone;
  const line = idx.points.actual.get(playerId);
  const played = (line?.playedWeeks ?? []).filter((x) => x <= ctx.week);
  let seasonPts = 0;
  for (const [wk, v] of line?.byWeek ?? []) if (wk <= ctx.week) seasonPts += v;
  const game = player.team ? fc.games.get(player.team) : undefined;
  const action: CardAction = rowAction(ctx, fc, a);
  const claim = fc.myClaims.get(playerId);
  const spot = a.spot;
  const fantasy: FantasySummary = {
    owner: spot
      ? {
          teamId: spot.teamId,
          name: spot.team.name,
          abbrev: spot.team.abbrev,
          logoUrl: spot.team.logoUrl,
          primaryColor: spot.team.primaryColor,
          secondaryColor: spot.team.secondaryColor,
          isMine: a.isMine,
          salary: spot.salary,
          contractYears: spot.contractYears,
          thru: ctx.season + spot.contractYears - 1,
          status: spot.status,
          acquiredVia: spot.acquiredVia,
          acquiredAt: spot.acquiredAt.toISOString(),
          isRookieContract: spot.isRookieContract,
        }
      : null,
    waiver: !spot && a.onWaivers ? { processAtLabel: a.processAt ? fmtDateTime(a.processAt, tz) : null, reason: a.mode?.kind === "claim" || a.mode?.kind === "blocked" ? a.mode.reason : "" } : null,
    action,
    blockedReason: a.mode?.kind === "blocked" ? a.mode.reason : null,
    tradeClosedReason: ctx.myTeam && spot && !a.isMine ? fc.tradesClosedReason : null,
    pendingClaim: claim ? { id: claim.id, bid: claim.bidAmount } : null,
    watched: fc.watch.has(playerId),
    seasonPts: round(seasonPts),
    avg: played.length ? round(played.reduce((s, wk) => s + (line?.byWeek.get(wk) ?? 0), 0) / played.length) : null,
    last3: played.length ? lastNAverage(line!.byWeek, played, 3) : null,
    games: played.length,
    posRank: await positionRank(idx, playerId, player.position, ctx.week),
    thisWeek: {
      week: ctx.week,
      game: game && player.team ? gameInfo(player.team, game, tz) : null,
      bye: !!player.team && !game,
      proj: idx.points.proj.get(playerId)?.get(ctx.week) ?? null,
      pts: line?.byWeek.get(ctx.week) ?? null,
    },
    byeWeek: player.team ? (byes.get(player.team)?.[0] ?? null) : null,
  };
  return { player, fantasy, injury: effectiveInjury(player, latest.get(playerId)), idx, window: w, games: fc.games, byes };
}

function serializeInjury(i: EffectiveInjury): CardData["injury"] {
  return { ...i, returnDate: i.returnDate ? new Date(i.returnDate).toISOString() : null, updatedAt: i.updatedAt ? new Date(i.updatedAt).toISOString() : null };
}

function seasonLineFor(idx: PlayerIndexes, playerId: string, position: string, week: number) {
  const weeks = idx.actual.byPlayer.get(playerId);
  const totals: StatMap = {};
  for (const [wk, l] of weeks ?? []) {
    if (wk > week) continue;
    for (const [k, v] of Object.entries(l.stats)) totals[k] = (totals[k] ?? 0) + Number(v || 0);
  }
  return statColumnsForPosition(position).map((k) => ({ key: k, label: STAT_BY_KEY[k]?.label ?? k, short: statLabel(k, STAT_BY_KEY[k]), value: round(totals[k] ?? 0, 1) }));
}

export async function loadPlayerCard(ctx: LeagueContext, playerId: string): Promise<CardData | null> {
  const base = await loadBase(ctx, playerId);
  if (!base) return null;
  const { player, idx } = base;
  const weeks = idx.actual.byPlayer.get(playerId);
  const line = idx.points.actual.get(playerId);
  const played = (line?.playedWeeks ?? []).filter((w) => w <= ctx.week);
  const last5 = played
    .slice(-5)
    .reverse()
    .map((wk) => {
      const l = weeks?.get(wk);
      const team = l?.team ?? player.team;
      return { week: wk, opp: l?.opponent ? `${l.opponent}` : "—", result: null as string | null, pts: line?.byWeek.get(wk) ?? 0, line: keyStatLine(l?.stats, player.position), team };
    });
  // results from the NFL schedule
  if (last5.length) {
    const games = await db.nflGame.findMany({ where: { season: ctx.season, seasonType: "REG", week: { in: last5.map((l) => l.week) } } });
    for (const l of last5) {
      const g = l.team ? games.find((x) => x.week === l.week && (x.homeTeam === l.team || x.awayTeam === l.team)) : undefined;
      if (g && l.team) {
        l.opp = opponentLabel(l.team, g).label;
        l.result = gameResult(l.team, g);
      }
    }
  }
  const news = await db.newsItem.findMany({
    where: { players: { some: { playerId } } },
    orderBy: { publishedAt: "desc" },
    take: 2,
    select: { id: true, headline: true, summary: true, analysis: true, url: true, imageUrl: true, source: true, category: true, publishedAt: true },
  });
  return {
    player: core(player),
    injury: serializeInjury(base.injury),
    fantasy: base.fantasy,
    seasonLine: seasonLineFor(idx, playerId, player.position, ctx.week),
    last5: last5.map(({ team: _t, ...rest }) => rest),
    news: news.map(newsLite),
    timezone: ctx.settings.general.timezone,
  };
}

// ───────────────────────────── Full profile ─────────────────────────────

export interface GameLogRow {
  week: number;
  opp: string | null;
  result: string | null;
  /** NFL game state: pre | in | post (null = no game found) */
  state: string | null;
  bye: boolean;
  played: boolean;
  stats: StatMap | null;
  pts: number | null;
  proj: number | null;
  breakdown: BreakdownLine[];
}

export interface ProjectionRow {
  week: number;
  opp: string | null;
  kickoffLabel: string | null;
  bye: boolean;
  stats: StatMap | null;
  pts: number | null;
  inFantasySeason: boolean;
}

export interface ProfileData extends Omit<CardData, "last5" | "news"> {
  chart: { week: number; pts: number | null; proj: number | null }[];
  gameLog: GameLogRow[];
  totals: StatMap;
  games: number;
  projections: ProjectionRow[];
  rosTotal: number;
  rosRange: { from: number; to: number };
  statColumns: string[];
}

export async function loadPlayerProfile(ctx: LeagueContext, playerId: string): Promise<ProfileData | null> {
  const base = await loadBase(ctx, playerId);
  if (!base) return null;
  const { player, idx, window: w, byes } = base;
  const tz = ctx.settings.general.timezone;
  const allGames = await db.nflGame.findMany({ where: { season: ctx.season, seasonType: "REG" } });
  const gameAt = (week: number, team: string | null | undefined) => (team ? allGames.find((g) => g.week === week && (g.homeTeam === team || g.awayTeam === team)) : undefined);
  const weeks = idx.actual.byPlayer.get(playerId);
  const projWeeks = idx.proj.byPlayer.get(playerId);
  const line = idx.points.actual.get(playerId);
  const projPts = idx.points.proj.get(playerId);
  // past-week projections (the shared index only covers the current week onward)
  const pastProj = await db.playerWeekProjection.findMany({ where: { playerId, season: ctx.season, seasonType: "REG", week: { lt: ctx.week } }, select: { week: true, stats: true } });
  const pastProjPts = new Map(pastProj.filter((r) => meaningfulProjection(r.stats as StatMap)).map((r) => [r.week, calcPoints(r.stats as StatMap, player.position, ctx.settings.scoring).points]));
  const projAt = (wk: number) => projPts?.get(wk) ?? pastProjPts.get(wk) ?? null;
  const myByes = new Set(player.team ? (byes.get(player.team) ?? []) : []);

  const gameLog: GameLogRow[] = [];
  for (let wk = 1; wk <= ctx.week; wk++) {
    const l = weeks?.get(wk);
    const team = l?.team ?? player.team;
    const g = gameAt(wk, team);
    const pts = line?.byWeek.get(wk);
    gameLog.push({
      week: wk,
      opp: g && team ? opponentLabel(team, g).label : l?.opponent ?? null,
      result: g && team ? gameResult(team, g) : null,
      state: g?.state ?? null,
      bye: !g && !l && myByes.has(wk),
      played: !!l && (line?.playedWeeks.includes(wk) ?? false),
      stats: l?.stats ?? null,
      pts: pts ?? null,
      proj: projAt(wk),
      breakdown: l ? calcPoints(l.stats, player.position, ctx.settings.scoring).breakdown : [],
    });
  }

  const totals: StatMap = {};
  for (const r of gameLog) if (r.stats) for (const [k, v] of Object.entries(r.stats)) totals[k] = (totals[k] ?? 0) + Number(v || 0);

  const projections: ProjectionRow[] = [];
  let rosTotal = 0;
  for (let wk = w.rosFrom; wk <= 18; wk++) {
    const p = projWeeks?.get(wk);
    const g = gameAt(wk, player.team);
    const pts = projPts?.get(wk) ?? null;
    const inFantasySeason = wk <= w.rosTo;
    if (inFantasySeason && pts) rosTotal += pts;
    projections.push({
      week: wk,
      opp: g && player.team ? opponentLabel(player.team, g).label : null,
      kickoffLabel: g ? fmtKickoff(g.startTime, tz) : null,
      bye: !!player.team && !g && myByes.has(wk),
      stats: p?.stats ?? null,
      pts,
      inFantasySeason,
    });
  }

  const chart: ProfileData["chart"] = [];
  for (let wk = 1; wk <= Math.max(ctx.week, w.rosTo); wk++) {
    chart.push({ week: wk, pts: wk <= ctx.week ? (line?.byWeek.get(wk) ?? null) : null, proj: projAt(wk) });
  }

  return {
    player: core(player),
    injury: serializeInjury(base.injury),
    fantasy: base.fantasy,
    seasonLine: seasonLineFor(idx, playerId, player.position, ctx.week),
    timezone: tz,
    chart,
    gameLog,
    totals,
    games: (line?.playedWeeks ?? []).filter((x) => x <= ctx.week).length,
    projections,
    rosTotal: round(rosTotal),
    rosRange: { from: w.rosFrom, to: w.rosTo },
    statColumns: statColumnsForPosition(player.position),
  };
}

// ───────────────────────────── League transaction history ─────────────────────────────

export interface PlayerTxRow {
  key: string;
  at: Date;
  week: number;
  type: string;
  team: { id: string; name: string } | null;
  description: string;
  tradeId: string | null;
  salary: number | null;
  /** FAB paid (null when none, or hidden by settings.waivers.revealBids) */
  faab: number | null;
}

/**
 * A player's history in this league: auction, rookie draft, adds, waiver claims (FAB shown per revealBids),
 * drops, commissioner moves and trades. Trades come from TradeAsset because a trade's Transaction rows only
 * reference the first player each team received.
 */
export async function playerTransactionHistory(ctx: LeagueContext, playerId: string): Promise<PlayerTxRow[]> {
  const [txs, assets] = await Promise.all([
    db.transaction.findMany({
      where: { leagueId: ctx.league.id, playerId, type: { not: "TRADE" } },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.tradeAsset.findMany({
      where: { playerId, type: "PLAYER", trade: { leagueId: ctx.league.id, completedAt: { not: null } } },
      include: {
        trade: { select: { id: true, status: true, completedAt: true, week: true } },
        fromTeam: { select: { id: true, name: true } },
        toTeam: { select: { id: true, name: true } },
      },
    }),
  ]);
  const tradeIds = [...new Set(assets.map((a) => a.tradeId))];
  const reversals = tradeIds.length
    ? await db.transaction.findMany({
        where: { leagueId: ctx.league.id, type: "TRADE", tradeId: { in: tradeIds } },
        select: { tradeId: true, createdAt: true, week: true, details: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const reversalOf = new Map<string, { at: Date; week: number }>();
  for (const r of reversals) if (r.tradeId && (r.details as { reversal?: boolean } | null)?.reversal && !reversalOf.has(r.tradeId)) reversalOf.set(r.tradeId, { at: r.createdAt, week: r.week });

  const viewer = { teamId: ctx.myTeam?.id ?? null, isCommish: ctx.isCommish };
  const rows: PlayerTxRow[] = txs.map((t) => ({
    key: t.id,
    at: t.createdAt,
    week: t.week,
    type: t.type,
    team: t.team,
    description: t.description,
    tradeId: t.tradeId,
    salary: t.salary,
    faab: t.faabAmount !== null && (t.type !== "WAIVER" || bidVisible(ctx.settings, { teamId: t.teamId ?? "", won: true }, viewer)) ? t.faabAmount : null,
  }));
  for (const a of assets) {
    rows.push({
      key: `trade:${a.id}`,
      at: a.trade.completedAt!,
      week: a.trade.week,
      type: "TRADE",
      team: a.toTeam,
      description: `Traded from ${a.fromTeam.name} to ${a.toTeam.name}`,
      tradeId: a.tradeId,
      salary: a.salary,
      faab: null,
    });
    const rev = reversalOf.get(a.tradeId);
    if (rev)
      rows.push({
        key: `reversal:${a.id}`,
        at: rev.at,
        week: rev.week,
        type: "TRADE",
        team: a.fromTeam,
        description: `Trade reversed by the commissioner — returned to ${a.fromTeam.name}`,
        tradeId: a.tradeId,
        salary: a.salary,
        faab: null,
      });
  }
  return rows.sort((x, y) => y.at.getTime() - x.at.getTime());
}
