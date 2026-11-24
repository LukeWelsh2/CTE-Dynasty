"use server";
// Commissioner controls for the live-game simulation (demos / offseason testing).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import { resetSimulation, startSimulation, SIM_SPEEDS } from "@/lib/live/simulate";

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

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
