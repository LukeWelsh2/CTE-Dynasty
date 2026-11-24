// Waiver / FAB processing (hourly job "process-waivers" + the commissioner's "Process waivers now").
// The award algorithm lives in ./logic.ts (pure, unit-tested); this file loads league state, writes each
// award atomically through @/lib/roster-ops and reports results (notifications, chat, live feed).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { capHit } from "@/lib/roster";
import { addPlayerToTeam, adjustFaab, broadcastTransaction, dropPlayerFromTeam } from "@/lib/roster-ops";
import { isLocked, weekGamesByTeam } from "@/lib/lineup";
import { computeStandings } from "@/lib/standings";
import { lastWaiverRun, nextWaiverRun } from "@/lib/waiver-schedule";
import { notify, teamUserIds } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import {
  applyDecision,
  createWaiverRun,
  currentSeasonDeadMoney,
  isRunDue,
  nextDecision,
  reverseStandingsOrder,
  rulesFromSettings,
  waiverContractYears,
  type AwardDecision,
  type EngineClaim,
  type EngineTeam,
} from "@/lib/waivers/logic";

export const LAST_RUN_KEY = (leagueId: string) => `waivers:last:${leagueId}`;

export interface LastRunInfo {
  at: string;
  scheduledRun: string | null;
  through: string;
  processed: number;
  awarded: number;
  lost: number;
  invalid: number;
  manual: boolean;
}

export interface WaiverRunSummary {
  leagueId: string;
  at: Date;
  processed: number;
  awarded: number;
  lost: number;
  invalid: number;
  skipped?: string;
  lines: string[];
}

const g = globalThis as unknown as { __cteWaiverLocks?: Set<string> };
const locks: Set<string> = g.__cteWaiverLocks ?? new Set();
g.__cteWaiverLocks = locks;

export async function getLastRun(leagueId: string): Promise<LastRunInfo | null> {
  const row = await db.keyValue.findUnique({ where: { key: LAST_RUN_KEY(leagueId) } });
  return (row?.value as unknown as LastRunInfo) ?? null;
}

/** Hourly job: process every league whose scheduled waiver run has passed since it was last processed. */
export async function processDueWaivers(): Promise<string> {
  const now = new Date();
  const leagues = await db.league.findMany({ select: { id: true, name: true, settings: true } });
  const out: string[] = [];
  for (const l of leagues) {
    const settings = resolveSettings(l.settings);
    const scheduled = lastWaiverRun(settings, now);
    const last = await getLastRun(l.id);
    if (!isRunDue(scheduled, last ? new Date(last.at) : null)) continue;
    try {
      const r = await processLeagueWaivers(l.id, { now, through: now, scheduledRun: scheduled });
      out.push(r.skipped ? `${l.name}: skipped (${r.skipped})` : `${l.name}: ${r.processed} claims — ${r.awarded} won, ${r.lost} lost, ${r.invalid} invalid`);
    } catch (e) {
      out.push(`${l.name}: error ${(e as Error).message}`);
    }
  }
  return out.length ? out.join("; ") : "no waiver runs due";
}

interface ProcessOptions {
  now?: Date;
  /** process claims due at or before this time (default now). "Process now" passes the next scheduled run. */
  through?: Date;
  scheduledRun?: Date | null;
  actorId?: string | null;
  manual?: boolean;
}

export async function processLeagueWaivers(leagueId: string, opts: ProcessOptions = {}): Promise<WaiverRunSummary> {
  if (locks.has(leagueId)) return { leagueId, at: new Date(), processed: 0, awarded: 0, lost: 0, invalid: 0, skipped: "already running", lines: [] };
  locks.add(leagueId);
  try {
    return await runLeague(leagueId, opts);
  } finally {
    locks.delete(leagueId);
  }
}

type ClaimRow = Prisma.WaiverClaimGetPayload<{ include: { addPlayer: true; dropPlayer: true; team: { select: { id: true; name: true; abbrev: true } } } }>;

async function runLeague(leagueId: string, opts: ProcessOptions): Promise<WaiverRunSummary> {
  const now = opts.now ?? new Date();
  const runAt = new Date();
  const through = opts.through ?? now;
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const nfl = await getNflState();
  const season = league.season;
  const week = leagueWeekFor(league, settings, nfl);
  const playoffs = league.phase === "PLAYOFFS";
  const playoffMode = settings.waivers.playoffMode ?? "SAME_AS_REGULAR";
  const frozenOrder = playoffs && playoffMode === "FROZEN";
  const rules = rulesFromSettings(settings, { rotate: !frozenOrder });
  if (settings.waivers.disableAdds) {
    return { leagueId, at: runAt, processed: 0, awarded: 0, lost: 0, invalid: 0, skipped: "frozen — the commissioner has disabled adds", lines: [] };
  }

  const claims: ClaimRow[] = await db.waiverClaim.findMany({
    where: { leagueId, status: "PENDING", OR: [{ processAt: null }, { processAt: { lte: through } }] },
    include: { addPlayer: true, dropPlayer: true, team: { select: { id: true, name: true, abbrev: true } } },
    orderBy: [{ teamId: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
  });

  const teams = await db.team.findMany({ where: { leagueId }, orderBy: [{ waiverPriority: "asc" }, { createdAt: "asc" }] });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const summaryLines: string[] = [];
  const perTeam = new Map<string, string[]>();
  const addLine = (teamId: string, line: string) => {
    if (!perTeam.has(teamId)) perTeam.set(teamId, []);
    perTeam.get(teamId)!.push(line);
  };
  let awarded = 0, lost = 0, invalid = 0;
  const createdTx: { id: string; description: string; type: string; teamId: string | null }[] = [];
  const awardsForChat: string[] = [];

  const rostersLocked = playoffs && settings.playoffs.lockRostersInPlayoffs;
  const revealWinner = (settings.waivers.revealBids ?? "ALL_BIDS") !== "NONE";
  let finalOrder = teams.map((t) => t.id);
  if (claims.length) {
    if (rostersLocked) {
      for (const c of claims) {
        await markClaim(c.id, "INVALID", "Rosters are locked for the playoffs.", runAt);
        addLine(c.teamId, `Invalid: ${c.addPlayer.fullName} — rosters are locked for the playoffs.`);
        invalid++;
      }
    } else {
      const blocked = playoffs && settings.waivers.eliminatedTeamsCanAdd === false ? await eliminatedTeams(leagueId, season, teams.map((t) => t.id)) : new Map<string, string>();
      const state = await buildState(leagueId, season, week, settings, claims, teams, now, rules, blocked);
      const byId = new Map(claims.map((c) => [c.id, c]));
      const startPriority = new Map(teams.map((t, i) => [t.id, i + 1]));
      for (let d = nextDecision(state); d; d = nextDecision(state)) {
        if (d.kind === "invalid") {
          const c = byId.get(d.claimId)!;
          await markClaim(d.claimId, "INVALID", d.reason, runAt);
          applyDecision(state, d);
          addLine(c.teamId, `Invalid: ${c.addPlayer.fullName} — ${d.reason}`);
          invalid++;
          continue;
        }
        const c = byId.get(d.claimId)!;
        try {
          const txs = await writeAward(d, c, { leagueId, season, week, settings, runAt, waiverPriority: startPriority.get(c.teamId) ?? null });
          createdTx.push(...txs);
          applyDecision(state, d);
          awarded++;
          const cost = rules.mode === "FAB" ? ` for $${d.bid}` : "";
          addLine(c.teamId, `Won ${c.addPlayer.fullName}${cost}${c.dropPlayer ? ` (dropped ${c.dropPlayer.fullName})` : ""}.`);
          awardsForChat.push(`${c.team.name} claimed ${c.addPlayer.fullName}${revealWinner ? cost : ""}${c.dropPlayer ? `, dropped ${c.dropPlayer.fullName}` : ""}`);
          for (const l of d.losers) {
            const lc = byId.get(l.claimId);
            if (!lc) continue;
            lost++;
            addLine(lc.teamId, `Lost ${lc.addPlayer.fullName} — ${l.note}.`);
          }
        } catch (e) {
          const reason = `Could not complete the claim: ${(e as Error).message}`;
          await markClaim(d.claimId, "INVALID", reason, runAt);
          applyDecision(state, { kind: "invalid", claimId: d.claimId, reason });
          addLine(c.teamId, `Invalid: ${c.addPlayer.fullName} — ${reason}`);
          invalid++;
        }
      }
      finalOrder = state.order;
    }
  }
  // waiver order after the run: rolling moves, then the weekly reset by record (not in the playoffs unless
  // the league plays the playoffs like the regular season; a frozen playoff order never changes)
  if (!frozenOrder) {
    const reset = settings.waivers.priorityType === "RESET_WEEKLY_BY_RECORD" && (!playoffs || playoffMode === "SAME_AS_REGULAR");
    await saveOrder(teams, finalOrder, reset, settings, leagueId, season);
  }
  const allowance = await creditWeeklyAllowance(leagueId, league.phase, season, week, settings, teams.map((t) => t.id));

  for (const t of createdTx) broadcastTransaction(leagueId, t);

  // notify every team that had a claim in this run
  for (const [teamId, lines] of perTeam) {
    const won = lines.filter((l) => l.startsWith("Won")).length;
    const title = won ? `Waivers: you won ${won} claim${won === 1 ? "" : "s"}` : "Waiver results";
    try {
      await notify({ userIds: await teamUserIds(teamId), leagueId, type: "WAIVER_RESULT", title, body: lines.join(" "), url: "/waivers#results", data: { runAt: runAt.toISOString() } });
    } catch (e) {
      console.error("[waivers] notify failed", e);
    }
  }
  if (awardsForChat.length && settings.notifications.transactionsToChat) {
    const label = runAt.toLocaleString("en-US", { timeZone: settings.general.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    await postSystemMessage(leagueId, `Waiver results (${label}): ${awardsForChat.join(" · ")}`, { channel: "transactions", kind: "TRANSACTION", data: { kind: "waivers", runAt: runAt.toISOString(), url: "/waivers#results" } }).catch((e) =>
      console.error("[waivers] chat post failed", e),
    );
  }
  for (const [teamId, lines] of perTeam) for (const l of lines) summaryLines.push(`${teamName.get(teamId) ?? teamId}: ${l}`);
  if (allowance) summaryLines.push(`Weekly FAB allowance: +$${allowance} to every team.`);

  const info: LastRunInfo = {
    at: runAt.toISOString(),
    scheduledRun: opts.scheduledRun ? opts.scheduledRun.toISOString() : null,
    through: through.toISOString(),
    processed: claims.length,
    awarded,
    lost,
    invalid,
    manual: !!opts.manual,
  };
  await db.keyValue.upsert({ where: { key: LAST_RUN_KEY(leagueId) }, create: { key: LAST_RUN_KEY(leagueId), value: info as unknown as Prisma.InputJsonValue }, update: { value: info as unknown as Prisma.InputJsonValue } });
  if (opts.manual) {
    await db.auditLog.create({
      data: { leagueId, actorId: opts.actorId ?? null, action: "waivers.process_now", targetType: "league", targetId: leagueId, details: { ...info } as unknown as Prisma.InputJsonValue },
    });
  }
  publish(topics.league(leagueId), "waivers.processed", { at: info.at, awarded, lost, invalid });
  return { leagueId, at: runAt, processed: claims.length, awarded, lost, invalid, lines: summaryLines };
}

async function markClaim(id: string, status: "INVALID" | "LOST", note: string, at: Date) {
  await db.waiverClaim.updateMany({ where: { id, status: "PENDING" }, data: { status, resultNote: note.slice(0, 500), processedAt: at } });
}

/**
 * Teams knocked out of the championship bracket (playoffs only): never in a non-consolation playoff game,
 * or lost one that is final.
 */
async function eliminatedTeams(leagueId: string, season: number, teamIds: string[]): Promise<Map<string, string>> {
  const games = await db.matchup.findMany({ where: { leagueId, season, isPlayoff: true, isConsolation: false } });
  const out = new Map<string, string>();
  if (!games.length) return out;
  const inBracket = new Set<string>();
  for (const g of games) {
    if (g.homeTeamId) inBracket.add(g.homeTeamId);
    if (g.awayTeamId) inBracket.add(g.awayTeamId);
    if (g.status === "FINAL" && g.homeTeamId && g.awayTeamId) {
      const winner = g.winnerTeamId ?? (g.homeScore >= g.awayScore ? g.homeTeamId : g.awayTeamId);
      const loser = winner === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
      out.set(loser, "Teams eliminated from the playoffs can't add players.");
    }
  }
  for (const id of teamIds) if (!inBracket.has(id)) out.set(id, "Teams eliminated from the playoffs can't add players.");
  return out;
}

const ALLOWANCE_KEY = (leagueId: string, season: number, week: number) => `waivers:allowance:${leagueId}:${season}:${week}`;

/** settings.waivers.weeklyFaabAllowance: credit every team once per league week (regular season + playoffs). */
async function creditWeeklyAllowance(leagueId: string, phase: string, season: number, week: number, settings: LeagueSettings, teamIds: string[]): Promise<number> {
  const amount = settings.waivers.weeklyFaabAllowance ?? 0;
  if (!amount || settings.waivers.type !== "FAB" || (phase !== "REGULAR" && phase !== "PLAYOFFS")) return 0;
  const key = ALLOWANCE_KEY(leagueId, season, week);
  const done = await db.keyValue.findUnique({ where: { key } });
  if (done) return 0;
  await db.$transaction(async (tx) => {
    await tx.keyValue.create({ data: { key, value: { amount, at: new Date().toISOString() } } });
    for (const teamId of teamIds) await adjustFaab(tx, { leagueId, teamId, season, amount, reason: "ALLOWANCE", refType: "week", refId: String(week) });
  });
  return amount;
}

async function buildState(
  leagueId: string,
  season: number,
  week: number,
  settings: LeagueSettings,
  claims: ClaimRow[],
  teams: { id: string; name: string; faabBalance: number }[],
  now: Date,
  rules: ReturnType<typeof rulesFromSettings>,
  blocked: Map<string, string>,
) {
  const [spots, states, acqWeek, acqSeason, lineup, games, standings] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId }, include: { player: true } }),
    db.leaguePlayerState.findMany({ where: { leagueId }, select: { deadCap: true } }),
    db.transaction.groupBy({ by: ["teamId"], where: { leagueId, season, week, type: { in: ["ADD", "WAIVER"] } }, _count: { _all: true } }),
    db.transaction.groupBy({ by: ["teamId"], where: { leagueId, season, type: { in: ["ADD", "WAIVER"] } }, _count: { _all: true } }),
    db.lineupSlot.findMany({ where: { leagueId, season, week, playerId: { not: null } }, select: { playerId: true, teamId: true } }),
    weekGamesByTeam(season, week),
    settings.waivers.tiebreaker === "WORST_RECORD" ? computeStandings(leagueId, season, settings) : Promise.resolve(null),
  ]);
  const dead = new Map<string, number>();
  for (const s of states) for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) if (d.season === season) dead.set(d.teamId, (dead.get(d.teamId) ?? 0) + d.amount);
  const wk = new Map(acqWeek.map((r) => [r.teamId, r._count._all]));
  const ss = new Map(acqSeason.map((r) => [r.teamId, r._count._all]));
  const spotByPlayer = new Map(spots.map((s) => [s.playerId, s]));
  const locked = new Set<string>();
  for (const l of lineup) {
    const sp = l.playerId ? spotByPlayer.get(l.playerId) : undefined;
    if (sp && sp.teamId === l.teamId && isLocked(sp.player.team, games, settings, now)) locked.add(sp.playerId);
  }
  const engineTeams: EngineTeam[] = teams.map((t) => {
    const roster = spots.filter((s) => s.teamId === t.id);
    return {
      id: t.id,
      name: t.name,
      faab: t.faabBalance,
      committed: roster.reduce((a, s) => a + capHit(s, settings), 0) + (dead.get(t.id) ?? 0),
      roster: roster.map((s) => ({
        playerId: s.playerId,
        name: s.player.fullName,
        position: normalizePosition(s.player.position),
        status: s.status,
        capHit: capHit(s, settings),
        deadIfDropped: currentSeasonDeadMoney(s, settings, week),
      })),
      acquisitionsWeek: wk.get(t.id) ?? 0,
      acquisitionsSeason: ss.get(t.id) ?? 0,
    };
  });
  const engineClaims: EngineClaim[] = claims.map((c) => ({
    id: c.id,
    teamId: c.teamId,
    playerId: c.addPlayerId,
    playerName: c.addPlayer.fullName,
    position: normalizePosition(c.addPlayer.position),
    dropPlayerId: c.dropPlayerId,
    bid: c.bidAmount,
    priority: c.priority,
    createdAt: c.createdAt,
  }));
  return createWaiverRun({
    rules,
    teams: engineTeams,
    claims: engineClaims,
    priorityOrder: teams.map((t) => t.id),
    recordOrder: standings ? [...standings].reverse().map((r) => r.team.id) : undefined,
    rosteredPlayerIds: spots.map((s) => s.playerId),
    lockedPlayerIds: locked,
    blockedTeams: blocked,
  });
}

async function writeAward(
  d: AwardDecision,
  c: ClaimRow,
  ctx: { leagueId: string; season: number; week: number; settings: LeagueSettings; runAt: Date; waiverPriority: number | null },
) {
  const { leagueId, season, week, settings, runAt } = ctx;
  const fab = settings.waivers.type === "FAB";
  const years = waiverContractYears(settings);
  const p = c.addPlayer;
  const meta = `${p.position}${p.team ? " " + p.team : ""}`;
  return db.$transaction(
    async (tx) => {
      const upd = await tx.waiverClaim.updateMany({
        where: { id: c.id, status: "PENDING" },
        data: { status: "WON", resultNote: fab ? `Won for $${d.bid}` : "Claimed", processedAt: runAt, salary: d.salary },
      });
      if (upd.count !== 1) throw new Error("the claim was changed while waivers were processing");
      const out: { id: string; description: string; type: string; teamId: string | null }[] = [];
      if (d.dropPlayerId && c.dropPlayer) {
        const dropSpot = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId, playerId: d.dropPlayerId } } });
        if (!dropSpot || dropSpot.teamId !== c.teamId) throw new Error(`${c.dropPlayer.fullName} is no longer on the roster`);
        const deadNow = currentSeasonDeadMoney(dropSpot, settings, week);
        const dp = c.dropPlayer;
        const res = await dropPlayerFromTeam(tx, {
          leagueId,
          teamId: c.teamId,
          playerId: d.dropPlayerId,
          season,
          week,
          settings,
          description: `Dropped ${dp.fullName} (${dp.position}${dp.team ? " " + dp.team : ""}) for waiver claim on ${p.fullName}${deadNow ? ` — $${deadNow} dead money` : ""}`,
        });
        out.push(res.transaction);
      }
      const added = await addPlayerToTeam(tx, {
        leagueId,
        teamId: c.teamId,
        playerId: c.addPlayerId,
        season,
        week,
        salary: d.salary,
        contractYears: years,
        via: "WAIVER",
        txType: "WAIVER",
        faabAmount: fab ? d.bid : null,
        description: fab
          ? `Claimed ${p.fullName} (${meta}) off waivers${(settings.waivers.revealBids ?? "ALL_BIDS") === "NONE" ? "" : ` for $${d.bid} FAB`} — $${d.salary}, ${years} yr${years === 1 ? "" : "s"}`
          : `Claimed ${p.fullName} (${meta}) off waivers${ctx.waiverPriority ? ` (priority #${ctx.waiverPriority})` : ""} — $${d.salary}, ${years} yr${years === 1 ? "" : "s"}`,
        details: {
          claimId: c.id,
          runAt: runAt.toISOString(),
          bid: d.bid,
          dropPlayerId: d.dropPlayerId,
          waiverPriority: ctx.waiverPriority,
          decidedByTiebreak: d.decidedByTiebreak,
          competing: d.losers.map((l) => ({ teamId: l.teamId, bid: l.bid })),
        },
      });
      out.push(added.transaction);
      if (fab && d.bid > 0) await adjustFaab(tx, { leagueId, teamId: c.teamId, season, amount: -d.bid, reason: "WAIVER", refType: "waiverClaim", refId: c.id });
      // settings.salaryCap.deadMoney.forgivenIfClaimed: the team that cut him no longer carries his dead money
      if (settings.salaryCap.deadMoney.forgivenIfClaimed) {
        const st = await tx.leaguePlayerState.findUnique({ where: { leagueId_playerId: { leagueId, playerId: c.addPlayerId } } });
        const entries = (st?.deadCap as unknown as { teamId: string; season: number; amount: number }[] | null) ?? [];
        const from = st?.lastDroppedById;
        const forgiven = entries.filter((e) => e.teamId === from && e.teamId !== c.teamId && e.season >= season);
        if (st && from && forgiven.length) {
          await tx.leaguePlayerState.update({ where: { id: st.id }, data: { deadCap: entries.filter((e) => !forgiven.includes(e)) as unknown as Prisma.InputJsonValue } });
          await tx.transaction.update({
            where: { id: added.transaction.id },
            data: { details: { ...(added.transaction.details as Record<string, unknown>), forgivenDeadMoney: { teamId: from, entries: forgiven } } as Prisma.InputJsonValue },
          });
        }
      }
      for (const l of d.losers) {
        await tx.waiverClaim.updateMany({ where: { id: l.claimId, status: "PENDING" }, data: { status: "LOST", resultNote: l.note.slice(0, 500), processedAt: runAt } });
      }
      return out;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

async function saveOrder(teams: { id: string; waiverPriority: number }[], rollingOrder: string[], reset: boolean, settings: LeagueSettings, leagueId: string, season: number) {
  let order = rollingOrder;
  if (reset) {
    const standings = await computeStandings(leagueId, season, settings);
    order = reverseStandingsOrder(standings.map((r) => r.team.id), teams.map((t) => t.id));
  }
  const current = new Map(teams.map((t) => [t.id, t.waiverPriority]));
  const updates = order.map((id, i) => ({ id, priority: i + 1 })).filter((u) => current.get(u.id) !== u.priority);
  if (updates.length) await db.$transaction(updates.map((u) => db.team.update({ where: { id: u.id }, data: { waiverPriority: u.priority } })));
}

/** Time the commissioner's "Process now" should cover: everything due by the next scheduled run. */
export function processNowThrough(settings: LeagueSettings, now = new Date()): Date {
  return nextWaiverRun(settings, now) ?? now;
}
