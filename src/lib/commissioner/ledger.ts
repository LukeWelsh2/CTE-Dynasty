// League money ledger (real-money side of the league, tracked here and settled by the commissioner):
// dues (settings.general.leagueDues + duesPaidTeamIds), empty-starter fines (settings.niche.emptyStarterFine),
// add/drop fees (settings.waivers.addDropFee) and weekly high-score prizes (settings.niche.weeklyHighScorePrize).
// Pure + client-safe.
import type { LeagueSettings } from "@/lib/settings/schema";

export interface LedgerInput {
  teams: { id: string; name: string; abbrev: string }[];
  /** empty starting slots per team in completed weeks */
  emptySlots: Map<string, number>;
  /** player acquisitions (adds + won waiver claims) per team this season */
  acquisitions: Map<string, number>;
  /** weeks each team had the league's top score (completed weeks) */
  highScoreWeeks: Map<string, number[]>;
  /** soft-cap luxury tax owed per team (only collected here when salaryCap.luxuryTaxPaidAs is DUES) */
  luxuryTax?: Map<string, number>;
}

export interface LedgerRow {
  teamId: string;
  team: string;
  abbrev: string;
  dues: number;
  duesPaid: boolean;
  emptySlots: number;
  fines: number;
  acquisitions: number;
  fees: number;
  highScoreWeeks: number[];
  winnings: number;
  /** soft-cap luxury tax collected with dues */
  luxuryTax: number;
  /** dues still unpaid + fines + fees + luxury tax (all collected with dues) */
  owed: number;
}

export interface Ledger {
  rows: LedgerRow[];
  /** which columns matter for this league */
  show: { dues: boolean; fines: boolean; fees: boolean; winnings: boolean; tax: boolean };
  totals: { duesCollected: number; duesOutstanding: number; fines: number; fees: number; winnings: number; tax: number; owed: number; pot: number };
  active: boolean;
}

/** Is a soft-cap luxury tax collected as real money with the dues? */
export function luxuryTaxInDues(s: LeagueSettings): boolean {
  return s.salaryCap.enabled && s.salaryCap.capType === "SOFT" && s.salaryCap.luxuryTaxRate > 0 && s.salaryCap.luxuryTaxPaidAs === "DUES";
}

export function ledgerActive(s: LeagueSettings): boolean {
  return s.general.leagueDues > 0 || s.niche.emptyStarterFine > 0 || s.waivers.addDropFee > 0 || s.niche.weeklyHighScorePrize > 0 || luxuryTaxInDues(s);
}

export function buildLedger(s: LeagueSettings, input: LedgerInput): Ledger {
  const paid = new Set(s.general.duesPaidTeamIds);
  const show = { dues: s.general.leagueDues > 0, fines: s.niche.emptyStarterFine > 0, fees: s.waivers.addDropFee > 0, winnings: s.niche.weeklyHighScorePrize > 0, tax: luxuryTaxInDues(s) };
  const rows: LedgerRow[] = input.teams.map((t) => {
    const duesPaid = paid.has(t.id);
    const emptySlots = input.emptySlots.get(t.id) ?? 0;
    const acquisitions = input.acquisitions.get(t.id) ?? 0;
    const highScoreWeeks = [...(input.highScoreWeeks.get(t.id) ?? [])].sort((a, b) => a - b);
    const fines = show.fines ? emptySlots * s.niche.emptyStarterFine : 0;
    const fees = show.fees ? acquisitions * s.waivers.addDropFee : 0;
    const winnings = show.winnings ? highScoreWeeks.length * s.niche.weeklyHighScorePrize : 0;
    const luxuryTax = show.tax ? Math.max(0, input.luxuryTax?.get(t.id) ?? 0) : 0;
    const dues = s.general.leagueDues;
    return {
      teamId: t.id,
      team: t.name,
      abbrev: t.abbrev,
      dues,
      duesPaid,
      emptySlots,
      fines,
      acquisitions,
      fees,
      highScoreWeeks,
      winnings,
      luxuryTax,
      owed: (show.dues && !duesPaid ? dues : 0) + fines + fees + luxuryTax,
    };
  });
  const sum = (f: (r: LedgerRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const duesCollected = show.dues ? sum((r) => (r.duesPaid ? r.dues : 0)) : 0;
  const totals = {
    duesCollected,
    duesOutstanding: show.dues ? sum((r) => (r.duesPaid ? 0 : r.dues)) : 0,
    fines: sum((r) => r.fines),
    fees: sum((r) => r.fees),
    winnings: sum((r) => r.winnings),
    tax: sum((r) => r.luxuryTax),
    owed: sum((r) => r.owed),
    pot: (show.dues ? s.general.leagueDues * rows.length : 0) + sum((r) => r.fines) + sum((r) => r.fees) + sum((r) => r.luxuryTax),
  };
  return { rows, show, totals, active: ledgerActive(s) };
}

/**
 * Teams with the week's top score from completed matchup results. Ties share the prize week.
 * `scores` = one entry per team per completed week.
 */
export function weeklyHighScorers(scores: { teamId: string; week: number; points: number }[]): Map<string, number[]> {
  const best = new Map<number, number>();
  for (const x of scores) best.set(x.week, Math.max(best.get(x.week) ?? -Infinity, x.points));
  const out = new Map<string, number[]>();
  for (const x of scores) {
    if (x.points <= 0 || Math.abs(x.points - (best.get(x.week) ?? -Infinity)) > 1e-6) continue;
    if (!out.has(x.teamId)) out.set(x.teamId, []);
    if (!out.get(x.teamId)!.includes(x.week)) out.get(x.teamId)!.push(x.week);
  }
  return out;
}
