// Pure helpers for commissioner settings edits: section merge, change summaries, scoring presets,
// roster-slot change detection. Client-safe.

import { DEFAULT_SETTINGS, SCORING_PRESETS, diffSettings, resolveSettings, withTombstones, type LeagueSettings, type RosterSlotDef } from "@/lib/settings/schema";
import { fieldForPath, formatFieldValue, labelForPath, type FormatLookups, type SettingsSection } from "@/lib/commissioner/settings-meta";

export interface SettingsChange {
  path: string;
  from?: unknown;
  to?: unknown;
}

/** Replace one top-level section of the settings (returns a new, fully resolved object). */
export function applySection<K extends SettingsSection>(current: LeagueSettings, section: K, value: LeagueSettings[K]): LeagueSettings {
  const next = { ...JSON.parse(JSON.stringify(current)), [section]: JSON.parse(JSON.stringify(value)) } as LeagueSettings;
  // tombstones keep removed default map entries (e.g. the TE premium) removed when re-resolving
  return resolveSettings(withTombstones(next));
}

/**
 * Full settings from a LeagueSettingsHistory snapshot. Keys added after the snapshot fall back to defaults,
 * but the snapshot's own maps (position overrides / limits, rookie scale) are kept exactly, so entries that
 * were removed at that version stay removed.
 */
export function settingsFromSnapshot(snapshot: unknown): LeagueSettings {
  const snap = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Partial<LeagueSettings>;
  const next = JSON.parse(JSON.stringify(resolveSettings(snap))) as LeagueSettings;
  if (snap.scoring?.positionOverrides) next.scoring.positionOverrides = JSON.parse(JSON.stringify(snap.scoring.positionOverrides));
  if (snap.roster?.positionLimits) next.roster.positionLimits = JSON.parse(JSON.stringify(snap.roster.positionLimits));
  if (snap.contracts?.rookieScale) next.contracts.rookieScale = JSON.parse(JSON.stringify(snap.contracts.rookieScale));
  return resolveSettings(withTombstones(next));
}

/** Deep copy with object keys sorted (Postgres jsonb reorders keys, which would otherwise look like a change). */
export function canonical<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => canonical(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canonical(x);
    }
    return out as T;
  }
  return v;
}

/** Diff two settings objects (or sections), ignoring key order */
export function settingsChanges(before: unknown, after: unknown): SettingsChange[] {
  return diffSettings(canonical(before), canonical(after)) as SettingsChange[];
}

/** Did the starting lineup structure change (keys, counts or order)? Labels / eligibility edits don't need a lineup reset. */
export function slotsStructureChanged(a: RosterSlotDef[], b: RosterSlotDef[]): boolean {
  const sig = (s: RosterSlotDef[]) => s.map((x) => `${x.key}:${x.count}`).join("|");
  return sig(a) !== sig(b);
}

/** Did slot eligibility change (players may now be in slots they can't fill)? */
export function slotsEligibilityChanged(a: RosterSlotDef[], b: RosterSlotDef[]): boolean {
  const map = new Map(a.map((s) => [s.key, [...s.eligible].sort().join(",")]));
  return b.some((s) => map.has(s.key) && map.get(s.key) !== [...s.eligible].sort().join(","));
}

const LIST_NOUN: Record<string, string> = {
  "scoring.bonuses": "bonus",
  "scoring.fieldGoalsByDistance": "distance range",
  "scoring.pointsAllowedTiers": "tier",
  "scoring.yardsAllowedTiers": "tier",
  "scoring.longTdBonuses": "long-TD bonus",
};

function scoringValue(path: string, v: unknown): string | null {
  if (v === undefined) return "none";
  if (path === "scoring.bonuses" && Array.isArray(v)) return v.length ? (v as { label: string; points: number }[]).map((b) => `${b.label} (+${b.points})`).join(", ") : "none";
  if (path === "scoring.longTdBonuses" && Array.isArray(v)) return v.length ? (v as { minYards: number; points: number }[]).map((b) => `${b.minYards}+ yd +${b.points}`).join(", ") : "none";
  if ((path === "scoring.pointsAllowedTiers" || path === "scoring.yardsAllowedTiers") && Array.isArray(v))
    return (v as { max: number; points: number }[]).map((t) => `≤${t.max}: ${t.points}`).join(", ") || "none";
  if (path === "scoring.fieldGoalsByDistance" && Array.isArray(v)) return (v as { min: number; max: number; points: number }[]).map((t) => `${t.min}-${t.max}: ${t.points}`).join(", ") || "none";
  if (path.startsWith("scoring.positionOverrides") && v && typeof v === "object")
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => (x && typeof x === "object" ? `${k}: ${Object.entries(x as Record<string, number>).map(([a, b]) => `${a} ${b}`).join(", ")}` : `${k} ${x}`)).join("; ") || "none";
  if (Array.isArray(v) && LIST_NOUN[path]) return `${v.length} ${LIST_NOUN[path]}${v.length === 1 ? "" : "s"}`;
  return null;
}

function shortJson(v: unknown): string {
  if (v === undefined) return "removed";
  if (v === null) return "none";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number" || typeof v === "string") return String(v);
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** Format one side of a change for display */
export function formatChangeValue(path: string, value: unknown, lk: FormatLookups = {}): string {
  if (value === undefined && !path.startsWith("scoring.")) return "—";
  if (path.startsWith("scoring.")) return scoringValue(path, value) ?? shortJson(value);
  const hit = fieldForPath(path);
  if (hit && !hit.rest) return formatFieldValue(hit.field, value, lk);
  return shortJson(value);
}

/** One-line human summary per change: "Salary cap: Salary cap: $300 → $320" */
export function describeChange(c: SettingsChange, lk: FormatLookups = {}): string {
  return `${labelForPath(c.path)}: ${formatChangeValue(c.path, c.from, lk)} → ${formatChangeValue(c.path, c.to, lk)}`;
}

/**
 * Collapse deep diffs into one row per catalog field (e.g. ten edited rookie-scale cells become one
 * "Rookie salary scale" change) so history and notifications stay readable.
 */
export function groupChanges(changes: SettingsChange[], before: LeagueSettings, after: LeagueSettings): SettingsChange[] {
  const out: SettingsChange[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    let key = c.path;
    if (c.path.startsWith("scoring.")) {
      const parts = c.path.split(".");
      key = ["rules", "positionOverrides"].includes(parts[1]) ? parts.slice(0, parts[1] === "rules" ? 3 : 4).join(".") : parts.slice(0, 2).join(".");
    } else {
      const hit = fieldForPath(c.path);
      if (hit) key = `${hit.section}.${hit.field.path}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: key, from: getDeep(before, key), to: getDeep(after, key) });
  }
  return out;
}

function getDeep(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Notification body: up to `limit` readable changes */
export function changeSummary(changes: SettingsChange[], lk: FormatLookups = {}, limit = 6): string {
  const lines = changes.slice(0, limit).map((c) => describeChange(c, lk));
  if (changes.length > limit) lines.push(`…and ${changes.length - limit} more`);
  return lines.join("\n");
}

/** Apply a scoring preset: per-stat points reset to the standard base with the preset's reception value. */
export function applyScoringPreset(scoring: LeagueSettings["scoring"], preset: "PPR" | "HALF_PPR" | "STANDARD"): LeagueSettings["scoring"] {
  const rules = { ...DEFAULT_SETTINGS.scoring.rules, ...(SCORING_PRESETS[preset] as Record<string, number>) };
  return { ...scoring, preset, rules };
}

/** Top-level sections touched by a list of changes */
export function changedSections(changes: SettingsChange[]): SettingsSection[] {
  return [...new Set(changes.map((c) => c.path.split(".")[0] as SettingsSection))];
}

/** Is this section locked right now? */
export function sectionLock(settings: LeagueSettings, section: SettingsSection, phase: string): { locked: boolean; requiresVote: boolean } {
  const inSeason = phase === "REGULAR" || phase === "PLAYOFFS";
  return {
    locked: inSeason && section !== "commissioner" && settings.commissioner.lockedSectionsInSeason.includes(section),
    requiresVote: inSeason && settings.commissioner.sectionsRequiringVote.includes(section),
  };
}

/** Pick a unique id for a new list row */
export function uniqueId(base: string, taken: string[]): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item";
  let id = slug;
  let i = 2;
  while (taken.includes(id)) id = `${slug}-${i++}`;
  return id;
}

/** Common lineup slot templates for the slot editor */
export const SLOT_TEMPLATES: RosterSlotDef[] = [
  { key: "QB", label: "QB", count: 1, eligible: ["QB"] },
  { key: "RB", label: "RB", count: 2, eligible: ["RB"] },
  { key: "WR", label: "WR", count: 3, eligible: ["WR"] },
  { key: "TE", label: "TE", count: 1, eligible: ["TE"] },
  { key: "FLEX", label: "W/R/T", count: 1, eligible: ["RB", "WR", "TE"] },
  { key: "WRRB", label: "W/R", count: 1, eligible: ["RB", "WR"] },
  { key: "REC", label: "W/T", count: 1, eligible: ["WR", "TE"] },
  { key: "SFLEX", label: "SUPERFLEX", count: 1, eligible: ["QB", "RB", "WR", "TE"] },
  { key: "OP", label: "OP", count: 1, eligible: ["QB", "RB", "WR", "TE", "K"] },
  { key: "K", label: "K", count: 1, eligible: ["K"] },
  { key: "DEF", label: "DST", count: 1, eligible: ["DEF"] },
  { key: "DL", label: "DL", count: 1, eligible: ["DL"] },
  { key: "LB", label: "LB", count: 1, eligible: ["LB"] },
  { key: "DB", label: "DB", count: 1, eligible: ["DB"] },
  { key: "IDP_FLEX", label: "IDP", count: 1, eligible: ["DL", "LB", "DB"] },
];

export interface VoteOutcome {
  yes: number;
  no: number;
  eligible: number;
  /** yes votes needed to pass (settings.commissioner.voteThresholdPercent of eligible managers) */
  needed: number;
  passed: boolean;
  /** yes votes as a share of eligible managers */
  pct: number;
  error: string | null;
}

/** Result of a recorded league vote on an in-season rule change. */
export function voteOutcome(vote: { yes: number; no: number }, eligible: number, thresholdPercent: number): VoteOutcome {
  const yes = Math.max(0, Math.floor(vote.yes));
  const no = Math.max(0, Math.floor(vote.no));
  const voters = Math.max(1, eligible);
  const needed = Math.max(1, Math.ceil((voters * thresholdPercent) / 100 - 1e-9));
  const pct = Math.round((yes / voters) * 1000) / 10;
  let error: string | null = null;
  if (yes + no > voters) error = `${yes + no} votes recorded but only ${voters} managers can vote.`;
  else if (yes < needed) error = `The vote failed: ${yes} of ${voters} managers voted yes; ${needed} (${thresholdPercent}%) needed.`;
  return { yes, no, eligible: voters, needed, passed: !error, pct, error };
}

/** History / audit note for a recorded vote */
export function voteNote(o: VoteOutcome): string {
  return `League vote passed ${o.yes}–${o.no} (${o.pct}% of ${o.eligible} managers; ${o.needed} needed)`;
}
