// Rookie draft engine: create from DraftPick assets, apply order, make / undo / auto picks.
import type { Draft, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { resolveSettings } from "@/lib/settings/schema";
import { addPlayerToTeam, broadcastTransaction } from "@/lib/roster-ops";
import { activeRosterLimit, isTaxiEligible } from "@/lib/roster";
import { ensureDraftPicks } from "@/lib/picks";
import { postSystemMessage } from "@/lib/chat-system";
import { assignPickNumbers, autopickChain, pickFromSources, rookieSalary, roundPickLabel, skippedIndexes, undoRewindIndex } from "@/lib/draft/logic";
import { getAdpMap, isRookieFor, rookieDeadline, rookieEligibleWhere, rookieRules, leagueRosterSnapshot } from "@/lib/draft/data";
import { computeRookieOrder } from "@/lib/draft/order";
import { DraftError, audit, draftOrderIds, emit, fmtDuration, loadDraft, notifyLeague, notifyTeam, txWeekFor } from "@/lib/draft/shared";

const ROOKIE_URL = (id: string) => `/draft/rookie?id=${id}`;

/**
 * Does a drafted player start on the taxi squad? Only when the team's active roster is full — measured against the limit
 * every transaction path uses for the league phase (activeRosterLimit: roster.offseasonMaxActiveRoster outside the
 * season until the cutdown deadline) — and the taxi squad has room and he's taxi-eligible.
 */
export function rookieGoesToTaxi(
  snap: { active: number; taxi: number } | null | undefined,
  player: Parameters<typeof isTaxiEligible>[0],
  settings: LeagueSettings,
  opts: { phase: string | null | undefined; now?: Date },
): boolean {
  if (!snap) return false;
  return snap.active >= activeRosterLimit(settings, { phase: opts.phase, now: opts.now }) && snap.taxi < settings.roster.taxiSlots && isTaxiEligible(player, settings);
}

/** Create the rookie draft for `season` from the league's DraftPick assets, numbered from the computed order. */
export async function createRookieDraft(input: { leagueId: string; season: number; startTime: Date | null; actorId: string | null }): Promise<Draft> {
  const league = await db.league.findUniqueOrThrow({ where: { id: input.leagueId } });
  const settings = resolveSettings(league.settings);
  const existing = await db.draft.findFirst({ where: { leagueId: league.id, season: input.season, type: "ROOKIE" } });
  if (existing) throw new DraftError(`A ${input.season} rookie draft already exists.`);
  // make sure every team has its picks for this season (e.g. a new team, or a season beyond the tradable window)
  await ensureDraftPicks(league.id, input.season, { ...settings, trades: { ...settings.trades, futurePickYears: 1 } });
  const order = await computeRookieOrder(league.id, input.season, settings);
  const teamOrder = order.rows.map((r) => r.teamId);
  const draft = await db.draft.create({
    data: {
      leagueId: league.id,
      season: input.season,
      type: "ROOKIE",
      status: "SCHEDULED",
      name: `${input.season} Rookie Draft`,
      startTime: input.startTime,
      settings: { kind: "ROOKIE", orderMethod: settings.draft.rookie.orderMethod, teamOrder, manualOrder: false } as Prisma.InputJsonValue,
      order: [],
    },
  });
  await applyRookieOrder(draft.id, teamOrder, { manual: false, settings });
  await audit(league.id, input.actorId, "draft.create", draft.id, { type: "ROOKIE", season: input.season, teamOrder, basis: order.status });
  return db.draft.findUniqueOrThrow({ where: { id: draft.id } });
}

/** Number the draft's picks from a team slot order and store Draft.order (pick ids in overall order). */
export async function applyRookieOrder(draftId: string, teamOrder: string[], opts: { manual: boolean; settings?: LeagueSettings }) {
  const draft = await loadDraft(draftId);
  if (draft.type !== "ROOKIE") throw new DraftError("Not a rookie draft");
  const settings = opts.settings ?? draft.settingsResolved;
  const rules = rookieRules(draft, settings);
  const used = await db.draftSelection.count({ where: { draftId } });
  if (used > 0) throw new DraftError("Picks have already been made — undo them before changing the order.");
  const teams = await db.team.findMany({ where: { leagueId: draft.leagueId }, select: { id: true } });
  const valid = teamOrder.filter((id, i) => teams.some((t) => t.id === id) && teamOrder.indexOf(id) === i);
  const picks = await db.draftPick.findMany({ where: { leagueId: draft.leagueId, season: draft.season }, select: { id: true, round: true, originalTeamId: true, playerId: true } });
  if (picks.some((p) => p.playerId)) throw new DraftError(`Some ${draft.season} picks were already used.`);
  const numbered = assignPickNumbers(picks, valid, rules.style, rules.rounds);
  const fullOrder = [...valid, ...teams.map((t) => t.id).filter((id) => !valid.includes(id))];
  await db.$transaction([
    // clear numbering first (rounds beyond the configured count stay unnumbered)
    db.draftPick.updateMany({ where: { leagueId: draft.leagueId, season: draft.season }, data: { pickInRound: null, overall: null } }),
    ...numbered.map((p) => db.draftPick.update({ where: { id: p.id }, data: { pickInRound: p.pickInRound, overall: p.overall } })),
    db.draft.update({
      where: { id: draftId },
      data: {
        order: numbered.map((p) => p.id),
        currentIndex: 0,
        settings: { ...((draft.settings ?? {}) as Record<string, unknown>), teamOrder: fullOrder, manualOrder: opts.manual } as Prisma.InputJsonValue,
      },
    }),
  ]);
  emit(draftId, "draft.order");
}

export interface PickInput {
  draftId: string;
  playerId: string;
  /** team the actor manages (null for commissioners without a team / the clock) */
  actorTeamId: string | null;
  actorId: string | null;
  isCommish: boolean;
  /** clock autopick */
  system?: boolean;
  /** guard against double submits: the pick index the client saw */
  expectedIndex?: number;
  isAutopick?: boolean;
  /** make up a skipped pick (settings.draft.rookie.onTimeout = SKIP) instead of the pick on the clock */
  pickId?: string | null;
}

/** Pick ids that already have a selection in this draft. */
async function usedPickIds(draftId: string): Promise<Set<string>> {
  const rows = await db.draftSelection.findMany({ where: { draftId }, select: { pickId: true } });
  return new Set(rows.map((r) => r.pickId).filter((x): x is string => !!x));
}

/**
 * Make the current pick (or a skipped one). Concurrency-safe: the draft row's currentIndex is advanced with a
 * conditional update, a pick asset can only be used once (conditional update on DraftPick.playerId) and
 * DraftSelection is unique per (draft, overall) and (draft, player).
 */
export async function makeRookiePick(input: PickInput) {
  const now = new Date();
  const draft = await loadDraft(input.draftId);
  if (draft.type !== "ROOKIE") throw new DraftError("Not a rookie draft");
  if (draft.status !== "LIVE") throw new DraftError(draft.status === "PAUSED" ? "The draft is paused." : "The draft is not live.");
  const settings = draft.settingsResolved;
  const rules = rookieRules(draft, settings);
  const order = draftOrderIds(draft);
  const idx = draft.currentIndex;
  const skipped = skippedIndexes(order, idx, await usedPickIds(draft.id));
  let pickIndex = idx;
  if (input.pickId && input.pickId !== order[idx]) {
    pickIndex = order.indexOf(input.pickId);
    if (pickIndex < 0 || !skipped.includes(pickIndex)) throw new DraftError("That pick can't be used right now — the board has been refreshed.");
  } else {
    if (input.expectedIndex !== undefined && input.expectedIndex !== idx) throw new DraftError("That pick was already made — the board has been refreshed.");
    if (!order[idx]) throw new DraftError(skipped.length ? "Only skipped picks are left — make one of those." : "The draft has no pick on the clock.");
  }
  const makeUp = pickIndex !== idx;
  const pickId = order[pickIndex];
  const pick = await db.draftPick.findUniqueOrThrow({ where: { id: pickId }, include: { ownerTeam: true, originalTeam: true } });
  if (!input.system && !input.isCommish && input.actorTeamId !== pick.ownerTeamId) throw new DraftError(makeUp ? "That skipped pick belongs to another team." : "You're not on the clock.");

  const player = await db.player.findFirst({ where: { id: input.playerId, ...rookieEligibleWhere(draft.leagueId, draft.season, settings, rules.eligibility) } });
  if (!player) throw new DraftError("That player isn't available in this draft.");
  const already = await db.draftSelection.findUnique({ where: { draftId_playerId: { draftId: draft.id, playerId: player.id } } });
  if (already) throw new DraftError(`${player.fullName} has already been drafted.`);

  const pickInRound = pick.pickInRound ?? pickIndex + 1;
  const overall = pick.overall ?? pickIndex + 1;
  const salary = rookieSalary(settings.contracts.rookieScale, pick.round, pickInRound, settings.salaryCap.minSalary);
  const rookie = isRookieFor(player, draft.season);
  const years = rookie ? settings.contracts.rookieContractYears : settings.contracts.defaultFreeAgentYears;
  const snap = (await leagueRosterSnapshot(draft.leagueId, draft.season, settings, { leagueSeason: draft.league.season })).get(pick.ownerTeamId);
  const toTaxi = rookieGoesToTaxi(snap, player, settings, { phase: draft.league.phase, now });
  const nextIdx = makeUp ? idx : idx + 1;
  const skippedLeft = makeUp ? skipped.length - 1 : skipped.length;
  const complete = nextIdx >= order.length && skippedLeft === 0;
  const deadline = makeUp ? draft.pickDeadline : nextIdx >= order.length ? null : rookieDeadline(now, rules, settings);
  const week = await txWeekFor(draft.league, draft.season);
  const label = `${draft.season} ${roundPickLabel(pick.round, pickInRound)}`;

  const result = await db.$transaction(async (tx) => {
    const upd = await tx.draft.updateMany({
      where: { id: draft.id, status: "LIVE", currentIndex: idx },
      data: { currentIndex: nextIdx, pickDeadline: deadline, ...(complete ? { status: "COMPLETE", completedAt: now, pickDeadline: null } : {}) },
    });
    if (upd.count !== 1) throw new DraftError("That pick was just made — the board has been refreshed.");
    const used = await tx.draftPick.updateMany({ where: { id: pick.id, playerId: null }, data: { playerId: player.id, usedAt: now } });
    if (used.count !== 1) throw new DraftError("That pick was just used — the board has been refreshed.");
    const selection = await tx.draftSelection.create({
      data: {
        draftId: draft.id, pickId: pick.id, teamId: pick.ownerTeamId, playerId: player.id, round: pick.round, pickInRound, overall,
        salary, contractYears: years, isAutopick: !!input.isAutopick, madeAt: now,
      },
    });
    const { transaction } = await addPlayerToTeam(tx, {
      leagueId: draft.leagueId,
      teamId: pick.ownerTeamId,
      playerId: player.id,
      season: draft.season,
      week,
      salary,
      contractYears: years,
      via: "ROOKIE_DRAFT",
      status: toTaxi ? "TAXI" : "ACTIVE",
      isRookieContract: rookie,
      actorId: input.actorId,
      txType: "ROOKIE_DRAFT",
      description: `Drafted ${player.fullName} (${player.position}${player.team ? " " + player.team : ""}) with pick ${label}${input.isAutopick ? " (autopick)" : ""} — $${salary}, ${years} yr${years === 1 ? "" : "s"}${toTaxi ? " · taxi squad" : ""}`,
      details: { draftId: draft.id, pickId: pick.id, overall, round: pick.round, pickInRound, autopick: !!input.isAutopick },
    });
    return { selection, transaction };
  });

  broadcastTransaction(draft.leagueId, result.transaction);
  emit(draft.id, "draft.pick", {
    overall, round: pick.round, pickInRound, teamId: pick.ownerTeamId, playerId: player.id, playerName: player.fullName, isAutopick: !!input.isAutopick,
    message: `${label}: ${pick.ownerTeam.name} select ${player.fullName}`,
  });
  const via = pick.originalTeamId !== pick.ownerTeamId ? ` (via ${pick.originalTeam.name})` : "";
  void postSystemMessage(
    draft.leagueId,
    `${label}${via}: ${pick.ownerTeam.name} select ${player.fullName} (${player.position}${player.college ? ", " + player.college : ""}${player.team ? " · " + player.team : ""})${input.isAutopick ? " — autopick" : ""}${makeUp ? " — skipped pick made up" : ""}`,
    { channel: "general", kind: "SYSTEM", data: { draftId: draft.id, playerId: player.id, teamId: pick.ownerTeamId } },
  ).catch(() => {});
  if (input.isCommish && !input.system && input.actorTeamId !== pick.ownerTeamId) {
    await audit(draft.leagueId, input.actorId, "draft.pick_on_behalf", draft.id, { pickId: pick.id, teamId: pick.ownerTeamId, playerId: player.id, makeUp });
  }
  if (complete) {
    emit(draft.id, "draft.status", { status: "COMPLETE", message: `${draft.name} is complete` });
    void postSystemMessage(draft.leagueId, `The ${draft.name} is complete. Full results: /draft/results?id=${draft.id}`, { channel: "general" }).catch(() => {});
  } else if (!makeUp) {
    if (nextIdx < order.length) await announceOnClock(draft.id);
    else await announceSkippedOnly(draft.id);
  }
  return { selection: result.selection, player, complete };
}

/** The regular order is done but skipped picks remain: tell their owners (the draft stays live without a clock). */
async function announceSkippedOnly(draftId: string) {
  const d = await db.draft.findUnique({ where: { id: draftId } });
  if (!d || d.status !== "LIVE") return;
  const order = draftOrderIds(d);
  const left = skippedIndexes(order, d.currentIndex, await usedPickIds(d.id));
  emit(d.id, "draft.clock", { currentIndex: d.currentIndex, teamId: null, deadline: null, message: `${left.length} skipped pick${left.length === 1 ? "" : "s"} left to make` });
  const picks = await db.draftPick.findMany({ where: { id: { in: left.map((i) => order[i]) } } });
  for (const teamId of new Set(picks.map((p) => p.ownerTeamId))) {
    notifyTeam(teamId, d.leagueId, "DRAFT_ON_CLOCK", "Make your skipped pick", `Every other pick in the ${d.name} is in — make your skipped pick to finish the draft.`, ROOKIE_URL(d.id));
  }
}

/** Publish the clock and notify the team now on the clock. */
export async function announceOnClock(draftId: string) {
  const d = await db.draft.findUnique({ where: { id: draftId } });
  if (!d || d.status !== "LIVE") return;
  const pickId = draftOrderIds(d)[d.currentIndex];
  if (!pickId) return;
  const pick = await db.draftPick.findUnique({ where: { id: pickId } });
  if (!pick) return;
  emit(d.id, "draft.clock", { currentIndex: d.currentIndex, teamId: pick.ownerTeamId, deadline: d.pickDeadline?.toISOString() ?? null });
  const label = `${d.season} ${roundPickLabel(pick.round, pick.pickInRound)}`;
  const timeLeft = d.pickDeadline ? ` You have ${fmtDuration(d.pickDeadline.getTime() - Date.now())} to pick.` : "";
  notifyTeam(pick.ownerTeamId, d.leagueId, "DRAFT_ON_CLOCK", "You're on the clock!", `Pick ${label} in the ${d.name}.${timeLeft}`, ROOKIE_URL(d.id));
}

/** Commissioner: take back the most recent pick (roster spot, transaction, pick usage). */
export async function undoLastRookiePick(draftId: string, actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.type !== "ROOKIE") throw new DraftError("Not a rookie draft");
  const sels = await db.draftSelection.findMany({ where: { draftId }, orderBy: [{ madeAt: "desc" }, { overall: "desc" }], include: { player: true } });
  const last = sels[0];
  if (!last) throw new DraftError("There are no picks to undo.");
  const settings = draft.settingsResolved;
  const rules = rookieRules(draft, settings);
  const order = draftOrderIds(draft);
  const idx = last.pickId ? order.indexOf(last.pickId) : last.overall - 1;
  const otherIdx = sels.slice(1).map((s) => (s.pickId ? order.indexOf(s.pickId) : s.overall - 1));
  const rewind = undoRewindIndex(Math.max(0, idx), draft.currentIndex, otherIdx);
  const spot = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: draft.leagueId, playerId: last.playerId } } });
  if (spot && spot.teamId !== last.teamId) throw new DraftError(`${last.player.fullName} has since moved to another team — fix the roster manually first.`);
  const now = new Date();
  const status = draft.status === "COMPLETE" ? "PAUSED" : draft.status;
  const full = rules.pickTimerMinutes > 0 ? rules.pickTimerMinutes * 60_000 : null;
  const onClock = rewind < order.length;
  const pickDeadline = status !== "LIVE" || !onClock ? null : rewind === draft.currentIndex ? draft.pickDeadline : rookieDeadline(now, rules, settings);
  await db.$transaction(async (tx) => {
    if (spot) {
      await tx.lineupSlot.updateMany({ where: { teamId: last.teamId, playerId: last.playerId }, data: { playerId: null } });
      await tx.rosterSpot.delete({ where: { id: spot.id } });
    }
    await tx.transaction.deleteMany({ where: { leagueId: draft.leagueId, type: "ROOKIE_DRAFT", playerId: last.playerId, teamId: last.teamId, details: { path: ["draftId"], equals: draftId } } });
    if (last.pickId) await tx.draftPick.update({ where: { id: last.pickId }, data: { playerId: null, usedAt: null } });
    await tx.draftSelection.delete({ where: { id: last.id } });
    await tx.draft.update({
      where: { id: draftId },
      data: {
        currentIndex: rewind,
        status,
        completedAt: null,
        pickDeadline,
        settings: { ...((draft.settings ?? {}) as Record<string, unknown>), pausedRemainingMs: status === "PAUSED" ? (onClock ? full : null) : null } as Prisma.InputJsonValue,
      },
    });
  });
  await audit(draft.leagueId, actorId, "draft.undo_pick", draftId, { overall: last.overall, playerId: last.playerId, teamId: last.teamId });
  emit(draftId, "draft.undo", { message: `Pick #${last.overall} (${last.player.fullName}) was undone by the commissioner` });
  if (status === "LIVE" && onClock && rewind !== draft.currentIndex) await announceOnClock(draftId);
  return last;
}

/** Ordered candidate lists for an autopick, per settings.draft.rookie.autopickSource. */
export async function autopickCandidates(draft: Draft, teamId: string, settings: LeagueSettings): Promise<{ available: Set<string>; sources: string[][] }> {
  const rules = rookieRules(draft, settings);
  const [eligible, queue, board, rankings, adp] = await Promise.all([
    db.player.findMany({ where: rookieEligibleWhere(draft.leagueId, draft.season, settings, rules.eligibility), select: { id: true, searchRank: true } }),
    db.draftQueueEntry.findMany({ where: { draftId: draft.id, teamId }, orderBy: { rank: "asc" }, select: { playerId: true } }),
    db.bigBoardEntry.findMany({ where: { teamId, classYear: draft.season }, orderBy: { rank: "asc" }, select: { playerId: true } }),
    db.rookieRanking.findMany({ where: { leagueId: draft.leagueId, classYear: { in: [draft.season, draft.season - 1] }, playerId: { not: null } }, orderBy: [{ classYear: "desc" }, { rank: "asc" }], select: { playerId: true } }),
    getAdpMap(draft.season),
  ]);
  const available = new Set(eligible.map((p) => p.id));
  const byAdp = [...eligible].sort((a, b) => (adp.get(a.id) ?? 9999) - (adp.get(b.id) ?? 9999) || (a.searchRank ?? 9_999_999) - (b.searchRank ?? 9_999_999)).map((p) => p.id);
  const lists: Record<string, string[]> = {
    QUEUE: queue.map((q) => q.playerId),
    BIG_BOARD: board.map((b) => b.playerId),
    LEAGUE_RANKINGS: rankings.map((r) => r.playerId!),
    ADP: byAdp,
  };
  return { available, sources: autopickChain(rules.autopickSource).map((k) => lists[k]) };
}

/**
 * Clock: the team on the clock ran out of time. Autopick (settings.draft.rookie.onTimeout = AUTOPICK), or
 * skip the pick and move on (SKIP — the team can still make it later). Returns a status string or null.
 */
export async function autopickExpired(draftId: string, now = new Date()): Promise<string | null> {
  const draft = await db.draft.findUnique({ where: { id: draftId }, include: { league: true } });
  if (!draft || draft.type !== "ROOKIE" || draft.status !== "LIVE" || !draft.pickDeadline || draft.pickDeadline > now) return null;
  const order = draftOrderIds(draft);
  const pickId = order[draft.currentIndex];
  if (!pickId) return null;
  const pick = await db.draftPick.findUnique({ where: { id: pickId }, include: { ownerTeam: { select: { name: true } } } });
  if (!pick) return null;
  const settings = resolveSettings(draft.league.settings);
  const rules = rookieRules(draft, settings);
  if (rules.onTimeout === "SKIP") {
    const nextIdx = draft.currentIndex + 1;
    const deadline = nextIdx < order.length ? rookieDeadline(now, rules, settings) : null;
    const upd = await db.draft.updateMany({
      where: { id: draft.id, status: "LIVE", currentIndex: draft.currentIndex, pickDeadline: { lte: now } },
      data: { currentIndex: nextIdx, pickDeadline: deadline },
    });
    if (!upd.count) return null; // another tick or a manager beat us to it
    const label = `${draft.season} ${roundPickLabel(pick.round, pick.pickInRound)}`;
    emit(draft.id, "draft.clock", { currentIndex: nextIdx, teamId: null, deadline: deadline?.toISOString() ?? null, message: `${label}: ${pick.ownerTeam.name} ran out of time — pick skipped` });
    void postSystemMessage(draft.leagueId, `${label}: ${pick.ownerTeam.name} ran out of time. The pick is skipped and can still be made while the draft is live.`, { channel: "general", kind: "SYSTEM", data: { draftId: draft.id } }).catch(() => {});
    notifyTeam(pick.ownerTeamId, draft.leagueId, "DRAFT_ON_CLOCK", "Your pick was skipped", `Time ran out on pick ${label}. You can still make it any time while the ${draft.name} is live.`, ROOKIE_URL(draft.id));
    if (nextIdx < order.length) await announceOnClock(draft.id);
    else await announceSkippedOnly(draft.id);
    return `skipped ${label}`;
  }
  const { available, sources } = await autopickCandidates(draft, pick.ownerTeamId, settings);
  const choice = pickFromSources(sources, available);
  if (!choice) {
    // nobody left to draft: finish the draft (remaining picks go unused)
    const upd = await db.draft.updateMany({ where: { id: draft.id, status: "LIVE", currentIndex: draft.currentIndex }, data: { status: "COMPLETE", completedAt: now, pickDeadline: null } });
    if (upd.count) emit(draft.id, "draft.status", { status: "COMPLETE", message: "No eligible players remain — the draft is complete" });
    return `draft ${draft.id}: no eligible players, completed`;
  }
  try {
    const r = await makeRookiePick({ draftId: draft.id, playerId: choice, actorTeamId: null, actorId: null, isCommish: false, system: true, expectedIndex: draft.currentIndex, isAutopick: true });
    return `autopick ${r.player.fullName}`;
  } catch (e) {
    if (e instanceof DraftError) return null; // another tick or a manager beat us to it
    throw e;
  }
}

export function notifyDraftLive(draft: Pick<Draft, "id" | "leagueId" | "name" | "type">) {
  notifyLeague(draft.leagueId, "DRAFT_PICK", `${draft.name} is live`, draft.type === "AUCTION" ? "Bidding is open — join the auction room." : "The draft room is open. Good luck!", draft.type === "AUCTION" ? `/draft/auction?id=${draft.id}` : ROOKIE_URL(draft.id));
}
