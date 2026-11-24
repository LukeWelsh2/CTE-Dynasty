"use server";
// Commissioner season & phase controls. Every write is audit-logged.
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner } from "@/lib/league";
import { notify, leagueUserIds } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import { KEEPER_LOCK_KEY } from "@/lib/keepers/data";
import { lockKeepers } from "@/lib/keepers/jobs";
import { patchLeagueSettings } from "@/lib/season/settings";
import { rolloverSeason } from "@/lib/season/rollover";
import { PHASES, PHASE_INFO, rolloverConfirmText, zonedLocalToUtc, type Phase } from "@/lib/season/logic";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/", "layout");
}

async function audit(leagueId: string, actorId: string, action: string, details: Record<string, unknown>) {
  await db.auditLog.create({ data: { leagueId, actorId, action, targetType: "league", targetId: leagueId, details: details as Prisma.InputJsonValue } });
}

function fmt(d: Date, tz: string) {
  return d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

// ───────────────────────────── Phase ─────────────────────────────

const phaseSchema = z.object({ phase: z.enum(PHASES) });

export async function setPhaseAction(input: z.input<typeof phaseSchema>): Promise<ActionResult> {
  const parsed = phaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid phase." };
  try {
    const ctx = await assertCommissioner();
    const { league, settings } = ctx;
    const phase = parsed.data.phase as Phase;
    if (league.phase === phase) return { ok: true, message: `Already in ${PHASE_INFO[phase].label}.` };
    await db.league.update({ where: { id: league.id }, data: { phase } });
    await audit(league.id, ctx.user.id, "season.phase", { from: league.phase, to: phase, season: league.season });
    const label = PHASE_INFO[phase].label;
    await postSystemMessage(league.id, `The commissioner moved the league to the ${label} phase.`, { channel: "general", kind: "SYSTEM", data: { kind: "phase", phase } }).catch(() => null);
    if (phase === "KEEPER" && settings.keepers.enabled) {
      const deadline = settings.keepers.deadline ? new Date(settings.keepers.deadline) : null;
      await notify({
        userIds: await leagueUserIds(league.id),
        leagueId: league.id,
        type: "KEEPER_DEADLINE",
        title: "The keeper window is open",
        body: `Designate which expiring players you're keeping for ${league.season + 1}${deadline ? ` before ${fmt(deadline, settings.general.timezone)}` : ""}.`,
        url: "/team/keepers",
      }).catch(() => null);
    }
    publish(topics.league(league.id), "league.phase", { phase });
    revalidateAll();
    return { ok: true, message: `League moved to ${label}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ───────────────────────────── Keeper window ─────────────────────────────

const local = z.string().trim().max(32);
const windowSchema = z.object({ windowOpens: local, deadline: local, openNow: z.boolean().optional(), notifyLeague: z.boolean().optional() });

export async function setKeeperWindowAction(input: z.input<typeof windowSchema>): Promise<ActionResult> {
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid dates." };
  try {
    const ctx = await assertCommissioner();
    const { league, settings } = ctx;
    const tz = settings.general.timezone;
    const now = new Date();
    const opens = parsed.data.openNow ? now : parsed.data.windowOpens ? zonedLocalToUtc(parsed.data.windowOpens, tz) : null;
    const deadline = parsed.data.deadline ? zonedLocalToUtc(parsed.data.deadline, tz) : null;
    if (parsed.data.windowOpens && !opens && !parsed.data.openNow) return { ok: false, error: "The window opening time isn't a valid date." };
    if (parsed.data.deadline && !deadline) return { ok: false, error: "The deadline isn't a valid date." };
    if (opens && deadline && deadline <= opens) return { ok: false, error: "The deadline must be after the window opens." };
    const before = { windowOpens: settings.keepers.windowOpens, deadline: settings.keepers.deadline };
    const after = { windowOpens: opens ? opens.toISOString() : null, deadline: deadline ? deadline.toISOString() : null };
    const res = await patchLeagueSettings(league.id, { keepers: after }, { actorId: ctx.user.id, note: "Keeper window updated (season controls)" });
    // a deadline moved into the future re-opens designations that were locked
    let unlocked = 0;
    if (deadline && deadline > now) {
      const u = await db.keeperDesignation.updateMany({ where: { leagueId: league.id, season: league.season + 1, status: "LOCKED" }, data: { status: "DESIGNATED" } });
      unlocked = u.count;
      await db.keyValue.deleteMany({ where: { key: KEEPER_LOCK_KEY(league.id, league.season + 1) } });
    }
    await audit(league.id, ctx.user.id, "keepers.window", { before, after, unlocked });
    const openNow = !!opens && opens <= now && (!deadline || deadline > now);
    if (res.changed && parsed.data.notifyLeague !== false && openNow && settings.keepers.enabled) {
      await notify({
        userIds: await leagueUserIds(league.id),
        leagueId: league.id,
        type: "KEEPER_DEADLINE",
        title: "The keeper window is open",
        body: `Designate which expiring players you're keeping for ${league.season + 1}${deadline ? ` before ${fmt(deadline, tz)}` : ""}.`,
        url: "/team/keepers",
      }).catch(() => null);
      await postSystemMessage(league.id, `Keeper window is open${deadline ? ` — deadline ${fmt(deadline, tz)}` : ""}. Designate your keepers on the Keepers page.`, { channel: "general", kind: "SYSTEM", data: { kind: "keepers", url: "/team/keepers" } }).catch(() => null);
    }
    revalidateAll();
    if (!res.changed) return { ok: true, message: "No changes." };
    return { ok: true, message: `Keeper window saved${unlocked ? ` — ${unlocked} locked designation${unlocked === 1 ? "" : "s"} re-opened` : ""}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function lockKeepersNowAction(): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const msg = await lockKeepers(ctx.league.id, ctx.league.season + 1, ctx.user.id);
    revalidateAll();
    return { ok: true, message: `Done: ${msg}.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ───────────────────────────── Week override ─────────────────────────────

const weekSchema = z.object({ week: z.number().int().min(1).max(18).nullable() });

export async function setWeekOverrideAction(input: z.input<typeof weekSchema>): Promise<ActionResult> {
  const parsed = weekSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Week must be between 1 and 18." };
  try {
    const ctx = await assertCommissioner();
    const { league } = ctx;
    if (league.weekOverride === parsed.data.week) return { ok: true, message: "No changes." };
    await db.league.update({ where: { id: league.id }, data: { weekOverride: parsed.data.week } });
    await audit(league.id, ctx.user.id, "season.week_override", { from: league.weekOverride, to: parsed.data.week });
    publish(topics.league(league.id), "scores.refresh", { week: parsed.data.week ?? ctx.nfl.week });
    revalidateAll();
    return { ok: true, message: parsed.data.week ? `Current week pinned to Week ${parsed.data.week}.` : "The league now follows the NFL week." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ───────────────────────────── Rollover ─────────────────────────────

const rolloverSchema = z.object({ confirm: z.string().trim().max(40), force: z.boolean().optional() });

export async function rolloverAction(input: z.input<typeof rolloverSchema>): Promise<ActionResult> {
  const parsed = rolloverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Type the confirmation text." };
  try {
    const ctx = await assertCommissioner();
    const expected = rolloverConfirmText(ctx.league.season + 1);
    if (parsed.data.confirm.toUpperCase() !== expected) return { ok: false, error: `Type "${expected}" to confirm.` };
    const res = await rolloverSeason(ctx.league.id, { actorId: ctx.user.id, force: !!parsed.data.force });
    revalidateAll();
    if (!res.ok) return { ok: false, error: res.error ?? "Rollover failed." };
    const s = res.summary!;
    return { ok: true, message: `Welcome to ${res.toSeason}! ${s.kept} kept, ${s.released} released, ${s.rolled} contracts rolled, ${s.picksCreated} picks created, ${s.matchups} matchups scheduled.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
