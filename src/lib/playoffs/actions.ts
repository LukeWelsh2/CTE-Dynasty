"use server";
// Commissioner: advance the bracket, recompute playoff odds on demand, and set playoff seeds manually.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import { computePlayoffOdds } from "@/lib/sim/playoff-odds";
import { advancePlayoffs, setManualSeeds } from "./bracket";

type Result = { ok: true; message: string } | { ok: false; error: string };

const PATHS = ["/playoffs", "/standings", "/standings/power"];

const schema = z.object({ simulations: z.number().int().min(1000).max(50_000).optional() }).optional();

export async function recomputePlayoffOddsAction(input?: { simulations?: number }): Promise<Result> {
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
    for (const p of PATHS) revalidatePath(p);
    if (!odds) return { ok: true, message: bracket === "bracket up to date" ? "The season is over — final results are locked in." : `Bracket: ${bracket}.` };
    const bracketNote = bracket.startsWith("created") || bracket.includes("started") || bracket.includes("complete") ? ` Bracket: ${bracket}.` : "";
    return { ok: true, message: `Odds updated: ${odds.simulations.toLocaleString()} simulated seasons in ${((Date.now() - t0) / 1000).toFixed(1)}s.${bracketNote}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const seedsSchema = z.object({
  /** team ids by seed (1 first); null = go back to seeding from the standings */
  teamIds: z.array(z.string().min(1).max(64)).min(2).max(32).nullable(),
});

export async function setPlayoffSeedsAction(input: { teamIds: string[] | null }): Promise<Result> {
  try {
    const ctx = await assertCommissioner();
    if (!ctx.settings.playoffs.manualSeedingAllowed) return { ok: false, error: "Manual seeding is turned off in league settings." };
    const parsed = seedsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid seeds" };
    const { teamIds } = parsed.data;
    if (teamIds && new Set(teamIds).size !== teamIds.length) return { ok: false, error: "Each team can only hold one seed." };
    const res = await setManualSeeds(ctx.league.id, teamIds, ctx.user.id);
    if (!res.ok) return { ok: false, error: res.error };
    await db.auditLog.create({
      data: {
        leagueId: ctx.league.id,
        actorId: ctx.user.id,
        action: teamIds ? "playoffs.seeds.set" : "playoffs.seeds.reset",
        targetType: "League",
        targetId: ctx.league.id,
        details: { season: ctx.season, before: res.before, after: res.after },
      },
    });
    // bracket-mode odds follow the new seeds
    await computePlayoffOdds(ctx.league.id, { notify: false }).catch(() => null);
    for (const p of PATHS) revalidatePath(p);
    return { ok: true, message: teamIds ? "Seeds saved — the bracket has been rebuilt." : "Seeds reset to the standings — the bracket has been rebuilt." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
