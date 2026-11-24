// Tradable assets for every team (rosters with contracts + points, unused rookie picks, FAB) —
// the data behind the trade builder, calculator and trade block. Serializable for client components.
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { firstOpenDraftSeason } from "@/lib/picks";
import { computeStandings } from "@/lib/standings";
import { ordinal, record } from "@/lib/utils";
import { getLeagueValues, valuePick, valuePlayer, valuePlayers } from "@/lib/value/context";
import type { TeamOutlook } from "@/lib/value/model";
import { faabTradingAllowed, maxTeams, pickAssetLabel, spotCapHit, tradablePickSeasons, tradeWindow } from "@/lib/trades/rules";
import { deadMoneyByTeam } from "@/lib/trades/validate";

export interface AssetPlayer {
  id: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  age: number | null;
  yearsExp: number | null;
  rosterStatus: string;
  salary: number;
  contractYears: number;
  isRookieContract: boolean;
  seasonPoints: number;
  ppg: number;
  rosPoints: number;
  value: number;
}

export interface AssetPick {
  id: string;
  season: number;
  round: number;
  pickInRound: number | null;
  originalTeamId: string;
  originalTeamName: string;
  label: string;
  /** compact label for lists: "2027 1st" / "2027 1st via RING" */
  shortLabel: string;
  slotLabel: string;
  value: number;
}

export interface AssetTeam {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  managerName: string | null;
  record: string;
  rank: number;
  outlook: TeamOutlook;
  faabBalance: number;
  cap: { committed: number; cap: number; space: number; dead: number };
  roster: { active: number; max: number; ir: number; irSlots: number; taxi: number };
  players: AssetPlayer[];
  picks: AssetPick[];
}

export interface TradeRulesSummary {
  enabled: boolean;
  windowOpen: boolean;
  windowReason: string | null;
  windowNote: string | null;
  maxTeams: number;
  picks: boolean;
  pickSeasons: number[];
  faab: boolean;
  capEnabled: boolean;
  requireCapCompliance: boolean;
  reviewType: LeagueSettings["trades"]["reviewType"];
  reviewPeriodHours: number;
  vetoVotesRequired: number;
  offerExpirationHours: number;
  tradeBackCooldownDays: number;
  maxActive: number;
  deadlineWeek: number | null;
}

export function rulesSummary(settings: LeagueSettings, phase: string, week: number, season: number): TradeRulesSummary {
  const w = tradeWindow(settings, phase, week);
  return {
    enabled: settings.trades.enabled,
    windowOpen: w.open,
    windowReason: w.reason,
    windowNote: w.note,
    maxTeams: maxTeams(settings),
    picks: settings.trades.allowDraftPickTrading,
    pickSeasons: tradablePickSeasons(settings, firstOpenDraftSeason(season, phase)),
    faab: faabTradingAllowed(settings),
    capEnabled: settings.salaryCap.enabled,
    requireCapCompliance: settings.trades.requireCapCompliance,
    reviewType: settings.trades.reviewType,
    reviewPeriodHours: settings.trades.reviewPeriodHours,
    vetoVotesRequired: settings.trades.vetoVotesRequired,
    offerExpirationHours: settings.trades.offerExpirationHours,
    tradeBackCooldownDays: settings.trades.tradeBackCooldownDays,
    maxActive: settings.roster.maxActiveRoster,
    deadlineWeek: settings.trades.deadlineWeek,
  };
}

export async function loadTradeAssets(leagueId: string): Promise<AssetTeam[]> {
  const values = await getLeagueValues(leagueId);
  const { settings, season, phase } = values;
  const pickSeasons = tradablePickSeasons(settings, firstOpenDraftSeason(season, phase));
  const [teams, spots, picks, dead, standings] = await Promise.all([
    db.team.findMany({ where: { leagueId }, include: { owner: { select: { name: true } } }, orderBy: { name: "asc" } }),
    db.rosterSpot.findMany({ where: { leagueId }, include: { player: true } }),
    settings.trades.allowDraftPickTrading
      ? db.draftPick.findMany({ where: { leagueId, playerId: null, usedAt: null, season: { in: pickSeasons } }, include: { originalTeam: { select: { name: true } } }, orderBy: [{ season: "asc" }, { round: "asc" }, { pickInRound: "asc" }] })
      : Promise.resolve([]),
    deadMoneyByTeam(db, leagueId, season),
    computeStandings(leagueId, season, settings),
  ]);
  const valued = await valuePlayers(values, spots.map((s) => s.playerId));
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const abbrevOf = new Map(teams.map((t) => [t.id, t.abbrev]));
  const st = new Map(standings.map((s) => [s.team.id, s]));
  return teams.map((t) => {
    const mine = spots.filter((s) => s.teamId === t.id);
    const d = dead.get(t.id) ?? { current: 0, next: 0 };
    const committed = mine.reduce((a, s) => a + spotCapHit(s, settings), 0) + d.current;
    const players: AssetPlayer[] = mine
      .map((s) => {
        const vp = valued.get(s.playerId);
        const v = vp ? valuePlayer(values, vp, "balanced") : null;
        return {
          id: s.playerId,
          fullName: s.player.fullName,
          position: s.player.position,
          nflTeam: s.player.team,
          injuryStatus: s.player.injuryStatus,
          age: s.player.age,
          yearsExp: s.player.yearsExp,
          rosterStatus: s.status,
          salary: s.salary,
          contractYears: s.contractYears,
          isRookieContract: s.isRookieContract,
          seasonPoints: vp?.seasonPoints ?? 0,
          ppg: v ? Math.round(v.ppg * 10) / 10 : 0,
          rosPoints: vp?.rosPoints ?? 0,
          value: v ? Math.round(v.value * 10) / 10 : 0,
        };
      })
      .sort((a, b) => b.value - a.value);
    const teamPicks: AssetPick[] = picks
      .filter((p) => p.ownerTeamId === t.id)
      .map((p) => {
        const v = valuePick(values, p, "balanced");
        return {
          id: p.id,
          season: p.season,
          round: p.round,
          pickInRound: p.pickInRound,
          originalTeamId: p.originalTeamId,
          originalTeamName: p.originalTeam.name,
          label: pickAssetLabel(p, t.id, (id) => nameOf.get(id) ?? "?"),
          shortLabel: `${p.pickInRound ? `${p.season} ${p.round}.${String(p.pickInRound).padStart(2, "0")}` : `${p.season} ${ordinal(p.round)}`}${p.originalTeamId !== t.id ? ` via ${abbrevOf.get(p.originalTeamId) ?? "?"}` : ""}`,
          slotLabel: v.slotLabel,
          value: Math.round(v.value * 10) / 10,
        };
      });
    const row = st.get(t.id);
    return {
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      managerName: t.owner?.name ?? null,
      record: row ? record(row.wins, row.losses, row.ties) : "0-0",
      rank: row?.rank ?? 0,
      outlook: values.outlooks[t.id] ?? "balanced",
      faabBalance: t.faabBalance,
      cap: { committed, cap: settings.salaryCap.cap, space: settings.salaryCap.cap - committed, dead: d.current },
      roster: {
        active: mine.filter((s) => s.status !== "IR" && s.status !== "TAXI").length,
        max: settings.roster.maxActiveRoster,
        ir: mine.filter((s) => s.status === "IR").length,
        irSlots: settings.roster.irSlots,
        taxi: mine.filter((s) => s.status === "TAXI").length,
      },
      players,
      picks: teamPicks,
    };
  });
}
