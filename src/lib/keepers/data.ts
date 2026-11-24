// Keeper data loaders shared by /team/keepers, the keeper server actions, the deadline job and the rollover.
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import {
  checkSelection,
  countsTowardLimit,
  keeperContractYears,
  keeperEligibility,
  keeperSalary,
  keeperWindowState,
  needsDesignation,
  projectNextSeason,
  type CapProjection,
  type KeeperWindow,
  type ProjectionSpot,
  type SelectionCheck,
} from "@/lib/keepers/logic";

export const KEEPER_LOCK_KEY = (leagueId: string, season: number) => `keepers:locked:${leagueId}:${season}`;

export async function keepersLocked(leagueId: string, nextSeason: number): Promise<boolean> {
  const [kv, locked] = await Promise.all([
    db.keyValue.findUnique({ where: { key: KEEPER_LOCK_KEY(leagueId, nextSeason) } }),
    db.keeperDesignation.count({ where: { leagueId, season: nextSeason, status: "LOCKED" } }),
  ]);
  return !!kv || locked > 0;
}

export async function loadKeeperWindow(league: { id: string; season: number; phase: string }, settings: LeagueSettings, now = new Date()): Promise<KeeperWindow> {
  return keeperWindowState({ settings, phase: league.phase, now, locked: await keepersLocked(league.id, league.season + 1) });
}

export interface KeeperRow {
  spotId: string;
  playerId: string;
  player: { id: string; fullName: string; position: string; team: string | null; injuryStatus: string | null; yearsExp: number | null; rookieYear: number | null };
  status: string;
  salary: number;
  contractYears: number;
  keeperCount: number;
  isRookieContract: boolean;
  isFranchiseTagged: boolean;
  expiring: boolean;
  eligible: boolean;
  reason: string | null;
  keeperSalary: number;
  keeperYears: number;
  countsTowardLimit: boolean;
  designated: boolean;
  designationStatus: string | null;
  salaryNext: number;
  statusNext: string;
  outcome: "ROLLS" | "KEPT" | "RELEASED";
}

export interface TeamKeeperView {
  nextSeason: number;
  rows: KeeperRow[];
  projection: CapProjection;
  check: SelectionCheck;
  deadNext: number;
}

/** Dead money charged to `season` per team */
export async function deadMoneyBySeason(leagueId: string, season: number): Promise<Map<string, number>> {
  const states = await db.leaguePlayerState.findMany({ where: { leagueId }, select: { deadCap: true } });
  const out = new Map<string, number>();
  for (const s of states) for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) if (d.season === season) out.set(d.teamId, (out.get(d.teamId) ?? 0) + d.amount);
  return out;
}

type SpotWithPlayer = Awaited<ReturnType<typeof loadSpots>>[number];

function loadSpots(where: { teamId: string } | { leagueId: string }) {
  return db.rosterSpot.findMany({
    where,
    include: { player: { select: { id: true, fullName: true, position: true, team: true, injuryStatus: true, yearsExp: true, rookieYear: true } } },
    orderBy: [{ salary: "desc" }],
  });
}

function toProjectionSpot(s: SpotWithPlayer): ProjectionSpot {
  return {
    playerId: s.playerId,
    status: s.status,
    salary: s.salary,
    contractYears: s.contractYears,
    keeperCount: s.keeperCount,
    isRookieContract: s.isRookieContract,
    yearsExp: s.player.yearsExp,
    rookieYear: s.player.rookieYear,
  };
}

export function buildTeamKeeperView(
  spots: SpotWithPlayer[],
  designations: { playerId: string; status: string; teamId: string }[],
  settings: LeagueSettings,
  nextSeason: number,
  deadNext: number,
  override?: { playerId: string; keep: boolean },
): TeamKeeperView {
  const desig = new Map(designations.map((d) => [d.playerId, d]));
  const designated = new Set(spots.filter((s) => desig.get(s.playerId)?.teamId === s.teamId).map((s) => s.playerId));
  if (override) {
    if (override.keep) designated.add(override.playerId);
    else designated.delete(override.playerId);
  }
  const pspots = spots.map(toProjectionSpot);
  const projection = projectNextSeason({ spots: pspots, designated, settings, nextSeason, deadMoney: deadNext });
  const check = checkSelection({ spots: pspots, designated, settings, projection });
  const proj = new Map(projection.rows.map((r) => [r.playerId, r]));
  const rows: KeeperRow[] = spots.map((s, i) => {
    const ps = pspots[i];
    const elig = keeperEligibility(ps, settings);
    const r = proj.get(s.playerId)!;
    return {
      spotId: s.id,
      playerId: s.playerId,
      player: s.player,
      status: s.status,
      salary: s.salary,
      contractYears: s.contractYears,
      keeperCount: s.keeperCount,
      isRookieContract: s.isRookieContract,
      isFranchiseTagged: s.isFranchiseTagged,
      expiring: needsDesignation(ps, settings),
      eligible: elig.eligible,
      reason: elig.reason,
      keeperSalary: keeperSalary(s.salary, settings),
      keeperYears: keeperContractYears(ps),
      countsTowardLimit: countsTowardLimit(ps, settings),
      designated: designated.has(s.playerId),
      designationStatus: desig.get(s.playerId)?.teamId === s.teamId ? (desig.get(s.playerId)?.status ?? null) : null,
      salaryNext: r.salaryNext,
      statusNext: r.statusNext,
      outcome: r.outcome,
    };
  });
  return { nextSeason, rows, projection, check, deadNext };
}

export async function loadTeamKeepers(leagueId: string, teamId: string, settings: LeagueSettings, season: number, override?: { playerId: string; keep: boolean }): Promise<TeamKeeperView> {
  const nextSeason = season + 1;
  const [spots, designations, dead] = await Promise.all([
    loadSpots({ teamId }),
    db.keeperDesignation.findMany({ where: { leagueId, season: nextSeason, teamId }, select: { playerId: true, status: true, teamId: true } }),
    deadMoneyBySeason(leagueId, nextSeason),
  ]);
  return buildTeamKeeperView(spots, designations, settings, nextSeason, dead.get(teamId) ?? 0, override);
}

/** Every team's designations for next season (league-wide keeper list) */
export async function loadLeagueKeepers(leagueId: string, nextSeason: number) {
  return db.keeperDesignation.findMany({
    where: { leagueId, season: nextSeason, status: { in: ["DESIGNATED", "LOCKED"] } },
    include: { player: { select: { id: true, fullName: true, position: true, team: true, injuryStatus: true } }, team: { select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } } },
    orderBy: [{ teamId: "asc" }, { keeperSalary: "desc" }],
  });
}

/** League-wide summary per team: expiring players, designated, next season payroll. Batched (no N+1). */
export async function loadLeagueKeeperSummary(leagueId: string, settings: LeagueSettings, season: number) {
  const nextSeason = season + 1;
  const [teams, spots, designations, dead] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { name: "asc" }, select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } }),
    loadSpots({ leagueId }),
    db.keeperDesignation.findMany({ where: { leagueId, season: nextSeason }, select: { playerId: true, status: true, teamId: true } }),
    deadMoneyBySeason(leagueId, nextSeason),
  ]);
  return teams.map((t) => {
    const view = buildTeamKeeperView(
      spots.filter((s) => s.teamId === t.id),
      designations.filter((d) => d.teamId === t.id),
      settings,
      nextSeason,
      dead.get(t.id) ?? 0,
    );
    return { team: t, view };
  });
}
