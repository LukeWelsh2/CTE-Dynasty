// Server-side loaders for the My Team pages (/team, /team/contracts, /team/picks, /teams, /teams/[id]).
import "server-only";
import type { NflGame, Player, Team, User } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { getLineup, isLocked, isOnBye, lockOffsetMs as lineupLockOffsetMs, optimalLineup, weekGamesByTeam } from "@/lib/lineup";
import { firstOpenDraftSeason } from "@/lib/picks";
import { seasonPoints } from "@/lib/points";
import { capHit, capSummary, deadMoneyFor, getTeamRoster, isIrEligible, rosterCounts, salaryInYear, type CapSummary, type RosterEntry } from "@/lib/roster";
import { teamWeekScore, type StarterLine, type TeamWeekScore } from "@/lib/scoreboard";
import { expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { computeStandings, type StandingRow } from "@/lib/standings";
import { record } from "@/lib/utils";
import { getDefenseVsPosition, seasonByeWeeks } from "@/lib/insights/data";
import { difficultyFor } from "@/lib/insights/engine";
import {
  capForSeason,
  capSeasonOffset,
  capEnforced,
  contractEndSeason,
  contractOffers,
  contractWindow,
  deadMoneyPreview,
  isInSeasonPhase,
  type ContractOffers,
  type ContractWindow,
  type DeadMoneyEntry,
} from "@/lib/team/contracts";
import { gameLine, positionRank } from "@/lib/team/format";
import { alignToCurrent, isUnavailableStatus, keepCurrentWhereEmpty, toAssignment, type Assignment } from "@/lib/team/lineup-model";
import { pickTier, projectedPickOrder, rookieScaleSalary } from "@/lib/team/picks";
import { canStartStatus, effectiveRosterSettings, lineupWeekState, lockClock, rosterMoveCheck, type MoveContext, type RuleSpot } from "@/lib/team/roster-rules";
import type { Avail, LineupEditorData, RosterLimits, RosterRow, RowActions } from "@/lib/team/types";

const NEWS_WINDOW_MS = 72 * 3600_000;

// ───────────────────────────── Which team is this page about? ─────────────────────────────

export type ManagedTeam = { kind: "ok"; teamId: string; commishEdit: boolean } | { kind: "redirect"; to: string } | { kind: "none" };

/** /team?team=<id>: commissioners (when canEditLineups) manage any team; everyone else is sent to the read-only page. */
export async function resolveManagedTeam(ctx: LeagueContext, teamParam: string | undefined): Promise<ManagedTeam> {
  if (teamParam && teamParam !== ctx.myTeam?.id) {
    const team = await db.team.findFirst({ where: { id: teamParam, leagueId: ctx.league.id }, select: { id: true } });
    if (!team) return ctx.myTeam ? { kind: "ok", teamId: ctx.myTeam.id, commishEdit: false } : { kind: "none" };
    if (ctx.isCommish && ctx.settings.commissioner.canEditLineups) return { kind: "ok", teamId: team.id, commishEdit: true };
    return { kind: "redirect", to: `/teams/${team.id}` };
  }
  if (ctx.myTeam) return { kind: "ok", teamId: ctx.myTeam.id, commishEdit: false };
  return { kind: "none" };
}

// ───────────────────────────── Header ─────────────────────────────

export interface SideData {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  score: number;
  projected: number;
  record: string | null;
}

export interface MatchupCardData {
  id: string;
  week: number;
  status: string;
  label: string | null;
  isPlayoff: boolean;
  me: SideData;
  opp: SideData | null;
  myWinProb: number;
}

export interface TeamHeaderData {
  team: Pick<Team, "id" | "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor" | "motto" | "division">;
  owner: { id: string; name: string } | null;
  divisionName: string | null;
  record: string;
  rank: number | null;
  teamCount: number;
  pointsFor: number;
  pointsAgainst: number;
  streak: string;
  cap: CapSummary | null;
  limits: RosterLimits;
  faab: number | null;
  matchup: MatchupCardData | null;
}

function sideFrom(team: Team, score: number, projected: number, standings: Map<string, StandingRow>): SideData {
  const st = standings.get(team.id);
  return {
    id: team.id,
    name: team.name,
    abbrev: team.abbrev,
    logoUrl: team.logoUrl,
    primaryColor: team.primaryColor,
    secondaryColor: team.secondaryColor,
    score,
    projected,
    record: st ? record(st.wins, st.losses, st.ties) : null,
  };
}

function headerFrom(
  ctx: LeagueContext,
  team: Team & { owner: User | null },
  roster: RosterEntry[],
  standings: StandingRow[],
  cap: CapSummary,
  matchup: (Awaited<ReturnType<typeof findMatchup>>) | null,
): TeamHeaderData {
  const { settings } = ctx;
  const byId = new Map(standings.map((s) => [s.team.id, s]));
  const st = byId.get(team.id);
  const counts = rosterCounts(roster);
  let mc: MatchupCardData | null = null;
  if (matchup) {
    const home = matchup.homeTeamId === team.id;
    const meTeam = home ? matchup.homeTeam : matchup.awayTeam;
    const oppTeam = home ? matchup.awayTeam : matchup.homeTeam;
    mc = {
      id: matchup.id,
      week: matchup.week,
      status: matchup.status,
      label: matchup.label,
      isPlayoff: matchup.isPlayoff,
      me: sideFrom(meTeam ?? team, home ? matchup.homeScore : matchup.awayScore, home ? matchup.homeProjected : matchup.awayProjected, byId),
      opp: oppTeam ? sideFrom(oppTeam, home ? matchup.awayScore : matchup.homeScore, home ? matchup.awayProjected : matchup.homeProjected, byId) : null,
      myWinProb: home ? matchup.homeWinProb : 1 - matchup.homeWinProb,
    };
  }
  return {
    team: { id: team.id, name: team.name, abbrev: team.abbrev, logoUrl: team.logoUrl, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor, motto: team.motto, division: team.division },
    owner: team.owner ? { id: team.owner.id, name: team.owner.name } : null,
    divisionName: settings.general.divisions.find((d) => d.id === team.division)?.name ?? null,
    record: st ? record(st.wins, st.losses, st.ties) : "0-0",
    rank: st?.rank ?? null,
    teamCount: standings.length,
    pointsFor: st?.pointsFor ?? 0,
    pointsAgainst: st?.pointsAgainst ?? 0,
    streak: st?.streak ?? "",
    cap: settings.salaryCap.enabled ? cap : null,
    limits: { maxActive: effectiveRosterSettings(settings, ctx.league.phase).roster.maxActiveRoster, irSlots: settings.roster.irSlots, taxiSlots: settings.roster.taxiSlots, active: counts.active, ir: counts.ir, taxi: counts.taxi },
    faab: settings.waivers.type === "FAB" ? team.faabBalance : null,
    matchup: mc,
  };
}

function findMatchup(leagueId: string, season: number, week: number, teamId: string) {
  return db.matchup.findFirst({
    where: { leagueId, season, week, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    include: { homeTeam: true, awayTeam: true },
  });
}

// ───────────────────────────── Dead money ─────────────────────────────

export interface DeadCapItem {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  bySeason: { season: number; amount: number }[];
  current: number;
}

/** Dead-money entries for teams in a league, grouped by team then player. */
export async function leagueDeadCap(leagueId: string): Promise<Map<string, DeadCapItem[]>> {
  const states = await db.leaguePlayerState.findMany({
    where: { leagueId, NOT: { deadCap: { equals: [] } } },
    select: { playerId: true, deadCap: true, player: { select: { fullName: true, position: true, team: true } } },
  });
  const out = new Map<string, DeadCapItem[]>();
  for (const s of states) {
    const entries = (s.deadCap as { teamId: string; season: number; amount: number }[] | null) ?? [];
    const byTeam = new Map<string, { season: number; amount: number }[]>();
    for (const e of entries) {
      if (!e?.teamId || !e.amount) continue;
      if (!byTeam.has(e.teamId)) byTeam.set(e.teamId, []);
      byTeam.get(e.teamId)!.push({ season: e.season, amount: e.amount });
    }
    for (const [teamId, list] of byTeam) {
      const merged = new Map<number, number>();
      for (const e of list) merged.set(e.season, (merged.get(e.season) ?? 0) + e.amount);
      const item: DeadCapItem = {
        playerId: s.playerId,
        name: s.player.fullName,
        position: s.player.position,
        nflTeam: s.player.team,
        bySeason: [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([season, amount]) => ({ season, amount })),
        current: 0,
      };
      if (!out.has(teamId)) out.set(teamId, []);
      out.get(teamId)!.push(item);
    }
  }
  return out;
}

// ───────────────────────────── Roster + lineup page ─────────────────────────────

export interface TeamPageData {
  header: TeamHeaderData;
  editor: LineupEditorData;
  score: TeamWeekScore;
  deadCap: DeadCapItem[];
}

/**
 * Everything rosterMoveCheck needs for a team's current week: locks, live games, taxi deadline, IR history,
 * taxi promotions and healthy players stuck on IR. Shared by the My Team page and the roster server actions.
 */
export async function loadMoveEnv(ctx: LeagueContext, teamId: string, roster: RosterEntry[], pre: { games?: Map<string, NflGame>; lineupIds?: Set<string>; deadMoney?: number } = {}) {
  const { league, settings, season } = ctx;
  const ids = roster.map((r) => r.playerId);
  const [games, lineupIds, kicked, deadMoney, history] = await Promise.all([
    pre.games ?? weekGamesByTeam(season, ctx.week),
    pre.lineupIds ?? getLineup(teamId, league.id, season, ctx.week, settings).then((l) => new Set(l.map((x) => x.playerId).filter((x): x is string => !!x))),
    taxiDeadlineKickedOff(settings, season),
    pre.deadMoney ?? deadMoneyFor(league.id, teamId, season),
    ids.length
      ? db.transaction.findMany({
          where: { leagueId: league.id, teamId, playerId: { in: ids }, type: { in: ["IR", "ACTIVATE"] } },
          select: { playerId: true, type: true, season: true, week: true, details: true },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  const clock = lockClock(settings);
  const lastIr = new Map<string, { season: number; week: number }>();
  const promoted = new Set<string>();
  for (const h of history) {
    if (!h.playerId) continue;
    if (h.type === "IR" && !lastIr.has(h.playerId)) lastIr.set(h.playerId, { season: h.season, week: h.week });
    if (h.type === "ACTIVATE" && ((h.details ?? {}) as { from?: string }).from === "TAXI") promoted.add(h.playerId);
  }
  const healthyOnIr = roster.filter((r) => r.status === "IR" && !isIrEligible(r.player, settings)).map((r) => r.player.fullName);
  return (r: RosterEntry): MoveContext => {
    const game = r.player.team ? games.get(r.player.team) : undefined;
    const ir = lastIr.get(r.playerId);
    return {
      settings,
      phase: league.phase,
      week: ctx.week,
      lockedStarter: lineupIds.has(r.playerId) && isLocked(r.player.team, games, settings, clock),
      gameLive: game?.state === "in",
      taxiDeadlineKickedOff: kicked,
      deadMoney,
      acquiredVia: r.acquiredVia,
      weeksOnIr: ir && ir.season === season ? Math.max(0, ctx.week - ir.week) : null,
      promotedBefore: promoted.has(r.playerId),
      healthyOnIr,
    };
  };
}

export const toRuleSpot = (r: RosterEntry): RuleSpot => ({ playerId: r.playerId, status: r.status, salary: r.salary, player: r.player });

/** Did the first game of the taxi deadline week kick off? */
export async function taxiDeadlineKickedOff(settings: LeagueSettings, season: number): Promise<boolean> {
  const dl = settings.roster.taxiDeadlineWeek;
  if (!dl) return false;
  const first = await db.nflGame.findFirst({ where: { season, week: dl, seasonType: "REG" }, orderBy: { startTime: "asc" }, select: { startTime: true } });
  return !!first && first.startTime <= new Date();
}

const asAvail = (c: { ok: true } | { ok: false; reason: string }): Avail => (c.ok ? { ok: true } : { ok: false, reason: c.reason });

export async function loadTeamPage(ctx: LeagueContext, teamId: string, week: number, opts: { manage: boolean; commishEdit: boolean }): Promise<TeamPageData> {
  const { league, settings, season } = ctx;
  const games = await weekGamesByTeam(season, week);
  const [team, score, roster, standings, matchup, byes, dvp, deadAll] = await Promise.all([
    db.team.findUniqueOrThrow({ where: { id: teamId }, include: { owner: true } }),
    teamWeekScore(teamId, league.id, season, week, settings, { games }),
    getTeamRoster(teamId),
    computeStandings(league.id, season, settings),
    findMatchup(league.id, season, week, teamId),
    seasonByeWeeks(season),
    getDefenseVsPosition(season, Math.min(ctx.week, week) - 1, settings),
    leagueDeadCap(league.id),
  ]);
  const cap = await capSummary(league.id, teamId, season, settings, roster);
  const header = headerFrom(ctx, team, roster, standings, cap, matchup);
  const spotById = new Map(roster.map((r) => [r.playerId, r]));
  const allLines: StarterLine[] = [...score.starters, ...score.bench].filter((l) => l.player);
  const players = allLines.map((l) => l.player!);
  const season$ = await seasonPoints(players, season, settings, ctx.week);
  const now = new Date();
  const clock = lockClock(settings, now);

  // lineup state + optimal
  const slots = expandSlots(settings);
  const weekState = lineupWeekState(settings, league.phase, ctx.week, week, { hasMatchup: !!matchup });
  const editable = weekState.editable && opts.manage;
  const saved = toAssignment(score.starters.map((s) => ({ slot: s.slot, slotIndex: s.slotIndex, playerId: s.player?.id ?? null })), slots);
  let optimal: Assignment | null = null;
  if (editable) {
    const active = roster.filter((r) => canStartStatus(r.status, settings));
    const proj = new Map(allLines.map((l) => [l.player!.id, l.liveProjected]));
    const locked = new Map<string, string>();
    for (const [k, pid] of Object.entries(saved)) {
      const p = pid ? spotById.get(pid)?.player : undefined;
      if (pid && p && isLocked(p.team, games, settings, clock)) locked.set(k, pid);
    }
    const starters = new Set(Object.values(saved).filter(Boolean));
    const excluded = new Set<string>();
    for (const r of active) {
      const lockedNow = isLocked(r.player.team, games, settings, clock);
      if ((lockedNow && !starters.has(r.playerId)) || isUnavailableStatus(r.player.injuryStatus) || isOnBye(r.player.team, games)) excluded.add(r.playerId);
    }
    for (const pid of locked.values()) excluded.delete(pid);
    const best = keepCurrentWhereEmpty(toAssignment(optimalLineup(active.map((r) => r.player), proj, settings, { locked, excluded }), slots), saved);
    const positions = new Map(roster.map((r) => [r.playerId, normalizePosition(r.player.position)]));
    optimal = alignToCurrent(best, saved, slots, positions, new Set(locked.keys()));
  }

  // roster actions are evaluated against the CURRENT week lineup/games
  let actionsFor: ((r: RosterEntry) => RowActions) | null = null;
  if (opts.manage) {
    const envFor = await loadMoveEnv(ctx, teamId, roster, {
      games: week === ctx.week ? games : undefined,
      lineupIds: week === ctx.week ? new Set(Object.values(saved).filter((x): x is string => !!x)) : undefined,
      deadMoney: cap.deadMoney,
    });
    const ruleRoster: RuleSpot[] = roster.map(toRuleSpot);
    const toWaivers = waiverHoursFor(settings, league.phase);
    actionsFor = (r) => {
      const m = envFor(r);
      const spot = ruleRoster.find((x) => x.playerId === r.playerId)!;
      const dead = deadMoneyPreview(r, settings, season, ctx.week, league.phase);
      const deadNow = dead.filter((d) => d.season === season).reduce((a, d) => a + d.amount, 0);
      return {
        ir: asAvail(rosterMoveCheck("IR", spot, ruleRoster, m)),
        activate: asAvail(rosterMoveCheck("ACTIVATE", spot, ruleRoster, m)),
        taxi: asAvail(rosterMoveCheck("TAXI", spot, ruleRoster, m)),
        promote: asAvail(rosterMoveCheck("PROMOTE", spot, ruleRoster, m)),
        drop: { ...asAvail(rosterMoveCheck("DROP", spot, ruleRoster, m)), dead, waiverHours: toWaivers, capAfter: settings.salaryCap.enabled ? cap.space + capHit(r, settings) - deadNow : null },
      };
    };
  }

  const tz = settings.general.timezone;
  const lockOffsetMs = lineupLockOffsetMs(settings);
  const rowFor = (l: StarterLine): RosterRow => {
    const p = l.player!;
    const spot = spotById.get(p.id);
    const pos = normalizePosition(p.position);
    const gl = gameLine(l.game, p.team, tz);
    const opp = gl.oppTeam;
    const e = dvp?.get(pos, opp);
    const sp = season$.get(p.id);
    const bye = p.team ? (byes.get(p.team) ?? []).filter((w) => w >= settings.general.firstWeek)[0] ?? null : null;
    return {
      playerId: p.id,
      name: p.fullName,
      position: p.position,
      pos,
      nflTeam: p.team,
      injuryStatus: p.injuryStatus,
      injuryBodyPart: p.injuryBodyPart,
      hasNews: !!p.newsUpdatedAt && now.getTime() - p.newsUpdatedAt.getTime() < NEWS_WINDOW_MS,
      rosterStatus: spot?.status ?? "GONE",
      salary: spot?.salary ?? null,
      contractYears: spot?.contractYears ?? null,
      contractEnd: spot ? contractEndSeason(season, spot.contractYears) : null,
      isRookie: !!spot?.isRookieContract,
      isTagged: !!spot?.isFranchiseTagged,
      age: p.age,
      points: l.points,
      projected: l.projected,
      liveProjected: l.liveProjected,
      game: gl,
      kickoff: l.game && l.game.state === "pre" ? new Date(l.game.startTime.getTime() - lockOffsetMs).toISOString() : null,
      seasonTotal: sp?.total ?? 0,
      seasonAvg: sp?.avg ?? 0,
      seasonGames: sp?.games ?? 0,
      byeWeek: bye,
      onBye: isOnBye(p.team, games),
      locked: isLocked(p.team, games, settings, clock),
      irIneligible: spot?.status === "IR" && !isIrEligible(p, settings),
      oprk: e && dvp ? { rank: e.rank, of: dvp.teamCount[pos] ?? 0, perGame: e.perGame, tone: difficultyFor(e.rank, dvp.teamCount[pos] ?? 0) } : null,
      actions: spot && actionsFor ? actionsFor(spot) : null,
    };
  };
  const starterRows = score.starters.filter((s) => s.player).map(rowFor);
  const benchRows = score.bench
    .filter((b) => b.player)
    .map(rowFor)
    .sort((a, b) => positionRank(a.pos) - positionRank(b.pos) || b.projected - a.projected || b.seasonTotal - a.seasonTotal);

  const deadCap = (deadAll.get(teamId) ?? []).map((d) => ({ ...d, current: d.bySeason.find((x) => x.season === season)?.amount ?? 0 })).sort((a, b) => b.current - a.current);

  const editor: LineupEditorData = {
    teamId,
    leagueId: league.id,
    season,
    week,
    currentWeek: ctx.week,
    editable,
    readOnlyReason: opts.manage ? weekState.reason : null,
    manage: opts.manage,
    commishEdit: opts.commishEdit,
    slots,
    saved,
    optimal,
    rows: [...starterRows, ...benchRows],
    limits: header.limits,
    benchSize: settings.roster.benchSize,
    timezone: tz,
    showSalary: settings.salaryCap.enabled,
    showContracts: settings.contracts.enabled,
    adjustments: score.adjustments,
    emptyPenalty: settings.lineup.emptySlotPenalty ?? 0,
    taxiCanStart: settings.roster.taxiPlayersCanStart,
    lockOffsetMinutes: Math.max(0, settings.lineup.lockOffsetMinutes ?? 0),
    irPolicy: settings.roster.irActivationPolicy ?? "NONE",
    irEligibleLabel: settings.roster.irRequireInjuryStatus ? settings.roster.irEligibleStatuses.join(" / ") : null,
  };
  return { header, editor, score, deadCap };
}

/** Hours a dropped player sits on waivers (null = straight to free agency) */
export function waiverHoursFor(settings: LeagueSettings, phase: string): number | null {
  if (settings.waivers.type === "FREE_FOR_ALL" || settings.waivers.waiverPeriodHours <= 0) return null;
  if (!isInSeasonPhase(phase) && !settings.waivers.offseasonWaivers) return null;
  return settings.waivers.waiverPeriodHours;
}

// ───────────────────────────── Header only (contracts / picks / insights pages) ─────────────────────────────

export async function loadTeamHeader(ctx: LeagueContext, teamId: string): Promise<TeamHeaderData> {
  const { league, settings, season } = ctx;
  const [team, roster, standings, matchup] = await Promise.all([
    db.team.findUniqueOrThrow({ where: { id: teamId }, include: { owner: true } }),
    getTeamRoster(teamId),
    computeStandings(league.id, season, settings),
    findMatchup(league.id, season, ctx.week, teamId),
  ]);
  const cap = await capSummary(league.id, teamId, season, settings, roster);
  return headerFrom(ctx, team, roster, standings, cap, matchup);
}

// ───────────────────────────── All teams ─────────────────────────────

export interface TeamCardData {
  team: Pick<Team, "id" | "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor" | "division" | "motto">;
  owner: { id: string; name: string } | null;
  record: string;
  rank: number | null;
  pointsFor: number;
  streak: string;
  capSpace: number | null;
  committed: number;
  deadMoney: number;
  faab: number | null;
  limits: RosterLimits;
  top: { id: string; name: string; position: string; team: string | null; salary: number; contractYears: number; injuryStatus: string | null }[];
}

export async function loadLeagueTeams(ctx: LeagueContext): Promise<TeamCardData[]> {
  const { league, settings, season } = ctx;
  const [teams, standings, spots, dead] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, include: { owner: true } }),
    computeStandings(league.id, season, settings),
    db.rosterSpot.findMany({ where: { leagueId: league.id }, include: { player: true } }),
    leagueDeadCap(league.id),
  ]);
  const byTeam = new Map<string, typeof spots>();
  for (const s of spots) {
    if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, []);
    byTeam.get(s.teamId)!.push(s);
  }
  const st = new Map(standings.map((s) => [s.team.id, s]));
  return teams
    .map((t) => {
      const list = byTeam.get(t.id) ?? [];
      const counts = rosterCounts(list);
      const deadMoney = (dead.get(t.id) ?? []).reduce((a, d) => a + (d.bySeason.find((x) => x.season === season)?.amount ?? 0), 0);
      const committed = list.reduce((a, s) => a + capHit(s, settings), 0) + deadMoney;
      const row = st.get(t.id);
      return {
        team: { id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, division: t.division, motto: t.motto },
        owner: t.owner ? { id: t.owner.id, name: t.owner.name } : null,
        record: row ? record(row.wins, row.losses, row.ties) : "0-0",
        rank: row?.rank ?? null,
        pointsFor: row?.pointsFor ?? 0,
        streak: row?.streak ?? "",
        capSpace: settings.salaryCap.enabled ? settings.salaryCap.cap - committed : null,
        committed,
        deadMoney,
        faab: settings.waivers.type === "FAB" ? t.faabBalance : null,
        limits: { maxActive: effectiveRosterSettings(settings, ctx.league.phase).roster.maxActiveRoster, irSlots: settings.roster.irSlots, taxiSlots: settings.roster.taxiSlots, active: counts.active, ir: counts.ir, taxi: counts.taxi },
        top: [...list]
          .sort((a, b) => b.salary - a.salary)
          .slice(0, 3)
          .map((s) => ({ id: s.playerId, name: s.player.fullName, position: s.player.position, team: s.player.team, salary: s.salary, contractYears: s.contractYears, injuryStatus: s.player.injuryStatus })),
      };
    })
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

// ───────────────────────────── Contracts ─────────────────────────────

export interface ContractRow {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  age: number | null;
  status: string;
  salary: number;
  capHit: number;
  contractYears: number;
  contractEnd: number;
  contractStart: number | null;
  isRookie: boolean;
  isTagged: boolean;
  acquiredVia: string;
  acquiredAt: string;
  bySeason: (number | null)[];
  cutCost: DeadMoneyEntry[];
  extension: ContractOffers["extension"];
  tag: ContractOffers["tag"];
  option: ContractOffers["option"];
}

export interface ContractsData {
  seasons: number[];
  caps: number[];
  rows: ContractRow[];
  cap: CapSummary;
  deadCap: DeadCapItem[];
  deadBySeason: number[];
  tagsUsed: number;
  extensionsUsed: number;
  /** season contract changes are measured against (next season once the current one is over) */
  capSeason: number;
  enforced: boolean;
  window: ContractWindow;
}

/** Everything the contract rules need for one team (shared by /team/contracts and the contract server actions). */
export async function loadContractContext(ctx: LeagueContext, teamId: string) {
  const { league, season } = ctx;
  const [roster, dead, positionSalaries, contractTx] = await Promise.all([
    getTeamRoster(teamId),
    leagueDeadCap(league.id),
    db.rosterSpot.findMany({ where: { leagueId: league.id }, select: { salary: true, player: { select: { position: true } } } }),
    db.transaction.findMany({ where: { leagueId: league.id, type: "CONTRACT" }, select: { teamId: true, playerId: true, season: true, details: true } }),
  ]);
  const rookieIds = roster.filter((r) => r.isRookieContract).map((r) => r.playerId);
  const [selections, picks] = rookieIds.length
    ? await Promise.all([
        db.draftSelection.findMany({ where: { playerId: { in: rookieIds }, draft: { leagueId: league.id, type: "ROOKIE" } }, select: { playerId: true, round: true, madeAt: true }, orderBy: { madeAt: "asc" } }),
        db.draftPick.findMany({ where: { leagueId: league.id, playerId: { in: rookieIds } }, select: { playerId: true, round: true, season: true }, orderBy: { season: "asc" } }),
      ])
    : [[], []];
  const draftRound = new Map<string, number>();
  for (const p of picks) if (p.playerId) draftRound.set(p.playerId, p.round);
  for (const sel of selections) draftRound.set(sel.playerId, sel.round);
  const kind = (d: unknown) => ((d ?? {}) as { kind?: string }).kind;
  const mineThisSeason = contractTx.filter((t) => t.teamId === teamId && t.season === season);
  const teamDead = (dead.get(teamId) ?? []).map((d) => ({ ...d, current: d.bySeason.find((x) => x.season === season)?.amount ?? 0 })).sort((a, b) => b.current - a.current);
  const deadIn = (yr: number) => teamDead.reduce((a, d) => a + (d.bySeason.find((x) => x.season === yr)?.amount ?? 0), 0);
  const salariesByPos = new Map<string, number[]>();
  for (const sp of positionSalaries) {
    const p = normalizePosition(sp.player.position);
    if (!salariesByPos.has(p)) salariesByPos.set(p, []);
    salariesByPos.get(p)!.push(sp.salary);
  }
  const tagSeasons = new Map<string, number[]>();
  for (const t of contractTx) {
    if (kind(t.details) !== "FRANCHISE_TAG" || !t.playerId) continue;
    if (!tagSeasons.has(t.playerId)) tagSeasons.set(t.playerId, []);
    tagSeasons.get(t.playerId)!.push(t.season);
  }
  return {
    roster,
    deadCap: teamDead,
    deadIn,
    tagsUsed: mineThisSeason.filter((t) => kind(t.details) === "FRANCHISE_TAG").length,
    extensionsUsed: mineThisSeason.filter((t) => kind(t.details) === "EXTENSION").length,
    extended: new Set(mineThisSeason.filter((t) => kind(t.details) === "EXTENSION").map((t) => t.playerId)),
    optioned: new Set(contractTx.filter((t) => kind(t.details) === "ROOKIE_OPTION").map((t) => t.playerId)),
    tagSeasons,
    draftRound,
    salariesByPos,
  };
}

export type ContractContext = Awaited<ReturnType<typeof loadContractContext>>;

/** Contract offers (extend / tag / option) for one rostered player. */
export function offersFor(ctx: LeagueContext, cc: ContractContext, r: RosterEntry): ContractOffers {
  return contractOffers({
    settings: ctx.settings,
    phase: ctx.league.phase,
    season: ctx.season,
    spot: { ...r, yearsExp: r.player.yearsExp },
    roster: cc.roster.map((x) => ({ playerId: x.playerId, salary: x.salary, contractYears: x.contractYears, status: x.status, isRookieContract: x.isRookieContract, yearsExp: x.player.yearsExp })),
    dead: [cc.deadIn(ctx.season), cc.deadIn(ctx.season + 1)],
    positionSalaries: cc.salariesByPos.get(normalizePosition(r.player.position)) ?? [],
    extendedThisSeason: cc.extended.has(r.playerId),
    extensionsUsed: cc.extensionsUsed,
    tagsUsedThisSeason: cc.tagsUsed,
    tagSeasons: cc.tagSeasons.get(r.playerId) ?? [],
    optionUsed: cc.optioned.has(r.playerId),
    draftRound: cc.draftRound.get(r.playerId) ?? null,
  });
}

export async function loadContracts(ctx: LeagueContext, teamId: string, opts: { manage: boolean }): Promise<ContractsData> {
  const { league, settings, season } = ctx;
  const cc = await loadContractContext(ctx, teamId);
  const { roster } = cc;
  const cap = await capSummary(league.id, teamId, season, settings, roster);
  const years = Math.max(1, settings.contracts.maxYears);
  const seasons = Array.from({ length: years }, (_, i) => season + i);
  const caps = seasons.map((_, i) => capForSeason(settings, i));
  const deadBySeason = seasons.map((s) => cc.deadIn(s));

  const rows: ContractRow[] = roster
    .map((r) => {
      const offers = opts.manage ? offersFor(ctx, cc, r) : null;
      return {
        playerId: r.playerId,
        name: r.player.fullName,
        position: r.player.position,
        nflTeam: r.player.team,
        injuryStatus: r.player.injuryStatus,
        age: r.player.age,
        status: r.status,
        salary: r.salary,
        capHit: capHit(r, settings),
        contractYears: r.contractYears,
        contractEnd: contractEndSeason(season, r.contractYears),
        contractStart: r.contractStart,
        isRookie: r.isRookieContract,
        isTagged: r.isFranchiseTagged,
        acquiredVia: r.acquiredVia,
        acquiredAt: r.acquiredAt.toISOString(),
        bySeason: seasons.map((_, i) => (i < r.contractYears ? salaryInYear(r.salary, i, settings, r) : null)),
        cutCost: deadMoneyPreview(r, settings, season, ctx.week, league.phase),
        extension: offers?.extension ?? null,
        tag: offers?.tag ?? null,
        option: offers?.option ?? null,
      };
    })
    .sort((a, b) => b.salary - a.salary || a.name.localeCompare(b.name));
  return {
    seasons,
    caps,
    rows,
    cap,
    deadCap: cc.deadCap,
    deadBySeason,
    tagsUsed: cc.tagsUsed,
    extensionsUsed: cc.extensionsUsed,
    capSeason: season + capSeasonOffset(league.phase),
    enforced: capEnforced(settings, league.phase),
    window: contractWindow(league.phase),
  };
}

// ───────────────────────────── Draft picks ─────────────────────────────

export interface PickRow {
  id: string;
  season: number;
  round: number;
  originalTeam: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
  owner: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
  pickInRound: number | null;
  projected: boolean;
  overall: number | null;
  tier: string;
  salary: number | null;
  acquiredAt: string | null;
}

export interface PicksData {
  seasons: number[];
  owned: PickRow[];
  tradedAway: PickRow[];
  teamCount: number;
  nextDraft: { id: string; status: string; startTime: string | null; name: string } | null;
}

export async function loadPicks(ctx: LeagueContext, teamId: string): Promise<PicksData> {
  const { league, settings, season } = ctx;
  const first = firstOpenDraftSeason(season, league.phase);
  const seasons = Array.from({ length: Math.max(1, settings.trades.futurePickYears) }, (_, i) => first + i);
  const include = {
    originalTeam: true,
    ownerTeam: true,
    tradeAssets: { where: { trade: { status: "COMPLETED" as const } }, select: { toTeamId: true, trade: { select: { completedAt: true } } } },
  };
  const [owned, away, standings, teamCount, draft] = await Promise.all([
    db.draftPick.findMany({ where: { leagueId: league.id, ownerTeamId: teamId, playerId: null, season: { in: seasons } }, include, orderBy: [{ season: "asc" }, { round: "asc" }] }),
    db.draftPick.findMany({ where: { leagueId: league.id, originalTeamId: teamId, ownerTeamId: { not: teamId }, playerId: null, season: { in: seasons } }, include, orderBy: [{ season: "asc" }, { round: "asc" }] }),
    computeStandings(league.id, season, settings),
    db.team.count({ where: { leagueId: league.id } }),
    db.draft.findFirst({ where: { leagueId: league.id, type: "ROOKIE", season: first }, orderBy: { createdAt: "desc" } }),
  ]);
  const order = projectedPickOrder(standings.map((s) => ({ teamId: s.team.id, rank: s.rank, pointsFor: s.pointsFor })), settings.draft.rookie.orderMethod);
  const tm = (t: Team) => ({ id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor });
  const toRow = (p: (typeof owned)[number]): PickRow => {
    let slot = p.pickInRound;
    let projected = false;
    if (!slot && p.season === first && order.length) {
      const idx = order.indexOf(p.originalTeamId);
      if (idx >= 0) {
        slot = settings.draft.rookie.style === "SNAKE" && p.round % 2 === 0 ? order.length - idx : idx + 1;
        projected = true;
      }
    }
    const trades = p.tradeAssets.filter((a) => a.toTeamId === p.ownerTeamId && a.trade.completedAt).map((a) => a.trade.completedAt!.getTime());
    return {
      id: p.id,
      season: p.season,
      round: p.round,
      originalTeam: tm(p.originalTeam),
      owner: tm(p.ownerTeam),
      pickInRound: slot,
      projected,
      overall: p.overall ?? (slot ? (p.round - 1) * teamCount + slot : null),
      tier: pickTier(p.round, slot, teamCount),
      salary: rookieScaleSalary(settings, p.round, slot),
      acquiredAt: trades.length ? new Date(Math.max(...trades)).toISOString() : null,
    };
  };
  const sortRows = (a: PickRow, b: PickRow) => a.season - b.season || a.round - b.round || (a.pickInRound ?? 99) - (b.pickInRound ?? 99);
  return {
    seasons,
    owned: owned.map(toRow).sort(sortRows),
    tradedAway: away.map(toRow).sort(sortRows),
    teamCount,
    nextDraft: draft ? { id: draft.id, status: draft.status, startTime: draft.startTime?.toISOString() ?? null, name: draft.name } : null,
  };
}

// ───────────────────────────── Transactions ─────────────────────────────

export async function recentTransactions(leagueId: string, teamId: string, take = 12) {
  return db.transaction.findMany({
    where: { leagueId, teamId },
    orderBy: { createdAt: "desc" },
    take,
    include: { player: { select: { id: true, fullName: true, position: true, team: true, injuryStatus: true } } },
  });
}

