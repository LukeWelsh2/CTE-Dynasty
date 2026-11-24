// Pure contract & cap math for the My Team module: dead-money previews, extensions, franchise tags,
// rookie options and roster-window rules. No database access (unit-tested in tests/team.test.ts).
import { capCheck, capEnforcement, capLimit, capLimitLabel, capWarningNote, deadMoneyCharges, isPreseasonPhase } from "@/lib/roster-rules";
import type { LeagueSettings } from "@/lib/settings/schema";

export interface ContractSpot {
  salary: number;
  contractYears: number;
  isRookieContract: boolean;
  isFranchiseTagged: boolean;
  status?: string;
}

export interface DeadMoneyEntry {
  season: number;
  amount: number;
}

/** Dead money a drop would create (mirrors dropPlayerFromTeam in @/lib/roster-ops). */
export function deadMoneyPreview(
  spot: Pick<ContractSpot, "salary" | "contractYears" | "isRookieContract">,
  settings: LeagueSettings,
  season: number,
  week: number,
  phase?: string | null,
): DeadMoneyEntry[] {
  return deadMoneyCharges(spot, settings, season, week, { preseason: isPreseasonPhase(phase) });
}

/** League cap for a season `yearOffset` seasons from now (annualCapIncrease is a flat $ amount per season). */
export function capForSeason(settings: LeagueSettings, yearOffset: number): number {
  return settings.salaryCap.cap + Math.max(0, yearOffset) * (settings.salaryCap.annualCapIncrease ?? 0);
}

export function contractEndSeason(season: number, years: number): number {
  return season + Math.max(1, years) - 1;
}

function clampSalary(n: number, settings: LeagueSettings): number {
  let v = Math.max(settings.salaryCap.minSalary, Math.round(n));
  if (settings.salaryCap.maxSalary !== null && settings.salaryCap.maxSalary !== undefined) v = Math.min(v, settings.salaryCap.maxSalary);
  return v;
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

// ───────── Contract calendar ─────────

/**
 * Where the league is in its contract year. OFFSEASON = after the season ends but before the rollover (OFFSEASON /
 * KEEPER phases): the season just played no longer counts, so a contract with 1 year left has expired.
 */
export type ContractWindow = "IN_SEASON" | "PRESEASON" | "OFFSEASON";

export function contractWindow(phase: string): ContractWindow {
  if (phase === "OFFSEASON" || phase === "KEEPER") return "OFFSEASON";
  if (phase === "PRESEASON") return "PRESEASON";
  return "IN_SEASON";
}

/** Seasons still to be played on a contract (in the offseason the finished season no longer counts). */
export function yearsAhead(contractYears: number, phase: string): number {
  return contractWindow(phase) === "OFFSEASON" ? Math.max(0, contractYears - 1) : Math.max(0, contractYears);
}

/** Season whose cap a contract change is checked against: next season once the current one is over. */
export function capSeasonOffset(phase: string): 0 | 1 {
  return contractWindow(phase) === "OFFSEASON" ? 1 : 0;
}

/**
 * Should moves that add salary be blocked when they'd break the cap? The league-wide rule (@/lib/roster-rules
 * capEnforcement) every transaction path uses: in season salaryCap.enforceInSeason; preseason / offseason
 * salaryCap.offseasonEnforcement (block, block once the compliance date passes, or warn only).
 */
export function capEnforced(settings: LeagueSettings, phase = "REGULAR", now: Date = new Date()): boolean {
  return capEnforcement(settings, phase, now) === "BLOCK";
}

/** Highest payroll a team may carry in a season with cap `cap` (@/lib/roster-rules capLimit; null = no ceiling). */
export function capCeiling(settings: LeagueSettings, cap: number): number | null {
  return capLimit(settings, cap);
}

export interface CapSpot {
  playerId: string;
  salary: number;
  contractYears: number;
  status: string;
  isRookieContract?: boolean;
  yearsExp?: number | null;
}

export interface ContractCapCheck {
  /** season the change is measured in */
  season: number;
  cap: number;
  committedBefore: number;
  committedAfter: number;
  /** cap - committedAfter (can be negative) */
  spaceAfter: number;
  /** true when the change is blocked by the cap rules */
  blocked: boolean;
  reason: string | null;
  /** the change goes over the cap but the cap is only a warning right now (capEnforcement WARN) */
  warning: string | null;
}

function hitFor(salary: number, status: string, settings: LeagueSettings): number {
  if (status === "IR" && !settings.roster.irCountsAgainstCap) return 0;
  if (status === "TAXI") return settings.roster.taxiCountsAgainstCap ? salary : Math.round((salary * (settings.roster.taxiCapPercent ?? 0)) / 100);
  return salary;
}

/**
 * Cap effect of replacing one contract (new salary / years). In season and preseason the new salary counts right
 * away; in the offseason it is measured against next season's cap (salaries after the annual raise, contracts that
 * have expired drop off). `dead` = dead money for [this season, next season].
 */
export function contractCapCheck(input: {
  settings: LeagueSettings;
  phase: string;
  season: number;
  roster: CapSpot[];
  playerId: string;
  newSalary: number;
  newYears: number;
  dead: [number, number];
  now?: Date;
}): ContractCapCheck {
  const { settings, phase, roster, playerId } = input;
  const off = capSeasonOffset(phase);
  const season = input.season + off;
  const cap = capForSeason(settings, off);
  const yearHit = (s: CapSpot, salary: number, years: number) => {
    if (years <= off) return 0;
    const sal = off === 0 ? salary : salaryInYearPure(salary, off, settings, s);
    return hitFor(sal, s.status, settings);
  };
  let before = input.dead[off] ?? 0;
  let after = input.dead[off] ?? 0;
  for (const s of roster) {
    const cur = yearHit(s, s.salary, s.contractYears);
    before += cur;
    after += s.playerId === playerId ? yearHit(s, input.newSalary, input.newYears) : cur;
  }
  // the shared cap rule: capLimit for that season's cap, capEnforcement for the phase, only changes that add salary
  const chk = capCheck(after, settings, { phase, now: input.now, before, cap });
  const over = chk.over > 0 ? `That would put your ${season} payroll at $${after}, over the $${chk.limit} ${capLimitLabel(settings)}.` : null;
  return {
    season,
    cap,
    committedBefore: before,
    committedAfter: after,
    spaceAfter: cap - after,
    blocked: chk.blocked,
    reason: chk.blocked ? over : null,
    warning: chk.warned && over ? `${over} ${capWarningNote(settings)}` : null,
  };
}

/** salaryInYear without the db-bound roster module (mirrors @/lib/roster salaryInYear). */
function salaryInYearPure(salary: number, yearOffset: number, settings: LeagueSettings, spot: { isRookieContract?: boolean | null; yearsExp?: number | null }): number {
  const raise = settings.contracts.annualRaisePercent ?? 0;
  if (!raise || yearOffset <= 0) return salary;
  const mode = settings.contracts.raiseAppliesTo ?? "ALL";
  if (mode !== "ALL") {
    if (spot.isRookieContract) return salary;
    if (mode === "VETERANS_ONLY" && (spot.yearsExp ?? 0) < (settings.contracts.rookieContractYears ?? 3)) return salary;
  }
  const v = Math.round(salary * Math.pow(1 + raise / 100, yearOffset) * 1e6) / 1e6;
  const r = settings.contracts.raiseRounding ?? "NEAREST";
  return r === "UP" ? Math.ceil(v) : r === "DOWN" ? Math.floor(v) : Math.round(v);
}

// ───────── Extensions ─────────

export interface ExtensionContext {
  phase: string;
  /** this player was already extended this season */
  extendedThisSeason: boolean;
  /** extensions this team signed this season */
  extensionsUsed?: number;
}

/** Is the league's extension window (settings.contracts.extensionWindow) open for this contract? */
export function extensionWindowCheck(spot: Pick<ContractSpot, "contractYears">, settings: LeagueSettings, phase: string): Eligibility {
  const w = contractWindow(phase);
  const ahead = yearsAhead(spot.contractYears, phase);
  if (w === "OFFSEASON" && ahead < 1) return { ok: false, reason: "His contract has expired — keep him in the keeper window or use the franchise tag." };
  const mode = settings.contracts.extensionWindow ?? "ANY_TIME";
  if (mode === "ANY_TIME") return { ok: true };
  if (w === "IN_SEASON") return { ok: false, reason: mode === "ANY_OFFSEASON" ? "Extensions can only be signed in the offseason." : "Extensions open in the offseason before a contract's final season." };
  if (mode === "FINAL_YEAR_OFFSEASON" && ahead !== 1) return { ok: false, reason: `Only contracts entering their final season can be extended (${ahead} seasons left).` };
  return { ok: true };
}

/** Most years that may be added: extensionMaxYearsAdded, without passing the maxYears contract length. */
export function maxExtensionYears(spot: Pick<ContractSpot, "contractYears">, settings: LeagueSettings, phase = "REGULAR"): number {
  const room = settings.contracts.maxYears - yearsAhead(spot.contractYears, phase);
  return Math.max(0, Math.min(settings.contracts.extensionMaxYearsAdded ?? settings.contracts.maxYears, room));
}

/**
 * Would a contract of `years` seasons break settings.contracts.lengthLimits (e.g. at most 3 deals of 4+ years)?
 * `others` = seasons left on the team's OTHER contracts; `current` = seasons left on this one now.
 */
export function lengthLimitProblem(years: number, current: number, others: number[], settings: LeagueSettings): string | null {
  for (const l of settings.contracts.lengthLimits ?? []) {
    if (years < l.years || current >= l.years) continue;
    const n = others.filter((y) => y >= l.years).length;
    if (n + 1 > l.maxCount) return `League limit: at most ${l.maxCount} contract${l.maxCount === 1 ? "" : "s"} of ${l.years}+ years (you have ${n}).`;
  }
  return null;
}

export function extensionEligibility(spot: ContractSpot, settings: LeagueSettings, opts: ExtensionContext): Eligibility {
  const c = settings.contracts;
  if (!c.enabled) return { ok: false, reason: "Contracts are disabled in this league." };
  if (!c.extensionsAllowed) return { ok: false, reason: "Extensions are not allowed in this league." };
  if (spot.isFranchiseTagged) return { ok: false, reason: "Franchise-tagged players can't be extended." };
  if (opts.extendedThisSeason) return { ok: false, reason: "Already extended this season." };
  if (c.extensionsPerTeamPerSeason !== null && c.extensionsPerTeamPerSeason !== undefined && (opts.extensionsUsed ?? 0) >= c.extensionsPerTeamPerSeason)
    return { ok: false, reason: `You've used all ${c.extensionsPerTeamPerSeason} extension${c.extensionsPerTeamPerSeason === 1 ? "" : "s"} this season.` };
  const win = extensionWindowCheck(spot, settings, opts.phase);
  if (!win.ok) return win;
  if (maxExtensionYears(spot, settings, opts.phase) < 1) return { ok: false, reason: `Contract is already at the ${c.maxYears}-year maximum.` };
  return { ok: true };
}

/** New salary after adding `years` (compounding extensionRaisePercent per year added). */
export function extensionSalary(salary: number, years: number, settings: LeagueSettings): number {
  const pct = settings.contracts.extensionRaisePercent ?? 0;
  const raised = salary * Math.pow(1 + pct / 100, Math.max(0, years));
  return clampSalary(pct > 0 ? Math.max(raised, salary + 1) : raised, settings);
}

// ───────── Franchise tag ─────────

export interface TagContext {
  phase: string;
  tagsUsedThisSeason: number;
  /** straight seasons this player has already been tagged (see consecutiveTagCount) */
  consecutive?: number;
}

/** Number of straight seasons before `season` in which the player was franchise-tagged. */
export function consecutiveTagCount(tagSeasons: number[], season: number): number {
  const set = new Set(tagSeasons);
  let n = 0;
  while (set.has(season - 1 - n)) n++;
  return n;
}

export function franchiseTagEligibility(spot: ContractSpot, settings: LeagueSettings, opts: TagContext): Eligibility {
  const ft = settings.contracts.franchiseTag;
  if (!settings.contracts.enabled) return { ok: false, reason: "Contracts are disabled in this league." };
  if (!ft.enabled) return { ok: false, reason: "Franchise tags are disabled." };
  if (spot.isFranchiseTagged) return { ok: false, reason: "Already franchise-tagged." };
  if (contractWindow(opts.phase) !== "OFFSEASON") return { ok: false, reason: "Franchise tags are applied in the offseason, after the season ends." };
  if ((ft.eligibility ?? "EXPIRING_ONLY") === "EXPIRING_ONLY" && yearsAhead(spot.contractYears, opts.phase) > 0) return { ok: false, reason: "Only expiring contracts can be tagged." };
  if (opts.tagsUsedThisSeason >= ft.perTeam) return { ok: false, reason: `You've used all ${ft.perTeam} franchise tag${ft.perTeam === 1 ? "" : "s"} this season.` };
  const max = ft.maxConsecutive ?? 99;
  if ((opts.consecutive ?? 0) >= max) return { ok: false, reason: `He's been tagged ${opts.consecutive} straight season${opts.consecutive === 1 ? "" : "s"} (league max ${max}).` };
  return { ok: true };
}

/**
 * Franchise tag salary. `positionSalaries` = every rostered salary at the player's position in the league.
 * TOP5_AVG_AT_POSITION averages the top `topN` salaries; repeat tags cost consecutiveMultiplier per straight tag.
 */
export function franchiseTagSalary(salary: number, positionSalaries: number[], settings: LeagueSettings, consecutive = 0): number {
  const ft = settings.contracts.franchiseTag;
  let base: number;
  if (ft.costMethod === "TOP5_AVG_AT_POSITION") {
    const top = [...positionSalaries].sort((a, b) => b - a).slice(0, Math.max(1, ft.topN ?? 5));
    const avg = top.length ? top.reduce((a, b) => a + b, 0) / top.length : salary;
    base = Math.max(salary, Math.ceil(avg));
  } else {
    base = Math.max(salary, salary * (1 + (ft.raisePercent ?? 0) / 100));
  }
  const mult = consecutive > 0 ? Math.pow(Math.max(1, ft.consecutiveMultiplier ?? 1), consecutive) : 1;
  return clampSalary(Math.ceil(base * mult - 1e-9), settings);
}

/** Contract years after a tag: the finished season + franchiseTag.years (the tag replaces the remaining deal). */
export function franchiseTagContractYears(settings: LeagueSettings): number {
  return 1 + Math.max(1, settings.contracts.franchiseTag.years ?? 1);
}

// ───────── Rookie option ─────────

export interface OptionContext {
  phase: string;
  optionUsed: boolean;
  /** rookie-draft round he was picked in (null = unknown, e.g. a commissioner-assigned rookie deal) */
  draftRound?: number | null;
}

export function rookieOptionEligibility(spot: ContractSpot, settings: LeagueSettings, opts: OptionContext): Eligibility {
  const c = settings.contracts;
  if (!c.enabled) return { ok: false, reason: "Contracts are disabled in this league." };
  if (!c.rookieFourthYearOption) return { ok: false, reason: "Rookie options are disabled." };
  if (!spot.isRookieContract) return { ok: false, reason: "Only rookie contracts have an option year." };
  if (opts.optionUsed) return { ok: false, reason: "Option already exercised." };
  const rounds = c.rookieOptionRounds ?? [];
  if (!rounds.length) return { ok: false, reason: "No draft rounds are option-eligible in this league." };
  if (opts.draftRound !== null && opts.draftRound !== undefined && !rounds.includes(opts.draftRound))
    return { ok: false, reason: `Only round ${rounds.join("/")} picks have an option year (he went in round ${opts.draftRound}).` };
  if (contractWindow(opts.phase) !== "OFFSEASON" || yearsAhead(spot.contractYears, opts.phase) > 0)
    return { ok: false, reason: "The option is exercised in the offseason once his rookie deal has run out." };
  return { ok: true };
}

export function rookieOptionSalary(salary: number, settings: LeagueSettings): number {
  const pct = settings.contracts.rookieOptionRaisePercent ?? 0;
  return clampSalary(Math.max(salary, salary * (1 + pct / 100)), settings);
}

// ───────── All contract actions for one player ─────────

export interface ContractActionInput {
  settings: LeagueSettings;
  phase: string;
  season: number;
  spot: ContractSpot & CapSpot;
  /** the whole team roster (including `spot`) */
  roster: CapSpot[];
  /** team dead money for [this season, next season] */
  dead: [number, number];
  /** every rostered salary at the player's position (franchise tag cost) */
  positionSalaries: number[];
  extendedThisSeason: boolean;
  extensionsUsed: number;
  tagsUsedThisSeason: number;
  /** seasons in which this player was franchise-tagged */
  tagSeasons: number[];
  optionUsed: boolean;
  draftRound: number | null;
  now?: Date;
}

export interface Offer {
  ok: boolean;
  reason?: string;
  salary: number;
  contractYears: number;
  /** cap space left in `capSeason` after the change */
  spaceAfter: number;
  /** allowed, but over the cap while the cap is only a warning (capEnforcement WARN) */
  warning?: string | null;
}

export interface ExtensionOffer {
  years: number;
  salary: number;
  contractYears: number;
  spaceAfter: number;
  /** why this length can't be chosen (cap / contract-length limits) */
  blocked: string | null;
  /** allowed, but over the cap while the cap is only a warning (capEnforcement WARN) */
  warning?: string | null;
}

export interface ContractOffers {
  capSeason: number;
  extension: { ok: boolean; reason?: string; options: ExtensionOffer[] } | null;
  tag: Offer | null;
  option: Offer | null;
}

/** Everything a manager could do with one contract right now, with costs and cap effects (pure; used by page + actions). */
export function contractOffers(i: ContractActionInput): ContractOffers {
  const { settings: s, spot, phase } = i;
  const capFor = (salary: number, contractYears: number) =>
    contractCapCheck({ settings: s, phase, season: i.season, roster: i.roster, playerId: spot.playerId, newSalary: salary, newYears: contractYears, dead: i.dead, now: i.now });
  const out: ContractOffers = { capSeason: i.season + capSeasonOffset(phase), extension: null, tag: null, option: null };
  if (!s.contracts.enabled) return out;

  if (s.contracts.extensionsAllowed) {
    const el = extensionEligibility(spot, s, { phase, extendedThisSeason: i.extendedThisSeason, extensionsUsed: i.extensionsUsed });
    const ahead = yearsAhead(spot.contractYears, phase);
    const others = i.roster.filter((r) => r.playerId !== spot.playerId).map((r) => yearsAhead(r.contractYears, phase));
    const options: ExtensionOffer[] = Array.from({ length: maxExtensionYears(spot, s, phase) }, (_, k) => {
      const years = k + 1;
      const salary = extensionSalary(spot.salary, years, s);
      const contractYears = spot.contractYears + years;
      const cap = capFor(salary, contractYears);
      const blocked = lengthLimitProblem(ahead + years, ahead, others, s) ?? cap.reason;
      return { years, salary, contractYears, spaceAfter: cap.spaceAfter, blocked, warning: blocked ? null : cap.warning };
    });
    const anyOk = options.some((o) => !o.blocked);
    out.extension = el.ok ? { ok: anyOk, reason: anyOk ? undefined : options[0]?.blocked ?? "No extension is possible.", options } : { ok: false, reason: el.reason, options };
  }

  if (s.contracts.franchiseTag.enabled) {
    const consecutive = consecutiveTagCount(i.tagSeasons, i.season);
    const salary = franchiseTagSalary(spot.salary, i.positionSalaries, s, consecutive);
    const contractYears = franchiseTagContractYears(s);
    const cap = capFor(salary, contractYears);
    const el = franchiseTagEligibility(spot, s, { phase, tagsUsedThisSeason: i.tagsUsedThisSeason, consecutive });
    out.tag = { ok: el.ok && !cap.blocked, reason: el.ok ? cap.reason ?? undefined : el.reason, salary, contractYears, spaceAfter: cap.spaceAfter, warning: cap.warning };
  }

  if (s.contracts.rookieFourthYearOption && spot.isRookieContract) {
    const salary = rookieOptionSalary(spot.salary, s);
    const contractYears = spot.contractYears + 1;
    const cap = capFor(salary, contractYears);
    const el = rookieOptionEligibility(spot, s, { phase, optionUsed: i.optionUsed, draftRound: i.draftRound });
    out.option = { ok: el.ok && !cap.blocked, reason: el.ok ? cap.reason ?? undefined : el.reason, salary, contractYears, spaceAfter: cap.spaceAfter, warning: cap.warning };
  }
  return out;
}

// ───────── Roster windows ─────────

const OFF_PHASES = new Set(["PRESEASON", "OFFSEASON", "KEEPER"]);

export function isInSeasonPhase(phase: string): boolean {
  return !OFF_PHASES.has(phase);
}

/**
 * Taxi squad stashing is open before `taxiDeadlineWeek` (always open in the offseason; on the deadline week
 * itself until that week's first kickoff).
 */
export function taxiWindowOpen(settings: LeagueSettings, phase: string, week: number, deadlineWeekKickedOff: boolean): boolean {
  const dl = settings.roster.taxiDeadlineWeek;
  if (dl === null || dl === undefined || dl <= 0) return true;
  if (!isInSeasonPhase(phase)) return true;
  if (week < dl) return true;
  if (week === dl) return !deadlineWeekKickedOff;
  return false;
}

export function taxiPromotionOpen(settings: LeagueSettings, phase: string): boolean {
  return settings.roster.taxiPromotionAllowedInSeason || !isInSeasonPhase(phase);
}

export type ContractTag = "ROOKIE" | "TAG" | "EXPIRING";

export function contractTags(spot: Pick<ContractSpot, "contractYears" | "isRookieContract" | "isFranchiseTagged">): ContractTag[] {
  const out: ContractTag[] = [];
  if (spot.isRookieContract) out.push("ROOKIE");
  if (spot.isFranchiseTagged) out.push("TAG");
  if (spot.contractYears <= 1) out.push("EXPIRING");
  return out;
}
