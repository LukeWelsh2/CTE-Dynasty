"use server";
// Keeper designation server actions. Managers designate their own expiring players while the keeper window
// is open; commissioners can override (any team, any time, with an audit log entry).
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertTeamManager } from "@/lib/league";
import { loadKeeperWindow, loadTeamKeepers } from "@/lib/keepers/data";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(64);
const setSchema = z.object({ teamId: id, playerId: id, keep: z.boolean() });

function revalidate() {
  revalidatePath("/team/keepers");
  revalidatePath("/commissioner/season");
}

export async function setKeeperAction(input: z.input<typeof setSchema>): Promise<ActionResult> {
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  const { teamId, playerId, keep } = parsed.data;
  try {
    const ctx = await assertTeamManager(teamId, true);
    const { league, settings } = ctx;
    if (!settings.keepers.enabled) return { ok: false, error: "Keepers are turned off in this league." };
    const ownTeam = ctx.myTeam?.id === teamId;
    const commish = ctx.isCommish;
    if ((settings.keepers.selectionBy ?? "OWNERS") === "COMMISSIONER" && !commish) return { ok: false, error: "In this league the commissioner designates keepers." };
    const window = await loadKeeperWindow(league, settings);
    const windowOk = window.status === "OPEN";
    if (!windowOk && !commish) {
      return { ok: false, error: window.status === "LOCKED" ? "The keeper deadline has passed — designations are locked." : "The keeper window isn't open yet." };
    }
    const spot = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: league.id, playerId } }, include: { player: { select: { fullName: true } } } });
    if (!spot || spot.teamId !== teamId) return { ok: false, error: "That player isn't on this roster." };
    const nextSeason = league.season + 1;
    const existing = await db.keeperDesignation.findUnique({ where: { leagueId_season_playerId: { leagueId: league.id, season: nextSeason, playerId } } });

    const view = await loadTeamKeepers(league.id, teamId, settings, league.season, { playerId, keep });
    const row = view.rows.find((r) => r.playerId === playerId)!;
    const overrides: string[] = [];
    if (!windowOk) overrides.push(window.status === "LOCKED" ? "deadline passed" : "window not open");

    if (keep) {
      if (!row.expiring) return { ok: false, error: `${spot.player.fullName} is under contract and rolls over automatically.` };
      if (!row.eligible) {
        if (!commish) return { ok: false, error: row.reason ?? "Not eligible to be kept." };
        overrides.push(row.reason ?? "ineligible");
      }
      if (view.check.errors.length) {
        if (!commish) return { ok: false, error: view.check.errors.join(" ") };
        overrides.push(...view.check.errors);
      }
      const data = {
        teamId,
        currentSalary: spot.salary,
        keeperSalary: row.keeperSalary,
        contractYears: row.keeperYears,
        status: window.status === "LOCKED" ? "LOCKED" : "DESIGNATED",
      };
      await db.keeperDesignation.upsert({
        where: { leagueId_season_playerId: { leagueId: league.id, season: nextSeason, playerId } },
        create: { leagueId: league.id, season: nextSeason, playerId, ...data },
        update: data,
      });
    } else {
      if (!existing || existing.teamId !== teamId) return { ok: true, message: `${spot.player.fullName} isn't designated.` };
      if (existing.status === "LOCKED" && !commish) return { ok: false, error: "Designations are locked." };
      await db.keeperDesignation.delete({ where: { id: existing.id } });
    }

    if (commish && (!ownTeam || overrides.length)) {
      await db.auditLog.create({
        data: {
          leagueId: league.id,
          actorId: ctx.user.id,
          action: keep ? "keepers.designate" : "keepers.undesignate",
          targetType: "team",
          targetId: teamId,
          details: { playerId, player: spot.player.fullName, season: nextSeason, keeperSalary: row.keeperSalary, overrides } as Prisma.InputJsonValue,
        },
      });
    }
    revalidate();
    const warn = keep && view.check.warnings.length ? ` ${view.check.warnings.join(" ")}` : "";
    return {
      ok: true,
      message: keep
        ? `${spot.player.fullName} designated as a ${nextSeason} keeper at $${row.keeperSalary}.${overrides.length ? " (commissioner override)" : ""}${warn}`
        : `${spot.player.fullName} removed from your keepers.`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Could not update keepers." };
  }
}

const clearSchema = z.object({ teamId: id });

/** Remove every (unlocked) designation for a team */
export async function clearKeepersAction(input: z.input<typeof clearSchema>): Promise<ActionResult> {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid team." };
  try {
    const ctx = await assertTeamManager(parsed.data.teamId, true);
    if ((ctx.settings.keepers.selectionBy ?? "OWNERS") === "COMMISSIONER" && !ctx.isCommish) return { ok: false, error: "In this league the commissioner designates keepers." };
    const window = await loadKeeperWindow(ctx.league, ctx.settings);
    if (window.status !== "OPEN" && !ctx.isCommish) return { ok: false, error: "The keeper window isn't open." };
    const res = await db.keeperDesignation.deleteMany({
      where: { leagueId: ctx.league.id, season: ctx.league.season + 1, teamId: parsed.data.teamId, ...(ctx.isCommish ? {} : { status: "DESIGNATED" }) },
    });
    if (ctx.isCommish && ctx.myTeam?.id !== parsed.data.teamId) {
      await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "keepers.clear", targetType: "team", targetId: parsed.data.teamId, details: { removed: res.count, season: ctx.league.season + 1 } } });
    }
    revalidate();
    return { ok: true, message: res.count ? `Cleared ${res.count} keeper designation${res.count === 1 ? "" : "s"}.` : "No designations to clear." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
