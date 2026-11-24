// Background job "keeper-deadlines" (hourly): reminders 7 days / 24 hours / 2 hours before
// settings.keepers.deadline (deduped via KeyValue), then at the deadline lock every designation for next
// season, log KEEPER transactions and tell the league.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { notify, leagueUserIds } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { broadcastTransaction } from "@/lib/roster-ops";
import { publish, topics } from "@/lib/realtime/bus";
import { designationApplies, dueReminder, keeperWindowState, REMINDER_THRESHOLDS } from "@/lib/keepers/logic";
import { KEEPER_LOCK_KEY, keepersLocked, loadLeagueKeeperSummary } from "@/lib/keepers/data";

const REMINDER_KEY = (leagueId: string, deadlineIso: string, k: string) => `keepers:remind:${leagueId}:${deadlineIso}:${k}`;

function fmt(d: Date, tz: string) {
  return d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

export async function processKeeperDeadlines(now = new Date()): Promise<string> {
  const leagues = await db.league.findMany({ select: { id: true, name: true, season: true, phase: true, settings: true } });
  const out: string[] = [];
  for (const league of leagues) {
    const settings = resolveSettings(league.settings);
    if (!settings.keepers.enabled || !settings.keepers.deadline) continue;
    const deadline = new Date(settings.keepers.deadline);
    if (Number.isNaN(deadline.getTime())) continue;
    const nextSeason = league.season + 1;
    const tz = settings.general.timezone;
    try {
      if (deadline <= now) {
        if (await keepersLocked(league.id, nextSeason)) continue;
        out.push(`${league.name}: ${await lockKeepers(league.id, nextSeason)}`);
        continue;
      }
      // no reminders once the commissioner locked keepers early, or while the window isn't open
      const window = keeperWindowState({ settings, phase: league.phase, now, locked: await keepersLocked(league.id, nextSeason) });
      if (window.status !== "OPEN") continue;
      const iso = deadline.toISOString();
      const keys = REMINDER_THRESHOLDS.map((t) => REMINDER_KEY(league.id, iso, t.key));
      const sentRows = await db.keyValue.findMany({ where: { key: { in: keys } }, select: { key: true } });
      const sent = new Set(sentRows.map((r) => r.key.split(":").pop()!));
      const due = dueReminder(deadline, now, sent);
      if (!due) continue;
      // per-team reminder with that team's status
      const summary = await loadLeagueKeeperSummary(league.id, settings, league.season);
      const teamUsers = await db.team.findMany({ where: { leagueId: league.id }, select: { id: true, ownerId: true, member: { select: { userId: true } } } });
      const usersByTeam = new Map(teamUsers.map((t) => [t.id, [t.ownerId, t.member?.userId].filter((x): x is string => !!x)]));
      for (const { team, view } of summary) {
        const expiring = view.rows.filter((r) => r.expiring && r.eligible).length;
        const kept = view.rows.filter((r) => r.designated).length;
        const problems = [...view.check.errors, ...view.check.warnings];
        const body = `Keeper deadline in ${due.label} (${fmt(deadline, tz)}). ${team.name}: ${kept} of ${expiring} eligible expiring player${expiring === 1 ? "" : "s"} designated.${problems.length ? " " + problems.join(" ") : ""} Undesignated expiring players are released at the rollover.`;
        await notify({ userIds: usersByTeam.get(team.id) ?? [], leagueId: league.id, type: "KEEPER_DEADLINE", title: `Keeper deadline in ${due.label}`, body, url: "/team/keepers" }).catch((e) =>
          console.error("[keepers] notify failed", e),
        );
      }
      for (const k of [due.key, ...due.skip]) {
        const key = REMINDER_KEY(league.id, iso, k);
        await db.keyValue.upsert({ where: { key }, create: { key, value: { sentAt: now.toISOString() } }, update: { value: { sentAt: now.toISOString() } } });
      }
      out.push(`${league.name}: ${due.label} reminder sent`);
    } catch (e) {
      out.push(`${league.name}: error ${(e as Error).message}`);
    }
  }
  return out.length ? out.join("; ") : "nothing due";
}

/**
 * Lock next season's designations (deadline reached). Idempotent: serialized with an advisory lock, every
 * keeper gets exactly one KEEPER transaction, and a second call reports "already locked".
 * Designations whose player left the designating team are locked under his new team when trades carry
 * keeper status (settings.keepers.tradeCarriesKeeperCost), and released otherwise (or when he was cut).
 */
export async function lockKeepers(leagueId: string, nextSeason: number, actorId: string | null = null): Promise<string> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const lockWeek = leagueWeekFor(league, settings, await getNflState());
  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${"keepers:lock:" + leagueId}))) AS l`;
      const designations = await tx.keeperDesignation.findMany({
        where: { leagueId, season: nextSeason, status: "DESIGNATED" },
        include: { player: { select: { fullName: true, position: true, team: true } } },
      });
      if (!designations.length && (await tx.keyValue.findUnique({ where: { key: KEEPER_LOCK_KEY(leagueId, nextSeason) } }))) return null;
      const spots = designations.length ? await tx.rosterSpot.findMany({ where: { leagueId, playerId: { in: designations.map((d) => d.playerId) } }, select: { playerId: true, teamId: true } }) : [];
      const holder = new Map(spots.map((s) => [s.playerId, s.teamId]));
      // a deadline that was extended after an earlier lock must not log the same keeper twice
      const logged = await tx.transaction.findMany({ where: { leagueId, type: "KEEPER", season: league.season }, select: { details: true } });
      const loggedIds = new Set(logged.map((t) => (t.details as { designationId?: string } | null)?.designationId).filter(Boolean));
      const txs = [];
      const kept: { teamId: string; name: string; salary: number }[] = [];
      let released = 0;
      for (const d of designations) {
        const teamId = holder.get(d.playerId);
        if (!designationApplies(d, teamId, settings)) {
          await tx.keeperDesignation.update({ where: { id: d.id }, data: { status: "RELEASED" } });
          released++;
          continue;
        }
        await tx.keeperDesignation.update({ where: { id: d.id }, data: { status: "LOCKED", teamId: teamId! } });
        kept.push({ teamId: teamId!, name: d.player.fullName, salary: d.keeperSalary });
        if (loggedIds.has(d.id)) continue;
        txs.push(
          await tx.transaction.create({
            data: {
              leagueId,
              season: league.season,
              week: lockWeek,
              type: "KEEPER",
              teamId: teamId!,
              playerId: d.playerId,
              salary: d.keeperSalary,
              description: `Kept ${d.player.fullName} (${d.player.position}${d.player.team ? " " + d.player.team : ""}) for ${nextSeason} — $${d.keeperSalary}, ${d.contractYears} yr${d.contractYears === 1 ? "" : "s"} (was $${d.currentSalary})`,
              details: { designationId: d.id, season: nextSeason, currentSalary: d.currentSalary, keeperSalary: d.keeperSalary } as Prisma.InputJsonValue,
              createdById: actorId,
            },
          }),
        );
      }
      await tx.keyValue.upsert({
        where: { key: KEEPER_LOCK_KEY(leagueId, nextSeason) },
        create: { key: KEEPER_LOCK_KEY(leagueId, nextSeason), value: { lockedAt: new Date().toISOString(), count: kept.length } },
        update: { value: { lockedAt: new Date().toISOString(), count: kept.length } },
      });
      await tx.auditLog.create({
        data: { leagueId, actorId, action: "keepers.lock", targetType: "league", targetId: leagueId, details: { season: nextSeason, locked: kept.length, released } },
      });
      return { txs, kept };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  if (!result) return "already locked";
  const { txs, kept } = result;
  for (const t of txs) broadcastTransaction(leagueId, t);
  const msg = `Keeper deadline reached: ${kept.length} keeper${kept.length === 1 ? "" : "s"} locked for ${nextSeason}.`;
  await notify({ userIds: await leagueUserIds(leagueId), leagueId, type: "KEEPER_DEADLINE", title: "Keepers are locked", body: `${msg} See every team's keepers on the Keepers page.`, url: "/team/keepers#league" }).catch((e) =>
    console.error("[keepers] notify failed", e),
  );
  if (settings.notifications.transactionsToChat) {
    const teams = await db.team.findMany({ where: { leagueId }, select: { id: true, name: true } });
    const teamName = new Map(teams.map((t) => [t.id, t.name]));
    const byTeam = new Map<string, string[]>();
    for (const k of kept) {
      const n = teamName.get(k.teamId) ?? "Team";
      byTeam.set(n, [...(byTeam.get(n) ?? []), `${k.name} ($${k.salary})`]);
    }
    const lines = [...byTeam.entries()].map(([t, ps]) => `${t}: ${ps.join(", ")}`);
    await postSystemMessage(leagueId, `${msg}${lines.length ? " " + lines.join(" · ") : ""}`, { channel: "transactions", kind: "TRANSACTION", data: { kind: "keepers", url: "/team/keepers#league" } }).catch(() => null);
  }
  publish(topics.league(leagueId), "keepers.locked", { season: nextSeason, count: kept.length });
  return `${kept.length} keeper${kept.length === 1 ? "" : "s"} locked`;
}
