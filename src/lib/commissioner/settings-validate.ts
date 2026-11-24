// Validation for commissioner settings edits. Zod schemas are generated from the settings catalog
// (settings-meta.ts) so the client form and the server action share exactly the same rules.
// Pure + client-safe.

import { z } from "zod";
import type { LeagueSettings } from "@/lib/settings/schema";
import { ALL_FANTASY_POSITIONS, IDP_POSITIONS, STAT_BY_KEY } from "@/lib/settings/stat-catalog";
import { isValidTimezone } from "@/lib/commissioner/time";
import { SECTION_BY_KEY, sectionFields, type EditableSection, type FieldDef, type ItemField } from "@/lib/commissioner/settings-meta";

export interface Issue {
  path: string;
  message: string;
}

export interface CheckResult {
  errors: Issue[];
  warnings: string[];
}

export interface CheckContext {
  /** ids of the league's teams (rivalries, dues tracker, trophies) */
  teamIds: string[];
}

const POS = ALL_FANTASY_POSITIONS as readonly string[];
const RESERVED_SLOT_KEYS = new Set(["BN", "IR", "TAXI"]);

const isoDate = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Enter a valid date and time" });
const unique = <T>(arr: T[]) => new Set(arr.map((x) => JSON.stringify(x))).size === arr.length;

function numberSchema(f: { label: string; min: number; max: number; int?: boolean; nullable?: boolean }) {
  let s = z.number({ message: `${f.label}: enter a number` });
  if (f.int) s = s.int({ message: `${f.label}: whole numbers only` });
  s = s.min(f.min, { message: `${f.label}: at least ${f.min}` }).max(f.max, { message: `${f.label}: at most ${f.max}` });
  return f.nullable ? s.nullable() : s;
}

function enumOf(values: string[], label: string) {
  return z.string().refine((v) => values.includes(v), { message: `${label}: choose a valid option` });
}

function itemSchema(i: ItemField): z.ZodType {
  switch (i.kind) {
    case "text": {
      let s = z.string().trim().max(i.maxLength, { message: `${i.label}: at most ${i.maxLength} characters` });
      if (i.minLength) s = s.min(i.minLength, { message: `${i.label} is required` });
      return s;
    }
    case "number":
      return i.nullable ? numberSchema({ ...i, nullable: true }).optional().transform((v) => v ?? null) : numberSchema(i);
    case "toggle":
      return z.boolean();
    case "team":
      return z.string().min(1, { message: `${i.label}: choose a team` }).max(64);
    case "select":
      return enumOf(i.options.map((x) => x.value), i.label);
  }
}

const slotSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{0,11}$/, { message: "Slot keys use 1-12 capital letters, digits or _ (e.g. FLEX)" })
    .refine((k) => !RESERVED_SLOT_KEYS.has(k), { message: "BN, IR and TAXI are reserved slot keys" }),
  label: z.string().trim().min(1, { message: "Every slot needs a label" }).max(16, { message: "Slot labels are at most 16 characters" }),
  count: z.number().int().min(1, { message: "Slot count must be at least 1" }).max(10, { message: "At most 10 of one slot" }),
  eligible: z
    .array(enumOf([...POS], "Eligible position"))
    .min(1, { message: "Every slot needs at least one eligible position" })
    .refine(unique, { message: "Duplicate eligible position" }),
});

/** zod schema for one catalog field */
export function zodForField(f: FieldDef): z.ZodType {
  switch (f.kind) {
    case "number":
      return numberSchema(f);
    case "toggle":
      return z.boolean();
    case "select":
      return enumOf(f.options.map((x) => x.value), f.label);
    case "weekday":
      return enumOf(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], f.label);
    case "timezone":
      return z.string().refine(isValidTimezone, { message: "Choose a valid timezone" });
    case "multi": {
      const values = f.options.map((x) => x.value);
      const item = f.numeric ? z.number().int().refine((n) => values.includes(String(n)), { message: `${f.label}: invalid option` }) : enumOf(values, f.label);
      let s = z.array(item).refine(unique, { message: `${f.label}: duplicate option` });
      if (f.minItems) s = s.refine((a) => a.length >= f.minItems!, { message: `${f.label}: choose at least ${f.minItems}` });
      return s;
    }
    case "ordered":
      return z
        .array(enumOf(f.options.map((x) => x.value), f.label))
        .min(1, { message: `${f.label}: choose at least one` })
        .refine(unique, { message: `${f.label}: each tiebreaker can be used once` });
    case "teams":
      return z.array(z.string().min(1).max(64)).max(64).refine(unique, { message: "Duplicate team" });
    case "players":
      return z.array(z.string().min(1).max(32)).max(300).refine(unique, { message: "Duplicate player" });
    case "text": {
      let s = z.string().trim().max(f.maxLength, { message: `${f.label}: at most ${f.maxLength} characters` });
      if (f.minLength) s = s.min(f.minLength, { message: `${f.label} is required` });
      return s;
    }
    case "datetime":
      return isoDate.nullable();
    case "numberList":
      return z
        .array(z.number().min(f.min, { message: `${f.label}: at least ${f.min}` }).max(f.max, { message: `${f.label}: at most ${f.max}` }))
        .max(f.maxItems, { message: `${f.label}: at most ${f.maxItems} values` });
    case "list": {
      const shape: Record<string, z.ZodType> = {};
      if (f.autoId) shape[f.autoId] = z.string().trim().min(1).max(64);
      for (const i of f.item) shape[i.key] = itemSchema(i);
      let s = z.array(z.object(shape)).max(f.maxItems, { message: `${f.label}: at most ${f.maxItems} entries` });
      if (f.autoId) s = s.refine((rows) => unique(rows.map((r) => (r as Record<string, unknown>)[f.autoId!])), { message: `${f.label}: duplicate id` });
      return s;
    }
    case "rivalries":
      return z.array(z.tuple([z.string().min(1).max(64), z.string().min(1).max(64)])).max(16);
    case "slots":
      return z
        .array(slotSchema)
        .min(1, { message: "Add at least one lineup slot" })
        .max(20, { message: "At most 20 slot types" })
        .refine((a) => unique(a.map((s) => s.key)), { message: "Slot keys must be unique" });
    case "positionLimits":
      return z.record(
        z.string().refine((p) => POS.includes(p), { message: "Unknown position" }),
        z.object({
          min: z.number().int().min(0).max(40),
          max: z.number().int().min(0).max(60).nullable(),
        }),
      );
    case "rookieScale":
      return z.record(
        z.string().regex(/^[1-9]$/, { message: "Rounds 1-9" }),
        z.array(z.number().int({ message: "Rookie salaries are whole dollars" }).min(0).max(100_000)).max(40),
      );
  }
}

type Tree = { [k: string]: Tree | z.ZodType };

function toZod(tree: Tree): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(tree)) shape[k] = v instanceof z.ZodType ? v : toZod(v as Tree);
  return z.object(shape);
}

const schemaCache = new Map<EditableSection, z.ZodType>();

/** Zod schema for a whole settings section, assembled from its catalog fields */
export function sectionSchema(section: EditableSection): z.ZodType {
  const cached = schemaCache.get(section);
  if (cached) return cached;
  const tree: Tree = {};
  for (const f of sectionFields(section)) {
    const parts = f.path.split(".");
    let node = tree;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Tree;
    node[parts[parts.length - 1]] = zodForField(f);
  }
  const s = toZod(tree);
  schemaCache.set(section, s);
  return s;
}

function zodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

export function parseSection<K extends EditableSection>(section: K, value: unknown): { ok: true; data: LeagueSettings[K] } | { ok: false; issues: Issue[] } {
  if (!SECTION_BY_KEY[section]) return { ok: false, issues: [{ path: "", message: "Unknown settings section" }] };
  const r = sectionSchema(section).safeParse(value);
  if (!r.success) return { ok: false, issues: zodIssues(r.error) };
  return { ok: true, data: r.data as LeagueSettings[K] };
}

// ───────────────────────────── cross-field checks ─────────────────────────────

export function lastRegularWeek(s: Pick<LeagueSettings, "general">) {
  return s.general.firstWeek + s.general.regularSeasonWeeks - 1;
}

export function playoffEndWeek(p: LeagueSettings["playoffs"]) {
  if (!p.teams) return null;
  const rounds = Math.ceil(Math.log2(Math.max(2, p.teams)));
  return p.startWeek + rounds * p.weeksPerRound - 1 + (p.championshipWeeks - 1);
}

/** Starters that can only be filled by `pos` (e.g. 2 RB slots -> RB needs at least 2) */
export function dedicatedSlots(slots: LeagueSettings["roster"]["slots"], pos: string): number {
  return slots.filter((s) => s.eligible.length === 1 && s.eligible[0] === pos).reduce((a, s) => a + s.count, 0);
}

/**
 * Cross-field validation of one section in the context of the full (proposed) settings.
 * Errors block saving; warnings are shown but allowed.
 */
export function crossFieldIssues(section: EditableSection, full: LeagueSettings, ctx: CheckContext): CheckResult {
  const errors: Issue[] = [];
  const warnings: string[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const teams = new Set(ctx.teamIds);
  const teamCount = ctx.teamIds.length || full.general.teamCount;

  switch (section) {
    case "general": {
      const g = full.general;
      const names = g.divisions.map((d) => d.name.trim().toLowerCase());
      if (!unique(names)) err("divisions", "Division names must be unique.");
      if (ctx.teamIds.length && g.teamCount !== ctx.teamIds.length) warnings.push(`Number of teams is ${g.teamCount} but the league has ${ctx.teamIds.length} teams.`);
      const pot = g.leagueDues * teamCount;
      const paid = g.payouts.reduce((a, p) => a + p.amount, 0);
      if (g.leagueDues > 0 && paid > pot) warnings.push(`Payouts total $${paid} but dues only collect $${pot}.`);
      if (lastRegularWeek(full) >= full.playoffs.startWeek && full.playoffs.teams > 0)
        warnings.push(`The regular season ends in Week ${lastRegularWeek(full)} but the playoffs start in Week ${full.playoffs.startWeek}.`);
      if (lastRegularWeek(full) > 18) err("regularSeasonWeeks", "The regular season would run past Week 18.");
      if (g.duesPaidTeamIds.some((id) => !teams.has(id))) err("duesPaidTeamIds", "Unknown team in the dues tracker.");
      break;
    }
    case "roster": {
      const r = full.roster;
      const starters = r.slots.reduce((a, s) => a + s.count, 0);
      if (!r.idpEnabled && r.slots.some((s) => s.eligible.some((p) => (IDP_POSITIONS as readonly string[]).includes(p))))
        err("slots", "Turn on IDP before adding DL / LB / DB to a slot.");
      if (r.minActiveRoster > r.maxActiveRoster) err("minActiveRoster", "Minimum roster is larger than the maximum.");
      if (starters > r.maxActiveRoster) err("maxActiveRoster", `The max active roster (${r.maxActiveRoster}) is smaller than the ${starters} starting slots.`);
      if (starters + r.benchSize !== r.maxActiveRoster) warnings.push(`${starters} starters + ${r.benchSize} bench = ${starters + r.benchSize}, but the max active roster is ${r.maxActiveRoster}.`);
      if (r.offseasonMaxActiveRoster !== null && r.offseasonMaxActiveRoster < r.maxActiveRoster) err("offseasonMaxActiveRoster", "The offseason limit can't be smaller than the in-season limit.");
      if (r.irRequireInjuryStatus && !r.irEligibleStatuses.length) err("irEligibleStatuses", "Choose at least one IR-eligible designation.");
      for (const [pos, lim] of Object.entries(r.positionLimits)) {
        if (lim.max !== null && lim.min > lim.max) err("positionLimits", `${pos}: minimum is larger than the maximum.`);
        const need = dedicatedSlots(r.slots, pos);
        if (lim.max !== null && lim.max < need) err("positionLimits", `${pos}: max ${lim.max} is fewer than the ${need} ${pos} starting slots.`);
        if (!r.idpEnabled && (IDP_POSITIONS as readonly string[]).includes(pos)) warnings.push(`${pos} limit has no effect while IDP is off.`);
      }
      const eligibleAnywhere = new Set(r.slots.flatMap((s) => s.eligible));
      if (!eligibleAnywhere.has("QB")) warnings.push("No slot accepts a QB.");
      break;
    }
    case "matchups": {
      const m = full.matchups;
      const seen = new Set<string>();
      for (const [a, b] of m.rivalries) {
        if (a === b) err("rivalries", "A team can't be its own rival.");
        if (!teams.has(a) || !teams.has(b)) err("rivalries", "Choose two league teams for every rivalry.");
        if (seen.has(a) || seen.has(b)) err("rivalries", "Each team can only have one rival.");
        seen.add(a);
        seen.add(b);
      }
      if (m.rivalryWeek !== null && (m.rivalryWeek < full.general.firstWeek || m.rivalryWeek > lastRegularWeek(full)))
        warnings.push(`Rivalry week ${m.rivalryWeek} is outside the regular season (Weeks ${full.general.firstWeek}-${lastRegularWeek(full)}).`);
      if (m.rivalryWeek !== null && !m.rivalries.length) warnings.push("A rivalry week is set but no rivalries are defined.");
      if (m.format === "H2H_PLUS_MEDIAN" && !full.niche.medianGameEachWeek) warnings.push("Head-to-head + median is selected; also turn on the median game under Fun & custom so standings count it.");
      if (m.scheduleType === "DIVISION_WEIGHTED" && full.general.divisions.length < 2) warnings.push("Division-weighted schedules need at least two divisions.");
      break;
    }
    case "standings": {
      const w = full.standings.powerRanking;
      const total = w.recordWeight + w.pointsWeight + w.allPlayWeight + w.recentFormWeight;
      if (full.standings.showPowerRankings && Math.abs(total - 1) > 0.011) warnings.push(`Power ranking weights add up to ${Math.round(total * 100)}% (they are scaled to 100%).`);
      if (full.standings.showPowerRankings && total <= 0) err("powerRanking.recordWeight", "At least one power ranking weight must be above zero.");
      break;
    }
    case "playoffs": {
      const p = full.playoffs;
      if (p.teams > 0) {
        if (p.teams > teamCount) err("teams", `Only ${teamCount} teams are in the league.`);
        if (p.teams < 2) err("teams", "A bracket needs at least 2 teams (or 0 for no playoffs).");
        if (p.byes >= p.teams) err("byes", "Byes must be fewer than playoff teams.");
        if ((p.teams - p.byes) % 2 !== 0) err("byes", `${p.teams} teams with ${p.byes} byes leaves an odd number of first-round teams.`);
        if (p.startWeek <= lastRegularWeek(full)) err("startWeek", `The regular season runs through Week ${lastRegularWeek(full)}.`);
        const end = playoffEndWeek(p)!;
        if (end > 18) err("startWeek", `The playoffs would end in Week ${end}, after the NFL regular season.`);
        else if (end === 18) warnings.push("The championship falls in Week 18, when NFL teams often rest starters.");
        if (p.wildcardsByPoints > p.teams) err("wildcardsByPoints", "More wildcards than playoff spots.");
        if (p.startWeek !== lastRegularWeek(full) + 1 && p.startWeek > lastRegularWeek(full)) warnings.push(`There is a gap between the regular season (ends Week ${lastRegularWeek(full)}) and the playoffs (Week ${p.startWeek}).`);
      }
      const consolation = teamCount - p.teams;
      if (p.toiletBowl && consolation < 2) warnings.push("A toilet bowl needs at least two non-playoff teams.");
      if (p.placementGames.includes("SEVENTH") && p.teams < 8) warnings.push("A 7th place game needs at least 8 playoff teams.");
      if (p.placementGames.includes("FIFTH") && p.teams < 6) warnings.push("A 5th place game needs at least 6 playoff teams.");
      break;
    }
    case "salaryCap": {
      const c = full.salaryCap;
      if (!c.enabled) break;
      if (c.floor > c.cap) err("floor", "The salary floor is above the cap.");
      if (c.maxSalary !== null && c.maxSalary < c.minSalary) err("maxSalary", "The maximum salary is below the minimum.");
      if (c.maxSalary !== null && c.maxSalary > c.cap) warnings.push("The maximum salary is above the whole cap.");
      if (c.minSalary * full.roster.maxActiveRoster > c.cap) warnings.push(`A full roster at the minimum salary ($${c.minSalary} × ${full.roster.maxActiveRoster}) is already over the cap.`);
      if (c.capType === "SOFT" && c.luxuryTaxRate === 0) warnings.push("Soft cap with a 0× luxury tax means overages cost nothing.");
      break;
    }
    case "contracts": {
      const c = full.contracts;
      if (c.minYears > c.maxYears) err("minYears", "Minimum years is above the maximum.");
      if (c.defaultFreeAgentYears < c.minYears || c.defaultFreeAgentYears > c.maxYears) err("defaultFreeAgentYears", `Free agent contracts must be ${c.minYears}-${c.maxYears} years.`);
      if (c.inSeasonPickupMaxYears > c.maxYears) err("inSeasonPickupMaxYears", "In-season pickups can't exceed the maximum contract length.");
      if (c.rookieContractYears > c.maxYears) warnings.push(`Rookie contracts (${c.rookieContractYears} yrs) are longer than the maximum contract (${c.maxYears} yrs).`);
      if (!unique(c.lengthLimits.map((l) => l.years))) err("lengthLimits", "Only one limit per contract length.");
      for (let r = 1; r <= full.draft.rookie.rounds; r++) {
        const arr = c.rookieScale[String(r)];
        if (!arr?.length) warnings.push(`No rookie scale for round ${r}: those picks sign at the league minimum.`);
        else if (arr.length < teamCount) warnings.push(`Round ${r} of the rookie scale covers ${arr.length} of ${teamCount} picks; later picks sign at the league minimum.`);
        if (arr?.some((x) => x < full.salaryCap.minSalary)) warnings.push(`Round ${r} has salaries below the $${full.salaryCap.minSalary} minimum.`);
      }
      const scaleTotal = Object.values(c.rookieScale).reduce((a, arr) => a + arr.reduce((x, y) => x + y, 0), 0);
      if (full.salaryCap.enabled && teamCount && scaleTotal / teamCount > full.salaryCap.cap * 0.25) warnings.push("The average team's rookie salaries are over 25% of the cap.");
      break;
    }
    case "keepers": {
      const k = full.keepers;
      if (k.maxKeepers !== null && k.minKeepers > k.maxKeepers) err("minKeepers", "Minimum keepers is above the maximum.");
      if (k.windowOpens && k.deadline && new Date(k.windowOpens) >= new Date(k.deadline)) err("deadline", "The keeper deadline must be after the window opens.");
      break;
    }
    case "waivers": {
      const w = full.waivers;
      if (w.type === "FAB") {
        if (w.minBid > w.faabBudget) err("minBid", "The minimum bid is above the FAB budget.");
        if (!w.allowZeroBids && w.minBid === 0) warnings.push("$0 bids are off but the minimum bid is $0; the effective minimum is $1.");
        if (w.salaryEqualsBid && full.salaryCap.enabled && w.minBid * w.salaryMultiplier < full.salaryCap.minSalary) warnings.push(`Low bids become salaries below the $${full.salaryCap.minSalary} minimum; they are raised to the minimum.`);
      }
      if (w.maxAcquisitionsPerWeek !== null && w.maxAcquisitionsPerSeason !== null && w.maxAcquisitionsPerWeek > w.maxAcquisitionsPerSeason) err("maxAcquisitionsPerWeek", "The weekly limit is above the season limit.");
      break;
    }
    case "trades": {
      const t = full.trades;
      if (t.reviewType === "LEAGUE_VOTE" && t.vetoVotesRequired > Math.max(1, teamCount - 2)) warnings.push(`${t.vetoVotesRequired} veto votes is more than the ${Math.max(1, teamCount - 2)} teams that can vote.`);
      if (t.deadlineWeek !== null && full.playoffs.teams > 0 && t.deadlineWeek >= full.playoffs.startWeek) warnings.push("The trade deadline is after the playoffs start.");
      if (t.maxTeamsPerTrade > teamCount) err("maxTeamsPerTrade", `Only ${teamCount} teams are in the league.`);
      break;
    }
    case "draft": {
      const r = full.draft.rookie;
      if (r.orderMethod === "LOTTERY") {
        if (r.lottery.odds.length !== r.lottery.teams) err("rookie.lottery.odds", `Enter odds for all ${r.lottery.teams} lottery teams (${r.lottery.odds.length} entered).`);
        const sum = r.lottery.odds.reduce((a, x) => a + x, 0);
        if (Math.abs(sum - 100) > 0.01) err("rookie.lottery.odds", `Lottery odds add up to ${Math.round(sum * 100) / 100}%, not 100%.`);
        if (r.lottery.picksDrawn !== null && r.lottery.picksDrawn > r.lottery.teams) err("rookie.lottery.picksDrawn", "More picks drawn than lottery teams.");
        if (r.lottery.teams > teamCount) err("rookie.lottery.teams", `Only ${teamCount} teams are in the league.`);
        if (full.playoffs.teams && r.lottery.teams > teamCount - full.playoffs.teams) warnings.push("The lottery includes playoff teams.");
      }
      if (r.overnightPause && r.pauseStartHour === r.pauseEndHour) err("rookie.pauseEndHour", "The pause must start and end at different hours.");
      const a = full.draft.auction;
      if (a.minBid > a.budget) err("auction.minBid", "The minimum bid is above the budget.");
      if (a.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" && a.minBid * a.rosterSpotsToFill > a.budget)
        err("auction.budget", `Filling ${a.rosterSpotsToFill} spots at $${a.minBid} costs more than the $${a.budget} budget.`);
      if (a.rosterSpotsToFill > full.roster.maxActiveRoster + full.roster.taxiSlots) warnings.push("The auction fills more spots than the roster holds.");
      break;
    }
    case "niche": {
      const n = full.niche;
      for (const t of n.rivalryTrophies) {
        if (!teams.has(t.teamA) || !teams.has(t.teamB)) err("rivalryTrophies", `Choose two league teams for "${t.name}".`);
        else if (t.teamA === t.teamB) err("rivalryTrophies", `"${t.name}" needs two different teams.`);
      }
      if (n.chaosWeek !== null && !n.chaosWeekRule.trim()) warnings.push("Describe the chaos week rule so managers know what to expect.");
      if (n.reverseScoringWeek !== null && n.reverseScoringWeek === n.chaosWeek) warnings.push("Reverse scoring and chaos week are the same week.");
      if (n.medianGameEachWeek && full.matchups.format === "ALL_PLAY") warnings.push("The median game is redundant with all-play matchups.");
      break;
    }
    default:
      break;
  }
  return { errors, warnings };
}

// ───────────────────────────── scoring ─────────────────────────────

/** Combined stats the engine can score bonuses on (see statValue in the scoring engine) */
export const COMBO_STATS: { key: string; label: string }[] = [
  { key: "rush_rec_yd", label: "Rushing + receiving yards" },
  { key: "pass_rush_yd", label: "Passing + rushing yards" },
  { key: "all_purpose_yd", label: "All-purpose yards" },
  { key: "total_td", label: "Total touchdowns" },
  { key: "scrimmage_td", label: "Rushing + receiving TDs" },
];
const STAT_KEY_RE = /^[a-z0-9_]{1,40}$/;
const isBonusStat = (k: string) => k in STAT_BY_KEY || COMBO_STATS.some((c) => c.key === k);
const pts = (label: string) => z.number({ message: `${label}: enter a number` }).min(-100, { message: `${label}: at least -100` }).max(100, { message: `${label}: at most 100` });

const tier = z.object({ max: z.number().int().min(0).max(99_999), points: pts("Tier points") });

export const scoringSchema = z.object({
  preset: z.enum(["PPR", "HALF_PPR", "STANDARD", "CUSTOM"]),
  decimals: z.number().int().min(0).max(3),
  rules: z.record(z.string().regex(STAT_KEY_RE), pts("Points per stat")),
  positionOverrides: z.record(
    z.string().refine((p) => POS.includes(p), { message: "Unknown position" }),
    z.record(z.string().regex(STAT_KEY_RE), pts("Position override")),
  ),
  bonuses: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        label: z.string().trim().min(1, { message: "Every bonus needs a label" }).max(60),
        stat: z.string().refine(isBonusStat, { message: "Choose a stat for every bonus" }),
        threshold: z.number().min(0.01, { message: "Bonus thresholds must be above 0" }).max(10_000),
        points: pts("Bonus points"),
        positions: z.array(z.string().refine((p) => POS.includes(p))).optional(),
        repeatEvery: z.number().min(0.01).max(10_000).nullable().optional(),
      }),
    )
    .max(60),
  fieldGoalsByDistance: z.array(z.object({ min: z.number().int().min(0).max(99), max: z.number().int().min(0).max(99), points: pts("FG points") })).max(12),
  useFieldGoalDistance: z.boolean(),
  pointsAllowedTiers: z.array(tier).max(20),
  yardsAllowedTiers: z.array(tier).max(20),
  longTdBonuses: z.array(z.object({ minYards: z.union([z.literal(40), z.literal(50)]), points: pts("Long TD bonus") })).max(2),
  negativePointsFloor: z.number().min(-100).max(0).nullable(),
  roundToDecimals: z.boolean(),
});

export function parseScoring(value: unknown): { ok: true; data: LeagueSettings["scoring"] } | { ok: false; issues: Issue[] } {
  const r = scoringSchema.safeParse(value);
  if (!r.success) return { ok: false, issues: zodIssues(r.error) };
  const data = r.data as LeagueSettings["scoring"];
  // drop zero-valued overrides / empty positions so "no override" is never stored as an override
  const po: Record<string, Record<string, number>> = {};
  for (const [pos, m] of Object.entries(data.positionOverrides)) {
    const kept = Object.fromEntries(Object.entries(m).filter(([k, v]) => v !== data.rules[k] || !(k in data.rules)));
    if (Object.keys(kept).length) po[pos] = kept;
  }
  return { ok: true, data: { ...data, positionOverrides: po } };
}

export function tierIssues(label: string, tiers: { max: number; points: number }[]): CheckResult {
  const errors: Issue[] = [];
  const warnings: string[] = [];
  const maxes = tiers.map((t) => t.max);
  if (!unique(maxes)) errors.push({ path: label, message: `${label}: two tiers end at the same value.` });
  return { errors, warnings };
}

export function scoringIssues(s: LeagueSettings["scoring"]): CheckResult {
  const errors: Issue[] = [];
  const warnings: string[] = [];
  const add = (r: CheckResult) => {
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  };
  add(tierIssues("Points allowed tiers", s.pointsAllowedTiers));
  add(tierIssues("Yards allowed tiers", s.yardsAllowedTiers));
  const pa = [...s.pointsAllowedTiers].sort((a, b) => a.max - b.max);
  if (pa.length && pa[pa.length - 1].max < 60) warnings.push(`Points allowed above ${pa[pa.length - 1].max} use the last tier's points.`);
  const ya = [...s.yardsAllowedTiers].sort((a, b) => a.max - b.max);
  if (ya.length && ya[ya.length - 1].max < 600) warnings.push(`Yards allowed above ${ya[ya.length - 1].max} use the last tier's points.`);

  if (s.useFieldGoalDistance) {
    const fg = [...s.fieldGoalsByDistance].sort((a, b) => a.min - b.min);
    if (!fg.length) errors.push({ path: "fieldGoalsByDistance", message: "Add at least one field goal distance range, or turn distance scoring off." });
    for (const r of fg) if (r.min > r.max) errors.push({ path: "fieldGoalsByDistance", message: `FG range ${r.min}-${r.max} is backwards.` });
    for (let i = 1; i < fg.length; i++) {
      if (fg[i].min <= fg[i - 1].max) errors.push({ path: "fieldGoalsByDistance", message: `FG ranges ${fg[i - 1].min}-${fg[i - 1].max} and ${fg[i].min}-${fg[i].max} overlap.` });
      else if (fg[i].min > fg[i - 1].max + 1) warnings.push(`Field goals of ${fg[i - 1].max + 1}-${fg[i].min - 1} yards fall back to the flat FG value.`);
    }
    if (fg.length && fg[0].min > 0) warnings.push(`Field goals under ${fg[0].min} yards fall back to the flat FG value.`);
  }
  if (!unique(s.longTdBonuses.map((l) => l.minYards))) errors.push({ path: "longTdBonuses", message: "Only one long-TD bonus per distance." });
  if (!unique(s.bonuses.map((b) => b.id))) errors.push({ path: "bonuses", message: "Duplicate bonus id." });
  for (const [pos, m] of Object.entries(s.positionOverrides)) for (const k of Object.keys(m)) if (!(k in STAT_BY_KEY)) warnings.push(`${pos} override for unknown stat "${k}".`);
  if ((s.rules.pts_allow ?? 0) !== 0 || (s.rules.yds_allow ?? 0) !== 0) warnings.push("Points / yards allowed are scored by the tier tables, not per unit.");
  return { errors, warnings };
}

/** Which preset (if any) a rules map matches */
export function detectPreset(rules: Record<string, number>, base: Record<string, number>): "PPR" | "HALF_PPR" | "STANDARD" | "CUSTOM" {
  const others = Object.keys({ ...rules, ...base }).filter((k) => k !== "rec");
  const sameOthers = others.every((k) => (rules[k] ?? 0) === (base[k] ?? 0));
  if (!sameOthers) return "CUSTOM";
  const rec = rules.rec ?? 0;
  return rec === 1 ? "PPR" : rec === 0.5 ? "HALF_PPR" : rec === 0 ? "STANDARD" : "CUSTOM";
}
