// Trade execution: complete (one DB transaction), reverse, veto/cancel/expire, conflict cleanup and the
// league-wide side effects (notifications, chat posts, live events). Safe to import from background jobs.
import type { AcquisitionType, Prisma, TradeStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { addPlayerToTeam, adjustFaab, broadcastTransaction, dropPlayerFromTeam, movePlayer } from "@/lib/roster-ops";
import { leagueUserIds, notify, teamUserIds, type NotificationType } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { invalidateLeagueValues } from "@/lib/value/context";
import { evaluateTradeInput, valuationSnapshot } from "@/lib/trades/evaluate";
import { onlyPickLocks, validateTrade, type Tx } from "@/lib/trades/validate";
import { listJoin, retentionDeadMoney, retainedAmount, reviewRoute, tradeHasStaleAssets, tradeSummaryFor, type AssetRef, type ReviewRoute } from "@/lib/trades/rules";

export class TradeError extends Error {
  constructor(
    message: string,
    readonly code?: ExecCode,
  ) {
    super(message);
  }
}

export interface LeagueState {
  leagueId: string;
  season: number;
  phase: string;
  week: number;
  settings: LeagueSettings;
  name: string;
}

export async function leagueState(leagueId: string): Promise<LeagueState> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const nfl = await getNflState();
  return { leagueId, season: league.season, phase: league.phase, week: leagueWeekFor(league, settings, nfl), settings, name: league.name };
}

const tradeInclude = {
  teams: { include: { team: { select: { id: true, name: true, abbrev: true } } } },
  assets: { include: { player: { select: { id: true, fullName: true, position: true, team: true } }, pick: true } },
} satisfies Prisma.TradeInclude;

type LoadedTrade = Prisma.TradeGetPayload<{ include: typeof tradeInclude }>;

export async function loadTrade(tradeId: string): Promise<LoadedTrade | null> {
  return db.trade.findUnique({ where: { id: tradeId }, include: tradeInclude });
}

/** Negotiated terms stored on Trade.valuation while the trade is open (kept after completion). */
export interface TradeTerms {
  /** playerId → % of his salary the sending team keeps paying */
  retention?: Record<string, number>;
}

export function tradeTerms(valuation: unknown): TradeTerms {
  const t = (valuation as { terms?: TradeTerms } | null)?.terms;
  return t && typeof t === "object" ? t : {};
}

export function tradeAssetRefs(trade: {
  assets: { type: string; playerId: string | null; pickId: string | null; faabAmount: number | null; fromTeamId: string; toTeamId: string }[];
  valuation: unknown;
}): AssetRef[] {
  const retention = tradeTerms(trade.valuation).retention ?? {};
  return trade.assets.map((a) => ({
    type: a.type as AssetRef["type"],
    playerId: a.playerId,
    pickId: a.pickId,
    faabAmount: a.faabAmount,
    fromTeamId: a.fromTeamId,
    toTeamId: a.toTeamId,
    retainPercent: a.playerId ? retention[a.playerId] ?? null : null,
  }));
}

function assetText(a: LoadedTrade["assets"][number], retention: Record<string, number> = {}): string {
  const pct = a.playerId ? retention[a.playerId] ?? 0 : 0;
  if (a.type === "PLAYER" && a.player) return `${a.player.fullName} (${a.player.position}${a.player.team ? " " + a.player.team : ""}${pct ? `, ${pct}% of salary retained` : ""})`;
  return a.label ?? (a.type === "FAAB" ? `$${a.faabAmount} FAB` : "Draft pick");
}

/** Plain-language summary: "Concussion Protocol gets A and B · Helmet to Helmet gets C" */
export function tradeHeadline(trade: LoadedTrade): string {
  return trade.teams
    .map((tt) => {
      const retention = tradeTerms(trade.valuation).retention ?? {};
      const got = trade.assets.filter((a) => a.toTeamId === tt.teamId).map((a) => assetText(a, retention));
      return `${tt.team.name} gets ${listJoin(got)}`;
    })
    .join(" · ");
}

export async function commissionerUserIds(leagueId: string): Promise<string[]> {
  const m = await db.leagueMember.findMany({ where: { leagueId, role: { in: ["COMMISSIONER", "CO_COMMISSIONER"] } }, select: { userId: true } });
  return m.map((x) => x.userId);
}

/** Teams managed by the league commissioner (role COMMISSIONER) — for settings.trades.commissionerTradesReviewedBy. */
export async function commissionerTeamIds(leagueId: string): Promise<Set<string>> {
  const members = await db.leagueMember.findMany({ where: { leagueId, role: "COMMISSIONER" }, select: { userId: true, teamId: true } });
  const ids = new Set(members.map((m) => m.teamId).filter((x): x is string => !!x));
  if (members.length) {
    const owned = await db.team.findMany({ where: { leagueId, ownerId: { in: members.map((m) => m.userId) } }, select: { id: true } });
    for (const t of owned) ids.add(t.id);
  }
  return ids;
}

/** Who reviews this trade once every team accepts (league review type, or the commissioner-trade override). */
export async function reviewRouteForTrade(trade: { leagueId: string; teams: { teamId: string }[] }, settings: LeagueSettings): Promise<ReviewRoute> {
  const override = settings.trades.commissionerTradesReviewedBy;
  if (!override || override === "NONE") return reviewRoute(settings, false);
  const commish = await commissionerTeamIds(trade.leagueId);
  return reviewRoute(settings, trade.teams.some((t) => commish.has(t.teamId)));
}

export async function tradeUserIds(trade: Pick<LoadedTrade, "teams">, exceptTeamIds: string[] = []): Promise<string[]> {
  const ids = await Promise.all(trade.teams.filter((t) => !exceptTeamIds.includes(t.teamId)).map((t) => teamUserIds(t.teamId)));
  return [...new Set(ids.flat())];
}

export function publishTradeEvent(leagueId: string, tradeId: string, status: string) {
  publish(topics.league(leagueId), "trade.update", { tradeId, status });
}

async function safeNotify(input: Parameters<typeof notify>[0]) {
  try {
    await notify(input);
  } catch (e) {
    console.error("[trades] notify failed", e);
  }
}

/** Week to clear lineups from: if the player's game this week has kicked off, his old team keeps this week. */
async function lineupWeeks(state: LeagueState, nflTeams: (string | null)[]): Promise<Map<string, number>> {
  const teams = [...new Set(nflTeams.filter((t): t is string => !!t))];
  const out = new Map<string, number>();
  if (!teams.length || !(state.phase === "REGULAR" || state.phase === "PLAYOFFS")) return out;
  const games = await db.nflGame.findMany({ where: { season: state.season, week: state.week, OR: [{ homeTeam: { in: teams } }, { awayTeam: { in: teams } }] } });
  const now = Date.now();
  for (const g of games) {
    const started = g.startTime.getTime() <= now || g.state !== "pre";
    for (const t of [g.homeTeam, g.awayTeam]) if (teams.includes(t) && started) out.set(t, state.week + 1);
  }
  return out;
}

export interface ExecutionLog {
  completedWeek: number;
  /** roster spot details before each player moved (restored on reversal) */
  moves?: {
    playerId: string;
    fromTeamId: string;
    status: string;
    acquiredVia: string;
    acquiredAt: string;
    lineupSlotIds: string[];
    /** salary retention: the full salary before the move and the sender's dead money rows */
    retained?: { salary: number; percent: number; deadMoney: { teamId: string; season: number; amount: number }[] };
  }[];
  drops: { teamId: string; playerId: string; fullName: string; salary: number; contractYears: number; status: string; isRookieContract: boolean; deadMoney: { teamId: string; season: number; amount: number }[] }[];
}

export interface CompleteOptions {
  actorId?: string | null;
  /** commissioner who approved (stored on the trade) */
  resolvedById?: string | null;
  note?: string | null;
  /** commissioner force: complete even if not everyone accepted / still in review */
  force?: boolean;
  /** commissioner force: skip roster-limit and cap checks */
  skipRosterChecks?: boolean;
}

/**
 * Codes for trades that can't be processed yet but should wait rather than fail:
 *   LOCKED       — settings.trades.lockedPlayersPolicy = BLOCK and a player's game this week has started (retry next week)
 *   DRAFT_LOCKED — a pick in the trade belongs to a rookie draft that is under way and
 *                  settings.draft.rookie.tradingDuringDraft is off (retry once the draft is over)
 */
export type ExecCode = "LOCKED" | "DRAFT_LOCKED";
export type ExecResult = { ok: true; message?: string } | { ok: false; error: string; code?: ExecCode };

/** Complete a trade atomically. Guards against double completion with a status claim inside the transaction. */
export async function completeTrade(tradeId: string, opts: CompleteOptions = {}): Promise<ExecResult> {
  const trade = await loadTrade(tradeId);
  if (!trade) return { ok: false, error: "Trade not found." };
  const allowed: TradeStatus[] = opts.force ? ["PROPOSED", "ACCEPTED"] : trade.teams.every((t) => t.accepted) ? ["PROPOSED", "ACCEPTED"] : ["ACCEPTED"];
  if (!allowed.includes(trade.status)) return { ok: false, error: `This trade is ${trade.status.toLowerCase()} and can't be processed.` };
  const state = await leagueState(trade.leagueId);
  const refs = tradeAssetRefs(trade);
  const terms = tradeTerms(trade.valuation);
  const retention = terms.retention ?? {};
  const drops: Record<string, string[]> = Object.fromEntries(trade.teams.map((t) => [t.teamId, t.dropPlayerIds]));
  const teamIds = trade.teams.map((t) => t.teamId);

  let snapshot: ReturnType<typeof valuationSnapshot> | null = null;
  try {
    snapshot = valuationSnapshot(await evaluateTradeInput(trade.leagueId, { teamIds, assets: refs, drops, mode: "auto" }));
  } catch (e) {
    console.error("[trades] valuation snapshot failed", e);
  }
  const weeks = await lineupWeeks(state, [...trade.assets.map((a) => a.player?.team ?? null)]);
  const dropPlayers = await db.rosterSpot.findMany({ where: { leagueId: trade.leagueId, playerId: { in: Object.values(drops).flat() } }, include: { player: { select: { team: true, fullName: true } } } });
  const dropWeeks = await lineupWeeks(state, dropPlayers.map((d) => d.player.team));
  if (state.settings.trades.lockedPlayersPolicy === "BLOCK" && !opts.force) {
    const locked = [
      ...trade.assets.filter((a) => a.type === "PLAYER" && a.player?.team && weeks.has(a.player.team)).map((a) => a.player!.fullName),
      ...dropPlayers.filter((d) => d.player.team && dropWeeks.has(d.player.team)).map((d) => d.player.fullName),
    ];
    if (locked.length)
      return { ok: false, code: "LOCKED", error: `${listJoin(locked)} ${locked.length === 1 ? "has" : "have"} already played in week ${state.week}. League rules hold this trade until the week is over.` };
  }
  const createdTx: { id: string; description: string; type: string; teamId: string | null }[] = [];
  const now = new Date();

  try {
    await db.$transaction(
      async (tx) => {
        const claim = await tx.trade.updateMany({ where: { id: tradeId, status: { in: allowed } }, data: { status: "COMPLETED", completedAt: now } });
        if (claim.count !== 1) throw new TradeError("This trade was already processed.");
        // league-state locks apply when the trade is processed too (a commissioner force skips them): a pick of a
        // rookie draft that is under way can't change hands mid-draft, and a team knocked out of the playoffs can't
        // complete a trade when playoffs.eliminatedTeamsCanTransact is off
        const check = await validateTrade(
          tx,
          state,
          { teamIds, assets: refs, drops },
          { checkWindow: false, checkLocks: !opts.force, strictTeams: "all", skipRosterChecks: opts.skipRosterChecks },
        );
        if (check.errors.length) throw new TradeError(check.errors.join(" "), onlyPickLocks(check) ? "DRAFT_LOCKED" : undefined);

        const log: ExecutionLog = { completedWeek: state.week, drops: [], moves: [] };
        for (const a of trade.assets) {
          if (a.type === "PLAYER" && a.playerId) {
            const fromWeek = weeks.get(a.player?.team ?? "") ?? state.week;
            const before = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: a.playerId } }, include: { player: { select: { yearsExp: true } } } });
            const slots = await tx.lineupSlot.findMany({ where: { teamId: a.fromTeamId, playerId: a.playerId, season: state.season, week: { gte: fromWeek } }, select: { id: true } });
            const move: NonNullable<ExecutionLog["moves"]>[number] | null = before
              ? { playerId: a.playerId, fromTeamId: a.fromTeamId, status: before.status, acquiredVia: before.acquiredVia, acquiredAt: before.acquiredAt.toISOString(), lineupSlotIds: slots.map((x) => x.id) }
              : null;
            const moved = await movePlayer(tx, { leagueId: trade.leagueId, playerId: a.playerId, toTeamId: a.toTeamId, season: state.season, week: fromWeek });
            const pct = retention[a.playerId] ?? 0;
            if (before && move && pct > 0) {
              // salary retention: the receiving team pays the rest; the sender carries the retained share as dead money
              const dead = retentionDeadMoney(before, pct, state.settings, state.season, a.fromTeamId);
              await tx.rosterSpot.update({ where: { id: moved.id }, data: { salary: before.salary - retainedAmount(before.salary, pct) } });
              const st = await tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: a.playerId } } });
              const prevDead = (st?.deadCap as { teamId: string; season: number; amount: number }[] | null) ?? [];
              await tx.leaguePlayerState.upsert({
                where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: a.playerId } },
                create: { leagueId: trade.leagueId, playerId: a.playerId, deadCap: dead as Prisma.InputJsonValue },
                update: { deadCap: [...prevDead, ...dead] as Prisma.InputJsonValue },
              });
              move.retained = { salary: before.salary, percent: pct, deadMoney: dead };
            }
            if (move) log.moves!.push(move);
          } else if (a.type === "PICK" && a.pickId) {
            await tx.draftPick.update({ where: { id: a.pickId }, data: { ownerTeamId: a.toTeamId } });
          } else if (a.type === "FAAB" && a.faabAmount) {
            await adjustFaab(tx, { leagueId: trade.leagueId, teamId: a.fromTeamId, season: state.season, amount: -a.faabAmount, reason: "TRADE", refType: "trade", refId: trade.id });
            await adjustFaab(tx, { leagueId: trade.leagueId, teamId: a.toTeamId, season: state.season, amount: a.faabAmount, reason: "TRADE", refType: "trade", refId: trade.id });
          }
        }
        for (const tt of trade.teams) {
          for (const pid of tt.dropPlayerIds) {
            const sp = dropPlayers.find((d) => d.playerId === pid);
            const res = await dropPlayerFromTeam(tx, {
              leagueId: trade.leagueId,
              teamId: tt.teamId,
              playerId: pid,
              season: state.season,
              week: dropWeeks.get(sp?.player.team ?? "") ?? state.week,
              settings: state.settings,
              phase: state.phase,
              actorId: opts.actorId ?? null,
              description: `Dropped ${sp?.player.fullName ?? "player"} to make room for a trade`,
            });
            createdTx.push(res.transaction);
            log.drops.push({
              teamId: tt.teamId,
              playerId: pid,
              fullName: res.spot.player.fullName,
              salary: res.spot.salary,
              contractYears: res.spot.contractYears,
              status: res.spot.status,
              isRookieContract: res.spot.isRookieContract,
              deadMoney: res.deadMoney,
            });
          }
        }
        for (const tt of trade.teams) {
          const others = trade.teams.filter((o) => o.teamId !== tt.teamId);
          const sum = tradeSummaryFor(tt.teamId, trade.assets.map((a) => ({ fromTeamId: a.fromTeamId, toTeamId: a.toTeamId, label: assetText(a, retention) })));
          const firstPlayer = trade.assets.find((a) => a.toTeamId === tt.teamId && a.type === "PLAYER");
          const t = await tx.transaction.create({
            data: {
              leagueId: trade.leagueId,
              season: state.season,
              week: state.week,
              type: "TRADE",
              teamId: tt.teamId,
              relatedTeamId: others[0]?.teamId ?? null,
              playerId: firstPlayer?.playerId ?? null,
              tradeId: trade.id,
              faabAmount: trade.assets.filter((a) => a.type === "FAAB" && a.toTeamId === tt.teamId).reduce((x, a) => x + (a.faabAmount ?? 0), 0) || null,
              description: `Traded with ${listJoin(others.map((o) => o.team.name))}: received ${listJoin(sum.received)}${sum.sent.length ? `; sent ${listJoin(sum.sent)}` : ""}`,
              details: { tradeId: trade.id, received: sum.received, sent: sum.sent } as Prisma.InputJsonValue,
              createdById: opts.actorId ?? null,
            },
          });
          createdTx.push(t);
        }
        const movedPlayers = trade.assets.filter((a) => a.type === "PLAYER" && a.playerId).map((a) => a.playerId!);
        const movedPicks = trade.assets.filter((a) => a.type === "PICK" && a.pickId).map((a) => a.pickId!);
        const dropped = trade.teams.flatMap((t) => t.dropPlayerIds);
        await tx.tradeBlockEntry.deleteMany({ where: { leagueId: trade.leagueId, OR: [{ playerId: { in: [...movedPlayers, ...dropped] } }, { pickId: { in: movedPicks } }] } });
        await tx.trade.update({
          where: { id: trade.id },
          data: {
            acceptedAt: trade.acceptedAt ?? now,
            resolvedById: opts.resolvedById ?? null,
            resolutionNote: opts.note ?? null,
            valuation: { ...(snapshot ?? {}), terms, execution: log } as unknown as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof TradeError) return e.code ? { ok: false, error: e.message, code: e.code } : { ok: false, error: e.message };
    console.error("[trades] completeTrade failed", e);
    return { ok: false, error: "The trade could not be processed. Please try again." };
  }

  invalidateLeagueValues(trade.leagueId);
  for (const t of createdTx) broadcastTransaction(trade.leagueId, t);
  publishTradeEvent(trade.leagueId, trade.id, "COMPLETED");
  await afterTradeCompleted(trade, state);
  return { ok: true, message: "Trade processed." };
}

async function afterTradeCompleted(trade: LoadedTrade, state: LeagueState) {
  const headline = tradeHeadline(trade);
  await cancelStaleTrades(trade.leagueId, { exceptTradeId: trade.id, reason: "an asset in the offer was traded" });
  if (state.settings.notifications.tradeAlertsToLeague) {
    for (const channel of ["transactions", "trades"]) {
      await postSystemMessage(trade.leagueId, `Trade completed: ${headline}`, { channel, kind: "TRADE", data: { tradeId: trade.id, url: `/trades/${trade.id}` } }).catch((e) => console.error("[trades] chat post failed", e));
    }
  }
  await safeNotify({ userIds: await leagueUserIds(trade.leagueId), leagueId: trade.leagueId, type: "TRADE_COMPLETED", title: "Trade completed", body: headline, url: `/trades/${trade.id}`, data: { tradeId: trade.id } });
}

/**
 * Cancel open trades whose assets are no longer valid (players/picks moved, FAB spent).
 * Returns the number of cancelled trades.
 */
export async function cancelStaleTrades(leagueId: string, opts: { exceptTradeId?: string; reason?: string } = {}): Promise<number> {
  const open = await db.trade.findMany({ where: { leagueId, status: { in: ["PROPOSED", "ACCEPTED"] }, ...(opts.exceptTradeId ? { id: { not: opts.exceptTradeId } } : {}) }, include: tradeInclude });
  if (!open.length) return 0;
  const playerIds = [...new Set(open.flatMap((t) => t.assets.filter((a) => a.playerId).map((a) => a.playerId!)))];
  const pickIds = [...new Set(open.flatMap((t) => t.assets.filter((a) => a.pickId).map((a) => a.pickId!)))];
  const [spots, picks, teams] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId, playerId: { in: playerIds } }, select: { playerId: true, teamId: true } }),
    db.draftPick.findMany({ where: { id: { in: pickIds } }, select: { id: true, ownerTeamId: true, playerId: true, usedAt: true } }),
    db.team.findMany({ where: { leagueId }, select: { id: true, faabBalance: true } }),
  ]);
  const state = {
    playerTeam: new Map<string, string | null>(playerIds.map((id) => [id, spots.find((s) => s.playerId === id)?.teamId ?? null])),
    pickOwner: new Map(picks.map((p) => [p.id, { ownerTeamId: p.ownerTeamId, used: !!(p.playerId || p.usedAt) }])),
    faabBalance: new Map(teams.map((t) => [t.id, t.faabBalance])),
  };
  let n = 0;
  for (const t of open) {
    const why = tradeHasStaleAssets(tradeAssetRefs(t), state);
    if (!why) continue;
    const note = `Cancelled automatically: ${why}.`;
    const res = await db.trade.updateMany({ where: { id: t.id, status: { in: ["PROPOSED", "ACCEPTED"] } }, data: { status: "CANCELLED", resolutionNote: note } });
    if (!res.count) continue;
    n++;
    publishTradeEvent(leagueId, t.id, "CANCELLED");
    await safeNotify({ userIds: await tradeUserIds(t), leagueId, type: "TRADE_CANCELLED", title: "Trade offer cancelled", body: `${tradeHeadline(t)} — ${why}.`, url: `/trades/${t.id}` });
  }
  return n;
}

/** Move a trade between open states with a status guard. Returns false when the status already changed. */
export async function transitionTrade(tradeId: string, from: TradeStatus[], data: Prisma.TradeUpdateManyMutationInput): Promise<boolean> {
  const res = await db.trade.updateMany({ where: { id: tradeId, status: { in: from } }, data });
  return res.count === 1;
}

export async function vetoTrade(tradeId: string, opts: { actorId?: string | null; note?: string | null; byCommissioner: boolean }): Promise<ExecResult> {
  const trade = await loadTrade(tradeId);
  if (!trade) return { ok: false, error: "Trade not found." };
  const ok = await transitionTrade(tradeId, ["PROPOSED", "ACCEPTED"], { status: "VETOED", resolvedById: opts.byCommissioner ? opts.actorId ?? null : null, resolutionNote: opts.note ?? (opts.byCommissioner ? "Vetoed by the commissioner" : "Vetoed by league vote") });
  if (!ok) return { ok: false, error: "This trade is no longer pending." };
  publishTradeEvent(trade.leagueId, trade.id, "VETOED");
  const state = await leagueState(trade.leagueId);
  await safeNotify({
    userIds: await tradeUserIds(trade),
    leagueId: trade.leagueId,
    type: "TRADE_VETOED",
    title: opts.byCommissioner ? "Trade vetoed by the commissioner" : "Trade vetoed by league vote",
    body: `${tradeHeadline(trade)}${opts.note ? ` — ${opts.note}` : ""}`,
    url: `/trades/${trade.id}`,
  });
  if (state.settings.notifications.tradeAlertsToLeague) {
    await postSystemMessage(trade.leagueId, `Trade vetoed${opts.byCommissioner ? " by the commissioner" : " by league vote"}: ${tradeHeadline(trade)}`, { channel: "trades", kind: "TRADE", data: { tradeId: trade.id, url: `/trades/${trade.id}` } }).catch(() => null);
  }
  return { ok: true, message: "Trade vetoed." };
}

/** Commissioner reversal of a completed trade: every asset goes back, FAB is refunded, drops are restored. */
export async function reverseTrade(tradeId: string, opts: { actorId: string; note?: string | null }): Promise<ExecResult> {
  const trade = await loadTrade(tradeId);
  if (!trade) return { ok: false, error: "Trade not found." };
  if (trade.status !== "COMPLETED") return { ok: false, error: "Only completed trades can be reversed." };
  const state = await leagueState(trade.leagueId);
  const log = ((trade.valuation as { execution?: ExecutionLog } | null)?.execution ?? { completedWeek: trade.week, drops: [] }) as ExecutionLog;
  const retention = tradeTerms(trade.valuation).retention ?? {};
  const weeks = await lineupWeeks(state, trade.assets.map((a) => a.player?.team ?? null));
  const createdTx: { id: string; description: string; type: string; teamId: string | null }[] = [];
  const skipped: string[] = [];
  try {
    await db.$transaction(
      async (tx: Tx) => {
        const claim = await tx.trade.updateMany({ where: { id: tradeId, status: "COMPLETED" }, data: { status: "REVERSED", resolvedById: opts.actorId, resolutionNote: opts.note ?? "Reversed by the commissioner" } });
        if (claim.count !== 1) throw new TradeError("This trade was already reversed.");
        for (const a of trade.assets) {
          if (a.type === "PLAYER" && a.playerId) {
            const spot = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: a.playerId } } });
            if (!spot || spot.teamId !== a.toTeamId) throw new TradeError(`${a.player?.fullName ?? "A player"} is no longer on the team that received him — move him back manually first.`);
            const backWeek = weeks.get(a.player?.team ?? "") ?? state.week;
            await movePlayer(tx, { leagueId: trade.leagueId, playerId: a.playerId, toTeamId: a.fromTeamId, season: state.season, week: backWeek });
            // restore how the original team held him (acquisition, taxi status) and his lineup spots
            const prev = log.moves?.find((m) => m.playerId === a.playerId && m.fromTeamId === a.fromTeamId);
            if (prev) {
              await tx.rosterSpot.update({
                where: { id: spot.id },
                data: { acquiredVia: prev.acquiredVia as AcquisitionType, acquiredAt: new Date(prev.acquiredAt), status: prev.status, ...(prev.retained ? { salary: prev.retained.salary } : {}) },
              });
              if (prev.retained?.deadMoney.length) {
                // remove the sender's retained-salary dead money
                const st = await tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: a.playerId } } });
                if (st) {
                  const remaining = [...((st.deadCap as { teamId: string; season: number; amount: number }[]) ?? [])];
                  for (const dm of prev.retained.deadMoney) {
                    const i = remaining.findIndex((x) => x.teamId === dm.teamId && x.season === dm.season && x.amount === dm.amount);
                    if (i >= 0) remaining.splice(i, 1);
                  }
                  await tx.leaguePlayerState.update({ where: { id: st.id }, data: { deadCap: remaining as Prisma.InputJsonValue } });
                }
              }
              if (prev.lineupSlotIds.length) await tx.lineupSlot.updateMany({ where: { id: { in: prev.lineupSlotIds }, teamId: a.fromTeamId, playerId: null, week: { gte: backWeek } }, data: { playerId: a.playerId } });
            }
          } else if (a.type === "PICK" && a.pickId) {
            const pick = await tx.draftPick.findUnique({ where: { id: a.pickId } });
            if (!pick || pick.ownerTeamId !== a.toTeamId) throw new TradeError(`${a.label ?? "A pick"} has since changed hands — it can't be returned automatically.`);
            if (pick.playerId || pick.usedAt) throw new TradeError(`${a.label ?? "A pick"} has already been used in a draft.`);
            await tx.draftPick.update({ where: { id: a.pickId }, data: { ownerTeamId: a.fromTeamId } });
          } else if (a.type === "FAAB" && a.faabAmount) {
            const to = await tx.team.findUniqueOrThrow({ where: { id: a.toTeamId }, select: { faabBalance: true, name: true } });
            if (to.faabBalance < a.faabAmount) throw new TradeError(`${to.name} only has $${to.faabBalance} FAB left — adjust FAB manually before reversing.`);
            await adjustFaab(tx, { leagueId: trade.leagueId, teamId: a.toTeamId, season: state.season, amount: -a.faabAmount, reason: "TRADE", refType: "trade_reversal", refId: trade.id });
            await adjustFaab(tx, { leagueId: trade.leagueId, teamId: a.fromTeamId, season: state.season, amount: a.faabAmount, reason: "TRADE", refType: "trade_reversal", refId: trade.id });
          }
        }
        // restore players that were dropped to make room (if they're still unsigned) and remove their dead money
        for (const d of log.drops) {
          const spot = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: d.playerId } } });
          if (spot) {
            skipped.push(`${d.fullName} has since signed elsewhere and was not restored.`);
            continue;
          }
          const res = await addPlayerToTeam(tx, {
            leagueId: trade.leagueId,
            teamId: d.teamId,
            playerId: d.playerId,
            season: state.season,
            week: state.week,
            salary: d.salary,
            contractYears: d.contractYears,
            via: "COMMISSIONER",
            status: d.status === "IR" || d.status === "TAXI" ? (d.status as "IR" | "TAXI") : "ACTIVE",
            isRookieContract: d.isRookieContract,
            actorId: opts.actorId,
            txType: "COMMISSIONER",
            description: `Restored ${d.fullName} (trade reversal) — $${d.salary}, ${d.contractYears} yr${d.contractYears === 1 ? "" : "s"}`,
          });
          createdTx.push(res.transaction);
          const st = await tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId: trade.leagueId, playerId: d.playerId } } });
          if (st) {
            const remaining = [...((st.deadCap as { teamId: string; season: number; amount: number }[]) ?? [])];
            for (const dm of d.deadMoney) {
              const i = remaining.findIndex((x) => x.teamId === dm.teamId && x.season === dm.season && x.amount === dm.amount);
              if (i >= 0) remaining.splice(i, 1);
            }
            await tx.leaguePlayerState.update({ where: { id: st.id }, data: { deadCap: remaining as Prisma.InputJsonValue, lastDroppedById: null, lastDroppedAt: null } });
          }
        }
        for (const tt of trade.teams) {
          const sum = tradeSummaryFor(tt.teamId, trade.assets.map((a) => ({ fromTeamId: a.fromTeamId, toTeamId: a.toTeamId, label: assetText(a, retention) })));
          const others = trade.teams.filter((o) => o.teamId !== tt.teamId);
          const back = trade.assets.find((a) => a.fromTeamId === tt.teamId && a.type === "PLAYER");
          const t = await tx.transaction.create({
            data: {
              leagueId: trade.leagueId,
              season: state.season,
              week: state.week,
              type: "TRADE",
              teamId: tt.teamId,
              relatedTeamId: others[0]?.teamId ?? null,
              playerId: back?.playerId ?? null,
              tradeId: trade.id,
              description: `Trade with ${listJoin(others.map((o) => o.team.name))} reversed by the commissioner: got back ${listJoin(sum.sent)}${sum.received.length ? `; returned ${listJoin(sum.received)}` : ""}`,
              details: { tradeId: trade.id, reversal: true, returned: sum.received, recovered: sum.sent } as Prisma.InputJsonValue,
              createdById: opts.actorId,
            },
          });
          createdTx.push(t);
        }
        await tx.auditLog.create({
          data: { leagueId: trade.leagueId, actorId: opts.actorId, action: "trade.reverse", targetType: "trade", targetId: trade.id, details: { note: opts.note ?? null, headline: tradeHeadline(trade), skipped } as Prisma.InputJsonValue },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof TradeError) return { ok: false, error: e.message };
    console.error("[trades] reverseTrade failed", e);
    return { ok: false, error: "The trade could not be reversed. Please try again." };
  }
  invalidateLeagueValues(trade.leagueId);
  for (const t of createdTx) broadcastTransaction(trade.leagueId, t);
  publishTradeEvent(trade.leagueId, trade.id, "REVERSED");
  await cancelStaleTrades(trade.leagueId, { reason: "an asset in the offer moved" });
  await safeNotify({ userIds: await tradeUserIds(trade), leagueId: trade.leagueId, type: "TRADE_CANCELLED", title: "Trade reversed by the commissioner", body: `${tradeHeadline(trade)}${opts.note ? ` — ${opts.note}` : ""}`, url: `/trades/${trade.id}` });
  if (state.settings.notifications.tradeAlertsToLeague) {
    await postSystemMessage(trade.leagueId, `Trade reversed by the commissioner: ${tradeHeadline(trade)}`, { channel: "transactions", kind: "TRADE", data: { tradeId: trade.id, url: `/trades/${trade.id}` } }).catch(() => null);
  }
  return { ok: true, message: skipped.length ? `Trade reversed. ${skipped.join(" ")}` : "Trade reversed — every asset is back with its original team." };
}

/** Users who can approve a trade on the CO_COMMISSIONER route: co-commissioners outside the trade, else any commissioner outside it. */
export async function coReviewerUserIds(trade: Pick<LoadedTrade, "leagueId" | "teams">): Promise<string[]> {
  const involved = new Set(await tradeUserIds(trade));
  const members = await db.leagueMember.findMany({ where: { leagueId: trade.leagueId, role: { in: ["COMMISSIONER", "CO_COMMISSIONER"] } }, select: { userId: true, role: true } });
  const outside = members.filter((m) => !involved.has(m.userId));
  const co = outside.filter((m) => m.role === "CO_COMMISSIONER");
  return (co.length ? co : outside).map((m) => m.userId);
}

/** Notifications sent once every team has accepted and the trade enters review. */
export async function notifyReview(trade: LoadedTrade, state: LeagueState, route: ReviewRoute, reviewEndsAt: Date | null) {
  const headline = tradeHeadline(trade);
  if (route === "COMMISSIONER" || route === "CO_COMMISSIONER") {
    let reviewers = route === "CO_COMMISSIONER" ? await coReviewerUserIds(trade) : [];
    if (!reviewers.length) reviewers = await commissionerUserIds(trade.leagueId);
    await safeNotify({ userIds: reviewers, leagueId: trade.leagueId, type: "TRADE_REVIEW", title: "Trade awaiting your approval", body: headline, url: `/commissioner/trades` });
  } else if (route === "LEAGUE_VOTE") {
    const involved = new Set(state.settings.trades.voteEligibility === "ALL_TEAMS" ? [] : await tradeUserIds(trade));
    const voters = (await leagueUserIds(trade.leagueId)).filter((u) => !involved.has(u));
    await safeNotify({
      userIds: voters,
      leagueId: trade.leagueId,
      type: "TRADE_REVIEW",
      title: "Trade up for league review",
      body: `${headline}. ${state.settings.trades.vetoVotesRequired} veto votes block it${reviewEndsAt ? `; review ends ${reviewEndsAt.toLocaleString("en-US", { timeZone: state.settings.general.timezone, weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}.`,
      url: `/trades/${trade.id}`,
    });
  }
}

export async function notifyTeams(trade: LoadedTrade, teamIds: string[], type: NotificationType, title: string, body: string) {
  const ids = (await Promise.all(teamIds.map((t) => teamUserIds(t)))).flat();
  await safeNotify({ userIds: ids, leagueId: trade.leagueId, type, title, body, url: `/trades/${trade.id}` });
}

export type { LoadedTrade };
