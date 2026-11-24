// Pure helpers for the League Home dashboard: lineup checks, standings snapshot selection, key league
// dates, upcoming opponents, transaction feed grouping, recap teasers and date formatting.
// No database or server imports — safe for unit tests and client components.
import type { LeagueSettings } from "@/lib/settings/schema";
import { capLimit, capLimitLabel } from "@/lib/roster-rules";
import { deadlineShownAt } from "@/lib/commissioner/deadlines";

// ───────────────────────────── Phases & weeks ─────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  PRESEASON: "Preseason",
  REGULAR: "Regular season",
  PLAYOFFS: "Playoffs",
  OFFSEASON: "Offseason",
  KEEPER: "Keeper window",
};

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase.charAt(0) + phase.slice(1).toLowerCase();
}

export function isInSeason(phase: string): boolean {
  return phase === "REGULAR" || phase === "PLAYOFFS";
}

/** Number of playoff rounds (bracket depth) for the configured playoff field. */
export function playoffRounds(settings: Pick<LeagueSettings, "playoffs">): number {
  return Math.ceil(Math.log2(Math.max(2, settings.playoffs.teams)));
}

/** "Quarterfinals" / "Semifinals" / "Championship" / "Round 1" for a playoff week, null before the playoffs. */
export function playoffRoundLabel(week: number, settings: Pick<LeagueSettings, "playoffs">): string | null {
  const { startWeek, weeksPerRound } = settings.playoffs;
  if (week < startWeek) return null;
  const rounds = playoffRounds(settings);
  const round = Math.floor((week - startWeek) / Math.max(1, weeksPerRound)) + 1;
  if (round >= rounds) return "Championship";
  if (round === rounds - 1) return "Semifinals";
  if (round === rounds - 2 && rounds >= 3) return "Quarterfinals";
  return `Round ${round}`;
}

/**
 * Week whose lineup a manager should be setting: the current week, unless every NFL game of it is final
 * and another fantasy week follows (Tuesday after Monday night → next week).
 */
export function pickLineupWeek(currentWeek: number, gameStates: string[], maxWeek: number): number {
  if (gameStates.length > 0 && gameStates.every((s) => s === "post") && currentWeek < maxWeek) return currentWeek + 1;
  return currentWeek;
}

export type WeekState = "none" | "pre" | "between" | "live" | "final";

export interface WeekStatus {
  state: WeekState;
  total: number;
  live: number;
  final: number;
  /** next kickoff still to come (ISO) */
  nextKickoff: string | null;
}

/** Where the NFL week stands: not started, live, between game windows, or final. */
export function weekStatus(games: { state: string; startTime: Date | string }[], now: Date = new Date()): WeekStatus {
  const total = games.length;
  const live = games.filter((g) => g.state === "in").length;
  const final = games.filter((g) => g.state === "post").length;
  const upcoming = games
    .filter((g) => g.state === "pre")
    .map((g) => new Date(g.startTime))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const next = upcoming.find((d) => d.getTime() >= now.getTime()) ?? upcoming[0] ?? null;
  let state: WeekState;
  if (!total) state = "none";
  else if (final === total) state = "final";
  else if (live > 0) state = "live";
  else if (final > 0) state = "between";
  else state = "pre";
  return { state, total, live, final, nextKickoff: next ? next.toISOString() : null };
}

// ───────────────────────────── Injuries & lineup checks ─────────────────────────────

export type InjuryLevel = "OUT" | "DOUBTFUL" | "QUESTIONABLE";

const OUT_STATUSES = new Set(["o", "out", "ir", "injured reserve", "pup", "physically unable to perform", "sus", "susp", "suspended", "na", "not active", "inactive", "cov", "covid-19", "dnr", "nfi"]);

/** Normalize an injury designation into OUT / DOUBTFUL / QUESTIONABLE (null = healthy or unknown). */
export function injuryLevel(status: string | null | undefined): InjuryLevel | null {
  if (!status) return null;
  const s = status.trim().toLowerCase();
  if (!s) return null;
  if (s === "q" || s.startsWith("questionable")) return "QUESTIONABLE";
  if (s === "d" || s.startsWith("doubtful")) return "DOUBTFUL";
  if (OUT_STATUSES.has(s) || s.startsWith("injured reserve") || s.startsWith("ir-") || s.startsWith("pup") || s.startsWith("suspend") || s.startsWith("out")) return "OUT";
  return null;
}

/** Sort weight for injury lists (most severe first). */
export function injuryRank(status: string | null | undefined): number {
  const l = injuryLevel(status);
  return l === "OUT" ? 0 : l === "DOUBTFUL" ? 1 : l === "QUESTIONABLE" ? 2 : 3;
}

export type LineupIssueKind = "EMPTY" | "NO_TEAM" | "BYE" | "OUT" | "DOUBTFUL" | "QUESTIONABLE";

export interface LineupPlayerLite {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
}

export interface LineupSlotInput {
  slotLabel: string;
  player: LineupPlayerLite | null;
  /** the player's NFL team has no game this week */
  onBye: boolean;
  /** the slot can no longer be changed this week (game started / lineup lock passed) */
  locked: boolean;
}

export interface LineupIssue {
  kind: LineupIssueKind;
  slotLabel: string;
  player: LineupPlayerLite | null;
}

export interface LineupCheck {
  issues: LineupIssue[];
  /** empty, free-agent, bye, out and doubtful starters — things to fix now */
  actionable: number;
  /** questionable starters — keep an eye on them */
  watch: number;
  counts: Record<LineupIssueKind, number>;
}

const ISSUE_ORDER: LineupIssueKind[] = ["EMPTY", "NO_TEAM", "BYE", "OUT", "DOUBTFUL", "QUESTIONABLE"];

/** Problems in a lineup that a manager can still fix (locked slots are ignored). */
export function checkLineup(slots: LineupSlotInput[]): LineupCheck {
  const issues: LineupIssue[] = [];
  for (const s of slots) {
    if (s.locked) continue;
    if (!s.player) {
      issues.push({ kind: "EMPTY", slotLabel: s.slotLabel, player: null });
      continue;
    }
    let kind: LineupIssueKind | null = null;
    if (!s.player.team) kind = "NO_TEAM";
    else if (s.onBye) kind = "BYE";
    else {
      const lvl = injuryLevel(s.player.injuryStatus);
      if (lvl) kind = lvl;
    }
    if (kind) issues.push({ kind, slotLabel: s.slotLabel, player: s.player });
  }
  issues.sort((a, b) => ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind));
  const counts = { EMPTY: 0, NO_TEAM: 0, BYE: 0, OUT: 0, DOUBTFUL: 0, QUESTIONABLE: 0 } as Record<LineupIssueKind, number>;
  for (const i of issues) counts[i.kind]++;
  return { issues, actionable: issues.length - counts.QUESTIONABLE, watch: counts.QUESTIONABLE, counts };
}

/** "2 empty slots · 1 on bye · 1 out" */
export function lineupSummary(counts: Record<LineupIssueKind, number>): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many = one) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(counts.EMPTY, "empty slot", "empty slots");
  add(counts.NO_TEAM, "free agent", "free agents");
  add(counts.BYE, "on bye");
  add(counts.OUT, "out");
  add(counts.DOUBTFUL, "doubtful");
  return parts.join(" · ");
}

// ───────────────────────────── Standings snapshot ─────────────────────────────

/** Top `limit` rows (by rank) plus the manager's own row when it falls below the cut. */
export function pickStandingsRows<T extends { teamId: string; rank: number }>(rows: T[], myTeamId: string | null | undefined, limit: number): { rows: T[]; myRowDetached: boolean } {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const top = sorted.slice(0, Math.max(0, limit));
  if (myTeamId && !top.some((r) => r.teamId === myTeamId)) {
    const mine = sorted.find((r) => r.teamId === myTeamId);
    if (mine) return { rows: [...top, mine], myRowDetached: true };
  }
  return { rows: top, myRowDetached: false };
}

/**
 * Rank after which the playoff cut line is drawn: N when the current playoff seeds are exactly the top N
 * teams in the standings. Null when seeding skips teams (division winners / points wildcards) — then
 * seeds are marked per row instead.
 */
export function playoffCutRank(rows: { teamId: string; rank: number }[], seededTeamIds: string[]): number | null {
  const n = seededTeamIds.length;
  if (!n || n >= rows.length) return null;
  const seeded = new Set(seededTeamIds);
  const topN = [...rows].sort((a, b) => a.rank - b.rank).slice(0, n);
  return topN.every((r) => seeded.has(r.teamId)) ? n : null;
}

/** Competition ranking ("1, 2, 2, 4") of teams by a value, highest first. */
export function rankBy<T>(items: T[], key: (t: T) => string, value: (t: T) => number): Map<string, number> {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  const out = new Map<string, number>();
  sorted.forEach((t, i) => {
    const prev = sorted[i - 1];
    out.set(key(t), prev && value(prev) === value(t) ? out.get(key(prev))! : i + 1);
  });
  return out;
}

// ───────────────────────────── Upcoming opponents ─────────────────────────────

export interface ScheduleMatchupInput {
  id: string;
  week: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  label: string | null;
  isPlayoff: boolean;
}

export interface TeamStatInput {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  rank: number;
}

export interface UpcomingOpponent {
  matchupId: string;
  week: number;
  /** null = bye week */
  opponentId: string | null;
  label: string | null;
  isPlayoff: boolean;
  record: string | null;
  rank: number | null;
  pfRank: number | null;
}

export function recordString(w: number, l: number, t = 0): string {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/** The manager's next `take` matchups after `afterWeek`, with each opponent's record, rank and points-for rank. */
export function nextOpponents(matchups: ScheduleMatchupInput[], myTeamId: string, afterWeek: number, stats: TeamStatInput[], take = 3): UpcomingOpponent[] {
  const pfRank = rankBy(stats, (s) => s.teamId, (s) => s.pointsFor);
  const byId = new Map(stats.map((s) => [s.teamId, s]));
  return matchups
    .filter((m) => m.week > afterWeek && (m.homeTeamId === myTeamId || m.awayTeamId === myTeamId))
    .sort((a, b) => a.week - b.week || (a.id < b.id ? -1 : 1))
    .slice(0, take)
    .map((m) => {
      const opponentId = m.homeTeamId === myTeamId ? m.awayTeamId : m.homeTeamId;
      const s = opponentId ? byId.get(opponentId) : undefined;
      return {
        matchupId: m.id,
        week: m.week,
        opponentId,
        label: m.label,
        isPlayoff: m.isPlayoff,
        record: s ? recordString(s.wins, s.losses, s.ties) : null,
        rank: s?.rank ?? null,
        pfRank: opponentId ? pfRank.get(opponentId) ?? null : null,
      };
    });
}

// ───────────────────────────── Key league dates ─────────────────────────────

export interface KeyDate {
  key: string;
  label: string;
  detail: string | null;
  /** ISO timestamp (null when only the week is known) */
  at: string | null;
  week: number | null;
  status: "live" | "upcoming" | "past";
  href: string | null;
}

export interface KeyDateDraft {
  type: string;
  status: string;
  startTime: Date | null;
  name: string;
}

export interface KeyDateInput {
  now: Date;
  phase: string;
  week: number;
  settings: LeagueSettings;
  /** first / last kickoff of each NFL week of the league season */
  weekWindows: Map<number, { first: Date; last: Date }>;
  nextWaiver: Date | null;
  drafts: KeyDateDraft[];
  /** last fantasy week (end of playoffs) */
  lastWeek: number;
}

function validDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Deadlines and milestones derived from league settings, soonest first (live items lead, past items trail). */
export function buildKeyDates(input: KeyDateInput): KeyDate[] {
  const { now, phase, week, settings: s, weekWindows, lastWeek } = input;
  const out: KeyDate[] = [];
  const preOrRegular = phase === "PRESEASON" || phase === "REGULAR";
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const future = (d: Date | null) => !!d && d.getTime() > now.getTime();

  // Waivers
  const waiversRun =
    s.waivers.type !== "FREE_FOR_ALL" &&
    !s.waivers.disableAdds &&
    !!input.nextWaiver &&
    (isInSeason(phase) || s.waivers.offseasonWaivers) &&
    !(phase === "PLAYOFFS" && s.waivers.playoffMode === "FROZEN");
  if (waiversRun) {
    out.push({
      key: "waivers",
      label: s.waivers.type === "FAB" ? "FAB waivers process" : "Waivers process",
      detail: s.waivers.continuousFreeAgency ? "Unclaimed players become free agents" : null,
      at: iso(input.nextWaiver),
      week: null,
      status: "upcoming",
      href: "/waivers",
    });
  }

  // Trade deadline (end of the deadline week)
  if (s.trades.enabled && s.trades.deadlineWeek != null && preOrRegular) {
    const dl = s.trades.deadlineWeek;
    const passed = phase === "REGULAR" && week > dl;
    out.push({
      key: "trade-deadline",
      label: passed ? "Trade deadline passed" : "Trade deadline",
      detail: `End of Week ${dl}`,
      at: iso(weekWindows.get(dl)?.last),
      week: dl,
      status: passed ? "past" : "upcoming",
      href: passed ? "/trades/history" : "/trades",
    });
  }

  // Taxi squad deadline
  if (s.roster.taxiSlots > 0 && s.roster.taxiDeadlineWeek != null && preOrRegular && week <= s.roster.taxiDeadlineWeek) {
    out.push({
      key: "taxi-deadline",
      label: "Taxi squad deadline",
      detail: `Week ${s.roster.taxiDeadlineWeek} kickoff`,
      at: iso(weekWindows.get(s.roster.taxiDeadlineWeek)?.first),
      week: s.roster.taxiDeadlineWeek,
      status: "upcoming",
      href: "/team",
    });
  }

  // Playoffs
  const start = s.playoffs.startWeek;
  if (preOrRegular && (phase === "PRESEASON" || week < start)) {
    const byes = s.playoffs.byes > 0 ? ` · top ${s.playoffs.byes} get byes` : "";
    out.push({
      key: "playoffs",
      label: "Playoffs begin",
      detail: `Week ${start} · ${s.playoffs.teams} teams${byes}`,
      at: iso(weekWindows.get(start)?.first),
      week: start,
      status: "upcoming",
      href: "/playoffs",
    });
  }

  // Championship
  const champStart = Math.max(start, lastWeek - Math.max(1, s.playoffs.championshipWeeks) + 1);
  const trophy = s.general.championTrophyName?.trim();
  if ((preOrRegular || phase === "PLAYOFFS") && week <= lastWeek) {
    const live = phase === "PLAYOFFS" && week >= champStart;
    out.push({
      key: "championship",
      label: trophy ? `${trophy} game` : "Championship",
      detail: champStart === lastWeek ? `Week ${lastWeek}` : `Weeks ${champStart}–${lastWeek}`,
      at: iso(weekWindows.get(champStart)?.first),
      week: champStart,
      status: live ? "live" : "upcoming",
      href: "/playoffs",
    });
  }

  // Drafts: a scheduled / running Draft row wins over the settings date
  const draftEntry = (type: "ROOKIE" | "AUCTION", key: string, label: string, href: string, settingsAt: string | null) => {
    const active = input.drafts.find((d) => d.type === type && (d.status === "LIVE" || d.status === "PAUSED"));
    if (active) {
      out.push({ key, label: `${label} ${active.status === "PAUSED" ? "paused" : "live now"}`, detail: active.name, at: iso(active.startTime), week: null, status: "live", href });
      return;
    }
    const scheduled = input.drafts
      .filter((d) => d.type === type && d.status === "SCHEDULED")
      .sort((a, b) => (a.startTime?.getTime() ?? Infinity) - (b.startTime?.getTime() ?? Infinity))[0];
    if (scheduled) {
      if (scheduled.startTime && !future(scheduled.startTime)) {
        out.push({ key, label: `${label} starting`, detail: scheduled.name, at: iso(scheduled.startTime), week: null, status: "live", href });
      } else {
        out.push({ key, label, detail: scheduled.name, at: iso(scheduled.startTime), week: null, status: "upcoming", href });
      }
      return;
    }
    const when = validDate(settingsAt);
    if (when && future(when)) out.push({ key, label, detail: null, at: iso(when), week: null, status: "upcoming", href });
  };
  draftEntry("ROOKIE", "rookie-draft", "Rookie draft", "/draft/rookie", s.draft.rookie.scheduledFor);
  draftEntry("AUCTION", "auction", "Salary auction", "/draft/auction", s.draft.auction.scheduledFor);

  // Keepers
  if (s.keepers.enabled) {
    const opens = validDate(s.keepers.windowOpens);
    const deadline = validDate(s.keepers.deadline);
    if (opens && future(opens)) out.push({ key: "keeper-window", label: "Keeper window opens", detail: null, at: iso(opens), week: null, status: "upcoming", href: "/team/keepers" });
    if (deadline && future(deadline)) {
      const max = s.keepers.maxKeepers != null ? `Up to ${s.keepers.maxKeepers} keepers` : null;
      out.push({ key: "keeper-deadline", label: "Keeper deadline", detail: max, at: iso(deadline), week: null, status: "upcoming", href: "/team/keepers" });
    }
  }

  // Roster cutdown / cap compliance / dues — read like the rules read them (deadlineShownAt over roster-rules
  // deadlineInstant: a date-only value passes at midnight in the league time zone and is shown as that day)
  const tz = s.general.timezone;
  const cutdown = deadlineShownAt(s.roster.rosterCutdownDate, tz);
  const extra = s.roster.offseasonMaxActiveRoster;
  // the cutdown only ends the offseason roster limit (activeRosterLimit), so it matters only when that limit is larger
  if (cutdown && future(cutdown.due) && extra !== null && extra !== undefined && extra > s.roster.maxActiveRoster) {
    out.push({ key: "cutdown", label: "Roster cutdown", detail: `Active roster max ${extra} → ${s.roster.maxActiveRoster}`, at: iso(cutdown.shown), week: null, status: "upcoming", href: "/team" });
  }
  const compliance = deadlineShownAt(s.salaryCap.complianceDate, tz);
  if (s.salaryCap.enabled && compliance && future(compliance.due)) {
    // the ceiling teams must be under (capLimit: the cap, or cap + softCapMaxOverage for a soft cap)
    const limit = capLimit(s);
    const detail = limit === null ? `$${s.salaryCap.cap.toLocaleString()} soft cap` : `$${limit.toLocaleString()} ${capLimitLabel(s)}`;
    out.push({ key: "cap-compliance", label: "Cap compliance deadline", detail, at: iso(compliance.shown), week: null, status: "upcoming", href: "/team/contracts" });
  }
  const dues = validDate(s.general.duesDueDate);
  if (s.general.leagueDues > 0 && dues && future(dues)) {
    out.push({ key: "dues", label: "League dues due", detail: `$${s.general.leagueDues.toLocaleString()} per team`, at: iso(dues), week: null, status: "upcoming", href: "/rules" });
  }

  const statusOrder = { live: 0, upcoming: 1, past: 2 } as const;
  const timeOf = (k: KeyDate) => (k.at ? new Date(k.at).getTime() : Number.MAX_SAFE_INTEGER - 1000 + (k.week ?? 0));
  return out.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || timeOf(a) - timeOf(b));
}

// ───────────────────────────── Transactions feed ─────────────────────────────

export interface FeedTxInput {
  id: string;
  type: string;
  teamId: string | null;
  tradeId: string | null;
  playerId: string | null;
  createdAt: Date;
  details: unknown;
}

export interface FeedGroup {
  key: string;
  kind: "trade" | "move";
  tradeId: string | null;
  /** primary row first */
  rowIds: string[];
  createdAt: Date;
}

function declaredDrop(details: unknown): string | null {
  if (details && typeof details === "object" && "dropPlayerId" in details) {
    const v = (details as { dropPlayerId?: unknown }).dropPlayerId;
    return typeof v === "string" ? v : null;
  }
  return null;
}

function pairs(add: FeedTxInput, drop: FeedTxInput): boolean {
  if (add.teamId !== drop.teamId) return false;
  const gap = Math.abs(add.createdAt.getTime() - drop.createdAt.getTime());
  const declared = declaredDrop(add.details);
  return declared ? declared === drop.playerId && gap <= 120_000 : gap <= 1_500;
}

/**
 * Collapse raw Transaction rows into feed entries, newest first: every leg of a trade becomes one entry,
 * and an add / waiver claim absorbs the drop made for it.
 */
export function groupFeed(rows: FeedTxInput[], limit = Infinity): FeedGroup[] {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const trades = new Map<string, FeedGroup>();
  const out: FeedGroup[] = [];
  for (const r of sorted) {
    if (used.has(r.id)) continue;
    used.add(r.id);
    if (r.type === "TRADE" && r.tradeId) {
      const g = trades.get(r.tradeId);
      if (g) {
        g.rowIds.push(r.id);
        continue;
      }
      const ng: FeedGroup = { key: `trade:${r.tradeId}`, kind: "trade", tradeId: r.tradeId, rowIds: [r.id], createdAt: r.createdAt };
      trades.set(r.tradeId, ng);
      out.push(ng);
      continue;
    }
    const g: FeedGroup = { key: r.id, kind: "move", tradeId: null, rowIds: [r.id], createdAt: r.createdAt };
    if (r.type === "ADD" || r.type === "WAIVER") {
      const drop = sorted.find((d) => d.type === "DROP" && !used.has(d.id) && pairs(r, d));
      if (drop) {
        g.rowIds.push(drop.id);
        used.add(drop.id);
      }
    } else if (r.type === "DROP") {
      const add = sorted.find((a) => (a.type === "ADD" || a.type === "WAIVER") && !used.has(a.id) && pairs(a, r));
      if (add) {
        g.key = add.id;
        g.rowIds = [add.id, r.id];
        used.add(add.id);
      }
    }
    out.push(g);
  }
  return out.slice(0, limit);
}

export interface TradeAssetInput {
  fromTeamId: string;
  toTeamId: string;
  type: string;
  label: string | null;
  playerName: string | null;
  faabAmount: number | null;
}

/** What each team received in a trade, in the given team order. */
export function tradeReceipts(teamOrder: string[], assets: TradeAssetInput[]): { teamId: string; items: string[] }[] {
  const ids = [...teamOrder];
  for (const a of assets) if (!ids.includes(a.toTeamId)) ids.push(a.toTeamId);
  return ids.map((teamId) => ({
    teamId,
    items: assets
      .filter((a) => a.toTeamId === teamId)
      .map((a) => (a.type === "PLAYER" ? a.playerName ?? a.label : a.type === "FAAB" ? a.label ?? (a.faabAmount != null ? `$${a.faabAmount} FAB` : null) : a.label))
      .filter((x): x is string => !!x && !!x.trim()),
  }));
}

const TX_LABELS: Record<string, string> = {
  ADD: "Add",
  DROP: "Drop",
  WAIVER: "Waiver",
  TRADE: "Trade",
  AUCTION: "Auction",
  ROOKIE_DRAFT: "Draft",
  DRAFT: "Draft",
  KEEPER: "Keeper",
  IR: "IR",
  TAXI: "Taxi",
  ACTIVATE: "Activate",
  CONTRACT: "Contract",
  FAAB: "FAB",
  COMMISSIONER: "Commish",
};

export function txLabel(type: string): string {
  return TX_LABELS[type] ?? type.charAt(0) + type.slice(1).toLowerCase();
}

export type TxTone = "green" | "red" | "brand" | "gold" | "purple" | "amber" | "neutral";

export function txTone(type: string): TxTone {
  switch (type) {
    case "ADD":
    case "WAIVER":
    case "ACTIVATE":
      return "green";
    case "DROP":
      return "red";
    case "TRADE":
      return "brand";
    case "AUCTION":
    case "ROOKIE_DRAFT":
    case "DRAFT":
      return "gold";
    case "KEEPER":
    case "CONTRACT":
      return "purple";
    case "COMMISSIONER":
    case "FAAB":
    case "IR":
    case "TAXI":
      return "amber";
    default:
      return "neutral";
  }
}

// ───────────────────────────── Recap teaser / playoff odds / chat ─────────────────────────────

export interface RecapTeaser {
  headline: string;
  intro: string | null;
  awards: { title: string; value: string; teamId: string | null }[];
}

/** Headline, intro and first awards from a stored WeeklyRecap (tolerates older / foreign content shapes). */
export function recapTeaser(title: string, content: unknown, maxAwards = 3): RecapTeaser {
  const c = content && typeof content === "object" ? (content as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const awards = Array.isArray(c.awards)
    ? c.awards
        .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>) : null))
        .filter((a): a is Record<string, unknown> => !!a && !!str(a.title))
        .slice(0, maxAwards)
        .map((a) => ({ title: str(a.title)!, value: str(a.value) ?? "", teamId: str(a.teamId) }))
    : [];
  return { headline: str(c.headline) ?? title, intro: str(c.intro), awards };
}

export interface OddsLite {
  playoffPct: number;
  byePct: number | null;
  champPct: number | null;
  marker: "x" | "y" | "z" | "e" | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Per-team playoff odds from a PlayoffOddsSnapshot.data array (fractions 0..1). */
export function parseOdds(data: unknown): Map<string, OddsLite> {
  const out = new Map<string, OddsLite>();
  if (!Array.isArray(data)) return out;
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.teamId !== "string" || typeof r.playoffPct !== "number" || !Number.isFinite(r.playoffPct)) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? clamp01(v) : null);
    const marker = r.marker === "x" || r.marker === "y" || r.marker === "z" || r.marker === "e" ? r.marker : null;
    out.set(r.teamId, { playoffPct: clamp01(r.playoffPct), byePct: num(r.byePct), champPct: num(r.champPct), marker });
  }
  return out;
}

/** "62%", "<1%", ">99%" (exact 0 / 100 only when decided). */
export function pctLabel(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  if (p <= 0) return "0%";
  if (p >= 1) return "100%";
  if (p < 0.005) return "<1%";
  if (p > 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** A starter / bench line from GET /api/live/matchup/:id (bench, IR and taxi players follow the starters). */
export interface LiveMatchupPlayer {
  playerId: string;
  name: string;
  slot: string;
  points: number;
  projected: number;
  gameState: string;
}

const NON_STARTER_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** Live starters split into still-to-play ids and the top scorer among players whose game has started. */
export function liveStarterSummary(players: LiveMatchupPlayer[]): { pendingIds: Set<string>; top: LiveMatchupPlayer | null } {
  const starters = players.filter((p) => !NON_STARTER_SLOTS.has(p.slot));
  const scored = starters.filter((p) => p.gameState === "in" || p.gameState === "post");
  return {
    pendingIds: new Set(starters.filter((p) => p.gameState === "pre").map((p) => p.playerId)),
    top: scored.length ? scored.reduce((a, b) => (b.points > a.points ? b : a)) : null,
  };
}

/** Rule proposals in VOTING: still-open votes first (closing soonest first), then votes awaiting a decision. */
export function openVotesFirst<T extends { votingEndsAt: Date | string | null }>(rows: T[], now: Date = new Date()): T[] {
  const end = (r: T) => (r.votingEndsAt ? new Date(r.votingEndsAt).getTime() : Number.POSITIVE_INFINITY);
  const open = (r: T) => end(r) > now.getTime();
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(open(b.r)) - Number(open(a.r)) || (open(a.r) ? end(a.r) - end(b.r) : end(b.r) - end(a.r)) || a.i - b.i)
    .map((x) => x.r);
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** Compact chip label: last name without generational suffixes ("Michael Pittman Jr." → "Pittman"). */
export function shortPlayerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1]!.toLowerCase())) parts.pop();
  return parts.length > 1 ? parts[parts.length - 1]! : parts[0] ?? fullName;
}

/** Plain one-line preview of a chat message (markdown-lite stripped). */
export function previewText(body: string, max = 160): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, (m) => m.slice(3, -3))
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/~~([^~]*?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}

// ───────────────────────────── Time formatting (league timezone) ─────────────────────────────

function dayKey(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function fmt(d: Date, tz: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  }
}

/** "Today 8:15 PM", "Tomorrow 1:00 PM", "Sun 4:25 PM", "Dec 6" (league timezone). */
export function formatWhen(at: Date | string, tz: string, now: Date = new Date(), opts: { time?: boolean } = {}): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const withTime = opts.time ?? true;
  const diff = dayDiff(dayKey(now, tz), dayKey(d, tz));
  const time = fmt(d, tz, { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return withTime ? `Today ${time}` : "Today";
  if (diff === 1) return withTime ? `Tomorrow ${time}` : "Tomorrow";
  if (diff === -1) return withTime ? `Yesterday ${time}` : "Yesterday";
  if (diff > 1 && diff < 7) return withTime ? `${fmt(d, tz, { weekday: "short" })} ${time}` : fmt(d, tz, { weekday: "long" });
  const sameYear = fmt(d, tz, { year: "numeric" }) === fmt(now, tz, { year: "numeric" });
  return fmt(d, tz, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "in 45m", "in 5h 10m", "in 3d 4h" ("now" when due). */
export function countdownLabel(at: Date | string, now: Date = new Date()): string {
  const ms = new Date(at).getTime() - now.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms <= 60_000) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `in ${hr}h${min % 60 ? ` ${min % 60}m` : ""}`;
  const day = Math.floor(hr / 24);
  return `in ${day}d${hr % 24 ? ` ${hr % 24}h` : ""}`;
}

/** Time zone abbreviation for labels ("ET", "PT"...), falls back to the short Intl name. */
export function tzAbbrev(tz: string, at: Date = new Date()): string {
  const map: Record<string, string> = { "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Los_Angeles": "PT" };
  if (map[tz]) return map[tz];
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
