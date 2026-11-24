// Pure roster / contract / cap rules shared by server code and client components (no DB access).
// Re-exported from @/lib/roster; import from here in modules that client components also load.
//
// The three league-wide answers every transaction path uses (adds, waiver claims, trades, the salary auction, IR /
// taxi moves, contract changes and commissioner tools), so they always agree:
//  • capLimit           — the payroll ceiling (hard cap, or cap + softCapMaxOverage for a soft cap)
//  • activeRosterLimit  — maxActiveRoster, or roster.offseasonMaxActiveRoster outside the season until the cutdown
//  • capEnforcement     — BLOCK / WARN / OFF for the league phase (enforceInSeason in season, offseasonEnforcement
//                         outside it)
import type { LeagueSettings } from "@/lib/settings/schema";

export interface DeadMoneyCharge {
  season: number;
  amount: number;
}

/**
 * Dead money a release creates (settings.salaryCap.deadMoney): currentSeasonPercent of the salary this season
 * (preseasonCutPercent instead for cuts before Week 1, when set) plus futureSeasonPercent for each later contract
 * year. Exempt: rookie deals (rookieContractsExempt), in-season cuts before waivedInSeasonBeforeWeek and
 * minimum-salary players. The single formula every drop preview and dropPlayerFromTeam use.
 */
export function deadMoneyCharges(
  spot: { salary: number; contractYears: number; isRookieContract?: boolean | null },
  settings: Pick<LeagueSettings, "salaryCap">,
  season: number,
  week: number,
  opts: { preseason?: boolean } = {},
): DeadMoneyCharge[] {
  const s = settings.salaryCap;
  const dm = s.deadMoney;
  if (!s.enabled || !dm.enabled) return [];
  if (spot.isRookieContract && dm.rookieContractsExempt) return [];
  if (!opts.preseason && dm.waivedInSeasonBeforeWeek && week < dm.waivedInSeasonBeforeWeek) return [];
  if (spot.salary <= s.minSalary) return [];
  const out: DeadMoneyCharge[] = [];
  const curPct = opts.preseason && dm.preseasonCutPercent !== null && dm.preseasonCutPercent !== undefined ? dm.preseasonCutPercent : dm.currentSeasonPercent;
  const cur = Math.round((spot.salary * curPct) / 100);
  if (cur > 0) out.push({ season, amount: cur });
  for (let y = 1; y < spot.contractYears; y++) {
    const fut = Math.round((spot.salary * dm.futureSeasonPercent) / 100);
    if (fut > 0) out.push({ season: season + y, amount: fut });
  }
  return out;
}

// ───────────────────────────── Phases ─────────────────────────────

/** Cuts made in this league phase count as "before Week 1" for deadMoney.preseasonCutPercent. */
export function isPreseasonPhase(phase: string | null | undefined): boolean {
  return phase === "PRESEASON";
}

/**
 * Offseason for roster-size and cap rules: every league phase except REGULAR and PLAYOFFS (PRESEASON, OFFSEASON,
 * KEEPER). No phase (a caller that doesn't know it) counts as in season.
 */
export function isOffseasonPhase(phase: string | null | undefined): boolean {
  return !!phase && phase !== "REGULAR" && phase !== "PLAYOFFS";
}

// ───────────────────────────── League deadlines ─────────────────────────────

const DEFAULT_TZ = "America/New_York";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A wall-clock datetime without a UTC offset or "Z" ("2027-03-01T12:00", "2027-03-01 12:00:00.000"). */
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** One formatter per time zone (constructing Intl.DateTimeFormat is the slow part); null = unknown zone. */
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!zoneFormatters.has(timeZone)) {
    let f: Intl.DateTimeFormat | null = null;
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      f = null;
    }
    zoneFormatters.set(timeZone, f);
  }
  return zoneFormatters.get(timeZone) ?? null;
}

/** Offset (ms) of `timeZone` from UTC at instant `ts` (UTC when the zone is unknown). */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const f = zoneFormatter(timeZone);
  if (!f) return 0;
  const parts = f.formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - (ts - (((ts % 1000) + 1000) % 1000));
}

/** The instant the wall clock in `timeZone` reads y-m-d h:mi:s.ms (handles DST: two passes). */
function zonedInstant(y: number, m: number, d: number, timeZone: string, h = 0, mi = 0, sec = 0, ms = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, mi, sec, ms);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

/** y-m-d is a real calendar date (rejects 2026-02-30, month 13, …). */
function realDate(y: number, m: number, d: number): boolean {
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

/**
 * The moment a league deadline setting (roster.rosterCutdownDate, salaryCap.complianceDate) passes. The settings
 * editor stores full ISO datetimes with a UTC offset, used as-is; a datetime without an offset is wall-clock time in
 * the league timezone (settings.general.timezone); a date-only value ("YYYY-MM-DD", older / imported settings) means
 * the end of that day in the league timezone, i.e. the next midnight there. null when unset or unreadable.
 */
export function deadlineInstant(value: string | null | undefined, timeZone: string = DEFAULT_TZ): Date | null {
  if (!value) return null;
  const v = value.trim();
  const m = DATE_ONLY.exec(v);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (!realDate(y, mo, d)) return null;
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    return new Date(zonedInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone));
  }
  const l = LOCAL_DATETIME.exec(v);
  if (l) {
    const [y, mo, d, h, mi, sec] = [+l[1], +l[2], +l[3], +l[4], +l[5], +(l[6] ?? 0)];
    if (!realDate(y, mo, d) || h > 23 || mi > 59 || sec > 59) return null;
    return new Date(zonedInstant(y, mo, d, timeZone, h, mi, sec, l[7] ? +l[7].padEnd(3, "0") : 0));
  }
  const at = new Date(v);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** A deadline setting for messages: "Mar 1, 2027" (date-only) or "Mar 1, 2027, 12:00 PM EST" in the league timezone. */
export function deadlineLabel(value: string | null | undefined, timeZone: string = DEFAULT_TZ): string | null {
  if (!value) return null;
  const m = DATE_ONLY.exec(value.trim());
  try {
    if (m) {
      if (!deadlineInstant(value, timeZone)) return null;
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
    }
    const at = deadlineInstant(value, timeZone);
    if (!at) return null;
    // an unknown zone reads (and is shown) in UTC rather than hiding a deadline that is set
    const zone = zoneFormatter(timeZone) ? timeZone : "UTC";
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
  } catch {
    return null;
  }
}

const tzOf = (settings: { general?: { timezone?: string } }) => settings.general?.timezone || DEFAULT_TZ;

// ───────────────────────────── Active-roster limit ─────────────────────────────

export interface PhaseOptions {
  /** league phase (League.phase); outside REGULAR / PLAYOFFS the offseason rules apply */
  phase?: string | null;
  /** legacy: treat the move as an offseason move when no phase is given */
  offseason?: boolean;
  now?: Date;
}

function offseasonFrom(opts: PhaseOptions): boolean {
  return opts.phase !== undefined && opts.phase !== null ? isOffseasonPhase(opts.phase) : !!opts.offseason;
}

/**
 * Active-roster limit every transaction path uses: roster.offseasonMaxActiveRoster outside the regular season and
 * playoffs (when larger than maxActiveRoster) until roster.rosterCutdownDate passes (see deadlineInstant), else
 * roster.maxActiveRoster.
 */
export function activeRosterLimit(settings: Pick<LeagueSettings, "roster"> & { general?: { timezone?: string } }, opts: PhaseOptions = {}): number {
  const r = settings.roster;
  const extra = r.offseasonMaxActiveRoster;
  if (!offseasonFrom(opts) || extra === null || extra === undefined || extra <= r.maxActiveRoster) return r.maxActiveRoster;
  const cutdown = deadlineInstant(r.rosterCutdownDate, tzOf(settings));
  if (cutdown && (opts.now ?? new Date()).getTime() >= cutdown.getTime()) return r.maxActiveRoster;
  return extra;
}

// ───────────────────────────── Salary cap ─────────────────────────────

/**
 * Payroll ceiling used for every cap check: the hard cap, or cap + softCapMaxOverage for soft caps (null = no
 * ceiling: a soft cap without a max overage only owes luxury tax). `cap` = that season's cap (default this season's).
 */
export function capLimit(settings: Pick<LeagueSettings, "salaryCap">, cap: number = settings.salaryCap.cap): number | null {
  const c = settings.salaryCap;
  if (c.capType === "SOFT") return c.softCapMaxOverage === null || c.softCapMaxOverage === undefined ? null : cap + c.softCapMaxOverage;
  return cap;
}

/** What the ceiling is called in messages: "soft-cap limit" or "cap". */
export function capLimitLabel(settings: Pick<LeagueSettings, "salaryCap">): string {
  return settings.salaryCap.capType === "SOFT" ? "soft-cap limit" : "cap";
}

/**
 * BLOCK: moves that would take a team over capLimit (and add salary) are refused. WARN: they go through with a
 * warning. OFF: the cap isn't checked.
 */
export type CapEnforcement = "BLOCK" | "WARN" | "OFF";

/**
 * How the cap applies to a move right now — the same answer for adds, waiver claims, trades, auction bids, roster
 * moves and contract changes. salaryCap.enabled off: OFF. Regular season / playoffs: enforceInSeason ? BLOCK : OFF.
 * Outside them, salaryCap.offseasonEnforcement: BLOCK_OVER_CAP_MOVES → BLOCK, WARN_ONLY → WARN,
 * ALLOW_UNTIL_COMPLIANCE_DATE → WARN until complianceDate passes, then BLOCK (no date: never blocks).
 */
export function capEnforcement(settings: Pick<LeagueSettings, "salaryCap"> & { general?: { timezone?: string } }, phase?: string | null, now: Date = new Date()): CapEnforcement {
  const c = settings.salaryCap;
  if (!c.enabled) return "OFF";
  if (!isOffseasonPhase(phase)) return c.enforceInSeason ? "BLOCK" : "OFF";
  switch (c.offseasonEnforcement ?? "BLOCK_OVER_CAP_MOVES") {
    case "WARN_ONLY":
      return "WARN";
    case "ALLOW_UNTIL_COMPLIANCE_DATE": {
      const due = deadlineInstant(c.complianceDate, tzOf(settings));
      return due && now.getTime() >= due.getTime() ? "BLOCK" : "WARN";
    }
    default:
      return "BLOCK";
  }
}

/** Why an over-cap move is only a warning right now (appended to WARN-mode messages). */
export function capWarningNote(settings: Pick<LeagueSettings, "salaryCap"> & { general?: { timezone?: string } }): string {
  const c = settings.salaryCap;
  if (c.offseasonEnforcement === "ALLOW_UNTIL_COMPLIANCE_DATE") {
    const due = deadlineLabel(c.complianceDate, tzOf(settings));
    return due ? `Allowed until the cap compliance deadline (${due}).` : "Allowed in the offseason (no cap compliance deadline is set).";
  }
  return "The cap is only a warning in the offseason.";
}

export interface CapCheck {
  mode: CapEnforcement;
  /** ceiling the payroll is measured against (capLimit for the season's cap; null = none) */
  limit: number | null;
  /** the ceiling is enforced (BLOCK mode with a ceiling): over-limit moves that add salary are refused */
  enforced: boolean;
  /** dollars over the ceiling that count against this move (0 = within it, the move doesn't add salary, or OFF) */
  over: number;
  /**
   * dollars the move must shed to stop counting as over: after − max(limit, before) — back under the ceiling, or no
   * more salary than before for a team that was already over it (0 when not over)
   */
  excess: number;
  /** refused: enforced and over */
  blocked: boolean;
  /** WARN mode and over */
  warned: boolean;
}

/**
 * Cap verdict for a payroll after a move (incl. dead money). `before` = payroll before it: a move that doesn't add
 * salary is never over (a team already above the ceiling may still shed salary). `cap` = the season's cap.
 */
export function capCheck(
  after: number,
  settings: Pick<LeagueSettings, "salaryCap"> & { general?: { timezone?: string } },
  opts: { phase?: string | null; now?: Date; before?: number; cap?: number } = {},
): CapCheck {
  const mode = capEnforcement(settings, opts.phase, opts.now);
  const limit = capLimit(settings, opts.cap);
  const enforced = mode === "BLOCK" && limit !== null;
  const grows = opts.before === undefined || after > opts.before;
  const over = mode !== "OFF" && limit !== null && after > limit && grows ? after - limit : 0;
  const excess = over > 0 && limit !== null ? after - Math.max(limit, opts.before ?? limit) : 0;
  return { mode, limit, enforced, over, excess, blocked: enforced && over > 0, warned: mode === "WARN" && over > 0 };
}

/**
 * Room under the ceiling that limits spending right now (auction max bids, the add dialog): limit − committed when
 * the ceiling is enforced, else null (nothing limits it).
 */
export function bindingCapRoom(
  committed: number,
  settings: Pick<LeagueSettings, "salaryCap"> & { general?: { timezone?: string } },
  opts: { phase?: string | null; now?: Date; cap?: number } = {},
): number | null {
  const c = capCheck(committed, settings, opts);
  return c.enforced && c.limit !== null ? c.limit - committed : null;
}
