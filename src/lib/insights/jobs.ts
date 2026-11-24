// Background job "lineup-warnings" (hourly): warn managers whose starters are Out / IR / Doubtful / Suspended,
// on a bye, or whose lineup has empty slots, when the relevant kickoff is within
// settings.notifications.lineupReminderHoursBefore hours (off when settings.lineup.emptyStarterAlerts is off).
// Deduped per team/player-or-slot/week via KeyValue.
import { db } from "@/lib/db";
import { lastFantasyWeek, leagueWeekFor } from "@/lib/league-week";
import { getLineup, isLocked, weekGamesByTeam } from "@/lib/lineup";
import { getNflState } from "@/lib/nfl/state";
import { notify } from "@/lib/notify";
import { expandSlots, resolveSettings } from "@/lib/settings/schema";
import { findLineupWarnings, type LineupWarning, type WarningPlayer } from "@/lib/insights/engine";
import { formatKickoff } from "@/lib/team/format";
import { slotId, type Assignment } from "@/lib/team/lineup-model";
import { lockClock } from "@/lib/team/roster-rules";

export function lineupWarningKey(teamId: string, season: number, week: number, key: string) {
  return `lw:${teamId}:${season}:${week}:${key}`;
}

function describe(w: LineupWarning, tz: string): string {
  const when = formatKickoff(w.kickoff, tz);
  if (w.kind === "empty") return `Your ${w.slotLabel} slot is empty (next kickoff ${when}).`;
  if (w.kind === "bye") return `${w.playerName} (${w.slotLabel}) is on a bye this week.`;
  if (w.kind === "doubtful") return `${w.playerName} (${w.slotLabel}) is Doubtful — kickoff ${when}.`;
  return `${w.playerName} (${w.slotLabel}) is ${w.status === "IR" ? "on IR" : `listed ${w.status}`} — kickoff ${when}.`;
}

export interface LineupWarningOptions {
  /** evaluate as of this time (default: now) */
  now?: Date;
  /** override the league week (testing / previews) */
  week?: number;
  /** compute and report only: no notifications, no dedupe rows */
  dryRun?: boolean;
}

export async function sendLineupWarnings(opts: LineupWarningOptions = {}): Promise<string> {
  const nfl = await getNflState();
  const leagues = await db.league.findMany({ where: { phase: { in: ["REGULAR", "PLAYOFFS"] } } });
  const now = opts.now ?? new Date();
  const preview: string[] = [];
  let notifications = 0;
  let issues = 0;
  let checkedTeams = 0;

  for (const league of leagues) {
    const settings = resolveSettings(league.settings);
    const hours = settings.notifications.lineupReminderHoursBefore;
    if (!hours || hours <= 0 || !settings.lineup.emptyStarterAlerts) continue;
    const season = league.season;
    const week = opts.week ?? leagueWeekFor(league, settings, nfl);
    if (week > lastFantasyWeek(settings)) continue;
    const games = await weekGamesByTeam(season, week);
    const upcoming = [...new Set(games.values())].some((g) => g.state === "pre" && g.startTime > now && g.startTime.getTime() - now.getTime() <= hours * 3600_000);
    if (!upcoming) continue;

    const slots = expandSlots(settings);
    const clock = lockClock(settings, now);
    const [teams, matchups, lineupRows, members] = await Promise.all([
      db.team.findMany({ where: { leagueId: league.id }, select: { id: true, name: true, ownerId: true } }),
      db.matchup.findMany({ where: { leagueId: league.id, season, week }, select: { homeTeamId: true, awayTeamId: true } }),
      db.lineupSlot.findMany({ where: { leagueId: league.id, season, week } }),
      db.leagueMember.findMany({ where: { leagueId: league.id, teamId: { not: null } }, select: { teamId: true, userId: true } }),
    ]);
    // Only teams that actually play this week (playoff byes / eliminated teams are skipped)
    const playing = new Set(matchups.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x));
    const lineups = new Map<string, Assignment>();
    for (const team of teams) {
      if (!playing.has(team.id)) continue;
      const rows = lineupRows.filter((r) => r.teamId === team.id);
      let list: { slot: string; slotIndex: number; playerId: string | null }[] = rows;
      // no lineup yet this week: create it the same way the site does (carry forward last week's)
      if (!rows.length) {
        if (opts.dryRun) continue;
        list = await getLineup(team.id, league.id, season, week, settings);
      }
      const lineup: Assignment = {};
      for (const s of slots) lineup[slotId(s.key, s.index)] = list.find((r) => r.slot === s.key && r.slotIndex === s.index)?.playerId ?? null;
      lineups.set(team.id, lineup);
    }
    const playerIds = [...new Set([...lineups.values()].flatMap((l) => Object.values(l)).filter((x): x is string => !!x))];
    const players = new Map<string, WarningPlayer>(
      (await db.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, fullName: true, team: true, injuryStatus: true } })).map((p) => [p.id, p]),
    );
    const usersByTeam = new Map<string, Set<string>>();
    for (const t of teams) usersByTeam.set(t.id, new Set(t.ownerId ? [t.ownerId] : []));
    for (const m of members) if (m.teamId) usersByTeam.get(m.teamId)?.add(m.userId);

    const perTeam: { teamId: string; warnings: LineupWarning[]; keys: string[] }[] = [];
    for (const team of teams) {
      const lineup = lineups.get(team.id);
      if (!lineup) continue;
      checkedTeams++;
      const warnings = findLineupWarnings({ slots, lineup, players, games, now, hoursBefore: hours, isLocked: (t) => isLocked(t, games, settings, clock) });
      if (!warnings.length) continue;
      perTeam.push({ teamId: team.id, warnings, keys: warnings.map((w) => lineupWarningKey(team.id, season, week, w.key)) });
    }
    if (!perTeam.length) continue;
    const sent = new Set((await db.keyValue.findMany({ where: { key: { in: perTeam.flatMap((p) => p.keys) } }, select: { key: true } })).map((k) => k.key));

    for (const p of perTeam) {
      const fresh = p.warnings.filter((_, i) => !sent.has(p.keys[i]));
      if (!fresh.length) continue;
      const userIds = [...(usersByTeam.get(p.teamId) ?? [])];
      const keys = fresh.map((w) => lineupWarningKey(p.teamId, season, week, w.key));
      if (opts.dryRun) {
        issues += fresh.length;
        preview.push(`${teams.find((t) => t.id === p.teamId)?.name}: ${fresh.map((w) => describe(w, settings.general.timezone)).join(" ")}`);
        continue;
      }
      // record first so a slow/failed push never causes duplicate alerts on the next run
      await db.keyValue.createMany({ data: keys.map((key) => ({ key, value: { at: now.toISOString(), week } })), skipDuplicates: true });
      issues += fresh.length;
      if (!userIds.length) continue;
      const tz = settings.general.timezone;
      const first = fresh[0];
      const title =
        fresh.length === 1
          ? first.kind === "empty"
            ? `Lineup warning: empty ${first.slotLabel} slot`
            : `Lineup warning: ${first.playerName} ${first.kind === "bye" ? "is on bye" : `is ${first.status ?? "out"}`}`
          : `Lineup warning: ${fresh.length} starters need attention`;
      await notify({
        userIds,
        leagueId: league.id,
        type: "LINEUP_WARNING",
        title,
        body: `${fresh.map((w) => describe(w, tz)).join(" ")} Set your Week ${week} lineup before kickoff.`,
        url: "/team",
        data: { teamId: p.teamId, week, players: fresh.map((w) => w.key) },
      });
      notifications++;
    }
  }
  const summary = `lineup warnings: ${notifications} notification${notifications === 1 ? "" : "s"} · ${issues} issue${issues === 1 ? "" : "s"} · ${checkedTeams} lineups checked`;
  return opts.dryRun ? [`${summary} (dry run)`, ...preview].join("\n") : summary;
}
