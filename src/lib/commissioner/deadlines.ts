// Upcoming league deadlines and special weeks for the commissioner dashboard, from the live settings.
// Pure + client-safe.
import type { LeagueSettings } from "@/lib/settings/schema";
import { capLimit, capLimitLabel, deadlineInstant } from "@/lib/roster-rules";

export interface Deadline {
  key: string;
  label: string;
  /** ISO date for dated deadlines */
  at: string | null;
  /** NFL week for week-based deadlines */
  week: number | null;
  detail: string | null;
  href: string;
  passed: boolean;
}

/**
 * A roster / cap deadline setting (roster.rosterCutdownDate, salaryCap.complianceDate) for a dated list: `due` is the
 * moment the rules switch (roster-rules deadlineInstant — a date-only value passes at the next midnight in the league
 * time zone) and `shown` the instant to display: the same, except a date-only value is shown as the last moment of
 * its day (11:59 PM), so "2027-03-01" reads as Mar 1 rather than the midnight that ends it. null = unset or unreadable.
 */
export function deadlineShownAt(value: string | null | undefined, timeZone: string): { due: Date; shown: Date } | null {
  const due = deadlineInstant(value, timeZone);
  if (!due || !value) return null;
  return { due, shown: /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? new Date(due.getTime() - 1) : due };
}

const OVER_CAP: Record<LeagueSettings["salaryCap"]["overCapPenalty"], string> = {
  COMMISSIONER_RESOLVES: "Over-cap teams are resolved by the commissioner",
  FREEZE_TRANSACTIONS: "Over-cap teams have transactions frozen",
  FORFEIT_PICK: "Over-cap teams forfeit a draft pick",
};

/**
 * Deadlines that are still ahead (or passed within `recentDays`), soonest first: dated items by date,
 * week items by week (a week item sorts before dated items more than a week away).
 */
export function upcomingDeadlines(s: LeagueSettings, opts: { now: Date; week: number; recentDays?: number; horizonDays?: number }): Deadline[] {
  const now = opts.now.getTime();
  const recent = (opts.recentDays ?? 7) * 864e5;
  const horizon = (opts.horizonDays ?? 400) * 864e5;
  const out: Deadline[] = [];
  // `when`: the instant to show and the one it passes at (deadlineShownAt), default the ISO value itself
  const dated = (key: string, label: string, iso: string | null | undefined, href: string, detail: string | null = null, when: { due: Date; shown: Date } | null = iso ? { due: new Date(iso), shown: new Date(iso) } : null) => {
    if (!iso || !when) return;
    const t = when.due.getTime();
    if (Number.isNaN(t) || t < now - recent || t > now + horizon) return;
    out.push({ key, label, at: when.shown.toISOString(), week: null, detail, href, passed: t <= now });
  };
  const weekly = (key: string, label: string, week: number | null | undefined, href: string, detail: string | null = null) => {
    if (!week || week < opts.week) return;
    out.push({ key, label, at: null, week, detail, href, passed: false });
  };

  if (s.general.leagueDues > 0) dated("dues", "League dues due", s.general.duesDueDate, "/commissioner/members#dues", `$${s.general.leagueDues} per team`);
  if (s.trades.enabled) weekly("trade-deadline", "Trade deadline", s.trades.deadlineWeek, "/commissioner/settings?tab=trades");
  if (s.roster.taxiSlots > 0) weekly("taxi-deadline", "Taxi squad deadline", s.roster.taxiDeadlineWeek, "/commissioner/settings?tab=roster", "Last week to place players on the taxi squad");
  if (s.playoffs.teams > 0) weekly("playoffs", "Playoffs begin", s.playoffs.startWeek, "/commissioner/settings?tab=playoffs", `${s.playoffs.teams} teams`);
  if (s.matchups.rivalries.length) weekly("rivalry", "Rivalry week", s.matchups.rivalryWeek, "/commissioner/schedule");
  weekly("reverse", "Reverse scoring week", s.niche.reverseScoringWeek, "/commissioner/settings?tab=niche", "Lowest score wins");
  weekly("chaos", "Chaos week", s.niche.chaosWeek, "/commissioner/settings?tab=niche", s.niche.chaosWeekRule || null);
  if (s.keepers.enabled) {
    dated("keeper-open", "Keeper window opens", s.keepers.windowOpens, "/commissioner/season");
    dated("keeper-deadline", "Keeper deadline", s.keepers.deadline, "/commissioner/season");
  }
  // the two roster / cap deadlines the transaction rules read, parsed the same way (roster-rules deadlineInstant: a
  // date-only value ends at midnight in the league time zone)
  const tz = s.general.timezone;
  if (s.salaryCap.enabled) {
    // the ceiling the over-cap check measures (capLimit: the cap, or cap + softCapMaxOverage for a soft cap)
    const limit = capLimit(s);
    const detail = `${OVER_CAP[s.salaryCap.overCapPenalty]}${limit === null ? "" : ` (over the $${limit} ${capLimitLabel(s)})`}`;
    dated("compliance", "Cap compliance deadline", s.salaryCap.complianceDate, "/commissioner/rosters", detail, deadlineShownAt(s.salaryCap.complianceDate, tz));
  }
  // the cutdown ends the offseason roster limit (activeRosterLimit) — only meaningful when that limit is larger
  const extra = s.roster.offseasonMaxActiveRoster;
  if (extra !== null && extra !== undefined && extra > s.roster.maxActiveRoster)
    dated("cutdown", "Roster cutdown", s.roster.rosterCutdownDate, "/commissioner/rosters", `Active rosters back to ${s.roster.maxActiveRoster}`, deadlineShownAt(s.roster.rosterCutdownDate, tz));
  dated("rookie-draft", "Rookie draft", s.draft.rookie.scheduledFor, "/draft", `${s.draft.rookie.rounds} rounds`);
  dated("auction", "Salary auction", s.draft.auction.scheduledFor, "/draft", `$${s.draft.auction.budget} budgets`);
  if (s.niche.lastPlacePunishment.trim()) dated("punishment", "Last-place punishment due", s.niche.punishmentDeadline, "/rules#fun", s.niche.lastPlaceTrophyName || null);

  // order: week items by week; dated items by time; a dated item within 7 days sorts with the current week
  const rank = (d: Deadline) => (d.week !== null ? (d.week - opts.week) * 7 : (new Date(d.at!).getTime() - now) / 864e5);
  return out.sort((a, b) => rank(a) - rank(b));
}
