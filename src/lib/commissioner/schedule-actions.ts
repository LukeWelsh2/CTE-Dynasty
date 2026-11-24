"use server";
// Commissioner schedule & scoring tools: regenerate the schedule, edit a week's pairings, score
// adjustments, recalculating a week, and pinning the league week.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { lastFantasyWeek } from "@/lib/league-week";
import type { LeagueContext } from "@/lib/league";
import { assertNotOwnTeam, audit, fail, idSchema, leagueTeam, notifyTeam, requireCommish, requireFullPowers, type ActionResult } from "@/lib/commissioner/server";
import { buildSeasonSchedule, weekPairingErrors } from "@/lib/commissioner/schedule-gen";
import { lastRegularWeek } from "@/lib/commissioner/settings-validate";
import { statCorrectionsOpen } from "@/lib/commissioner/stat-corrections";
import { changedResults, type ResultRow } from "@/lib/commissioner/roster-logic";

function revalidateSchedule() {
  revalidatePath("/commissioner/schedule");
  revalidatePath("/commissioner");
  revalidatePath("/schedule");
  revalidatePath("/scoring");
  revalidatePath("/standings");
  revalidatePath("/", "layout");
}

function assertPastScoresEditable(ctx: LeagueContext, week: number) {
  if (week < ctx.week && !ctx.settings.commissioner.canEditPastScores) throw new Error("League rules don't allow editing past weeks (Settings › Commissioner › Edit past scores).");
}

const weekSchema = z.number().int().min(1).max(18);

export async function regenerateSchedule(raw: { fromWeek: number; overwriteResults?: boolean }): Promise<ActionResult> {
  try {
    const ctx = await requireFullPowers();
    const input = z.object({ fromWeek: weekSchema, overwriteResults: z.boolean().default(false) }).parse(raw);
    const s = ctx.settings;
    const last = lastRegularWeek(s);
    const fromWeek = Math.max(input.fromWeek, s.general.firstWeek);
    if (fromWeek > last) return { ok: false, error: `The regular season ends in Week ${last}.` };
    const played = await db.matchup.count({ where: { leagueId: ctx.league.id, season: ctx.season, isPlayoff: false, week: { gte: fromWeek }, status: { in: ["FINAL", "LIVE"] } } });
    if (played && !input.overwriteResults) return { ok: false, error: `${played} matchup(s) from Week ${fromWeek} on have already been played. Confirm overwriting results to continue.` };
    if (played) assertPastScoresEditable(ctx, fromWeek);
    const teams = await db.team.findMany({ where: { leagueId: ctx.league.id }, orderBy: { createdAt: "asc" }, select: { id: true, division: true } });
    if (teams.length < 2) return { ok: false, error: "Add at least two teams first." };
    const plan = buildSeasonSchedule(teams, s).filter((m) => m.week >= fromWeek && m.week <= last);
    await db.$transaction(async (tx) => {
      await tx.matchup.deleteMany({ where: { leagueId: ctx.league.id, season: ctx.season, isPlayoff: false, week: { gte: fromWeek, lte: last } } });
      await tx.matchup.createMany({ data: plan.map((m) => ({ leagueId: ctx.league.id, season: ctx.season, week: m.week, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, label: m.label === "Bye" ? null : m.label })) });
      await audit(tx, ctx, "schedule.regenerate", {
        targetType: "season",
        targetId: String(ctx.season),
        details: { summary: `Weeks ${fromWeek}-${last} (${s.matchups.scheduleType.replace(/_/g, " ").toLowerCase()}), ${plan.length} matchups${played ? `, ${played} played results replaced` : ""}` },
      });
    });
    for (let w = fromWeek; w <= Math.min(last, ctx.week); w++) await refreshWeekMatchups(ctx.league.id, ctx.season, w, s);
    revalidateSchedule();
    return { ok: true, message: `Schedule regenerated for Weeks ${fromWeek}-${last} (${plan.length} matchups).` };
  } catch (e) {
    return fail(e);
  }
}

const pairSchema = z.object({ id: idSchema.optional(), homeTeamId: idSchema.nullable(), awayTeamId: idSchema.nullable(), label: z.string().trim().max(40).nullable().optional() });

export async function saveWeekMatchups(raw: { week: number; pairs: z.input<typeof pairSchema>[] }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z.object({ week: weekSchema, pairs: z.array(pairSchema).max(32) }).parse(raw);
    const existing = await db.matchup.findMany({ where: { leagueId: ctx.league.id, season: ctx.season, week: input.week } });
    const editable = existing.filter((m) => !m.isPlayoff);
    if (editable.some((m) => m.status !== "UPCOMING")) assertPastScoresEditable(ctx, input.week);
    const playoffTeams = new Set(existing.filter((m) => m.isPlayoff).flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x));
    const teams = await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true } });
    const names = new Map(teams.map((t) => [t.id, t.name]));
    const pairs = input.pairs.map((p) => ({ ...p, homeTeamId: p.homeTeamId || null, awayTeamId: p.awayTeamId || null }));
    const errors = weekPairingErrors(pairs, teams.map((t) => t.id), names);
    for (const p of pairs) for (const id of [p.homeTeamId, p.awayTeamId]) if (id && playoffTeams.has(id)) errors.push(`${names.get(id)} already has a playoff game this week.`);
    if (errors.length) return { ok: false, error: errors[0] };
    const ids = new Set(editable.map((m) => m.id));
    for (const p of pairs) if (p.id && !ids.has(p.id)) return { ok: false, error: "Matchup not found in this week." };
    const keep = new Set(pairs.map((p) => p.id).filter(Boolean));
    const removed = editable.filter((m) => !keep.has(m.id));
    const describe = (h: string | null, a: string | null) => `${a ? names.get(a) : "BYE"} @ ${h ? names.get(h) : "BYE"}`;
    await db.$transaction(async (tx) => {
      if (removed.length) await tx.matchup.deleteMany({ where: { id: { in: removed.map((m) => m.id) } } });
      for (const p of pairs) {
        if (p.id) await tx.matchup.update({ where: { id: p.id }, data: { homeTeamId: p.homeTeamId, awayTeamId: p.awayTeamId, ...(p.label !== undefined ? { label: p.label || null } : {}) } });
        else await tx.matchup.create({ data: { leagueId: ctx.league.id, season: ctx.season, week: input.week, homeTeamId: p.homeTeamId, awayTeamId: p.awayTeamId, label: p.label || null } });
      }
      await audit(tx, ctx, "schedule.week_edit", { targetType: "week", targetId: String(input.week), details: { summary: `Week ${input.week}: ${pairs.map((p) => describe(p.homeTeamId, p.awayTeamId)).join("; ")}` } });
    });
    await refreshWeekMatchups(ctx.league.id, ctx.season, input.week, ctx.settings);
    revalidateSchedule();
    return { ok: true, message: `Week ${input.week} matchups saved.` };
  } catch (e) {
    return fail(e);
  }
}

export async function addScoreAdjustment(raw: { teamId: string; week: number; points: number; reason: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z
      .object({
        teamId: idSchema,
        week: weekSchema,
        points: z.number().min(-500).max(500).refine((n) => n !== 0, "Enter a non-zero adjustment"),
        reason: z.string().trim().min(3, "Give a reason managers will see").max(200),
      })
      .parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    assertNotOwnTeam(ctx, team.id);
    assertPastScoresEditable(ctx, input.week);
    const pts = Math.round(input.points * 100) / 100;
    await db.$transaction(async (tx) => {
      const adj = await tx.scoreAdjustment.create({ data: { leagueId: ctx.league.id, teamId: team.id, season: ctx.season, week: input.week, points: pts, reason: input.reason, createdById: ctx.user.id } });
      await audit(tx, ctx, "score.adjust", { targetType: "scoreAdjustment", targetId: adj.id, details: { summary: `${team.name} Week ${input.week}: ${pts > 0 ? "+" : ""}${pts} pts`, reason: input.reason, team: team.name } });
    });
    await refreshWeekMatchups(ctx.league.id, ctx.season, input.week, ctx.settings);
    await notifyTeam(ctx, team.id, "Score adjustment", `Week ${input.week}: ${pts > 0 ? "+" : ""}${pts} points (${input.reason})`, "/scoring");
    revalidateSchedule();
    return { ok: true, message: `${pts > 0 ? "+" : ""}${pts} points for ${team.name} in Week ${input.week}; matchups recalculated.` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteScoreAdjustment(raw: { id: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const { id } = z.object({ id: idSchema }).parse(raw);
    const adj = await db.scoreAdjustment.findUnique({ where: { id }, include: { team: { select: { name: true } } } });
    if (!adj || adj.leagueId !== ctx.league.id) return { ok: false, error: "Adjustment not found." };
    assertNotOwnTeam(ctx, adj.teamId);
    assertPastScoresEditable(ctx, adj.week);
    await db.$transaction(async (tx) => {
      await tx.scoreAdjustment.delete({ where: { id } });
      await audit(tx, ctx, "score.adjust_delete", { targetType: "scoreAdjustment", targetId: id, details: { summary: `${adj.team.name} Week ${adj.week}: removed ${adj.points > 0 ? "+" : ""}${adj.points} pts`, reason: adj.reason } });
    });
    await refreshWeekMatchups(ctx.league.id, adj.season, adj.week, ctx.settings);
    await notifyTeam(ctx, adj.teamId, "Score adjustment removed", `Week ${adj.week}: ${adj.points > 0 ? "+" : ""}${adj.points} points removed`, "/scoring");
    revalidateSchedule();
    return { ok: true, message: "Adjustment removed; matchups recalculated." };
  } catch (e) {
    return fail(e);
  }
}

export async function recalculateWeek(raw: { week: number }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const { week } = z.object({ week: weekSchema }).parse(raw);
    assertPastScoresEditable(ctx, week);
    const resultSelect = { id: true, season: true, week: true, homeScore: true, awayScore: true, winnerTeamId: true, status: true, isPlayoff: true, isConsolation: true, bracketRound: true, bracketSlot: true } as const;
    const before = await db.matchup.findMany({ where: { leagueId: ctx.league.id, season: ctx.season, week }, select: resultSelect });
    if (!before.length) return { ok: false, error: `No matchups in Week ${week}.` };
    // the last week of a multi-week playoff game also re-settles the game's earlier weeks' rows
    const otherWeeks = { leagueId: ctx.league.id, season: ctx.season, isPlayoff: true, week: { not: week } };
    const othersBefore: ResultRow[] = before.some((m) => m.isPlayoff) ? await db.matchup.findMany({ where: otherWeeks, select: resultSelect }) : [];
    // settings.general.statCorrectionDay/Hour: after the cutoff a recalculation is a logged commissioner override
    const kickoff = await db.nflGame.aggregate({ where: { season: ctx.season, week, seasonType: "REG" }, _max: { startTime: true } });
    const override = !statCorrectionsOpen(kickoff._max.startTime, ctx.settings);
    const results = await refreshWeekMatchups(ctx.league.id, ctx.season, week, ctx.settings);
    const prev = new Map(before.map((m) => [m.id, m]));
    const changed = results.filter((r) => {
      const p = prev.get(r.matchup.id);
      return p && (Math.abs(p.homeScore - r.matchup.homeScore) > 0.005 || Math.abs(p.awayScore - r.matchup.awayScore) > 0.005);
    }).length;
    const othersAfter: ResultRow[] = othersBefore.length ? await db.matchup.findMany({ where: { id: { in: othersBefore.map((m) => m.id) } }, select: resultSelect }) : [];
    // results that changed, counting a multi-week playoff game once however many of its weeks' rows changed
    const flipped = changedResults([...before, ...othersBefore], [...results.map((r) => r.matchup), ...othersAfter]);
    await audit(db, ctx, "score.recalc", {
      targetType: "week",
      targetId: String(week),
      details: { summary: `Week ${week}: ${changed} score change(s), ${flipped} result change(s)${override && changed ? " (after the stat-correction cutoff)" : ""}`, afterCutoff: override },
    });
    revalidateSchedule();
    return {
      ok: true,
      message: `Week ${week} recalculated: ${changed} matchup score${changed === 1 ? "" : "s"} changed${flipped ? `, ${flipped} result${flipped === 1 ? "" : "s"} changed` : ""}${override && changed ? " (after the stat-correction cutoff, logged as a commissioner override)" : ""}.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function setWeekOverride(raw: { week: number | null }): Promise<ActionResult> {
  try {
    const ctx = await requireFullPowers();
    const { week } = z.object({ week: weekSchema.nullable() }).parse(raw);
    if (week !== null && week > lastFantasyWeek(ctx.settings)) return { ok: false, error: `The fantasy season ends in Week ${lastFantasyWeek(ctx.settings)}.` };
    await db.$transaction(async (tx) => {
      await tx.league.update({ where: { id: ctx.league.id }, data: { weekOverride: week } });
      await audit(tx, ctx, "league.week_override", { targetType: "league", targetId: ctx.league.id, details: { summary: week === null ? "Following the NFL calendar" : `Pinned to Week ${week}` } });
    });
    if (week !== null) await refreshWeekMatchups(ctx.league.id, ctx.season, week, ctx.settings).catch(() => {});
    revalidateSchedule();
    return { ok: true, message: week === null ? "The league week now follows the NFL calendar." : `League pinned to Week ${week}.` };
  } catch (e) {
    return fail(e);
  }
}
