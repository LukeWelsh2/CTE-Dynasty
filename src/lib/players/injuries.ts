// League injury report: every fantasy-relevant injured player with owner, status, practice, latest note.
import "server-only";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { latestInjuryReports } from "@/lib/players/injury-data";
import { effectiveInjury, injuryGroup, injurySeverity, practiceFromText, rawPositionsFor, type EffectiveInjury, type InjuryGroup, type PositionFilter } from "@/lib/players/logic";
import { getLeagueIndexes } from "@/lib/players/stats-index";

export interface InjuryFilters {
  scope: "mine" | "rostered" | "all";
  pos: PositionFilter;
}

export function parseInjuryFilters(sp: Record<string, string | string[] | undefined>, hasTeam: boolean): InjuryFilters {
  const s = Array.isArray(sp.scope) ? sp.scope[0] : sp.scope;
  const p = ((Array.isArray(sp.pos) ? sp.pos[0] : sp.pos) ?? "").toUpperCase();
  const scope = s === "mine" || s === "rostered" || s === "all" ? s : hasTeam ? "rostered" : "all";
  const pos = (["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"].includes(p) ? p : "ALL") as PositionFilter;
  return { scope: scope === "mine" && !hasTeam ? "rostered" : scope, pos };
}

function practiceFor(official: string | null, injury: EffectiveInjury): InjuryRow["practice"] {
  if (official) return { value: official, derived: false };
  const fresh = injury.updatedAt && Date.now() - new Date(injury.updatedAt).getTime() < 7 * 86_400_000;
  const derived = fresh ? practiceFromText(injury.note) ?? practiceFromText(injury.detail) : null;
  return { value: derived, derived: !!derived };
}

export interface InjuryRow {
  player: { id: string; fullName: string; position: string; team: string | null; practiceParticipation: string | null; practiceDescription: string | null };
  injury: EffectiveInjury;
  group: InjuryGroup;
  owner: { teamId: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string; isMine: boolean } | null;
  rosterStatus: string | null;
  /** official participation, or read from the latest report note (derived) */
  practice: { value: string | null; derived: boolean };
  myStarter: boolean;
  starterFor: string | null;
  seasonPts: number;
}

export async function loadInjuryReport(ctx: LeagueContext, f: InjuryFilters) {
  const fantasyPositions = f.pos === "ALL" ? ["QB", "RB", "WR", "TE", "K", ...(ctx.settings.roster.idpEnabled ? ["DL", "LB", "DB"] : [])] : [f.pos];
  const positions = fantasyPositions.flatMap((fp) => rawPositionsFor(fp as PositionFilter, ctx.settings));
  const latest = await latestInjuryReports();
  const reportIds = [...latest.values()].filter((r) => r.status !== "Active").map((r) => r.playerId);
  const [spots, lineup, idx] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId: ctx.league.id }, include: { team: true } }),
    db.lineupSlot.findMany({ where: { leagueId: ctx.league.id, season: ctx.season, week: ctx.week, playerId: { not: null } }, select: { playerId: true, teamId: true } }),
    getLeagueIndexes(ctx.league.id, ctx.season, ctx.settings, ctx.week),
  ]);
  const spotBy = new Map(spots.map((s) => [s.playerId, s]));
  const scopeIds = f.scope === "mine" ? spots.filter((s) => s.teamId === ctx.myTeam?.id).map((s) => s.playerId) : f.scope === "rostered" ? spots.map((s) => s.playerId) : null;
  const players = await db.player.findMany({
    where: {
      position: { in: positions },
      ...(scopeIds ? { id: { in: scopeIds } } : { OR: [{ injuryStatus: { not: null } }, { id: { in: reportIds } }] }),
    },
    select: {
      id: true,
      fullName: true,
      position: true,
      team: true,
      searchRank: true,
      injuryStatus: true,
      injuryBodyPart: true,
      injuryNotes: true,
      practiceParticipation: true,
      practiceDescription: true,
    },
  });
  const starters = new Map(lineup.map((l) => [l.playerId!, l.teamId]));
  const teamName = new Map(spots.map((s) => [s.teamId, s.team.name]));
  const seasonPts = (id: string) => {
    let t = 0;
    for (const [w, v] of idx.points.actual.get(id)?.byWeek ?? []) if (w <= ctx.week) t += v;
    return Math.round(t * 10) / 10;
  };

  const rows: InjuryRow[] = [];
  for (const p of players) {
    const injury = effectiveInjury(p, latest.get(p.id));
    if (!injury.status) continue;
    const spot = spotBy.get(p.id);
    const pts = seasonPts(p.id);
    // "all": fantasy-relevant = rostered in the league, or on an NFL roster and either ranked or productive
    if (!scopeIds && !spot && (!p.team || ((p.searchRank ?? 99999) > 600 && pts <= 0))) continue;
    const starterTeam = starters.get(p.id) ?? null;
    rows.push({
      player: { id: p.id, fullName: p.fullName, position: p.position, team: p.team, practiceParticipation: p.practiceParticipation, practiceDescription: p.practiceDescription },
      injury,
      group: injuryGroup(injury.status),
      owner: spot
        ? { teamId: spot.teamId, name: spot.team.name, abbrev: spot.team.abbrev, logoUrl: spot.team.logoUrl, primaryColor: spot.team.primaryColor, secondaryColor: spot.team.secondaryColor, isMine: spot.teamId === ctx.myTeam?.id }
        : null,
      rosterStatus: spot?.status ?? null,
      practice: practiceFor(p.practiceParticipation, injury),
      myStarter: !!ctx.myTeam && starterTeam === ctx.myTeam.id,
      starterFor: starterTeam ? (teamName.get(starterTeam) ?? null) : null,
      seasonPts: pts,
    });
  }
  rows.sort((a, b) => Number(b.myStarter) - Number(a.myStarter) || Number(!!b.owner?.isMine) - Number(!!a.owner?.isMine) || b.seasonPts - a.seasonPts);

  const mine = rows.filter((r) => r.owner?.isMine);
  const myStarterIds = new Set(lineup.filter((l) => l.teamId === ctx.myTeam?.id).map((l) => l.playerId));
  const summary = {
    myInjuredStarters: rows.filter((r) => r.myStarter).length,
    myStartersOut: rows.filter((r) => r.myStarter && injurySeverity(r.injury.status) >= 3).length,
    myInjured: mine.length,
    myIr: mine.filter((r) => r.group === "IR").length,
    myStarterCount: myStarterIds.size,
    leagueRosteredInjured: rows.filter((r) => r.owner).length,
    questionableStarters: rows.filter((r) => r.starterFor && r.group === "QUESTIONABLE").length,
  };
  return { rows, summary };
}
