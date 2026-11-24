"use server";
// Commissioner settings server actions: save a section, save scoring (+ optional re-score), preview
// scoring impact, revert to a previous version, dues tracker, player search for pickers.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { searchName } from "@/lib/utils";
import { fail, idSchema, requireCommish, requireFullPowers, type ActionResult } from "@/lib/commissioner/server";
import { writeSettings, type WriteResult } from "@/lib/commissioner/settings-store";
import { scoringPreview, type ScoringPreview } from "@/lib/commissioner/scoring-preview";
import { SECTION_LABELS, isEditableSection, type SettingsSection } from "@/lib/commissioner/settings-meta";
import { crossFieldIssues, parseScoring, parseSection, scoringIssues } from "@/lib/commissioner/settings-validate";
import { applySection, changedSections, sectionLock, settingsChanges, settingsFromSnapshot, voteNote, voteOutcome } from "@/lib/commissioner/settings-logic";
import type { LeagueContext } from "@/lib/league";

const noteSchema = z.string().trim().max(500).optional();

function revalidateAll() {
  revalidatePath("/", "layout");
}

function resultMessage(base: string, r: WriteResult): string {
  if (!r.changes.length) return "No changes to save.";
  let msg = `${base} (version ${r.version}, ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}).`;
  if (r.lineupReset?.mode === "rebuilt") msg += ` Lineups from Week ${r.lineupReset.fromWeek} on were rebuilt for the new slots.`;
  if (r.lineupReset?.mode === "ineligible-removed" && r.lineupReset.rowsCleared) msg += ` ${r.lineupReset.rowsCleared} starter(s) no longer eligible were moved to the bench.`;
  return msg;
}

const voteSchema = z.object({ yes: z.number().int().min(0).max(64), no: z.number().int().min(0).max(64) }).optional();

/**
 * Enforce setting locks (settings.commissioner.lockedSectionsInSeason) and in-season league votes
 * (sectionsRequiringVote + voteThresholdPercent). Returns the change note, prefixed with the vote result
 * when a vote was required.
 */
async function checkLocks(ctx: LeagueContext, sections: SettingsSection[], note: string | undefined, vote: z.infer<typeof voteSchema>): Promise<string | undefined> {
  const needsVote: SettingsSection[] = [];
  for (const s of sections) {
    const lock = sectionLock(ctx.settings, s, ctx.league.phase);
    if (lock.locked) throw new Error(`${SECTION_LABELS[s]} settings are locked during the season (unlock them under Settings › Commissioner).`);
    if (lock.requiresVote) needsVote.push(s);
  }
  if (!needsVote.length) return note;
  const labels = needsVote.map((s) => SECTION_LABELS[s]).join(", ");
  if (!vote) throw new Error(`In-season ${labels} changes need a league vote: record the yes / no votes to save.`);
  const voters = await db.team.count({ where: { leagueId: ctx.league.id } });
  const outcome = voteOutcome(vote, voters, ctx.settings.commissioner.voteThresholdPercent);
  if (outcome.error) throw new Error(outcome.error);
  return [voteNote(outcome), note?.trim()].filter(Boolean).join(" · ");
}

async function teamIds(leagueId: string) {
  return (await db.team.findMany({ where: { leagueId }, select: { id: true } })).map((t) => t.id);
}

const sectionInput = z.object({
  section: z.string(),
  value: z.unknown(),
  note: noteSchema,
  vote: voteSchema,
  notifyManagers: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});

export async function saveSettingsSection(raw: z.input<typeof sectionInput>): Promise<ActionResult<{ version: number }>> {
  try {
    const ctx = await requireFullPowers();
    const input = sectionInput.parse(raw);
    if (!isEditableSection(input.section)) return { ok: false, error: "Unknown settings section." };
    const parsed = parseSection(input.section, input.value);
    if (!parsed.ok) return { ok: false, error: parsed.issues[0]?.message ?? "Invalid settings" };
    const next = applySection(ctx.settings, input.section, parsed.data as LeagueSettings[typeof input.section]);
    const check = crossFieldIssues(input.section, next, { teamIds: await teamIds(ctx.league.id) });
    if (check.errors.length) return { ok: false, error: check.errors[0].message };
    const note = await checkLocks(ctx, [input.section], input.note, input.vote);
    const res = await writeSettings(ctx, next, {
      action: "settings.update",
      note,
      notifyManagers: input.notifyManagers,
      expectedVersion: input.expectedVersion,
      details: { section: input.section, ...(input.vote ? { vote: input.vote } : {}) },
    });
    revalidateAll();
    return { ok: true, message: resultMessage(`${SECTION_LABELS[input.section]} saved`, res), data: { version: res.version } };
  } catch (e) {
    return fail(e);
  }
}

const scoringInput = z.object({
  scoring: z.unknown(),
  applyMode: z.enum(["CURRENT_AND_FUTURE", "WHOLE_SEASON"]).default("CURRENT_AND_FUTURE"),
  note: noteSchema,
  vote: voteSchema,
  notifyManagers: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});

export async function saveScoringSettings(raw: z.input<typeof scoringInput>): Promise<ActionResult<{ version: number; rescored: number }>> {
  try {
    const ctx = await requireFullPowers();
    const input = scoringInput.parse(raw);
    const parsed = parseScoring(input.scoring);
    if (!parsed.ok) return { ok: false, error: parsed.issues[0]?.message ?? "Invalid scoring" };
    const issues = scoringIssues(parsed.data);
    if (issues.errors.length) return { ok: false, error: issues.errors[0].message };
    const note = await checkLocks(ctx, ["scoring"], input.note, input.vote);
    const next = applySection(ctx.settings, "scoring", parsed.data);
    const res = await writeSettings(ctx, next, {
      action: "scoring.update",
      note,
      notifyManagers: input.notifyManagers,
      expectedVersion: input.expectedVersion,
      details: { applyMode: input.applyMode, ...(input.vote ? { vote: input.vote } : {}) },
    });
    if (!res.changes.length) return { ok: true, message: "No changes to save.", data: { version: res.version, rescored: 0 } };
    const resolved = resolveSettings((await db.league.findUniqueOrThrow({ where: { id: ctx.league.id }, select: { settings: true } })).settings);
    let weeks: number[] = [ctx.week];
    if (input.applyMode === "WHOLE_SEASON") {
      const rows = await db.matchup.findMany({ where: { leagueId: ctx.league.id, season: ctx.season, week: { lte: ctx.week } }, select: { week: true }, distinct: ["week"], orderBy: { week: "asc" } });
      weeks = rows.map((r) => r.week);
    }
    for (const w of weeks) await refreshWeekMatchups(ctx.league.id, ctx.season, w, resolved);
    revalidateAll();
    const extra = input.applyMode === "WHOLE_SEASON" ? ` Re-scored ${weeks.length} week${weeks.length === 1 ? "" : "s"} of matchups.` : ` Week ${ctx.week} recalculated; completed weeks keep their final scores.`;
    return { ok: true, message: `Scoring saved (version ${res.version}, ${res.changes.length} changes).${extra}`, data: { version: res.version, rescored: weeks.length } };
  } catch (e) {
    return fail(e);
  }
}

export async function previewScoringImpact(raw: { scoring: unknown }): Promise<ActionResult<ScoringPreview>> {
  try {
    const ctx = await requireCommish();
    const parsed = parseScoring(raw?.scoring);
    if (!parsed.ok) return { ok: false, error: parsed.issues[0]?.message ?? "Invalid scoring" };
    const data = await scoringPreview(ctx.league.id, ctx.season, ctx.week, ctx.settings, parsed.data);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

export async function revertSettingsVersion(raw: { historyId: string; note?: string; vote?: { yes: number; no: number }; expectedVersion: number }): Promise<ActionResult<{ version: number }>> {
  try {
    const ctx = await requireFullPowers();
    const input = z.object({ historyId: idSchema, note: noteSchema, vote: voteSchema, expectedVersion: z.number().int().min(1) }).parse(raw);
    const row = await db.leagueSettingsHistory.findUnique({ where: { id: input.historyId } });
    if (!row || row.leagueId !== ctx.league.id) return { ok: false, error: "That version was not found." };
    const target = settingsFromSnapshot(row.snapshot);
    // honor locks for every section the revert would change
    const sections = changedSections(settingsChanges(ctx.settings, target));
    if (!sections.length) return { ok: true, message: "The current settings already match that version." };
    const note = await checkLocks(ctx, sections, input.note?.trim() || `Reverted to version ${row.version}`, input.vote);
    const res = await writeSettings(ctx, target, {
      action: "settings.revert",
      note,
      expectedVersion: input.expectedVersion,
      details: { revertedTo: row.version, historyId: row.id, ...(input.vote ? { vote: input.vote } : {}) },
    });
    if (sections.includes("scoring")) await refreshWeekMatchups(ctx.league.id, ctx.season, ctx.week, target).catch(() => {});
    revalidateAll();
    return { ok: true, message: resultMessage(`Reverted to version ${row.version}`, res), data: { version: res.version } };
  } catch (e) {
    return fail(e);
  }
}

export async function setDuesPaid(raw: { teamId: string; paid: boolean }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = z.object({ teamId: idSchema, paid: z.boolean() }).parse(raw);
    const team = await db.team.findUnique({ where: { id: input.teamId } });
    if (!team || team.leagueId !== ctx.league.id) return { ok: false, error: "Team not found." };
    const set = new Set(ctx.settings.general.duesPaidTeamIds);
    if (input.paid) set.add(team.id);
    else set.delete(team.id);
    const next = applySection(ctx.settings, "general", { ...ctx.settings.general, duesPaidTeamIds: [...set] });
    await writeSettings(ctx, next, { action: "dues.update", note: `${team.name} dues marked ${input.paid ? "paid" : "unpaid"}`, details: { teamId: team.id, paid: input.paid } });
    revalidatePath("/commissioner/members");
    revalidatePath("/commissioner");
    return { ok: true, message: `${team.name}: dues ${input.paid ? "paid" : "unpaid"}.` };
  } catch (e) {
    return fail(e);
  }
}

export interface PlayerSearchRow {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  rosteredBy: { teamId: string; abbrev: string; salary: number } | null;
}

export async function searchPlayersAction(q: string): Promise<ActionResult<PlayerSearchRow[]>> {
  try {
    const ctx = await requireCommish();
    const query = z.string().trim().min(2).max(40).parse(q);
    const sn = searchName(query);
    const players = await db.player.findMany({
      where: { OR: [{ searchName: { contains: sn } }, { lastName: { startsWith: query, mode: "insensitive" } }, { id: query.toUpperCase() }] },
      orderBy: [{ active: "desc" }, { searchRank: { sort: "asc", nulls: "last" } }],
      take: 12,
      include: { rosterSpots: { where: { leagueId: ctx.league.id }, include: { team: { select: { id: true, abbrev: true } } } } },
    });
    return {
      ok: true,
      data: players.map((p) => ({
        id: p.id,
        name: p.fullName,
        position: p.position,
        nflTeam: p.team,
        injuryStatus: p.injuryStatus,
        rosteredBy: p.rosterSpots[0] ? { teamId: p.rosterSpots[0].team.id, abbrev: p.rosterSpots[0].team.abbrev, salary: p.rosterSpots[0].salary } : null,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}
