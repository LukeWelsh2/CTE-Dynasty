// Tradable assets for every team (rosters with contracts + points, unused rookie picks, FAB) —
// the data behind the trade builder, calculator and trade block. Serializable for client components.
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { firstOpenDraftSeason } from "@/lib/picks";
import { computeStandings } from "@/lib/standings";
import { ordinal, record } from "@/lib/utils";
import { getLeagueValues, valuePick, valuePlayer, valuePlayers } from "@/lib/value/context";
import type { TeamOutlook } from "@/lib/value/model";
import { activeRosterLimit, bindingCapRoom, capEnforcement, capLimit, capLimitLabel, type CapEnforcement } from "@/lib/roster-rules";
import { faabTradingAllowed, maxTeams, pickAssetLabel, retentionMax, spotCapHit, tradablePickSeasons, tradeWindow } from "@/lib/trades/rules";
import { deadMoneyByTeam } from "@/lib/trades/validate";
import { lockedPickSeasons, pickTradingOpen } from "@/lib/draft/trading";
import { championshipStatus, eliminationBlock, eliminationRuleActive } from "@/lib/playoffs/elimination";

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
  /**
   * payroll this season (incl. dead money) and the room the trade rules leave: `cap` is tradeCapReference (the capLimit
   * ceiling while the cap blocks over-cap moves, else the league cap) and `space` = cap − committed
   */
  cap: { committed: number; cap: number; space: number; dead: number };
  /** active roster vs activeRosterLimit for the league phase (the offseason limit until the cutdown deadline) */
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
  /**
   * over-cap trades have to be fixed right now: trades.requireCapCompliance while the cap blocks (capEnforcement BLOCK
   * for the league phase, with a capLimit ceiling). Otherwise an over-cap trade only carries a warning (or, with the
   * cap OFF, nothing).
   */
  requireCapCompliance: boolean;
  /** how the cap applies to moves in the league phase (capEnforcement) */
  capMode: CapEnforcement;
  /** the ceiling every cap check uses (capLimit: the cap, or cap + softCapMaxOverage; null = none) */
  capLimit: number | null;
  /** what the ceiling is called in messages: "cap" / "soft-cap limit" */
  capLimitLabel: string;
  reviewType: LeagueSettings["trades"]["reviewType"];
  reviewPeriodHours: number;
  vetoVotesRequired: number;
  offerExpirationHours: number;
  tradeBackCooldownDays: number;
  /** active-roster limit for the league phase (activeRosterLimit) */
  maxActive: number;
  deadlineWeek: number | null;
  voteEligibility: LeagueSettings["trades"]["voteEligibility"];
  irTradable: boolean;
  taxiTradable: boolean;
  maxPlayersPerSide: number | null;
  allowUnbalanced: boolean;
  picksNeedDues: boolean;
  lockedPlayersPolicy: LeagueSettings["trades"]["lockedPlayersPolicy"];
  /** max % of a traded player's salary the sender may keep paying (0 = off) */
  retainMax: number;
  /** pick seasons that can't be traded right now because their rookie draft is under way (draft.rookie.tradingDuringDraft) */
  lockedPickSeasons?: { season: number; reason: string }[];
}

/** League-state trade locks as seen by one team (see tradeLocksFor). */
export interface ViewerTradeLocks {
  /** why the viewer's team can't trade right now (out of the playoffs, playoffs.eliminatedTeamsCanTransact) */
  myBlock: string | null;
  /** other teams that can't trade right now → reason */
  blockedTeams: Map<string, string>;
  /** pick seasons whose rookie draft is under way → reason */
  lockedPicks: { season: number; reason: string }[];
}

/**
 * Trade locks that depend on league state rather than settings alone: playoffs.eliminatedTeamsCanTransact (the
 * viewer's own team and its possible partners) and draft.rookie.tradingDuringDraft (pick seasons whose rookie draft
 * is running). The same checks validateTrade() enforces, loaded up front so the builder can explain them. No
 * queries beyond one draft lookup unless a rule applies.
 */
export async function tradeLocksFor(
  league: { id: string; season: number; phase: string },
  settings: LeagueSettings,
  myTeamId: string | null,
  teams: { id: string; name: string }[],
): Promise<ViewerTradeLocks> {
  const picksOn = settings.trades.enabled && settings.trades.allowDraftPickTrading;
  const [statuses, seasons] = await Promise.all([
    eliminationRuleActive(settings, league.phase, "TRADE") ? championshipStatus(league.id, league.season, settings) : Promise.resolve(null),
    picksOn ? lockedPickSeasons(league.id, settings) : Promise.resolve([] as number[]),
  ]);
  const lockedPicks: ViewerTradeLocks["lockedPicks"] = [];
  for (const season of [...seasons].sort((a, b) => a - b)) {
    const r = await pickTradingOpen(league.id, season, settings);
    if (!r.ok) lockedPicks.push({ season, reason: r.reason });
  }
  const blockedTeams = new Map<string, string>();
  let myBlock: string | null = null;
  if (statuses) {
    for (const t of teams) {
      if (t.id === myTeamId) myBlock = eliminationBlock(settings, league.phase, statuses.get(t.id), "TRADE");
      else {
        const reason = eliminationBlock(settings, league.phase, statuses.get(t.id), "TRADE", t.name);
        if (reason) blockedTeams.set(t.id, reason);
      }
    }
  }
  return { myBlock, blockedTeams, lockedPicks };
}

/** The rules summary with the viewer's locks applied: their own block closes the window, locked pick seasons drop out. */
export function withViewerLocks(rules: TradeRulesSummary, locks: ViewerTradeLocks): TradeRulesSummary {
  const locked = new Set(locks.lockedPicks.map((l) => l.season));
  const closed = rules.windowOpen && !!locks.myBlock;
  return {
    ...rules,
    windowOpen: rules.windowOpen && !locks.myBlock,
    windowReason: closed ? locks.myBlock : rules.windowReason,
    windowNote: closed ? null : rules.windowNote,
    pickSeasons: rules.pickSeasons.filter((s) => !locked.has(s)),
    lockedPickSeasons: locks.lockedPicks,
  };
}

/**
 * The cap figure trade screens measure room against (team cap chips, the preview's cap lines and "over" flags): the
 * capLimit ceiling while the cap blocks over-cap moves (capEnforcement BLOCK for `phase`), else the league cap —
 * the same reference the free-agent add dialog uses. `cap` = that season's league cap (default this season's).
 */
export function tradeCapReference(settings: LeagueSettings, phase: string | null | undefined, opts: { now?: Date; cap?: number } = {}): number {
  const cap = opts.cap ?? settings.salaryCap.cap;
  const limit = capLimit(settings, cap);
  return capEnforcement(settings, phase, opts.now) === "BLOCK" && limit !== null ? limit : cap;
}

export function rulesSummary(settings: LeagueSettings, phase: string, week: number, season: number, now: Date = new Date()): TradeRulesSummary {
  const w = tradeWindow(settings, phase, week);
  const capMode = capEnforcement(settings, phase, now);
  const limit = capLimit(settings);
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
    requireCapCompliance: settings.salaryCap.enabled && settings.trades.requireCapCompliance && capMode === "BLOCK" && limit !== null,
    capMode,
    capLimit: limit,
    capLimitLabel: capLimitLabel(settings),
    reviewType: settings.trades.reviewType,
    reviewPeriodHours: settings.trades.reviewPeriodHours,
    vetoVotesRequired: settings.trades.vetoVotesRequired,
    offerExpirationHours: settings.trades.offerExpirationHours,
    tradeBackCooldownDays: settings.trades.tradeBackCooldownDays,
    maxActive: activeRosterLimit(settings, { phase, now }),
    deadlineWeek: settings.trades.deadlineWeek,
    voteEligibility: settings.trades.voteEligibility,
    irTradable: settings.trades.irPlayersTradable !== false,
    taxiTradable: settings.trades.taxiPlayersTradable !== false,
    maxPlayersPerSide: settings.trades.maxPlayersPerSide && settings.trades.maxPlayersPerSide > 0 ? settings.trades.maxPlayersPerSide : null,
    allowUnbalanced: settings.trades.allowUnbalanced !== false,
    picksNeedDues: settings.trades.pickTradingRequiresPaidDues && settings.general.leagueDues > 0,
    lockedPlayersPolicy: settings.trades.lockedPlayersPolicy,
    retainMax: retentionMax(settings),
  };
}

export async function loadTradeAssets(leagueId: string): Promise<AssetTeam[]> {
  const values = await getLeagueValues(leagueId);
  const { settings, season, phase } = values;
  const pickSeasons = tradablePickSeasons(settings, firstOpenDraftSeason(season, phase));
  // roster room and cap room follow the league-wide rules for the phase (what checkTrade measures)
  const now = new Date();
  const maxActive = activeRosterLimit(settings, { phase, now });
  const capRef = tradeCapReference(settings, phase, { now });
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
      cap: { committed, cap: capRef, space: bindingCapRoom(committed, settings, { phase, now }) ?? settings.salaryCap.cap - committed, dead: d.current },
      roster: {
        active: mine.filter((s) => s.status !== "IR" && s.status !== "TAXI").length,
        max: maxActive,
        ir: mine.filter((s) => s.status === "IR").length,
        irSlots: settings.roster.irSlots,
        taxi: mine.filter((s) => s.status === "TAXI").length,
      },
      players,
      picks: teamPicks,
    };
  });
}
