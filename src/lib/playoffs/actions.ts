"use server";
// Commissioner: advance the bracket and recompute playoff odds on demand.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import { computePlayoffOdds } from "@/lib/sim/playoff-odds";
import { advancePlayoffs } from "./bracket";

const schema = z.object({ simulations: z.number().int().min(1000).max(50_000).optional() }).optional();

export async function recomputePlayoffOddsAction(input?: { simulations?: number }): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const ctx = await assertCommissioner();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const t0 = Date.now();
    const bracket = await advancePlayoffs(ctx.league.id);
    const odds = await computePlayoffOdds(ctx.league.id, { simulations: parsed.data?.simulations, backfill: true });
    await db.auditLog.create({
      data: {
        leagueId: ctx.league.id,
        actorId: ctx.user.id,
        action: "playoffs.recompute",
        targetType: "League",
        targetId: ctx.league.id,
        details: { bracket, week: odds?.week ?? null, simulations: odds?.simulations ?? 0, ms: Date.now() - t0 },
      },
    });
    for (const p of ["/playoffs", "/standings", "/standings/power"]) revalidatePath(p);
    if (!odds) return { ok: true, message: bracket === "bracket up to date" ? "The season is over — final results are locked in." : `Bracket: ${bracket}.` };
    const bracketNote = bracket.startsWith("created") || bracket.includes("started") || bracket.includes("complete") ? ` Bracket: ${bracket}.` : "";
    return { ok: true, message: `Odds updated: ${odds.simulations.toLocaleString()} simulated seasons in ${((Date.now() - t0) / 1000).toFixed(1)}s.${bracketNote}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
