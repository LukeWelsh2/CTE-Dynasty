// POST /api/trades/preview — live valuation (+ rule validation) for the trade builder and calculator.
import { z } from "zod";
import { db } from "@/lib/db";
import { getLeagueContextOrNull } from "@/lib/league";
import { evaluateTradeInput } from "@/lib/trades/evaluate";
import { validateTrade } from "@/lib/trades/validate";
import type { AssetRef, TeamImpact } from "@/lib/trades/rules";

export const dynamic = "force-dynamic";

const id = z.string().trim().min(1).max(64);
const bodySchema = z.object({
  mode: z.enum(["auto", "balanced", "contender", "rebuild"]).default("auto"),
  free: z.boolean().default(false),
  teamIds: z.array(id).min(1).max(6),
  assets: z
    .array(
      z.object({
        type: z.enum(["PLAYER", "PICK", "FAAB"]),
        playerId: id.nullish(),
        pickId: id.nullish(),
        faabAmount: z.number().int().min(0).max(100_000).nullish(),
        fromTeamId: id,
        toTeamId: id,
      }),
    )
    .max(40),
  drops: z.record(z.string(), z.array(id).max(15)).default({}),
  /** team whose problems are blocking (the proposer); others are warnings */
  strictTeamId: id.nullish(),
  validate: z.boolean().default(true),
});

export async function POST(req: Request) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? e.issues[0]?.message : "Invalid request" }, { status: 400 });
  }
  const assets: AssetRef[] = body.assets
    .filter((a) => a.type !== "FAAB" || (a.faabAmount ?? 0) > 0)
    .map((a) => ({ ...a, playerId: a.playerId ?? null, pickId: a.pickId ?? null, faabAmount: a.faabAmount ?? null }));

  if (!body.free) {
    const teams = await db.team.count({ where: { leagueId: ctx.league.id, id: { in: body.teamIds } } });
    if (teams !== new Set(body.teamIds).size) return Response.json({ error: "Unknown team" }, { status: 400 });
  }
  const evaluation = await evaluateTradeInput(ctx.league.id, { teamIds: body.teamIds, assets, drops: body.drops, mode: body.mode, free: body.free });
  let validation: { errors: string[]; warnings: string[]; impacts: TeamImpact[] } | null = null;
  if (!body.free && body.validate && body.teamIds.length >= 2 && assets.length) {
    const res = await validateTrade(
      db,
      { leagueId: ctx.league.id, season: ctx.season, phase: ctx.league.phase, week: ctx.week, settings: ctx.settings },
      { teamIds: body.teamIds, assets, drops: body.drops },
      { checkWindow: true, strictTeams: new Set(body.strictTeamId ? [body.strictTeamId] : []) },
    );
    validation = { errors: res.errors, warnings: res.warnings, impacts: res.impacts };
  }
  return Response.json({ evaluation, validation });
}
