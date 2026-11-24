// Page data for /standings, /standings/power and /playoffs (server only). Batches every query.
import "server-only";
import type { Matchup, PlayoffOddsSnapshot, Team } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import type { LeagueSettings } from "@/lib/settings/schema";
import { lastFantasyWeek } from "@/lib/league-week";
import { divisionTiebreakChain, standingsFromMatchups, type H2HRecord, type StandingRow } from "@/lib/standings";
import { tiebreakNotes } from "./tiebreak-notes";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { clinchFor, parseSnapshotOdds, snapshotThroughWeek, type SnapshotTeamOdds } from "@/lib/sim/playoff-odds";
import { finalClinchStatus, markerFor, type ClinchStatus, type Marker } from "@/lib/sim/clinch";
import { simDataFrom, teamWeeklyProjections } from "@/lib/sim/inputs";
import { powerBlurb } from "@/lib/sim/power";
import { leagueSeeds } from "./seeding";
import {
  advKey,
  bracketPlan,
  bracketWinner,
  placementLabel,
  placementPairings,
  placementShape,
  playoffSchedule,
  roundHeading,
  roundLabel,
  roundPairings,
  type BracketKind,
  type BracketPlan,
  type PlacementShape,
  type PlayoffSchedule,
} from "./structure";
import {
  advancersFor,
  bracketGames,
  buildBracketSeeds,
  loadManualSeeds,
  loadStoredBracket,
  placementEntries,
  placementShapeFor,
  seedingWindow,
  type BracketEntry,
  type BracketGame,
  type StoredBracket,
} from "./bracket";

export type TeamLite = Pick<Team, "id" | "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor" | "division">;

export interface OddsState {
  latest: PlayoffOddsSnapshot | null;
  /** results-through week of the latest snapshot */
  latestThrough: number | null;
  odds: Map<string, SnapshotTeamOdds>;
  /** latest snapshot taken before the most recent week's results (for week-over-week change) */
  previous: Map<string, SnapshotTeamOdds>;
  previousThrough: number | null;
}

const throughOf = (s: { week: number; data: unknown }) => snapshotThroughWeek(s.data) ?? s.week - 1;

export async function loadOdds(leagueId: string, season: number): Promise<OddsState> {
  const snaps = await db.playoffOddsSnapshot.findMany({ where: { leagueId, season }, orderBy: { computedAt: "desc" }, take: 12 });
  const latest = snaps[0] ?? null;
  const latestThrough = latest ? throughOf(latest) : null;
  const prev = latest ? snaps.find((s) => throughOf(s) < latestThrough!) ?? null : null;
  return {
    latest,
    latestThrough,
    odds: new Map(parseSnapshotOdds(latest?.data).map((o) => [o.teamId, o])),
    previous: new Map(parseSnapshotOdds(prev?.data).map((o) => [o.teamId, o])),
    previousThrough: prev ? throughOf(prev) : null,
  };
}

export interface TeamExtras {
  games: number;
  /** head-to-head record only (no median / bonus wins) */
  h2hWins: number;
  h2hLosses: number;
  h2hTies: number;
  highWeeks: number;
  lowWeeks: number;
  bestWeek: number;
  avgPF: number;
}

function weeklyExtras(teams: Team[], final: Matchup[]): Map<string, TeamExtras> {
  const out = new Map<string, TeamExtras>(teams.map((t) => [t.id, { games: 0, h2hWins: 0, h2hLosses: 0, h2hTies: 0, highWeeks: 0, lowWeeks: 0, bestWeek: 0, avgPF: 0 }]));
  const byWeek = new Map<number, { id: string; pts: number }[]>();
  for (const m of final) {
    if (!m.homeTeamId || !m.awayTeamId) continue;
    const h = out.get(m.homeTeamId);
    const a = out.get(m.awayTeamId);
    const homeWon = m.winnerTeamId ? m.winnerTeamId === m.homeTeamId : m.homeScore > m.awayScore;
    const awayWon = m.winnerTeamId ? m.winnerTeamId === m.awayTeamId : m.awayScore > m.homeScore;
    if (h && a) {
      if (homeWon) (h.h2hWins++, a.h2hLosses++);
      else if (awayWon) (a.h2hWins++, h.h2hLosses++);
      else (h.h2hTies++, a.h2hTies++);
    }
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week)!.push({ id: m.homeTeamId, pts: m.homeScore }, { id: m.awayTeamId, pts: m.awayScore });
  }
  const totals = new Map<string, number>();
  for (const scores of byWeek.values()) {
    const max = Math.max(...scores.map((s) => s.pts));
    const min = Math.min(...scores.map((s) => s.pts));
    for (const s of scores) {
      const e = out.get(s.id);
      if (!e) continue;
      e.games++;
      if (s.pts === max) e.highWeeks++;
      if (s.pts === min) e.lowWeeks++;
      e.bestWeek = Math.max(e.bestWeek, s.pts);
      totals.set(s.id, (totals.get(s.id) ?? 0) + s.pts);
    }
  }
  for (const [id, e] of out) e.avgPF = e.games ? Math.round(((totals.get(id) ?? 0) / e.games) * 100) / 100 : 0;
  return out;
}

export interface StandingsView {
  season: number;
  seasons: number[];
  standings: StandingRow[];
  owners: Map<string, string | null>;
  extras: Map<string, TeamExtras>;
  odds: OddsState;
  clinch: Map<string, ClinchStatus>;
  markers: Map<string, Marker | null>;
  seeds: string[];
  seedOf: Map<string, number>;
  schedule: PlayoffSchedule;
  lastFinalWeek: number;
  remainingWeeks: number;
  gamesLeft: number;
  medianGame: boolean;
  playoffsStarted: boolean;
  /** "why A is above B" for teams tied in win pct (overall order / division order) */
  tieNotes: Map<string, string>;
  divisionTieNotes: Map<string, string>;
}

function divisionNotes(standings: StandingRow[], h2h: Record<string, H2HRecord>, chain: readonly string[]): Map<string, string> {
  const groups = new Map<string, StandingRow[]>();
  for (const r of standings) {
    const k = r.team.division ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) for (const [k, v] of tiebreakNotes([...g].sort((a, b) => a.divisionRank - b.divisionRank), h2h, chain, { division: true })) out.set(k, v);
  return out;
}

export async function loadStandingsView(ctx: LeagueContext, seasonParam?: number): Promise<StandingsView> {
  const leagueId = ctx.league.id;
  const seasonRows = await db.matchup.findMany({ where: { leagueId }, distinct: ["season"], select: { season: true } });
  const seasons = [...new Set([ctx.season, ...seasonRows.map((s) => s.season)])].sort((a, b) => b - a);
  const season = seasonParam && seasons.includes(seasonParam) ? seasonParam : ctx.season;
  const settings = ctx.settings;
  const [teams, regular, playoffCount, odds] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" }, include: { owner: { select: { name: true } } } }),
    db.matchup.findMany({ where: { leagueId, season, isPlayoff: false }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
    db.matchup.count({ where: { leagueId, season, isPlayoff: true } }),
    loadOdds(leagueId, season),
  ]);
  const data = simDataFrom(teams, regular, settings, undefined, season);
  const schedule = playoffSchedule(settings, teams.length);
  let stored: StoredBracket | null = null;
  if (playoffCount) stored = await loadStoredBracket(leagueId, season);
  const seeds = stored ? stored.winners.map((e) => e.teamId) : leagueSeeds(data.standings, settings).map((r) => r.team.id);
  const clinch = stored
    ? finalClinchStatus(teams.map((t) => t.id), seeds, data.standings.filter((r) => r.divisionRank === 1 && r.team.division).map((r) => r.team.id), schedule.plan.byes)
    : regular.length
      ? clinchFor(data, settings, schedule.plan.byes)
      : new Map<string, ClinchStatus>();
  return {
    season,
    seasons,
    standings: data.standings,
    owners: new Map(teams.map((t) => [t.id, t.owner?.name ?? null])),
    extras: weeklyExtras(teams, data.final),
    odds,
    clinch,
    markers: new Map(teams.map((t) => [t.id, markerFor(clinch.get(t.id))])),
    seeds,
    seedOf: new Map(seeds.map((id, i) => [id, i + 1])),
    schedule,
    lastFinalWeek: data.lastFinalWeek,
    remainingWeeks: new Set(data.remaining.map((m) => m.week)).size,
    gamesLeft: data.remaining.length,
    medianGame: settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN",
    playoffsStarted: playoffCount > 0,
    tieNotes: tiebreakNotes(data.standings, data.h2h, settings.standings.tiebreakers),
    divisionTieNotes: divisionNotes(data.standings, data.h2h, divisionTiebreakChain(settings)),
  };
}

// ───────── Power rankings ─────────

export interface PowerRow {
  row: StandingRow;
  owner: string | null;
  prevRank: number | null;
  pfRank: number;
  allPlayPct: number;
  rosTotal: number | null;
  rosPerWeek: number | null;
  rosRank: number | null;
  injured: { id: string; name: string; status: string; position: string }[];
  playoffPct: number | null;
  playoffLock: ClinchStatus["playoffs"];
  marker: Marker | null;
  blurb: string;
}

export interface PowerView {
  rows: PowerRow[];
  throughWeek: number;
  comparedTo: number | null;
  rosWeeks: [number, number] | null;
}

const INJURY_FLAGS = new Set(["Questionable", "Doubtful", "Out", "IR", "PUP", "Sus", "SUS", "NA"]);

export async function loadPowerView(ctx: LeagueContext): Promise<PowerView> {
  const { settings, season } = ctx;
  const leagueId = ctx.league.id;
  const [teams, regular, odds, spots] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" }, include: { owner: { select: { name: true } } } }),
    db.matchup.findMany({ where: { leagueId, season, isPlayoff: false }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
    loadOdds(leagueId, season),
    db.rosterSpot.findMany({
      where: { leagueId, status: { in: ["ACTIVE", "IR"] } },
      select: { teamId: true, player: { select: { id: true, fullName: true, position: true, injuryStatus: true } } },
    }),
  ]);
  const data = simDataFrom(teams, regular, settings, undefined, season);
  const throughWeek = data.lastFinalWeek;
  const prev = throughWeek > 1 ? standingsFromMatchups(teams, data.final.filter((m) => m.week <= throughWeek - 1), settings, { season }) : null;
  const prevRank = new Map(prev?.map((r) => [r.team.id, r.powerRank]) ?? []);

  // rest of season (remaining regular season + playoffs, capped at week 18)
  const lastWeek = Math.min(18, lastFantasyWeek(settings));
  const from = Math.max(throughWeek + 1, 1);
  const rosWeeks = from <= lastWeek ? Array.from({ length: lastWeek - from + 1 }, (_, i) => from + i) : [];
  const proj = rosWeeks.length ? await teamWeeklyProjections(leagueId, season, rosWeeks, settings, { currentWeek: ctx.week }) : new Map();
  const rosTotal = new Map<string, number>();
  const rosCount = new Map<string, number>();
  for (const [teamId, m] of proj) {
    let t = 0;
    let c = 0;
    for (const p of m.values()) (t += p.mean), c++;
    rosTotal.set(teamId, Math.round(t * 10) / 10);
    rosCount.set(teamId, c);
  }
  const rosOrder = [...rosTotal.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  // key players: season points of rostered players → flag injuries among each team's top 4
  const ids = spots.map((s) => s.player.id);
  const stats = ids.length
    ? await db.playerWeekStat.findMany({ where: { season, seasonType: "REG", playerId: { in: ids } }, select: { playerId: true, stats: true } })
    : [];
  const posOf = new Map(spots.map((s) => [s.player.id, s.player.position]));
  const seasonPts = new Map<string, number>();
  for (const s of stats) seasonPts.set(s.playerId, (seasonPts.get(s.playerId) ?? 0) + calcPoints(s.stats as StatMap, posOf.get(s.playerId) ?? "WR", settings.scoring).points);
  const byTeam = new Map<string, typeof spots>();
  for (const s of spots) {
    if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, []);
    byTeam.get(s.teamId)!.push(s);
  }

  const pfOrder = [...data.standings].sort((a, b) => b.pointsFor - a.pointsFor).map((r) => r.team.id);
  const owners = new Map(teams.map((t) => [t.id, t.owner?.name ?? null]));
  const schedule = playoffSchedule(settings, teams.length);
  const clinch = regular.length ? clinchFor(data, settings, schedule.plan.byes) : new Map<string, ClinchStatus>();
  const rows: PowerRow[] = [...data.standings]
    .sort((a, b) => a.powerRank - b.powerRank)
    .map((r) => {
      const apg = r.allPlayWins + r.allPlayLosses + r.allPlayTies;
      const allPlayPct = apg ? (r.allPlayWins + r.allPlayTies * 0.5) / apg : 0;
      const top = [...(byTeam.get(r.team.id) ?? [])].sort((a, b) => (seasonPts.get(b.player.id) ?? 0) - (seasonPts.get(a.player.id) ?? 0)).slice(0, 4);
      const injured = top
        .filter((s) => s.player.injuryStatus && INJURY_FLAGS.has(s.player.injuryStatus))
        .map((s) => ({ id: s.player.id, name: s.player.fullName, status: s.player.injuryStatus!, position: s.player.position }));
      const total = rosTotal.get(r.team.id) ?? null;
      const cnt = rosCount.get(r.team.id) ?? 0;
      const o = odds.odds.get(r.team.id);
      const st = clinch.get(r.team.id);
      const playoffPct = st?.playoffs === "clinched" ? 1 : st?.playoffs === "eliminated" ? 0 : o?.playoffPct ?? null;
      const pr = prevRank.get(r.team.id) ?? null;
      const rosRank = total !== null ? rosOrder.indexOf(r.team.id) + 1 : null;
      const rosPerWeek = total !== null && cnt ? Math.round((total / cnt) * 10) / 10 : null;
      return {
        row: r,
        owner: owners.get(r.team.id) ?? null,
        prevRank: pr,
        pfRank: pfOrder.indexOf(r.team.id) + 1,
        allPlayPct,
        rosTotal: total,
        rosPerWeek,
        rosRank,
        injured,
        playoffPct,
        playoffLock: st?.playoffs ?? null,
        marker: markerFor(st),
        blurb: powerBlurb({
          teamId: r.team.id,
          teamName: r.team.name,
          week: throughWeek,
          rank: r.powerRank,
          prevRank: pr,
          teamCount: teams.length,
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          streak: r.streak,
          pfRank: pfOrder.indexOf(r.team.id) + 1,
          pointsFor: r.pointsFor,
          allPlayPct,
          recordPct: r.pct,
          rosRank,
          rosPerWeek,
          injuredStars: injured,
          playoffPct,
        }),
      };
    });
  return { rows, throughWeek, comparedTo: prev ? throughWeek - 1 : null, rosWeeks: rosWeeks.length ? [rosWeeks[0]!, rosWeeks[rosWeeks.length - 1]!] : null };
}

// ───────── Bracket ─────────

export type Feed = { kind: "seed"; seed: number } | { kind: "bye" } | { kind: "tbd"; text: string };

export interface BracketSide {
  team: TeamLite | null;
  seed: number | null;
  placeholder: string | null;
  score: number | null;
  projected: number | null;
  winProb: number | null;
  won: boolean;
  lost: boolean;
  champPct: number | null;
  /** result against the week's league median (settings.playoffs.medianGameInPlayoffs): "W", "L", "T" or "1-1" */
  median?: string | null;
}

export interface BracketGameView {
  key: string;
  round: number;
  globalRound: number;
  slot: number;
  label: string;
  weeks: number[];
  status: "PROJECTED" | "UPCOMING" | "LIVE" | "FINAL";
  bye: boolean;
  home: BracketSide;
  away: BracketSide;
  matchupId: string | null;
}

export interface BracketRoundView {
  round: number;
  globalRound: number;
  heading: string;
  weeks: number[];
  games: BracketGameView[];
}

export interface BracketView {
  kind: BracketKind;
  rounds: BracketRoundView[];
  winner: TeamLite | null;
  /** loser-advances bracket (toilet bowl) */
  loserAdvances: boolean;
  teamCount: number;
}

export interface PlayoffsView {
  mode: "LIVE" | "PROJECTED";
  stored: StoredBracket;
  schedule: PlayoffSchedule;
  brackets: BracketView[];
  third: BracketGameView | null;
  /** 5th / 7th place games (settings.playoffs.placementGames) */
  placement: BracketView | null;
  placementNote: string | null;
  champion: TeamLite | null;
  teams: Map<string, TeamLite>;
  liveGames: number;
  settingsByesDiffer: boolean;
  /** commissioner seeding (settings.playoffs.manualSeedingAllowed) */
  seeding: SeedingView | null;
  /** the league-median game continues in the playoffs */
  medianGame: boolean;
}

export interface SeedingView {
  open: boolean;
  /** why the editor is closed */
  reason: string | null;
  /** current seed order (team ids) */
  current: string[];
  /** seeds straight from the standings */
  standingsSeeds: string[];
  /** a commissioner override is in effect */
  manual: boolean;
  /** every team, best record first, for the pickers */
  options: { id: string; name: string; record: string; rank: number }[];
}

function weeksOf(schedule: PlayoffSchedule, globalRound: number): number[] {
  return schedule.roundWeeks[globalRound - 1] ?? [];
}

/** What feeds a bracket position (fixed bracket): a seed, a bye, or the winner/loser of an earlier game. */
function advancerFeed(plan: BracketPlan, r: number, s: number, adv: ReadonlyMap<string, number>, verb: string, name: (r: number, s: number) => string): Feed {
  const [a, b] = gameFeeds(plan, r, s, adv, verb, name);
  if (a.kind === "bye") return b;
  if (b.kind === "bye") return a;
  if (a.kind === "seed" && b.kind === "seed") {
    const w = adv.get(advKey(r, s));
    return w !== undefined ? { kind: "seed", seed: w } : { kind: "tbd", text: `${verb} of #${Math.min(a.seed, b.seed)} vs #${Math.max(a.seed, b.seed)}` };
  }
  return { kind: "tbd", text: `${verb} of ${name(r, s)}` };
}

function gameFeeds(plan: BracketPlan, r: number, s: number, adv: ReadonlyMap<string, number>, verb: string, name: (r: number, s: number) => string): [Feed, Feed] {
  if (r === 1) {
    const f = (pos: number): Feed => {
      const seed = plan.positions[pos]!;
      return seed <= plan.teams ? { kind: "seed", seed } : { kind: "bye" };
    };
    return [f(2 * s - 2), f(2 * s - 1)];
  }
  return [advancerFeed(plan, r - 1, 2 * s - 1, adv, verb, name), advancerFeed(plan, r - 1, 2 * s, adv, verb, name)];
}

function buildBracketView(
  kind: BracketKind,
  entries: BracketEntry[],
  offset: number,
  reseed: boolean,
  games: BracketGame[],
  schedule: PlayoffSchedule,
  teams: Map<string, TeamLite>,
  odds: Map<string, SnapshotTeamOdds>,
  mode: "LIVE" | "PROJECTED",
): BracketView {
  const plan = bracketPlan(entries.length);
  const loserAdvances = kind === "TOILET";
  const adv = advancersFor(games, entries, loserAdvances);
  const bySeed = new Map(entries.map((e) => [e.seed, e]));
  const verb = loserAdvances ? "Loser" : "Winner";
  const gameName = (r: number, s: number) => {
    let idx = 0;
    for (let x = 1; x <= s; x++) {
      const f = gameFeeds(plan, r, x, adv, verb, () => "");
      if (f[0].kind !== "bye" && f[1].kind !== "bye") idx++;
    }
    return `${roundLabel(kind, r, plan.rounds)} ${idx}`;
  };
  const gameAt = new Map(games.map((g) => [advKey(g.round, g.slot), g]));
  const side = (feed: Feed, game: BracketGame | undefined): BracketSide => {
    if (feed.kind !== "seed") return { team: null, seed: null, placeholder: feed.kind === "bye" ? "BYE" : feed.text, score: null, projected: null, winProb: null, won: false, lost: false, champPct: null };
    const e = bySeed.get(feed.seed);
    const team = e ? teams.get(e.teamId) ?? null : null;
    const o = e ? odds.get(e.teamId) : undefined;
    const base: BracketSide = { team, seed: e?.displaySeed ?? feed.seed, placeholder: null, score: null, projected: null, winProb: null, won: false, lost: false, champPct: kind === "WINNERS" && o ? o.champPct : null };
    if (!game || !e) return base;
    const isGameHome = game.homeTeamId === e.teamId;
    const done = game.status === "FINAL";
    return {
      ...base,
      score: game.status === "UPCOMING" ? null : isGameHome ? game.homeScore : game.awayScore,
      projected: done ? null : isGameHome ? game.homeProjected : game.awayProjected,
      winProb: done ? null : isGameHome ? game.homeWinProb : 1 - game.homeWinProb,
      won: done && game.winnerTeamId === e.teamId,
      lost: done && game.winnerTeamId !== e.teamId,
      champPct: base.champPct,
    };
  };
  const rounds: BracketRoundView[] = [];
  for (let r = 1; r <= plan.rounds; r++) {
    const globalRound = offset + r;
    const out: BracketGameView[] = [];
    const reseeded = reseed && r > 1 ? roundPairings(plan, r, true, adv) : null;
    const count = plan.size / 2 ** r;
    for (let s = 1; s <= count; s++) {
      let feeds: [Feed, Feed];
      if (reseed && r > 1) {
        const p = reseeded?.find((x) => x.slot === s);
        feeds = p
          ? [p.home !== null ? { kind: "seed", seed: p.home } : { kind: "bye" }, p.away !== null ? { kind: "seed", seed: p.away } : { kind: "bye" }]
          : [{ kind: "tbd", text: "Reseeded after the previous round" }, { kind: "tbd", text: "Reseeded after the previous round" }];
      } else feeds = gameFeeds(plan, r, s, adv, verb, gameName);
      const bye = feeds[0].kind === "bye" || feeds[1].kind === "bye";
      if (bye && r > 1) continue;
      if (feeds[0].kind === "bye" && feeds[1].kind === "bye") continue;
      // keep the higher seed on top
      if (feeds[0].kind === "seed" && feeds[1].kind === "seed" && feeds[1].seed < feeds[0].seed) feeds = [feeds[1], feeds[0]];
      if (feeds[0].kind === "bye") feeds = [feeds[1], feeds[0]];
      const g = gameAt.get(advKey(r, s));
      const status: BracketGameView["status"] = g ? g.status : mode === "PROJECTED" ? "PROJECTED" : "UPCOMING";
      const weeks = g?.weeks.length ? g.weeks : weeksOf(schedule, globalRound);
      const currentLeg = g?.rows.find((x) => x.status === "LIVE") ?? g?.rows.find((x) => x.status === "UPCOMING") ?? g?.rows[g.rows.length - 1];
      out.push({
        key: `${kind}-${r}-${s}`,
        round: r,
        globalRound,
        slot: s,
        label: roundLabel(kind, r, plan.rounds),
        weeks,
        status,
        bye,
        home: side(feeds[0], g),
        away: side(feeds[1], g),
        matchupId: currentLeg?.id ?? null,
      });
    }
    rounds.push({ round: r, globalRound, heading: kind === "WINNERS" ? roundHeading(r, plan.rounds) : roundLabel(kind, r, plan.rounds), weeks: weeksOf(schedule, globalRound), games: out });
  }
  const w = bracketWinner(plan, reseed, adv);
  const winnerEntry = w !== null && games.length ? bySeed.get(w) : undefined;
  return { kind, rounds, winner: winnerEntry ? teams.get(winnerEntry.teamId) ?? null : null, loserAdvances, teamCount: entries.length };
}

function emptySide(placeholder: string): BracketSide {
  return { team: null, seed: null, placeholder, score: null, projected: null, winProb: null, won: false, lost: false, champPct: null };
}

function sideFromGame(entry: BracketEntry, teams: Map<string, TeamLite>, game: BracketGame | undefined): BracketSide {
  const base: BracketSide = { ...emptySide(""), placeholder: null, team: teams.get(entry.teamId) ?? null, seed: entry.displaySeed };
  if (!game) return base;
  const home = game.homeTeamId === entry.teamId;
  const done = game.status === "FINAL";
  return {
    ...base,
    score: game.status === "UPCOMING" ? null : home ? game.homeScore : game.awayScore,
    projected: done ? null : home ? game.homeProjected : game.awayProjected,
    winProb: done ? null : home ? game.homeWinProb : 1 - game.homeWinProb,
    won: done && game.winnerTeamId === entry.teamId,
    lost: done && game.winnerTeamId !== entry.teamId,
  };
}

/** 5th / 7th place games: real games once the pool is known, otherwise labelled placeholders. */
function buildPlacementView(
  shape: PlacementShape,
  entries: BracketEntry[] | null,
  games: BracketGame[],
  schedule: PlayoffSchedule,
  teams: Map<string, TeamLite>,
  mode: "LIVE" | "PROJECTED",
): BracketView {
  const poolRound = roundLabel("WINNERS", schedule.plan.rounds - 2, schedule.plan.rounds);
  const seedText = (k: number) =>
    shape.size === 2 ? `${k === 1 ? "Higher" : "Lower"}-seeded ${poolRound.toLowerCase()} loser` : `${k === 1 ? "Best" : k === 2 ? "2nd-best" : k === 3 ? "3rd-best" : "4th-best"}-seeded ${poolRound.toLowerCase()} loser`;
  const adv = entries ? advancersFor(games, entries, false) : new Map<string, number>();
  const bySeed = new Map((entries ?? []).map((e) => [e.seed, e]));
  const gameAt = new Map(games.map((g) => [advKey(g.round, g.slot), g]));
  const rounds: BracketRoundView[] = [];
  for (let r = 1; r <= shape.rounds; r++) {
    const globalRound = shape.offset + r;
    const weeks = weeksOf(schedule, globalRound);
    const pairs = placementPairings(shape, r, adv);
    const slots = r === 1 ? (placementPairings(shape, 1, adv) ?? []).map((p) => p.slot) : shape.size === 3 ? [1] : [...(shape.fifth ? [1] : []), ...(shape.seventh ? [2] : [])];
    const out: BracketGameView[] = [];
    for (const slot of slots) {
      const p = pairs?.find((x) => x.slot === slot);
      const g = gameAt.get(advKey(r, slot));
      const semi = shape.size === 3 ? "the 5th place semifinal" : `placement semifinal`;
      const ph = (which: "home" | "away"): string => {
        if (r === 1) {
          const k = which === "home" ? (shape.size === 3 ? 2 : slot) : shape.size === 3 ? 3 : shape.size === 2 ? 2 : 5 - slot;
          return seedText(k);
        }
        if (shape.size === 3) return which === "home" ? seedText(1) : `Winner of ${semi}`;
        return `${slot === 1 ? "Winner" : "Loser"} of ${semi} ${which === "home" ? 1 : 2}`;
      };
      const side = (which: "home" | "away"): BracketSide => {
        const seed = p ? (which === "home" ? p.home : p.away) : null;
        const e = seed !== null ? bySeed.get(seed) : undefined;
        return e ? sideFromGame(e, teams, g) : emptySide(ph(which));
      };
      const leg = g?.rows.find((x) => x.status === "LIVE") ?? g?.rows.find((x) => x.status === "UPCOMING") ?? g?.rows[g.rows.length - 1];
      out.push({
        key: `PLACEMENT-${r}-${slot}`,
        round: r,
        globalRound,
        slot,
        label: placementLabel(shape, r, slot),
        weeks: g?.weeks.length ? g.weeks : weeks,
        status: g ? g.status : mode === "PROJECTED" ? "PROJECTED" : "UPCOMING",
        bye: false,
        home: side("home"),
        away: side("away"),
        matchupId: leg?.id ?? null,
      });
    }
    const heading = r === shape.rounds ? (shape.seventh && shape.fifth ? "5th & 7th Place" : shape.seventh && !shape.fifth ? "7th Place" : "5th Place") : placementLabel(shape, r, 1) + "s";
    rounds.push({ round: r, globalRound, heading, weeks, games: out });
  }
  return { kind: "PLACEMENT", rounds, winner: null, loserAdvances: false, teamCount: shape.size };
}

/** Median of a list of scores (mean of the middle two for an even count). */
export function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const lo = v[Math.floor((v.length - 1) / 2)]!;
  const hi = v[Math.ceil((v.length - 1) / 2)]!;
  return (lo + hi) / 2;
}

/**
 * League-median game in the playoffs: every team that plays a playoff-week game (any bracket) is also scored
 * against that week's median. It never decides who advances; the result is shown on each game card.
 */
function applyMedianResults(views: BracketGameView[], rows: Matchup[]) {
  const scores = new Map<number, Map<string, number>>();
  for (const m of rows) {
    if (m.status === "UPCOMING" || !m.homeTeamId || !m.awayTeamId) continue;
    let w = scores.get(m.week);
    if (!w) scores.set(m.week, (w = new Map()));
    w.set(m.homeTeamId, m.homeScore);
    w.set(m.awayTeamId, m.awayScore);
  }
  const median = new Map([...scores].map(([week, w]) => [week, medianOf([...w.values()])]));
  for (const g of views) {
    for (const side of [g.home, g.away]) {
      if (!side.team) continue;
      let wins = 0;
      let losses = 0;
      let ties = 0;
      for (const week of g.weeks) {
        const med = median.get(week);
        const pts = scores.get(week)?.get(side.team.id);
        if (med === null || med === undefined || pts === undefined) continue;
        if (pts > med) wins++;
        else if (pts < med) losses++;
        else ties++;
      }
      const n = wins + losses + ties;
      side.median = !n ? null : n === 1 ? (wins ? "W" : losses ? "L" : "T") : `${wins}-${losses}${ties ? `-${ties}` : ""}`;
    }
  }
}

function placementNote(shape: PlacementShape, schedule: PlayoffSchedule): string {
  const pool = `${roundLabel("WINNERS", schedule.plan.rounds - 2, schedule.plan.rounds)} losers`;
  const stakes = shape.fifth && shape.seventh ? "5th and 7th place" : shape.seventh ? "7th place" : "5th place";
  if (shape.size === 2) return `${pool} play for 5th place`;
  if (shape.size === 3) return `${pool}: the top seed waits, the other two play for a spot in the 5th place game`;
  return `${pool} play placement semifinals, then for ${stakes}`;
}

export async function loadPlayoffsView(ctx: LeagueContext, odds: OddsState): Promise<PlayoffsView | null> {
  const { settings, season } = ctx;
  const leagueId = ctx.league.id;
  const [teamRows, regular, playoffRows] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } }),
    db.matchup.findMany({ where: { leagueId, season, isPlayoff: false }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
    db.matchup.findMany({ where: { leagueId, season, isPlayoff: true }, orderBy: { week: "asc" } }),
  ]);
  if (teamRows.length < 2) return null;
  const teams = new Map<string, TeamLite>(teamRows.map((t) => [t.id, t]));
  const schedule = playoffSchedule(settings, teamRows.length);
  let stored = playoffRows.length ? await loadStoredBracket(leagueId, season) : null;
  const mode: PlayoffsView["mode"] = stored ? "LIVE" : "PROJECTED";
  if (!stored) {
    const data = simDataFrom(teamRows, regular, settings, undefined, season);
    const manual = settings.playoffs.manualSeedingAllowed && !data.remaining.length ? await loadManualSeeds(leagueId, season) : null;
    stored = buildBracketSeeds(data.standings, settings, season, manual?.teamIds);
  }
  const games = mode === "LIVE" ? bracketGames(playoffRows, stored, schedule.plan.rounds) : [];
  const brackets: BracketView[] = [
    buildBracketView("WINNERS", stored.winners, 0, stored.reseed, games.filter((g) => g.kind === "WINNERS"), schedule, teams, odds.odds, mode),
    ...stored.sides.map((s) => buildBracketView(s.kind, s.entries, s.offset, stored!.reseed, games.filter((g) => g.kind === s.kind), schedule, teams, odds.odds, mode)),
  ];
  let third: BracketGameView | null = null;
  if (stored.thirdPlace && schedule.plan.rounds >= 2) {
    const g = games.find((x) => x.kind === "THIRD");
    const bySeedTeam = new Map(stored.winners.map((e) => [e.teamId, e]));
    const mk = (id: string | null, isHome: boolean): BracketSide => {
      if (!g || !id) return { team: null, seed: null, placeholder: `${isHome ? "Higher" : "Lower"}-seeded semifinal loser`, score: null, projected: null, winProb: null, won: false, lost: false, champPct: null };
      const done = g.status === "FINAL";
      const home = g.homeTeamId === id;
      return {
        team: teams.get(id) ?? null,
        seed: bySeedTeam.get(id)?.displaySeed ?? null,
        placeholder: null,
        score: g.status === "UPCOMING" ? null : home ? g.homeScore : g.awayScore,
        projected: done ? null : home ? g.homeProjected : g.awayProjected,
        winProb: done ? null : home ? g.homeWinProb : 1 - g.homeWinProb,
        won: done && g.winnerTeamId === id,
        lost: done && g.winnerTeamId !== id,
        champPct: null,
      };
    };
    const leg = g?.rows.find((x) => x.status !== "FINAL") ?? g?.rows[g.rows.length - 1];
    third = {
      key: "third",
      round: 1,
      globalRound: schedule.plan.rounds,
      slot: 1,
      label: "3rd Place",
      weeks: g?.weeks ?? weeksOf(schedule, schedule.plan.rounds),
      status: g ? g.status : mode === "PROJECTED" ? "PROJECTED" : "UPCOMING",
      bye: false,
      home: mk(g?.homeTeamId ?? null, true),
      away: mk(g?.awayTeamId ?? null, false),
      matchupId: leg?.id ?? null,
    };
  }
  const shape = placementShapeFor(stored);
  const placement = shape
    ? buildPlacementView(shape, mode === "LIVE" ? placementEntries(stored, shape, games.filter((g) => g.kind === "WINNERS")) : null, games.filter((g) => g.kind === "PLACEMENT"), schedule, teams, mode)
    : null;

  let seeding: SeedingView | null = null;
  if (ctx.isCommish && settings.playoffs.manualSeedingAllowed && schedule.plan.teams >= 2) {
    const win = seedingWindow(settings, ctx.league.phase, regular, playoffRows);
    const data = simDataFrom(teamRows, regular, settings, undefined, season);
    const standingsSeeds = leagueSeeds(data.standings, settings).map((r) => r.team.id);
    const manual = !!stored.manual;
    seeding = {
      open: win.open,
      reason: win.open ? null : win.reason,
      current: stored.winners.map((e) => e.teamId),
      standingsSeeds,
      manual,
      options: data.standings.map((r) => ({ id: r.team.id, name: r.team.name, record: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`, rank: r.rank })),
    };
  }

  const medianGame = (settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN") && !!settings.playoffs.medianGameInPlayoffs;
  if (medianGame && mode === "LIVE") applyMedianResults([...brackets.flatMap((b) => b.rounds.flatMap((r) => r.games)), ...(third ? [third] : []), ...(placement?.rounds.flatMap((r) => r.games) ?? [])], playoffRows);

  return {
    mode,
    stored,
    schedule,
    brackets,
    third,
    placement,
    placementNote: shape ? placementNote(shape, schedule) : null,
    champion: brackets[0]?.winner ?? null,
    teams,
    liveGames: games.filter((g) => g.status === "LIVE").length,
    settingsByesDiffer: settings.playoffs.byes !== schedule.plan.byes,
    seeding,
    medianGame,
  };
}

/** Odds history for the trend chart: the latest snapshot for each results-through week. */
export async function loadOddsHistory(leagueId: string, season: number) {
  const snaps = await db.playoffOddsSnapshot.findMany({ where: { leagueId, season }, orderBy: { computedAt: "asc" }, select: { week: true, computedAt: true, data: true } });
  const byWeek = new Map<number, (typeof snaps)[number]>();
  for (const s of snaps) byWeek.set(throughOf(s), s);
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([through, s]) => ({
      week: through,
      computedAt: s.computedAt.toISOString(),
      teams: Object.fromEntries(parseSnapshotOdds(s.data).map((o) => [o.teamId, { playoff: o.playoffPct, bye: o.byePct, champ: o.champPct }])),
    }));
}

export type OddsHistory = Awaited<ReturnType<typeof loadOddsHistory>>;

export function settingsSummary(settings: LeagueSettings, schedule: PlayoffSchedule): string {
  const p = settings.playoffs;
  const parts = [`${schedule.plan.teams}-team bracket`];
  if (schedule.plan.byes) parts.push(`top ${schedule.plan.byes === 1 ? "seed gets a bye" : `${schedule.plan.byes} seeds get byes`}`);
  if (settings.standings.divisionWinnersTopSeeds) parts.push("division winners seeded first");
  else if (p.divisionWinnersQualify) parts.push("division winners qualify");
  if (p.wildcardsByPoints) parts.push(`${p.wildcardsByPoints} wildcard${p.wildcardsByPoints === 1 ? "" : "s"} by points`);
  if (p.seeding === "POINTS_FOR") parts.push("seeded by points");
  if (p.reseed) parts.push("reseeded each round");
  // the final round's real length: weeksPerRound + championshipWeeks − 1 (2-week rounds + a 2-week championship = 3)
  const finalWeeks = schedule.roundWeeks.at(-1)?.length ?? 1;
  if (p.weeksPerRound > 1 && schedule.roundWeeks.length > 1) parts.push(`${p.weeksPerRound}-week rounds`);
  if (finalWeeks > 1) parts.push(`${finalWeeks}-week final`);
  const placement = placementShape(schedule.plan, p.placementGames);
  if (placement) parts.push(placement.fifth && placement.seventh ? "5th & 7th place games" : placement.seventh ? "7th place game" : "5th place game");
  return parts.join(" · ");
}
