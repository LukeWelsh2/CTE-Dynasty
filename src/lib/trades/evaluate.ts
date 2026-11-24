// Trade evaluation with live league data: values every asset for its receiving team (or a fixed mode),
// adds each team's cap + roster impact, and returns UI-ready asset details.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getLeagueValues, outlookFor, valueFaab, valuePick, valuePlayer, valuePlayers, type LeagueValueData } from "@/lib/value/context";
import { evaluateTrade, type EvalAssetInput, type EvalTeamInput, type TeamOutlook, type TradeEvaluation, type ValueMode } from "@/lib/value/model";
import { assetKey, dropDeadMoney, faabLabel, pickAssetLabel, retainedAmount, salaryNextSeason, spotCapHit, tradeWindow, type AssetRef } from "@/lib/trades/rules";
import { deadMoneyByTeam } from "@/lib/trades/validate";
import { tradeCapReference } from "@/lib/trades/assets";
import { activeRosterLimit, capLimit, capLimitLabel } from "@/lib/roster-rules";

export interface TradeAssetDetail extends EvalAssetInput {
  player?: { id: string; fullName: string; position: string; team: string | null; injuryStatus: string | null; age: number | null; yearsExp: number | null };
  seasonPoints?: number;
  ppg?: number;
  rosPoints?: number;
  isRookieContract?: boolean;
  pick?: { id: string; season: number; round: number; pickInRound: number | null; originalTeamId: string; originalTeamName: string; slotLabel: string; usedBy: { id: string; fullName: string; position: string } | null };
  faabAmount?: number;
}

export interface TradePreview extends Omit<TradeEvaluation, "assets"> {
  assets: TradeAssetDetail[];
  mode: ValueMode;
  outlooks: Record<string, TeamOutlook>;
}

export interface EvaluateInput {
  teamIds: string[];
  assets: (AssetRef & { salary?: number | null; contractYears?: number | null; label?: string | null })[];
  drops?: Record<string, string[]>;
  mode: ValueMode;
  /** free mode: synthetic sides "A"/"B", no cap/roster impact */
  free?: boolean;
  /** use the asset's salary snapshot instead of the current contract (historical trades) */
  useSnapshots?: boolean;
  withImpact?: boolean;
}

const FREE_NAMES: Record<string, string> = { A: "Side A", B: "Side B" };

type PickRow = Prisma.DraftPickGetPayload<{ include: { originalTeam: { select: { name: true } }; player: { select: { id: true; fullName: true; position: true } } } }>;
type SpotRow = Prisma.RosterSpotGetPayload<{ include: { player: { select: { fullName: true; position: true; yearsExp: true } } } }>;

/** Shared lookups so evaluating many trades (lists, history) doesn't repeat queries. */
export interface EvalPreload {
  teamNames: Map<string, string>;
  picks: Map<string, PickRow>;
  /** roster spots by player id (league-wide) */
  spots: Map<string, SpotRow>;
  spotsByTeam: Map<string, SpotRow[]>;
  dead: Map<string, { current: number; next: number }>;
}

export async function buildEvalPreload(leagueId: string, season: number, pickIds: string[]): Promise<EvalPreload> {
  const [teams, picks, spots, dead] = await Promise.all([
    db.team.findMany({ where: { leagueId }, select: { id: true, name: true } }),
    pickIds.length ? db.draftPick.findMany({ where: { leagueId, id: { in: [...new Set(pickIds)] } }, include: { originalTeam: { select: { name: true } }, player: { select: { id: true, fullName: true, position: true } } } }) : Promise.resolve([] as PickRow[]),
    db.rosterSpot.findMany({ where: { leagueId }, include: { player: { select: { fullName: true, position: true, yearsExp: true } } } }),
    deadMoneyByTeam(db, leagueId, season),
  ]);
  const spotsByTeam = new Map<string, SpotRow[]>();
  for (const s of spots) spotsByTeam.set(s.teamId, [...(spotsByTeam.get(s.teamId) ?? []), s]);
  return { teamNames: new Map(teams.map((t) => [t.id, t.name])), picks: new Map(picks.map((p) => [p.id, p])), spots: new Map(spots.map((s) => [s.playerId, s])), spotsByTeam, dead };
}

export async function evaluateTradeInput(leagueId: string, input: EvaluateInput, data?: LeagueValueData, preload?: EvalPreload): Promise<TradePreview> {
  const values = data ?? (await getLeagueValues(leagueId));
  const settings = values.settings;
  const teamIds = [...new Set(input.teamIds)];
  const pickIds = input.assets.filter((a) => a.type === "PICK" && a.pickId).map((a) => a.pickId!);
  const playerIds = input.assets.filter((a) => a.type === "PLAYER" && a.playerId).map((a) => a.playerId!);
  const pre = preload && pickIds.every((id) => preload.picks.has(id)) ? preload : await buildEvalPreload(leagueId, values.season, pickIds);
  const teamName = input.free ? new Map(Object.entries(FREE_NAMES)) : pre.teamNames;
  const valued = await valuePlayers(values, playerIds);
  const picks = pickIds.map((id) => pre.picks.get(id)).filter((p): p is PickRow => !!p);
  const pickById = new Map(picks.map((p) => [p.id, p]));
  const outlooks: Record<string, TeamOutlook> = {};
  for (const id of teamIds) outlooks[id] = input.free ? (input.mode === "auto" ? "balanced" : input.mode) : outlookFor(values, id, input.mode);

  const assets: TradeAssetDetail[] = [];
  for (const a of input.assets) {
    const outlook = outlooks[a.toTeamId] ?? "balanced";
    const base = { key: assetKey(a), type: a.type, fromTeamId: a.fromTeamId, toTeamId: a.toTeamId } as const;
    if (a.type === "PLAYER" && a.playerId) {
      const vp = valued.get(a.playerId);
      if (!vp) continue;
      const retain = a.retainPercent && a.retainPercent > 0 ? a.retainPercent : 0;
      const snapContract = input.useSnapshots && a.salary !== undefined && a.salary !== null ? { salary: a.salary, contractYears: a.contractYears ?? 1 } : undefined;
      const fullSalary = snapContract?.salary ?? vp.input.salary;
      // the receiving team values the player on what it will actually pay (salary less the retained share)
      const contract =
        retain && fullSalary !== null
          ? { salary: fullSalary - retainedAmount(fullSalary, retain), contractYears: snapContract?.contractYears ?? vp.input.contractYears }
          : snapContract;
      const v = valuePlayer(values, vp, outlook, contract);
      const salary = fullSalary;
      const years = contract?.contractYears ?? vp.input.contractYears;
      const spotStatus = "ACTIVE" as const;
      assets.push({
        ...base,
        label: a.label || vp.player.fullName,
        value: v.value,
        components: v.components,
        notes: v.notes,
        salary,
        contractYears: years,
        capHit: salary ?? 0,
        nextSeasonSalary: salary !== null && years !== null ? salaryNextSeason({ salary, contractYears: years, isRookieContract: vp.input.isRookieContract, player: { yearsExp: vp.input.yearsExp } }, settings) : 0,
        rosterStatus: spotStatus,
        ...(retain ? { retainPercent: retain } : {}),
        player: vp.player,
        seasonPoints: vp.seasonPoints,
        ppg: Math.round(v.ppg * 10) / 10,
        rosPoints: vp.rosPoints,
        isRookieContract: vp.input.isRookieContract,
      });
    } else if (a.type === "PICK" && a.pickId) {
      const p = pickById.get(a.pickId);
      if (!p) continue;
      const v = valuePick(values, p, outlook);
      const nameOf = (id: string) => (id === p.originalTeamId ? p.originalTeam.name : teamName.get(id) ?? "?");
      assets.push({
        ...base,
        label: a.label || pickAssetLabel(p, input.free ? null : a.fromTeamId, nameOf),
        value: p.playerId ? 0 : v.value,
        components: p.playerId ? [] : v.components,
        notes: v.notes,
        pick: { id: p.id, season: p.season, round: p.round, pickInRound: p.pickInRound, originalTeamId: p.originalTeamId, originalTeamName: p.originalTeam.name, slotLabel: v.slotLabel, usedBy: p.player },
      });
    } else if (a.type === "FAAB") {
      const amt = Math.max(0, Math.round(Number(a.faabAmount ?? 0)));
      const v = valueFaab(values, amt);
      assets.push({ ...base, key: `F:${a.fromTeamId}>${a.toTeamId}`, label: faabLabel(amt), value: v.value, components: v.components, notes: [], faabAmount: amt });
    }
  }

  // roster status + cap hit of traded players and each team's current cap / roster
  const teamInputs: EvalTeamInput[] = teamIds.map((id) => ({ teamId: id, name: teamName.get(id) ?? id, outlook: outlooks[id] ?? "balanced" }));
  const extraWarnings: string[] = [];
  if (!input.free && input.withImpact !== false) {
    const dead = pre.dead;
    const spotBy = pre.spots;
    for (const a of assets) {
      if (a.type !== "PLAYER" || !a.player) continue;
      const sp = spotBy.get(a.player.id);
      if (!sp) continue;
      a.rosterStatus = sp.status === "IR" ? "IR" : "ACTIVE";
      a.fromStatus = sp.status === "IR" ? "IR" : sp.status === "TAXI" ? "TAXI" : "ACTIVE";
      if (!input.useSnapshots) {
        a.salary = sp.salary;
        a.contractYears = sp.contractYears;
      }
      // cap hit for the receiving team: taxi players arrive on the active roster; a retained share stays with the sender
      const full = a.salary ?? sp.salary;
      const kept = retainedAmount(full, a.retainPercent);
      const contractOf = (salary: number) => ({ salary, contractYears: a.contractYears ?? sp.contractYears, isRookieContract: sp.isRookieContract, player: sp.player });
      a.capHit = spotCapHit({ salary: full - kept, status: sp.status === "TAXI" ? "ACTIVE" : sp.status }, settings);
      a.fromCapHit = spotCapHit({ salary: full, status: sp.status }, settings) - kept;
      a.nextSeasonSalary = salaryNextSeason(contractOf(full - kept), settings);
      const fullNext = salaryNextSeason(contractOf(full), settings);
      a.fromNextSeasonSalary = fullNext - retainedAmount(fullNext, a.retainPercent);
    }
    // the league-wide rules for the phase, as checkTrade applies them: room is measured against the capLimit ceiling
    // while the cap blocks over-cap moves (tradeCapReference — the figure the builder's cap chips use), and roster
    // room against activeRosterLimit (the offseason limit until the cutdown deadline)
    const now = new Date();
    const capRef = tradeCapReference(settings, values.phase, { now });
    const nextCapRef = tradeCapReference(settings, values.phase, { now, cap: settings.salaryCap.cap + (settings.salaryCap.annualCapIncrease ?? 0) });
    const maxActive = activeRosterLimit(settings, { phase: values.phase, now });
    for (const t of teamInputs) {
      const mine = pre.spotsByTeam.get(t.teamId) ?? [];
      const d = dead.get(t.teamId) ?? { current: 0, next: 0 };
      t.cap = {
        enabled: settings.salaryCap.enabled,
        cap: capRef,
        committed: mine.reduce((a, s) => a + spotCapHit(s, settings), 0) + d.current,
        nextSeasonCommitted: mine.reduce((a, s) => a + salaryNextSeason(s, settings), 0) + d.next,
        nextSeasonCap: nextCapRef,
        limit: capLimit(settings),
        nextSeasonLimit: capLimit(settings, settings.salaryCap.cap + (settings.salaryCap.annualCapIncrease ?? 0)),
        limitLabel: capLimitLabel(settings),
      };
      t.roster = {
        active: mine.filter((s) => s.status !== "IR" && s.status !== "TAXI").length,
        maxActive,
        ir: mine.filter((s) => s.status === "IR").length,
        irSlots: settings.roster.irSlots,
      };
      const drops = (input.drops?.[t.teamId] ?? []).map((pid) => spotBy.get(pid)).filter((s): s is NonNullable<typeof s> => !!s && s.teamId === t.teamId);
      t.drops = drops.map((s) => {
        const dm = dropDeadMoney(s, settings, values.week, values.phase);
        return { capHit: spotCapHit(s, settings), deadMoney: dm.current, nextSeasonSalary: salaryNextSeason(s, settings), nextSeasonDead: dm.next, status: s.status };
      });
    }
    const w = tradeWindow(settings, values.phase, values.week);
    if (!w.open && w.reason) extraWarnings.push(w.reason);
  }
  const evaluation = evaluateTrade({ teams: teamInputs, assets, extraWarnings });
  return { ...evaluation, assets, mode: input.mode, outlooks };
}

/** Compact JSON snapshot stored on Trade.valuation when a trade completes */
export function valuationSnapshot(preview: TradePreview) {
  return {
    computedAt: new Date().toISOString(),
    mode: preview.mode,
    fairness: Math.round(preview.fairness * 1000) / 1000,
    verdict: preview.verdict,
    verdictTone: preview.verdictTone,
    favoredTeamId: preview.favoredTeamId,
    teams: preview.teams.map((t) => ({ teamId: t.teamId, name: t.name, outlook: t.outlook, received: round1(t.received), receivedRaw: round1(t.receivedRaw), sent: round1(t.sent), net: round1(t.net), consolidation: round1(t.consolidation), cap: t.cap ?? null, roster: t.roster ?? null })),
    assets: preview.assets.map((a) => ({ key: a.key, value: round1(a.value), components: a.components.map((c) => ({ key: c.key, label: c.label, value: round1(c.value), note: c.note ?? null })) })),
    warnings: preview.warnings,
  };
}

export type ValuationSnapshot = ReturnType<typeof valuationSnapshot>;

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
