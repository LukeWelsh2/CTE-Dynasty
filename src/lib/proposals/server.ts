// Rule suggestion board — server helpers: load proposals, preview a settings patch with the commissioner
// validators, and apply an adopted proposal's patch through the commissioner settings store (so the
// LeagueSettingsHistory + AuditLog rows match every other settings change).
import "server-only";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { writeSettings } from "@/lib/commissioner/settings-store";
import { crossFieldIssues, parseScoring, parseSection, scoringIssues } from "@/lib/commissioner/settings-validate";
import { changedSections, describeChange, formatChangeValue, groupChanges, sectionLock, settingsChanges, type SettingsChange } from "@/lib/commissioner/settings-logic";
import { SECTION_LABELS, isEditableSection, labelForPath, type SettingsSection } from "@/lib/commissioner/settings-meta";
import { checkPatchShape, mergePatch } from "@/lib/proposals/logic";

export interface PatchPreview {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** sections locked for in-season edits that the patch touches */
  locked: string[];
  sections: string[];
  changes: { path: string; label: string; from: string; to: string }[];
  summary: string[];
  merged: LeagueSettings | null;
}

/** Validate a settings patch against the current league settings and describe what it would change. */
export async function previewPatch(ctx: Pick<LeagueContext, "league" | "settings">, patch: Record<string, unknown>): Promise<PatchPreview> {
  const empty: PatchPreview = { ok: false, errors: [], warnings: [], locked: [], sections: [], changes: [], summary: [], merged: null };
  const shape = checkPatchShape(patch, DEFAULT_SETTINGS);
  if (shape.length) return { ...empty, errors: shape };
  let merged: LeagueSettings;
  try {
    merged = mergePatch(ctx.settings, patch);
  } catch (e) {
    return { ...empty, errors: [`The patch couldn't be merged: ${(e as Error).message}`] };
  }
  const raw = settingsChanges(ctx.settings, merged);
  if (!raw.length) return { ...empty, ok: true, warnings: ["The current settings already match this patch — adopting it changes nothing."], merged };
  const sections = changedSections(raw);
  const errors: string[] = [];
  const warnings: string[] = [];
  const teamIds = (await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true } })).map((t) => t.id);
  for (const s of sections) {
    if (s === "scoring") {
      const parsed = parseScoring(merged.scoring);
      if (!parsed.ok) errors.push(...parsed.issues.map((i) => i.message));
      else {
        const c = scoringIssues(parsed.data);
        errors.push(...c.errors.map((i) => i.message));
        warnings.push(...c.warnings);
      }
    } else if (isEditableSection(s)) {
      const parsed = parseSection(s, merged[s]);
      if (!parsed.ok) errors.push(...parsed.issues.map((i) => `${SECTION_LABELS[s]}: ${i.message}`));
      else {
        const c = crossFieldIssues(s, merged, { teamIds });
        errors.push(...c.errors.map((i) => i.message));
        warnings.push(...c.warnings);
      }
    } else errors.push(`Unknown settings section “${s}”.`);
  }
  const locked = sections.filter((s) => sectionLock(ctx.settings, s as SettingsSection, ctx.league.phase).locked).map((s) => SECTION_LABELS[s as SettingsSection] ?? s);
  const teams = await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true } });
  const lk = { teams: new Map(teams.map((t) => [t.id, t.name])), tz: ctx.settings.general.timezone };
  const grouped: SettingsChange[] = groupChanges(raw, ctx.settings, merged);
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    locked,
    sections: sections.map((s) => SECTION_LABELS[s as SettingsSection] ?? s),
    changes: grouped.map((c) => ({ path: c.path, label: labelForPath(c.path), from: formatChangeValue(c.path, c.from, lk), to: formatChangeValue(c.path, c.to, lk) })),
    summary: grouped.slice(0, 6).map((c) => describeChange(c, lk)),
    merged,
  };
}

/** Audit rows recording that a proposal's patch was applied, keyed by proposal id. */
export async function appliedPatches(leagueId: string, proposalIds: string[]): Promise<Map<string, { at: Date; version: number | null; actorId: string | null }>> {
  if (!proposalIds.length) return new Map();
  const rows = await db.auditLog.findMany({
    where: { leagueId, action: "proposal.apply", targetType: "rule_proposal", targetId: { in: proposalIds } },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, createdAt: true, details: true, actorId: true },
  });
  const out = new Map<string, { at: Date; version: number | null; actorId: string | null }>();
  for (const r of rows) {
    if (!r.targetId || out.has(r.targetId)) continue;
    const v = (r.details as Record<string, unknown> | null)?.version;
    out.set(r.targetId, { at: r.createdAt, version: typeof v === "number" ? v : null, actorId: r.actorId });
  }
  return out;
}

/**
 * Apply an adopted proposal's settings patch. Honors in-season section locks; the league vote stands in
 * for the "requires a vote" rule. Returns the new settings version and number of changes.
 */
export async function applyProposalPatch(
  ctx: LeagueContext,
  proposal: { id: string; title: string; settingsPatch: unknown; effectiveSeason: number | null },
): Promise<{ version: number; changes: number; summary: string[] }> {
  const patch = proposal.settingsPatch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("This proposal has no settings patch to apply.");
  if (proposal.effectiveSeason && proposal.effectiveSeason > ctx.season)
    throw new Error(`This rule takes effect in ${proposal.effectiveSeason}. Apply it once the league rolls over to the ${proposal.effectiveSeason} season.`);
  const preview = await previewPatch(ctx, patch as Record<string, unknown>);
  if (!preview.ok || !preview.merged) throw new Error(preview.errors[0] ?? "The settings patch is invalid.");
  if (preview.locked.length) throw new Error(`${preview.locked.join(", ")} settings are locked during the season — apply this after the season or unlock the section first.`);
  if (!preview.changes.length) throw new Error("The current settings already match this proposal.");
  const res = await writeSettings(ctx, preview.merged, {
    action: "settings.proposal",
    note: `Adopted rule proposal: ${proposal.title}`,
    notifyManagers: ctx.settings.notifications.settingsChangeNotifyDefault,
    // the patch was merged into this request's settings: refuse if someone saved a newer version meanwhile
    expectedVersion: ctx.league.settingsVersion,
    details: { proposalId: proposal.id },
  });
  await db.auditLog.create({
    data: {
      leagueId: ctx.league.id,
      actorId: ctx.user.id,
      action: "proposal.apply",
      targetType: "rule_proposal",
      targetId: proposal.id,
      details: { version: res.version, changes: res.changes.length, title: proposal.title },
    },
  });
  return { version: res.version, changes: res.changes.length, summary: preview.summary };
}
