// Upcoming league deadlines and special weeks for the commissioner dashboard, from the live settings.
// Pure + client-safe.
import type { LeagueSettings } from "@/lib/settings/schema";

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
  const dated = (key: string, label: string, iso: string | null | undefined, href: string, detail: string | null = null) => {
    if (!iso) return;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t < now - recent || t > now + horizon) return;
    out.push({ key, label, at: new Date(t).toISOString(), week: null, detail, href, passed: t < now });
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
  if (s.salaryCap.enabled) dated("compliance", "Cap compliance deadline", s.salaryCap.complianceDate, "/commissioner/rosters", OVER_CAP[s.salaryCap.overCapPenalty]);
  if (s.roster.offseasonMaxActiveRoster !== null) dated("cutdown", "Roster cutdown", s.roster.rosterCutdownDate, "/commissioner/rosters", `Active rosters back to ${s.roster.maxActiveRoster}`);
  dated("rookie-draft", "Rookie draft", s.draft.rookie.scheduledFor, "/draft", `${s.draft.rookie.rounds} rounds`);
  dated("auction", "Salary auction", s.draft.auction.scheduledFor, "/draft", `$${s.draft.auction.budget} budgets`);
  if (s.niche.lastPlacePunishment.trim()) dated("punishment", "Last-place punishment due", s.niche.punishmentDeadline, "/rules#fun", s.niche.lastPlaceTrophyName || null);

  // order: week items by week; dated items by time; a dated item within 7 days sorts with the current week
  const rank = (d: Deadline) => (d.week !== null ? (d.week - opts.week) * 7 : (new Date(d.at!).getTime() - now) / 864e5);
  return out.sort((a, b) => rank(a) - rank(b));
}
