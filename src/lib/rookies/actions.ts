"use server";
// Commissioner editing of the league rookie rankings.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { excludedPlayers, refreshRookieRankings, setExcludedPlayers, writeRankings, type RankingDraftRow } from "@/lib/rookies/rankings";
import { movedIndexes } from "@/lib/rookies/logic";

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
  console.error("[rookie rankings]", e);
  return { ok: false, error: (e as Error).message || "Something went wrong" };
}

const classYear = z.number().int().min(2000).max(2100);

const rowSchema = z.object({
  id: z.string().max(64).nullable().optional(),
  playerId: z.string().max(64).nullable().optional(),
  prospectName: z.string().trim().max(80).nullable().optional(),
  position: z.string().trim().min(1).max(4),
  college: z.string().trim().max(80).nullable().optional(),
  nflTeam: z.string().trim().max(4).nullable().optional(),
  draftRound: z.number().int().min(1).max(7).nullable().optional(),
  draftPick: z.number().int().min(1).max(40).nullable().optional(),
  tier: z.number().int().min(1).max(30),
  notes: z.string().trim().max(400).nullable().optional(),
});

const saveSchema = z.object({ classYear, rows: z.array(rowSchema).max(400) });

/**
 * Save the commissioner's edited list. Rows whose relative order or tier changed (and new prospects) become
 * COMMISSIONER rows, which keep their rank when the auto rankings refresh. Removed players are excluded.
 */
export async function saveRookieRankingsAction(input: z.input<typeof saveSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = saveSchema.parse(input);
    const leagueId = ctx.league.id;
    const existing = await db.rookieRanking.findMany({ where: { leagueId, classYear: v.classYear }, orderBy: { rank: "asc" } });
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const r of v.rows) if (!r.playerId && !r.prospectName) return { ok: false, error: "Every prospect needs a name." };
    const prevRanks = v.rows.map((r) => (r.id && byId.get(r.id) ? byId.get(r.id)!.rank : null));
    const moved = movedIndexes(prevRanks);
    const rows: RankingDraftRow[] = v.rows.map((r, i) => {
      const old = r.id ? byId.get(r.id) : undefined;
      const tierChanged = !!old && old.tier !== r.tier;
      const pinned = !old || old.source === "COMMISSIONER" || moved.has(i) || tierChanged;
      return {
        playerId: old?.playerId ?? r.playerId ?? null,
        prospectName: old?.playerId ? null : r.prospectName ?? old?.prospectName ?? null,
        position: normalizePosition(old?.position ?? r.position),
        college: old?.playerId ? old.college : r.college ?? old?.college ?? null,
        nflTeam: old?.playerId ? old.nflTeam : r.nflTeam?.toUpperCase() || old?.nflTeam || null,
        draftRound: old?.playerId ? old.draftRound : r.draftRound ?? old?.draftRound ?? null,
        draftPick: old?.playerId ? old.draftPick : r.draftPick ?? old?.draftPick ?? null,
        tier: r.tier,
        autoScore: old?.autoScore ?? null,
        notes: r.notes?.trim() ? r.notes.trim() : null,
        source: pinned ? "COMMISSIONER" : "AUTO",
      };
    });
    // removed real players stay out of future auto refreshes
    const keptIds = new Set(rows.map((r) => r.playerId).filter(Boolean));
    const removed = existing.filter((r) => r.playerId && !keptIds.has(r.playerId)).map((r) => r.playerId!);
    if (removed.length) {
      const ex = await excludedPlayers(leagueId, v.classYear);
      for (const id of removed) ex.add(id);
      await setExcludedPlayers(leagueId, v.classYear, ex);
    }
    await writeRankings(leagueId, v.classYear, rows, existing);
    await db.auditLog.create({
      data: { leagueId, actorId: ctx.user.id, action: "rookies.rankings_edit", targetType: "RookieRanking", targetId: String(v.classYear), details: { rows: rows.length, pinned: rows.filter((r) => r.source === "COMMISSIONER").length, removed: removed.length } },
    });
    revalidatePath("/rookies");
    return { ok: true, message: "Rankings saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function refreshRookieRankingsAction(input: { classYear: number }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ classYear }).parse(input);
    const r = await refreshRookieRankings(ctx.league.id, v.classYear);
    revalidatePath("/rookies");
    return { ok: true, message: `Rankings refreshed: ${r.count} players (${r.pinned} commissioner-ranked)` };
  } catch (e) {
    return fail(e);
  }
}

/** Return a commissioner-ranked player to the automatic rankings. */
export async function unpinRankingAction(input: { id: string }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ id: z.string().min(1).max(64) }).parse(input);
    const row = await db.rookieRanking.findUnique({ where: { id: v.id } });
    if (!row || row.leagueId !== ctx.league.id) return { ok: false, error: "Ranking not found" };
    if (!row.playerId) return { ok: false, error: "Prospects without an NFL player record are always commissioner-ranked." };
    await db.rookieRanking.update({ where: { id: row.id }, data: { source: "AUTO" } });
    await refreshRookieRankings(ctx.league.id, row.classYear);
    revalidatePath("/rookies");
    return { ok: true, message: "Returned to automatic ranking" };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreExcludedAction(input: { classYear: number; playerId: string }): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const v = z.object({ classYear, playerId: z.string().min(1).max(64) }).parse(input);
    const ex = await excludedPlayers(ctx.league.id, v.classYear);
    ex.delete(v.playerId);
    await setExcludedPlayers(ctx.league.id, v.classYear, ex);
    await refreshRookieRankings(ctx.league.id, v.classYear);
    revalidatePath("/rookies");
    return { ok: true, message: "Player restored to the rankings" };
  } catch (e) {
    return fail(e);
  }
}
