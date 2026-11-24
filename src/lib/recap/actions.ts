"use server";
// Commissioner recap controls: regenerate, send to the league, and personalized email previews.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import { buildWeeklyRecap, RecapError } from "./generate";
import { renderRecapEmail } from "./html";
import { sendRecap } from "./jobs";
import { completedWeeks } from "./compute";
import { isRecapContent, type RecapContent } from "./types";

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const weekInput = z.object({
  season: z.number().int().min(2000).max(2100),
  week: z.number().int().min(1).max(18),
});

const sendInput = weekInput.extend({ resend: z.boolean().optional() });
const previewInput = weekInput.extend({ teamId: z.string().min(1).max(64).nullable() });

function revalidate(week: number) {
  revalidatePath("/recaps");
  revalidatePath(`/recaps/${week}`);
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof RecapError) return { ok: false, error: e.message };
  console.error("[recap action]", e);
  return { ok: false, error: (e as Error).message || "Something went wrong" };
}

export async function generateRecapAction(input: { season: number; week: number }): Promise<ActionResult> {
  const ctx = await assertCommissioner();
  const parsed = weekInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid week" };
  const { season, week } = parsed.data;
  try {
    const built = await buildWeeklyRecap(ctx.league.id, season, week);
    await db.auditLog.create({
      data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "recap.generate", targetType: "recap", targetId: built.id, details: { season, week, headline: built.content.headline } },
    });
    revalidate(week);
    return { ok: true, message: `Week ${week} recap refreshed` };
  } catch (e) {
    return fail(e);
  }
}

/** Write every completed week of a season that has no recap yet (oldest first). */
export async function generateMissingRecapsAction(input: { season: number }): Promise<ActionResult> {
  const ctx = await assertCommissioner();
  const parsed = z.object({ season: weekInput.shape.season }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid season" };
  const { season } = parsed.data;
  const [matchups, recaps] = await Promise.all([
    db.matchup.findMany({ where: { leagueId: ctx.league.id, season }, select: { week: true, status: true } }),
    db.weeklyRecap.findMany({ where: { leagueId: ctx.league.id, season }, select: { week: true, content: true } }),
  ]);
  const have = new Set(recaps.filter((r) => isRecapContent(r.content)).map((r) => r.week));
  const missing = completedWeeks(matchups)
    .filter((w) => !have.has(w))
    .sort((a, b) => a - b);
  if (!missing.length) return { ok: true, message: "Every completed week already has a recap" };
  const written: number[] = [];
  const failed: string[] = [];
  for (const week of missing) {
    try {
      await buildWeeklyRecap(ctx.league.id, season, week);
      written.push(week);
    } catch (e) {
      failed.push(`Week ${week}: ${(e as Error).message}`);
    }
  }
  if (written.length) {
    await db.auditLog.create({
      data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "recap.generate", targetType: "recap", targetId: null, details: { season, weeks: written, backfill: true } },
    });
  }
  revalidatePath("/recaps");
  for (const w of written) revalidatePath(`/recaps/${w}`);
  if (!written.length) return { ok: false, error: failed[0] ?? "No recaps were written" };
  return { ok: true, message: `Wrote ${written.length} recap${written.length === 1 ? "" : "s"}${failed.length ? ` (${failed.length} failed: ${failed.join("; ")})` : ""}` };
}

export async function sendRecapAction(input: { season: number; week: number; resend?: boolean }): Promise<ActionResult> {
  const ctx = await assertCommissioner();
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid week" };
  const { season, week, resend } = parsed.data;
  try {
    const r = await sendRecap(ctx.league.id, season, week, { resend: !!resend });
    await db.auditLog.create({
      data: {
        leagueId: ctx.league.id,
        actorId: ctx.user.id,
        action: "recap.send",
        targetType: "recap",
        targetId: r.recapId,
        details: { season, week, resend: !!resend, emailed: r.emailed, optedOut: r.optedOut, failed: r.failed, notified: r.notified, preview: r.preview },
      },
    });
    revalidate(week);
    const parts = [`${r.emailed} email${r.emailed === 1 ? "" : "s"} ${r.preview ? "saved as previews (SMTP not configured)" : "sent"}`];
    if (r.optedOut) parts.push(`${r.optedOut} opted out`);
    if (r.failed) parts.push(`${r.failed} failed`);
    return { ok: true, message: `Week ${week} recap delivered: ${parts.join(", ")}` };
  } catch (e) {
    return fail(e);
  }
}

/** Personalized email preview HTML (rendered in a sandboxed iframe by the page). */
export async function previewRecapEmailAction(input: { season: number; week: number; teamId: string | null }): Promise<{ ok: true; html: string; subject: string } | { ok: false; error: string }> {
  const ctx = await assertCommissioner();
  const parsed = previewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { season, week, teamId } = parsed.data;
  const recap = await db.weeklyRecap.findUnique({ where: { leagueId_season_week: { leagueId: ctx.league.id, season, week } }, select: { content: true } });
  if (!recap || !isRecapContent(recap.content)) return { ok: false, error: "Generate the recap first." };
  const content = recap.content as unknown as RecapContent;
  if (teamId && !content.teams[teamId]) return { ok: false, error: "Unknown team" };
  const email = renderRecapEmail(content, content.leagueName, { teamId });
  return { ok: true, html: email.html, subject: email.subject };
}
