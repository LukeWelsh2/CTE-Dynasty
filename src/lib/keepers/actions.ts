"use server";
// Keeper designation server actions. Managers designate their own expiring players while the keeper window
// is open; commissioners can override (any team, any time, with an audit log entry). Changes for one team are
// serialized with a Postgres advisory lock so two quick clicks can't both slip past the keeper limit.
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertTeamManager } from "@/lib/league";
import { broadcastTransaction } from "@/lib/roster-ops";
import { loadKeeperWindow, loadTeamKeepers } from "@/lib/keepers/data";
import { designationApplies } from "@/lib/keepers/logic";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(64);
const setSchema = z.object({ teamId: id, playerId: id, keep: z.boolean() });

function revalidate() {
  revalidatePath("/team/keepers");
  revalidatePath("/commissioner/season");
  revalidatePath("/transactions");
}

async function lockKeepersFor(tx: Prisma.TransactionClient, teamId: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${"keepers:team:" + teamId}))) AS l`;
}

class Refusal extends Error {}

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
    const nextSeason = league.season + 1;
    const locked = window.status === "LOCKED";

    const result = await db.$transaction(
      async (tx) => {
        await lockKeepersFor(tx, teamId);
        // everything below reads committed state after any concurrent change for this team
        const spot = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: league.id, playerId } }, include: { player: { select: { fullName: true, position: true, team: true } } } });
        if (!spot || spot.teamId !== teamId) throw new Refusal("That player isn't on this roster.");
        const name = spot.player.fullName;
        const existing = await tx.keeperDesignation.findUnique({ where: { leagueId_season_playerId: { leagueId: league.id, season: nextSeason, playerId } } });
        const view = await loadTeamKeepers(league.id, teamId, settings, league.season, { playerId, keep });
        const row = view.rows.find((r) => r.playerId === playerId);
        if (!row) throw new Refusal("That player isn't on this roster.");
        const overrides: string[] = [];
        if (!windowOk) overrides.push(locked ? "deadline passed" : "window not open");
        let logged: { id: string; description: string; type: string; teamId: string | null } | null = null;
        const meta = `${spot.player.position}${spot.player.team ? " " + spot.player.team : ""}`;

        if (keep) {
          if (!row.expiring) throw new Refusal(`${name} is under contract and rolls over automatically.`);
          if (!row.eligible) {
            if (!commish) throw new Refusal(row.reason ?? "Not eligible to be kept.");
            overrides.push(row.reason ?? "ineligible");
          }
          if (view.check.errors.length) {
            if (!commish) throw new Refusal(view.check.errors.join(" "));
            overrides.push(...view.check.errors);
          }
          const data = { teamId, currentSalary: spot.salary, keeperSalary: row.keeperSalary, contractYears: row.keeperYears, status: locked ? "LOCKED" : "DESIGNATED" };
          const d = await tx.keeperDesignation.upsert({
            where: { leagueId_season_playerId: { leagueId: league.id, season: nextSeason, playerId } },
            create: { leagueId: league.id, season: nextSeason, playerId, ...data },
            update: data,
          });
          // keepers locked at the deadline each have a KEEPER transaction; a late commissioner designation gets one too
          if (locked && !(existing && existing.status === "LOCKED" && designationApplies(existing, teamId, settings))) {
            logged = await tx.transaction.create({
              data: {
                leagueId: league.id,
                season: league.season,
                week: ctx.week,
                type: "KEEPER",
                teamId,
                playerId,
                salary: row.keeperSalary,
                description: `Kept ${name} (${meta}) for ${nextSeason} — $${row.keeperSalary}, ${row.keeperYears} yr${row.keeperYears === 1 ? "" : "s"} (was $${spot.salary}; added by the commissioner after keepers locked)`,
                details: { designationId: d.id, season: nextSeason, currentSalary: spot.salary, keeperSalary: row.keeperSalary, commissioner: true } as Prisma.InputJsonValue,
                createdById: ctx.user.id,
              },
            });
          }
        } else {
          if (!existing || !designationApplies(existing, teamId, settings)) return { name, keeperSalary: row.keeperSalary, overrides, logged, noop: true, warnings: [] as string[] };
          if (existing.status === "LOCKED" && !commish) throw new Refusal("Designations are locked.");
          await tx.keeperDesignation.delete({ where: { id: existing.id } });
          if (existing.status === "LOCKED") {
            logged = await tx.transaction.create({
              data: {
                leagueId: league.id,
                season: league.season,
                week: ctx.week,
                type: "KEEPER",
                teamId,
                playerId,
                salary: spot.salary,
                description: `Removed ${name} (${meta}) from the ${nextSeason} keepers (commissioner) — released at the rollover`,
                details: { designationId: existing.id, season: nextSeason, removed: true, commissioner: true } as Prisma.InputJsonValue,
                createdById: ctx.user.id,
              },
            });
          }
        }

        if (commish && (!ownTeam || overrides.length || logged)) {
          await tx.auditLog.create({
            data: {
              leagueId: league.id,
              actorId: ctx.user.id,
              action: keep ? "keepers.designate" : "keepers.undesignate",
              targetType: "team",
              targetId: teamId,
              details: { playerId, player: name, season: nextSeason, keeperSalary: row.keeperSalary, overrides } as Prisma.InputJsonValue,
            },
          });
        }
        return { name, keeperSalary: row.keeperSalary, overrides, logged, noop: false, warnings: keep ? view.check.warnings : [] };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    if (result.logged) broadcastTransaction(league.id, result.logged);
    revalidate();
    if (result.noop) return { ok: true, message: `${result.name} isn't designated.` };
    const warn = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
    return {
      ok: true,
      message: keep
        ? `${result.name} designated as a ${nextSeason} keeper at $${result.keeperSalary}.${result.overrides.length ? " (commissioner override)" : ""}${warn}`
        : `${result.name} removed from the keepers.`,
    };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    const msg = (e as Error).message ?? "";
    return { ok: false, error: msg && msg.length < 300 && !msg.includes("invocation") ? msg : "Could not update keepers. Please try again." };
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
    const teamId = parsed.data.teamId;
    const nextSeason = ctx.league.season + 1;
    const removed = await db.$transaction(async (tx) => {
      await lockKeepersFor(tx, teamId);
      // every designation that applies to a player on this roster (incl. one carried over in a trade)
      const spots = await tx.rosterSpot.findMany({ where: { teamId }, select: { playerId: true, teamId: true } });
      const desig = await tx.keeperDesignation.findMany({ where: { leagueId: ctx.league.id, season: nextSeason, playerId: { in: spots.map((s) => s.playerId) } } });
      const ids = desig.filter((d) => designationApplies(d, teamId, ctx.settings) && (ctx.isCommish || d.status === "DESIGNATED")).map((d) => d.id);
      if (ids.length) await tx.keeperDesignation.deleteMany({ where: { id: { in: ids } } });
      if (ctx.isCommish && (ctx.myTeam?.id !== teamId || window.status !== "OPEN")) {
        await tx.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "keepers.clear", targetType: "team", targetId: teamId, details: { removed: ids.length, season: nextSeason } } });
      }
      return ids.length;
    });
    revalidate();
    return { ok: true, message: removed ? `Cleared ${removed} keeper designation${removed === 1 ? "" : "s"}.` : "No designations to clear." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
