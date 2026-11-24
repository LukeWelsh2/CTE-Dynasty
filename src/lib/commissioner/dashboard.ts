// Commissioner dashboard data: alerts that need the commissioner's attention, batched (no N+1).
import "server-only";
import type { Player } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { capHit, validateRoster } from "@/lib/roster";
import { getLineup, weekGamesByTeam } from "@/lib/lineup";
import { capProblem, effectiveRosterSettings, forfeitApplies, luxuryTaxFor } from "@/lib/commissioner/roster-logic";

export interface TeamAlert {
  teamId: string;
  team: string;
  abbrev: string;
  problems: string[];
  committed: number;
  space: number;
}

export interface LineupAlert {
  teamId: string;
  team: string;
  abbrev: string;
  empty: number;
  out: string[];
  bye: string[];
  /** starters expected to play (filled, not on bye, not ruled out) */
  playing: number;
  /**
   * below settings.niche.minimumStartersOrForfeit in a regular season game (playoff games are decided by the score
   * alone: forfeits never apply to them)
   */
  forfeitRisk: boolean;
}

export interface DashboardData {
  tradesAwaiting: number;
  tradesVoting: number;
  teamAlerts: TeamAlert[];
  underFloor: { team: string; abbrev: string; committed: number }[];
  /** soft cap: teams over the cap but within the allowed overage (they owe luxury tax) */
  overSoftCap: { teamId: string; team: string; abbrev: string; committed: number; over: number; tax: number }[];
  lineupAlerts: LineupAlert[];
  unclaimedTeams: { id: string; name: string }[];
  openInvites: number;
  failedJobs: { name: string; count: number; lastAt: Date; message: string | null }[];
  unpaidDues: { id: string; name: string }[];
  teamCount: number;
  memberCount: number;
  pendingClaims: number;
  audit: { id: string; action: string; createdAt: Date; actor: string | null; details: unknown; targetType: string | null }[];
  latestSettings: { version: number; createdAt: Date; by: string | null } | null;
}

const OUT_STATUSES = new Set(["out", "ir", "pup", "sus", "doubtful", "injured reserve"]);

export async function loadDashboard(ctx: LeagueContext): Promise<DashboardData> {
  const { league, settings, season, week } = ctx;
  const since = new Date(Date.now() - 24 * 3600_000);
  const [teams, spots, states, accepted, failed, invites, members, claims, auditRows, latest] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" } }),
    db.rosterSpot.findMany({ where: { leagueId: league.id }, include: { player: true } }),
    db.leaguePlayerState.findMany({ where: { leagueId: league.id }, select: { deadCap: true } }),
    db.trade.findMany({ where: { leagueId: league.id, status: "ACCEPTED" }, select: { reviewEndsAt: true } }),
    db.jobRun.findMany({ where: { status: "ERROR", startedAt: { gte: since } }, orderBy: { startedAt: "desc" } }),
    db.invite.findMany({ where: { leagueId: league.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { teamId: true } }),
    db.leagueMember.count({ where: { leagueId: league.id } }),
    db.waiverClaim.count({ where: { leagueId: league.id, status: "PENDING" } }),
    db.auditLog.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, take: 12, include: { actor: { select: { name: true } } } }),
    db.leagueSettingsHistory.findFirst({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" } }),
  ]);

  // dead money this season by team
  const dead = new Map<string, number>();
  for (const s of states)
    for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) if (d.season === season) dead.set(d.teamId, (dead.get(d.teamId) ?? 0) + d.amount);

  const byTeam = new Map<string, (typeof spots)[number][]>();
  for (const s of spots) {
    if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, []);
    byTeam.get(s.teamId)!.push(s);
  }

  const teamAlerts: TeamAlert[] = [];
  const underFloor: DashboardData["underFloor"] = [];
  const overSoftCap: DashboardData["overSoftCap"] = [];
  // offseason roster limit applies until the cutdown date
  const rules = effectiveRosterSettings(settings, league.phase);
  const cap = settings.salaryCap.cap;
  for (const t of teams) {
    const roster = byTeam.get(t.id) ?? [];
    const deadMoney = dead.get(t.id) ?? 0;
    const committed = roster.reduce((a, s) => a + capHit(s, settings), 0) + deadMoney;
    // the cap is checked here (not in validateRoster) so soft caps use their real ceiling
    const problems = validateRoster(roster, rules, { checkCap: false });
    const overCap = capProblem(committed, settings);
    if (overCap) problems.push(overCap);
    else if (settings.salaryCap.enabled && settings.salaryCap.capType === "SOFT" && committed > cap)
      overSoftCap.push({ teamId: t.id, team: t.name, abbrev: t.abbrev, committed, over: committed - cap, tax: luxuryTaxFor(committed, settings) });
    const active = roster.filter((s) => s.status === "ACTIVE").length;
    if (active < settings.roster.minActiveRoster) problems.push(`Only ${active} active players (minimum ${settings.roster.minActiveRoster}).`);
    for (const [pos, lim] of Object.entries(settings.roster.positionLimits)) {
      const n = roster.filter((s) => normalize(s.player) === pos).length;
      if (lim.min && n < lim.min) problems.push(`Needs at least ${lim.min} ${pos} (has ${n}).`);
    }
    if (problems.length) teamAlerts.push({ teamId: t.id, team: t.name, abbrev: t.abbrev, problems, committed, space: settings.salaryCap.cap - committed });
    if (settings.salaryCap.enabled && settings.salaryCap.floor > 0 && committed < settings.salaryCap.floor) underFloor.push({ team: t.name, abbrev: t.abbrev, committed });
  }

  // lineups this week (getLineup carries forward / creates rows on first view, like every lineup page)
  const lineupAlerts: LineupAlert[] = [];
  if (league.phase === "REGULAR" || league.phase === "PLAYOFFS") {
    const games = await weekGamesByTeam(season, week);
    const weekTeams = await db.matchup.findMany({ where: { leagueId: league.id, season, week }, select: { homeTeamId: true, awayTeamId: true, isPlayoff: true } });
    const playing = new Set(weekTeams.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x));
    // teams whose game this week is a regular season game (the only kind a forfeit can decide)
    const regularGame = new Set(weekTeams.filter((m) => !m.isPlayoff).flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x));
    const lineups = await Promise.all(teams.filter((t) => playing.has(t.id)).map(async (t) => ({ t, slots: await getLineup(t.id, league.id, season, week, settings) })));
    const playerById = new Map(spots.map((s) => [s.playerId, s.player]));
    const starterIds = lineups.flatMap((l) => l.slots.map((s) => s.playerId)).filter((x): x is string => !!x && !playerById.has(x));
    if (starterIds.length) for (const p of await db.player.findMany({ where: { id: { in: starterIds } } })) playerById.set(p.id, p);
    for (const { t, slots } of lineups) {
      const empty = slots.filter((s) => !s.playerId).length;
      const out: string[] = [];
      const bye: string[] = [];
      for (const s of slots) {
        const p = s.playerId ? playerById.get(s.playerId) : null;
        if (!p) continue;
        const g = p.team ? games.get(p.team) : undefined;
        if (games.size && (!p.team || !g)) bye.push(p.fullName);
        else if (OUT_STATUSES.has((p.injuryStatus ?? "").toLowerCase()) && (!g || g.state === "pre")) out.push(`${p.fullName} (${p.injuryStatus})`);
      }
      const playingCount = slots.length - empty - out.length - bye.length;
      const forfeitRisk = forfeitApplies(settings.niche.minimumStartersOrForfeit, playingCount, regularGame.has(t.id));
      if (empty || out.length || bye.length || forfeitRisk) lineupAlerts.push({ teamId: t.id, team: t.name, abbrev: t.abbrev, empty, out, bye, playing: playingCount, forfeitRisk });
    }
  }

  const jobMap = new Map<string, DashboardData["failedJobs"][number]>();
  for (const j of failed) {
    const cur = jobMap.get(j.name);
    if (cur) cur.count++;
    else jobMap.set(j.name, { name: j.name, count: 1, lastAt: j.startedAt, message: j.message?.split("\n")[0] ?? null });
  }

  const paid = new Set(settings.general.duesPaidTeamIds);
  const latestBy = latest?.changedById ? (await db.user.findUnique({ where: { id: latest.changedById }, select: { name: true } }))?.name ?? null : null;

  return {
    tradesAwaiting: settings.trades.reviewType === "COMMISSIONER" ? accepted.length : accepted.filter((t) => !t.reviewEndsAt).length,
    tradesVoting: settings.trades.reviewType === "LEAGUE_VOTE" ? accepted.filter((t) => t.reviewEndsAt).length : 0,
    teamAlerts,
    underFloor,
    overSoftCap,
    lineupAlerts,
    unclaimedTeams: teams.filter((t) => !t.ownerId).map((t) => ({ id: t.id, name: t.name })),
    openInvites: invites.filter((i) => !i.teamId || teams.some((t) => t.id === i.teamId && !t.ownerId)).length,
    failedJobs: [...jobMap.values()],
    unpaidDues: settings.general.leagueDues > 0 ? teams.filter((t) => !paid.has(t.id)).map((t) => ({ id: t.id, name: t.name })) : [],
    teamCount: teams.length,
    memberCount: members,
    pendingClaims: claims,
    audit: auditRows.map((a) => ({ id: a.id, action: a.action, createdAt: a.createdAt, actor: a.actor?.name ?? null, details: a.details, targetType: a.targetType })),
    latestSettings: latest ? { version: latest.version, createdAt: latest.createdAt, by: latestBy } : null,
  };
}

function normalize(p: Pick<Player, "position">) {
  const pos = (p.position ?? "").toUpperCase();
  if (["DE", "DT", "NT", "DL", "EDGE"].includes(pos)) return "DL";
  if (["LB", "ILB", "OLB", "MLB"].includes(pos)) return "LB";
  if (["CB", "S", "SS", "FS", "DB"].includes(pos)) return "DB";
  return pos;
}

// audit labels live in a pure module (unit-tested); re-exported for existing imports
export { AUDIT_LABELS, auditDetail, auditLabel } from "@/lib/commissioner/audit-labels";
