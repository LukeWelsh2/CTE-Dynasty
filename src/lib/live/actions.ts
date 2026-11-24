"use server";
// Commissioner controls for the live-game simulation (demos / offseason testing).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import type { LeagueContext } from "@/lib/league";
import { getSimState, resetSimulation, startSimulation, SIM_SPEEDS } from "@/lib/live/simulate";

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Simulated stats are NFL-wide (PlayerWeekStat), so they show up in every league of the season.
 * A league's commissioner may only drive them when theirs is the only league that season (or they're a site admin).
 */
async function canDriveSharedSim(ctx: LeagueContext): Promise<boolean> {
  if (ctx.user.isSiteAdmin) return true;
  const others = await db.league.count({ where: { season: ctx.season, id: { not: ctx.league.id } } });
  return others === 0;
}

const startSchema = z.object({
  week: z.coerce.number().int().min(1).max(18),
  speed: z.enum(Object.keys(SIM_SPEEDS) as [keyof typeof SIM_SPEEDS, ...(keyof typeof SIM_SPEEDS)[]]),
  alerts: z.boolean(),
});

export async function startSimulationAction(input: { week: number; speed: string; alerts: boolean }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid simulation settings" };
    const { week, speed, alerts } = parsed.data;
    if (!(await canDriveSharedSim(ctx))) return { ok: false, error: "Other leagues share this season's NFL stats — only a site admin can run a live simulation." };
    if (!(await db.matchup.count({ where: { leagueId: ctx.league.id, season: ctx.season, week } }))) return { ok: false, error: `Week ${week} has no fantasy matchups yet — there is nothing to simulate.` };
    const res = await startSimulation({ season: ctx.season, week, speed, alerts, startedById: ctx.user.id, leagueId: ctx.league.id, driver: "commissioner" });
    if (!res.ok) return { ok: false, error: res.error };
    await db.auditLog.create({
      data: {
        leagueId: ctx.league.id,
        actorId: ctx.user.id,
        action: "live.simulation.start",
        targetType: "week",
        targetId: String(week),
        details: { season: ctx.season, week, speed, alerts, players: res.state.playerIds.length, games: res.state.gameIds.length },
      },
    });
    revalidatePath("/scoring", "layout");
    return { ok: true, message: `Simulating week ${week}: ${res.state.gameIds.length} games, ${res.state.playerIds.length} rostered players.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function resetSimulationAction(): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const state = await getSimState();
    if (!state) return { ok: false, error: "No simulation is running." };
    if (state.leagueId !== ctx.league.id && !(await canDriveSharedSim(ctx))) return { ok: false, error: "This simulation was started from another league — only a site admin can reset it." };
    const res = await resetSimulation();
    if (!res.ok) return { ok: false, error: "No simulation is running." };
    await db.auditLog.create({
      data: {
        leagueId: ctx.league.id,
        actorId: ctx.user.id,
        action: "live.simulation.reset",
        targetType: "week",
        targetId: String(res.week),
        details: { removedStatRows: res.stats, removedEvents: res.events },
      },
    });
    revalidatePath("/scoring", "layout");
    return { ok: true, message: `Simulation stopped — week ${res.week} restored (${res.stats} simulated stat lines removed).` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
