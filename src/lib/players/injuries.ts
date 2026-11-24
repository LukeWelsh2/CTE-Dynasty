// League injury report: every fantasy-relevant injured player with owner, status, practice, latest note.
import "server-only";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { latestInjuryReports } from "@/lib/players/injury-data";
import { effectiveInjury, injuryGroup, injurySeverity, practiceFromText, rawPositionsFor, type EffectiveInjury, type InjuryGroup, type PositionFilter } from "@/lib/players/logic";
import { getLeagueIndexes } from "@/lib/players/stats-index";

/** Team defenses have no injury report */
const RAW_DEF = ["DEF"];

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
  // Every fantasy position is loaded so the league summary never depends on the filters; scope and position only
  // narrow the rows that are displayed.
  const allPositions = rawPositionsFor("ALL", ctx.settings).filter((p) => !RAW_DEF.includes(p));
  const shownPositions = new Set(f.pos === "ALL" ? allPositions : rawPositionsFor(f.pos, ctx.settings));
  const latest = await latestInjuryReports();
  const reportIds = [...latest.values()].filter((r) => r.status !== "Active").map((r) => r.playerId);
  const [spots, lineup, idx] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId: ctx.league.id }, include: { team: true } }),
    db.lineupSlot.findMany({ where: { leagueId: ctx.league.id, season: ctx.season, week: ctx.week, playerId: { not: null } }, select: { playerId: true, teamId: true } }),
    getLeagueIndexes(ctx.league.id, ctx.season, ctx.settings, ctx.week),
  ]);
  const spotBy = new Map(spots.map((s) => [s.playerId, s]));
  const rosteredIds = spots.map((s) => s.playerId);
  const players = await db.player.findMany({
    where: {
      position: { in: allPositions },
      OR: [{ id: { in: rosteredIds } }, ...(f.scope === "all" ? [{ injuryStatus: { not: null } }, { id: { in: reportIds } }] : [])],
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

  const all: InjuryRow[] = [];
  for (const p of players) {
    const injury = effectiveInjury(p, latest.get(p.id));
    if (!injury.status) continue;
    const spot = spotBy.get(p.id);
    const pts = seasonPts(p.id);
    // unrostered players count as fantasy-relevant when they are on an NFL roster and either ranked or productive
    if (!spot && (!p.team || ((p.searchRank ?? 99999) > 600 && pts <= 0))) continue;
    const starterTeam = starters.get(p.id) ?? null;
    all.push({
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
  all.sort((a, b) => Number(b.myStarter) - Number(a.myStarter) || Number(!!b.owner?.isMine) - Number(!!a.owner?.isMine) || b.seasonPts - a.seasonPts);

  const rows = all.filter((r) => shownPositions.has(r.player.position) && (f.scope === "all" || (f.scope === "rostered" ? !!r.owner : !!r.owner?.isMine)));
  const rostered = all.filter((r) => r.owner);
  const mine = rostered.filter((r) => r.owner?.isMine);
  const summary = {
    myInjuredStarters: mine.filter((r) => r.myStarter).length,
    myStartersOut: mine.filter((r) => r.myStarter && injurySeverity(r.injury.status) >= 3).length,
    myInjured: mine.length,
    myIr: mine.filter((r) => r.group === "IR").length,
    leagueRosteredInjured: rostered.length,
    leagueInjuredStarters: rostered.filter((r) => r.starterFor).length,
    questionableStarters: rostered.filter((r) => r.starterFor && r.group === "QUESTIONABLE").length,
  };
  return { rows, summary };
}
