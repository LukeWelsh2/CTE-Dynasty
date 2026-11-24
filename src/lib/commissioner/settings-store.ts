// Writes League.settings with versioning: settingsVersion++, LeagueSettingsHistory snapshot, AuditLog,
// lineup reset when roster slots change, optional "rules changed" notification.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { resolveSettings, withTombstones, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { weekGamesByTeam } from "@/lib/lineup";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { leagueUserIds, notify } from "@/lib/notify";
import { audit } from "@/lib/commissioner/server";
import { SECTION_LABELS, type SettingsSection } from "@/lib/commissioner/settings-meta";
import { changeSummary, changedSections, groupChanges, settingsChanges, slotsEligibilityChanged, slotsStructureChanged, type SettingsChange } from "@/lib/commissioner/settings-logic";

export interface WriteResult {
  version: number;
  changes: SettingsChange[];
  /** set when lineups were rebuilt because roster slots changed */
  lineupReset: { fromWeek: number; rowsCleared: number; mode: "rebuilt" | "ineligible-removed" } | null;
}

/** First week whose lineups can still be rebuilt (the current week only if none of its games has kicked off). */
export async function firstUnlockedWeek(season: number, week: number): Promise<number> {
  const games = [...new Set((await weekGamesByTeam(season, week)).values())];
  const now = Date.now();
  const started = games.some((g) => g.state !== "pre" || g.startTime.getTime() <= now);
  return started ? week + 1 : week;
}

async function resetLineups(ctx: LeagueContext, before: LeagueSettings, after: LeagueSettings): Promise<WriteResult["lineupReset"]> {
  const structure = slotsStructureChanged(before.roster.slots, after.roster.slots);
  const eligibility = slotsEligibilityChanged(before.roster.slots, after.roster.slots);
  if (!structure && !eligibility) return null;
  const fromWeek = await firstUnlockedWeek(ctx.season, ctx.week);
  if (structure) {
    const res = await db.lineupSlot.deleteMany({ where: { leagueId: ctx.league.id, season: ctx.season, week: { gte: fromWeek } } });
    return { fromWeek, rowsCleared: res.count, mode: "rebuilt" };
  }
  // eligibility only: take players out of slots they can no longer fill
  const rows = await db.lineupSlot.findMany({
    where: { leagueId: ctx.league.id, season: ctx.season, week: { gte: fromWeek }, playerId: { not: null } },
    select: { id: true, slot: true, player: { select: { position: true } } },
  });
  const eligibleBy = new Map(after.roster.slots.map((s) => [s.key, s.eligible]));
  const bad = rows.filter((r) => r.player && !(eligibleBy.get(r.slot) ?? []).includes(normalizePosition(r.player.position))).map((r) => r.id);
  if (bad.length) await db.lineupSlot.updateMany({ where: { id: { in: bad } }, data: { playerId: null } });
  return { fromWeek, rowsCleared: bad.length, mode: "ineligible-removed" };
}

/**
 * Persist a complete new settings object. Throws when nothing changed or when someone else saved first
 * (`expectedVersion` mismatch).
 */
export async function writeSettings(
  ctx: LeagueContext,
  next: LeagueSettings,
  opts: { action: string; note?: string | null; notifyManagers?: boolean; expectedVersion?: number; details?: Record<string, unknown> },
): Promise<WriteResult> {
  const league = await db.league.findUniqueOrThrow({ where: { id: ctx.league.id }, select: { settings: true, settingsVersion: true, name: true } });
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== league.settingsVersion)
    throw new Error("Settings were changed by someone else since you opened this page. Reload to see the latest version.");
  const before = resolveSettings(league.settings);
  const after = resolveSettings(JSON.parse(JSON.stringify(withTombstones(next))));
  const changes = settingsChanges(before, after);
  if (!changes.length) return { version: league.settingsVersion, changes: [], lineupReset: null };

  const version = league.settingsVersion + 1;
  const stored = withTombstones(after);
  await db.$transaction(async (tx) => {
    const res = await tx.league.updateMany({
      where: { id: ctx.league.id, settingsVersion: league.settingsVersion },
      data: {
        settings: stored as Prisma.InputJsonValue,
        settingsVersion: version,
        ...(after.general.leagueName !== league.name ? { name: after.general.leagueName } : {}),
      },
    });
    if (res.count !== 1) throw new Error("Settings were changed by someone else. Reload and try again.");
    // keep a snapshot of the original settings so the first edit can be reverted
    if (!(await tx.leagueSettingsHistory.count({ where: { leagueId: ctx.league.id } })))
      await tx.leagueSettingsHistory.create({
        data: { leagueId: ctx.league.id, version: league.settingsVersion, changedById: null, changes: [], snapshot: before as unknown as Prisma.InputJsonValue, note: "Original settings (before the first commissioner edit)", createdAt: new Date(Date.now() - 1000) },
      });
    await tx.leagueSettingsHistory.create({
      data: {
        leagueId: ctx.league.id,
        version,
        changedById: ctx.user.id,
        changes: changes as unknown as Prisma.InputJsonValue,
        snapshot: after as unknown as Prisma.InputJsonValue,
        note: opts.note?.trim() || null,
      },
    });
    await audit(tx, ctx, opts.action, {
      targetType: "settings",
      targetId: String(version),
      details: { version, sections: changedSections(changes), changed: changes.length, paths: changes.slice(0, 40).map((c) => c.path), note: opts.note ?? null, ...(opts.details ?? {}) },
    });
  });

  const lineupReset = await resetLineups(ctx, before, after);
  if (lineupReset && lineupReset.fromWeek === ctx.week) await refreshWeekMatchups(ctx.league.id, ctx.season, ctx.week, after).catch(() => {});

  if (opts.notifyManagers) {
    const teams = await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true } });
    const lk = { teams: new Map(teams.map((t) => [t.id, t.name])), tz: after.general.timezone };
    const grouped = groupChanges(changes, before, after);
    const sections = changedSections(changes).map((s) => SECTION_LABELS[s as SettingsSection] ?? s);
    const ids = (await leagueUserIds(ctx.league.id)).filter((id) => id !== ctx.user.id);
    await notify({
      userIds: ids,
      leagueId: ctx.league.id,
      type: "COMMISSIONER",
      title: `League rules updated: ${sections.join(", ")}`,
      body: `${changeSummary(grouped, lk, 5)}${opts.note ? `\nNote: ${opts.note}` : ""}`,
      url: "/rules",
      data: { version },
    }).catch(() => {});
  }
  return { version, changes, lineupReset };
}
