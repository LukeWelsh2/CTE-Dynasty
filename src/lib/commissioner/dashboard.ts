// Commissioner dashboard data: alerts that need the commissioner's attention, batched (no N+1).
import "server-only";
import type { Player } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { capHit, validateRoster } from "@/lib/roster";
import { getLineup, weekGamesByTeam } from "@/lib/lineup";

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
}

export interface DashboardData {
  tradesAwaiting: number;
  tradesVoting: number;
  teamAlerts: TeamAlert[];
  underFloor: { team: string; abbrev: string; committed: number }[];
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
  for (const t of teams) {
    const roster = byTeam.get(t.id) ?? [];
    const deadMoney = dead.get(t.id) ?? 0;
    const committed = roster.reduce((a, s) => a + capHit(s, settings), 0) + deadMoney;
    const problems = validateRoster(roster, settings, { checkCap: settings.salaryCap.enabled, deadMoney });
    if (settings.salaryCap.enabled && !settings.salaryCap.enforceInSeason && committed > settings.salaryCap.cap) problems.push(`Over the $${settings.salaryCap.cap} cap by $${committed - settings.salaryCap.cap}.`);
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
    const weekTeams = await db.matchup.findMany({ where: { leagueId: league.id, season, week }, select: { homeTeamId: true, awayTeamId: true } });
    const playing = new Set(weekTeams.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x));
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
      if (empty || out.length || bye.length) lineupAlerts.push({ teamId: t.id, team: t.name, abbrev: t.abbrev, empty, out, bye });
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

/** Human label for an audit action */
export const AUDIT_LABELS: Record<string, string> = {
  "settings.update": "Updated league settings",
  "settings.revert": "Reverted league settings",
  "scoring.update": "Updated scoring rules",
  "dues.update": "Updated the dues tracker",
  "member.invite": "Created an invite",
  "member.invite_revoke": "Revoked an invite",
  "member.invite_resend": "Re-sent an invite",
  "member.role": "Changed a member's role",
  "member.remove": "Removed a member",
  "member.assign": "Assigned a team owner",
  "member.replace": "Replaced a team's manager",
  "league.invite_code": "Reset the league invite code",
  "team.update": "Edited a team",
  "team.create": "Added an expansion team",
  "roster.update": "Edited a roster spot",
  "roster.force_add": "Force-added a player",
  "roster.force_drop": "Force-dropped a player",
  "roster.move": "Moved a player between teams",
  "roster.dead_money_forgive": "Forgave dead money",
  "faab.adjust": "Adjusted FAB",
  "pick.owner": "Changed draft pick ownership",
  "schedule.regenerate": "Regenerated the schedule",
  "schedule.week_edit": "Edited a week's matchups",
  "score.adjust": "Added a score adjustment",
  "score.adjust_delete": "Removed a score adjustment",
  "score.recalc": "Recalculated a week",
  "league.week_override": "Changed the league week",
  "job.run": "Ran a background job",
  "announcement.create": "Posted an announcement",
  "announcement.pin": "Pinned / unpinned an announcement",
  "announcement.delete": "Deleted an announcement",
  "system.test_email": "Sent a test email",
  "system.test_push": "Sent a test push",
};

export function auditLabel(action: string): string {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action];
  const [scope, verb] = action.split(".");
  return `${scope.charAt(0).toUpperCase()}${scope.slice(1)}: ${(verb ?? "").replace(/_/g, " ")}`;
}

/** Short description of an audit row's details */
export function auditDetail(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["summary", "note", "team", "player", "reason"]) if (typeof d[k] === "string" && d[k]) parts.push(String(d[k]));
  if (typeof d.version === "number") parts.push(`v${d.version}`);
  if (Array.isArray(d.sections)) parts.push((d.sections as string[]).join(", "));
  return parts.join(" · ");
}
