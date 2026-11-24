// Rule suggestion board — pure, client-safe helpers: categories, statuses + workflow, vote tallies,
// sorting and settings-patch parsing / shape checks. Unit-tested in tests/community.test.ts.
import { deepMerge, resolveSettings, withTombstones, type LeagueSettings } from "@/lib/settings/schema";

export const PROPOSAL_CATEGORIES = [
  { value: "SCORING", label: "Scoring" },
  { value: "ROSTER", label: "Roster" },
  { value: "TRADES", label: "Trades" },
  { value: "WAIVERS", label: "Waivers & FAB" },
  { value: "PLAYOFFS", label: "Playoffs" },
  { value: "DRAFT", label: "Draft" },
  { value: "KEEPERS", label: "Keepers & contracts" },
  { value: "CAP", label: "Salary cap" },
  { value: "GENERAL", label: "General" },
  { value: "FUN", label: "Fun & side bets" },
] as const;

export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number]["value"];
export const CATEGORY_VALUES = PROPOSAL_CATEGORIES.map((c) => c.value) as [ProposalCategory, ...ProposalCategory[]];
export function categoryLabel(c: string): string {
  return PROPOSAL_CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

export type ProposalStatus = "OPEN" | "VOTING" | "ADOPTED" | "REJECTED" | "TABLED" | "WITHDRAWN";
export const PROPOSAL_STATUSES: ProposalStatus[] = ["OPEN", "VOTING", "ADOPTED", "REJECTED", "TABLED", "WITHDRAWN"];

export const STATUS_META: Record<ProposalStatus, { label: string; tone: "brand" | "gold" | "green" | "red" | "neutral" | "amber" | "purple"; hint: string }> = {
  OPEN: { label: "Discussion", tone: "brand", hint: "Open for comments and early support" },
  VOTING: { label: "Voting", tone: "gold", hint: "Formal league vote in progress" },
  ADOPTED: { label: "Adopted", tone: "green", hint: "Passed and added to the league rules" },
  REJECTED: { label: "Rejected", tone: "red", hint: "Did not pass" },
  TABLED: { label: "Tabled", tone: "amber", hint: "Set aside for later" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", hint: "Pulled by the author" },
};

export function isActive(status: string): boolean {
  return status === "OPEN" || status === "VOTING";
}

/** Votes may be cast / changed in discussion and during an unexpired formal vote. */
export function votingOpen(p: { status: string; votingEndsAt: Date | string | null }, now: Date = new Date()): boolean {
  if (p.status === "OPEN") return true;
  if (p.status !== "VOTING") return false;
  return !p.votingEndsAt || new Date(p.votingEndsAt).getTime() > now.getTime();
}

/** A formal vote whose end date has passed (awaiting the commissioner's decision). */
export function votingEnded(p: { status: string; votingEndsAt: Date | string | null }, now: Date = new Date()): boolean {
  return p.status === "VOTING" && !!p.votingEndsAt && new Date(p.votingEndsAt).getTime() <= now.getTime();
}

/**
 * Status changes the actor may make. Authors can withdraw (and reopen their own withdrawn idea); the
 * commissioner runs the workflow OPEN → VOTING → ADOPTED / REJECTED / TABLED and can reopen.
 */
export function allowedTransitions(p: { status: string; authorId: string }, actor: { userId: string; isCommish: boolean }): ProposalStatus[] {
  const out = new Set<ProposalStatus>();
  const author = p.authorId === actor.userId;
  if (author && isActive(p.status)) out.add("WITHDRAWN");
  if (author && p.status === "WITHDRAWN") out.add("OPEN");
  if (actor.isCommish) {
    switch (p.status) {
      case "OPEN":
        ["VOTING", "ADOPTED", "REJECTED", "TABLED"].forEach((s) => out.add(s as ProposalStatus));
        break;
      case "VOTING":
        ["ADOPTED", "REJECTED", "TABLED", "OPEN"].forEach((s) => out.add(s as ProposalStatus));
        break;
      case "TABLED":
        ["OPEN", "VOTING"].forEach((s) => out.add(s as ProposalStatus));
        break;
      case "REJECTED":
        out.add("OPEN");
        break;
    }
  }
  out.delete(p.status as ProposalStatus);
  return PROPOSAL_STATUSES.filter((s) => out.has(s));
}

// ───────────────────────────── Votes ─────────────────────────────

export interface Tally {
  support: number;
  oppose: number;
  abstain: number;
  cast: number;
  managers: number;
  /** support share of support + oppose votes (0..1) */
  supportShare: number;
  /** share of the whole league (0..1) */
  leagueSupport: number;
  leagueOppose: number;
  turnout: number;
  net: number;
}

export function tallyVotes(values: number[], managers: number): Tally {
  let support = 0,
    oppose = 0,
    abstain = 0;
  for (const v of values) {
    if (v > 0) support++;
    else if (v < 0) oppose++;
    else abstain++;
  }
  const cast = support + oppose + abstain;
  const m = Math.max(managers, cast, 1);
  return {
    support,
    oppose,
    abstain,
    cast,
    managers: Math.max(managers, cast),
    supportShare: support + oppose ? support / (support + oppose) : 0,
    leagueSupport: support / m,
    leagueOppose: oppose / m,
    turnout: cast / m,
    net: support - oppose,
  };
}

export interface VoteOutcome {
  /** support votes needed to pass (thresholdPercent of every manager in the league) */
  needed: number;
  passes: boolean;
  /** more support votes needed to reach the threshold */
  short: number;
}

/** `thresholdPercent` = share of managers needed to pass a rule change (settings.commissioner.voteThresholdPercent). */
export function voteOutcome(t: Tally, thresholdPercent: number): VoteOutcome {
  const needed = Math.max(1, Math.ceil((Math.min(100, Math.max(0, thresholdPercent)) / 100) * t.managers - 1e-9));
  return { needed, passes: t.support >= needed, short: Math.max(0, needed - t.support) };
}

/** Texts announcing that a formal vote's deadline passed (chat post, league + commissioner notifications). */
export function closedVoteNotice(title: string, t: Tally, o: VoteOutcome): { chat: string; title: string; body: string; commishTitle: string; commishBody: string } {
  const score = `${t.support} support, ${t.oppose} oppose${t.abstain ? `, ${t.abstain} abstain` : ""}`;
  const verdict = o.passes ? `has the ${o.needed} votes needed to pass` : `fell ${o.short} vote${o.short === 1 ? "" : "s"} short of the ${o.needed} needed`;
  return {
    chat: `🗳️ Voting closed on “${title}”: ${score} — it ${verdict}. The commissioner will make it official.`,
    title: `Voting closed: ${title}`,
    body: `${score}. It ${verdict}; the commissioner will make the result official.`,
    commishTitle: `Decide: ${title}`,
    commishBody: `Voting closed — ${score}. It ${verdict}. Adopt, reject or table it on the suggestion board.`,
  };
}

// ───────────────────────────── Sorting ─────────────────────────────

export type ProposalSort = "top" | "newest" | "ending";

export interface SortableProposal {
  status: string;
  createdAt: Date | string;
  votingEndsAt: Date | string | null;
  resolvedAt?: Date | string | null;
  support: number;
  oppose: number;
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

export function sortProposals<T extends SortableProposal>(list: T[], sort: ProposalSort, now: Date = new Date()): T[] {
  const arr = [...list];
  if (sort === "newest") return arr.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  if (sort === "top") return arr.sort((a, b) => b.support - b.oppose - (a.support - a.oppose) || b.support - a.support || ms(b.createdAt) - ms(a.createdAt));
  // ending soon: live votes by deadline, then discussion (oldest first — closest to a vote), then closed (latest first)
  const bucket = (p: T) => (p.status === "VOTING" && p.votingEndsAt && ms(p.votingEndsAt) > now.getTime() ? 0 : p.status === "VOTING" ? 1 : p.status === "OPEN" ? 2 : 3);
  return arr.sort((a, b) => {
    const d = bucket(a) - bucket(b);
    if (d) return d;
    const k = bucket(a);
    if (k === 0) return ms(a.votingEndsAt) - ms(b.votingEndsAt);
    if (k === 1 || k === 2) return ms(a.createdAt) - ms(b.createdAt);
    return ms(b.resolvedAt ?? b.createdAt) - ms(a.resolvedAt ?? a.createdAt);
  });
}

// ───────────────────────────── Settings patch ─────────────────────────────

export const MAX_PATCH_CHARS = 20_000;

/** Map-style settings whose keys are free-form (stats, positions, rounds). */
export const RECORD_PATHS = ["scoring.rules", "scoring.positionOverrides", "roster.positionLimits", "contracts.rookieScale"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function depth(v: unknown): number {
  if (Array.isArray(v)) return 1 + Math.max(0, ...v.map(depth));
  if (isPlainObject(v)) return 1 + Math.max(0, ...Object.values(v).map(depth));
  return 0;
}

/** Parse the JSON a commissioner typed. Empty text = no patch. */
export function parsePatchText(text: string | null | undefined): { ok: true; patch: Record<string, unknown> | null } | { ok: false; error: string } {
  const t = (text ?? "").trim();
  if (!t) return { ok: true, patch: null };
  if (t.length > MAX_PATCH_CHARS) return { ok: false, error: "The settings patch is too long." };
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch (e) {
    return { ok: false, error: `Settings patch isn't valid JSON: ${(e as Error).message}` };
  }
  if (!isPlainObject(v)) return { ok: false, error: 'The settings patch must be a JSON object, e.g. { "roster": { "taxiSlots": 5 } }.' };
  if (!Object.keys(v).length) return { ok: true, patch: null };
  if (depth(v) > 8) return { ok: false, error: "The settings patch is nested too deeply." };
  return { ok: true, patch: v };
}

/** Structural check of a patch against the settings shape: unknown keys and type mismatches. */
export function checkPatchShape(patch: Record<string, unknown>, defaults: LeagueSettings): string[] {
  const errors: string[] = [];
  const walk = (val: unknown, def: unknown, path: string, freeKeys: boolean) => {
    if (freeKeys) return; // inside a record map: keys / values are validated after merging
    if (def === undefined) {
      errors.push(`Unknown setting “${path}”.`);
      return;
    }
    if (isPlainObject(def)) {
      if (!isPlainObject(val)) {
        errors.push(`“${path}” must be an object.`);
        return;
      }
      for (const [k, v] of Object.entries(val)) {
        const p = `${path}.${k}`;
        walk(v, def[k], p, RECORD_PATHS.some((r) => p.startsWith(r + ".")));
      }
      return;
    }
    if (Array.isArray(def)) {
      if (!Array.isArray(val)) errors.push(`“${path}” must be a list.`);
      return;
    }
    if (def === null) return; // nullable setting currently unset: value type is checked by the settings validator
    if (val === null) return; // clearing a nullable value; the settings validator rejects non-nullable fields
    if (typeof def !== typeof val) errors.push(`“${path}” must be a ${typeof def}.`);
    else if (typeof val === "number" && !Number.isFinite(val)) errors.push(`“${path}” must be a finite number.`);
  };
  for (const [k, v] of Object.entries(patch)) walk(v, (defaults as unknown as Record<string, unknown>)[k], k, false);
  return errors;
}

/** Current settings with the patch merged in (map entries removed from the current settings stay removed). */
export function mergePatch(current: LeagueSettings, patch: Record<string, unknown>): LeagueSettings {
  return resolveSettings(deepMerge(withTombstones(current), patch));
}

/** Flat leaf paths of a patch, for compact display. */
export function patchPaths(patch: Record<string, unknown>, prefix = ""): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length) out.push(...patchPaths(v, p));
    else out.push({ path: p, value: v });
  }
  return out;
}

/** Proposal list filter keys used in the URL */
export type StatusFilter = "active" | "all" | ProposalStatus;

export function matchesStatus(status: string, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return isActive(status);
  return status === filter;
}
