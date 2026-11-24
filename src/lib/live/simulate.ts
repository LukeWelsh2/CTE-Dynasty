// Live-game simulation for demos and the offseason. Writes simulated PlayerWeekStat rows (only for the
// simulated week and only for rostered players) and simulated clocks onto that week's NflGame rows,
// then runs the exact same pipeline as real live scoring (events, matchups, win probability, alerts).
// "Stop & reset" deletes everything the simulation wrote and restores the original game rows.
// State lives in the KeyValue table so it survives restarts; ticks are claimed with compare-and-swap.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";
import type { ScoresRefreshEvent } from "@/lib/realtime/events";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import type { StatMap } from "@/lib/scoring/engine";
import { resolveSettings } from "@/lib/settings/schema";
import { buildSimPlan, simulateAt, totalSteps, type SimPlan } from "@/lib/live/sim-plan";
import { processWeekUpdate } from "@/lib/live/pipeline";
import type { SimStatusEvent } from "@/lib/live/types";

const SIM_KEY = "live_sim";
const PLAN_KEY = "live_sim_plan";
/** Real kickoffs closer than this cancel (and reset) a simulation so real scoring takes over */
const REAL_KICKOFF_GUARD_MS = 5 * 60_000;
/** Finished simulations clear themselves after this long so simulated results never linger */
export const SIM_CLEAR_AFTER_MS = 15 * 60_000;
export const SIM_INTERVAL_MS = 3000;

export const SIM_SPEEDS = {
  fast: { label: "Fast (≈3 min)", secondsPerTick: 180 },
  normal: { label: "Normal (≈6 min)", secondsPerTick: 90 },
  slow: { label: "Slow (≈12 min)", secondsPerTick: 45 },
} as const;
export type SimSpeed = keyof typeof SIM_SPEEDS;

interface GameSnapshot {
  state: string;
  statusDetail: string | null;
  homeScore: number;
  awayScore: number;
  period: number | null;
  clock: string | null;
  possession: string | null;
  redZone: boolean;
}

export interface SimState {
  id: string;
  season: number;
  week: number;
  status: "running" | "complete";
  driver: "commissioner" | "env";
  speed: SimSpeed;
  secondsPerTick: number;
  intervalMs: number;
  alerts: boolean;
  step: number;
  totalSteps: number;
  simTime: number;
  startedAt: string;
  startedById: string | null;
  leagueId: string | null;
  lastTickAt: string | null;
  completedAt: string | null;
  firstRealKickoff: string;
  playerIds: string[];
  playerTeams: Record<string, string>;
  gameIds: string[];
  snapshot: Record<string, GameSnapshot>;
}

export async function getSimState(): Promise<SimState | null> {
  const row = await db.keyValue.findUnique({ where: { key: SIM_KEY } });
  return row ? (row.value as unknown as SimState) : null;
}

export function simStatusEvent(state: SimState | null): SimStatusEvent {
  if (!state) return { active: false, status: "idle", season: 0, week: 0, step: 0, totalSteps: 0, clearsAt: null };
  return {
    active: true,
    status: state.status,
    season: state.season,
    week: state.week,
    step: state.step,
    totalSteps: state.totalSteps,
    clearsAt: state.completedAt ? new Date(new Date(state.completedAt).getTime() + SIM_CLEAR_AFTER_MS).toISOString() : null,
  };
}

async function seasonLeagues(season: number) {
  const leagues = await db.league.findMany({ where: { season }, select: { id: true, settings: true } });
  return leagues.map((l) => ({ id: l.id, settings: resolveSettings(l.settings) }));
}

async function broadcastStatus(state: SimState | null, season: number) {
  const evt = simStatusEvent(state);
  for (const l of await db.league.findMany({ where: { season }, select: { id: true } })) publish(topics.league(l.id), "sim.status", evt);
}

// ───────────────────────────── availability / start ─────────────────────────────

export interface SimAvailability {
  ok: boolean;
  reason?: string;
  games: number;
  firstKickoff: Date | null;
}

/** A week can be simulated only while none of its real games has started (or is about to). */
export async function simAvailability(season: number, week: number, now = new Date()): Promise<SimAvailability> {
  const games = await db.nflGame.findMany({ where: { season, week, seasonType: "REG" }, select: { state: true, startTime: true } });
  if (!games.length) return { ok: false, reason: `No NFL games are scheduled for week ${week}.`, games: 0, firstKickoff: null };
  const first = games.reduce((a, g) => (g.startTime < a ? g.startTime : a), games[0]!.startTime);
  if (games.some((g) => g.state !== "pre") || first.getTime() - now.getTime() <= REAL_KICKOFF_GUARD_MS) {
    return { ok: false, reason: `Real week ${week} games have started — live scoring uses real stats.`, games: games.length, firstKickoff: first };
  }
  return { ok: true, games: games.length, firstKickoff: first };
}

export async function startSimulation(opts: {
  season: number;
  week: number;
  speed: SimSpeed;
  alerts: boolean;
  startedById: string | null;
  leagueId: string | null;
  driver: SimState["driver"];
}): Promise<{ ok: true; state: SimState } | { ok: false; error: string }> {
  const existing = await getSimState();
  if (existing) return { ok: false, error: `A simulation of week ${existing.week} is already ${existing.status === "running" ? "running" : "showing results"}. Reset it first.` };
  const avail = await simAvailability(opts.season, opts.week);
  if (!avail.ok) return { ok: false, error: avail.reason ?? "This week can't be simulated." };
  const realStats = await db.playerWeekStat.count({ where: { season: opts.season, week: opts.week, seasonType: "REG" } });
  if (realStats > 0) return { ok: false, error: `Week ${opts.week} already has stat rows — it can't be simulated.` };

  const games = await db.nflGame.findMany({ where: { season: opts.season, week: opts.week, seasonType: "REG" } });
  const playing = new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]));
  const spots = await db.rosterSpot.findMany({
    where: { league: { season: opts.season } },
    select: { playerId: true, player: { select: { id: true, position: true, team: true } } },
  });
  const players = new Map<string, { id: string; position: string; team: string }>();
  for (const s of spots) if (s.player.team && playing.has(s.player.team)) players.set(s.player.id, { id: s.player.id, position: s.player.position, team: s.player.team });
  if (!players.size) return { ok: false, error: "No rostered players have a game this week." };
  const projections = await db.playerWeekProjection.findMany({
    where: { season: opts.season, week: opts.week, seasonType: "REG", playerId: { in: [...players.keys()] } },
    select: { playerId: true, stats: true },
  });
  const projBy = new Map(projections.map((p) => [p.playerId, p.stats as StatMap]));

  const seed = Math.floor(Math.random() * 2 ** 31);
  const plan = buildSimPlan(
    games.map((g) => ({ id: g.id, homeTeam: g.homeTeam, awayTeam: g.awayTeam, spread: g.spread, overUnder: g.overUnder, startTime: g.startTime })),
    [...players.values()].map((p) => ({ ...p, proj: projBy.get(p.id) ?? null })),
    seed,
  );
  const speed = SIM_SPEEDS[opts.speed];
  const state: SimState = {
    id: `sim_${Date.now().toString(36)}_${seed.toString(36)}`,
    season: opts.season,
    week: opts.week,
    status: "running",
    driver: opts.driver,
    speed: opts.speed,
    secondsPerTick: speed.secondsPerTick,
    intervalMs: SIM_INTERVAL_MS,
    alerts: opts.alerts,
    step: 0,
    totalSteps: totalSteps(plan, speed.secondsPerTick),
    simTime: 0,
    startedAt: new Date().toISOString(),
    startedById: opts.startedById,
    leagueId: opts.leagueId,
    lastTickAt: null,
    completedAt: null,
    firstRealKickoff: avail.firstKickoff!.toISOString(),
    playerIds: [...players.keys()],
    playerTeams: Object.fromEntries([...players.values()].map((p) => [p.id, p.team])),
    gameIds: games.map((g) => g.id),
    snapshot: Object.fromEntries(
      games.map((g) => [g.id, { state: g.state, statusDetail: g.statusDetail, homeScore: g.homeScore, awayScore: g.awayScore, period: g.period, clock: g.clock, possession: g.possession, redZone: g.redZone }]),
    ),
  };
  try {
    // creating the state row is the lock: a concurrent start fails on the unique key
    await db.keyValue.create({ data: { key: SIM_KEY, value: state as unknown as Prisma.InputJsonValue } });
  } catch {
    return { ok: false, error: "Another simulation just started." };
  }
  await db.keyValue.upsert({
    where: { key: PLAN_KEY },
    create: { key: PLAN_KEY, value: { id: state.id, plan } as unknown as Prisma.InputJsonValue },
    update: { value: { id: state.id, plan } as unknown as Prisma.InputJsonValue },
  });
  planCache = { id: state.id, plan };
  await broadcastStatus(state, state.season);
  ensureSimLoop();
  return { ok: true, state };
}

// ───────────────────────────── ticking ─────────────────────────────

let planCache: { id: string; plan: SimPlan } | null = null;

async function loadPlan(id: string): Promise<SimPlan | null> {
  if (planCache?.id === id) return planCache.plan;
  const row = await db.keyValue.findUnique({ where: { key: PLAN_KEY } });
  const v = row?.value as unknown as { id: string; plan: SimPlan } | undefined;
  if (!v || v.id !== id) return null;
  planCache = v;
  return v.plan;
}

/** Compare-and-swap the state row on (id, step) so only one ticker advances a given step. */
async function casState(prev: SimState, next: SimState): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE "KeyValue" SET "value" = ${JSON.stringify(next)}::jsonb, "updatedAt" = NOW()
    WHERE "key" = ${SIM_KEY} AND "value"->>'id' = ${prev.id} AND ("value"->>'step')::int = ${prev.step}`;
  return n === 1;
}

/** Advance the simulation by one tick. Returns done=true when nothing is left to drive. */
export async function advanceSimulation(now = new Date()): Promise<{ done: boolean; message: string }> {
  const state = await getSimState();
  if (!state) return { done: true, message: "no simulation" };
  if (now.getTime() >= new Date(state.firstRealKickoff).getTime() - REAL_KICKOFF_GUARD_MS) {
    await resetSimulation();
    return { done: true, message: "simulation reset: real games are starting" };
  }
  if (state.status === "complete") {
    if (state.completedAt && now.getTime() - new Date(state.completedAt).getTime() >= SIM_CLEAR_AFTER_MS) {
      await resetSimulation();
      return { done: true, message: "simulation cleared" };
    }
    return { done: true, message: "simulation complete" };
  }
  const plan = await loadPlan(state.id);
  if (!plan) {
    await resetSimulation();
    return { done: true, message: "simulation plan missing — reset" };
  }
  const step = state.step + 1;
  const simTime = Math.min(plan.totalSeconds, step * state.secondsPerTick);
  const finished = simTime >= plan.totalSeconds;
  const nextState: SimState = {
    ...state,
    step,
    simTime,
    status: finished ? "complete" : "running",
    lastTickAt: now.toISOString(),
    completedAt: finished ? now.toISOString() : null,
  };
  if (!(await casState(state, nextState))) return { done: false, message: "tick handled elsewhere" };

  const { season, week } = state;
  const sim = simulateAt(plan, simTime);
  const prevRows = await db.playerWeekStat.findMany({ where: { season, week, seasonType: "REG", playerId: { in: state.playerIds } }, select: { playerId: true, stats: true } });
  const previous = new Map(prevRows.map((r) => [r.playerId, r.stats as StatMap]));
  const changed = [...sim.stats.entries()].filter(([pid, s]) => JSON.stringify(previous.get(pid) ?? null) !== JSON.stringify(s));

  const games = await db.nflGame.findMany({ where: { id: { in: state.gameIds } } });
  const gameById = new Map(games.map((g) => [g.id, g]));
  const gameUpdates: Prisma.PrismaPromise<unknown>[] = [];
  for (const [gid, gs] of sim.games) {
    const cur = gameById.get(gid);
    if (!cur) continue;
    const snap = state.snapshot[gid];
    const data =
      gs.state === "pre"
        ? snap ?? { state: "pre", statusDetail: null, homeScore: 0, awayScore: 0, period: null, clock: null, possession: null, redZone: false }
        : { state: gs.state, statusDetail: gs.statusDetail, homeScore: gs.homeScore, awayScore: gs.awayScore, period: gs.period, clock: gs.clock, possession: gs.possession, redZone: gs.redZone };
    const same = cur.state === data.state && cur.clock === data.clock && cur.homeScore === data.homeScore && cur.awayScore === data.awayScore && cur.possession === data.possession && cur.redZone === data.redZone && cur.statusDetail === data.statusDetail;
    if (same) continue;
    gameUpdates.push(db.nflGame.update({ where: { id: gid }, data }));
    Object.assign(cur, data);
  }

  const gameIdByTeam = new Map<string, NonNullable<ReturnType<typeof gameById.get>>>();
  for (const g of games) {
    gameIdByTeam.set(g.homeTeam, g);
    gameIdByTeam.set(g.awayTeam, g);
  }
  const rows: Prisma.PlayerWeekStatCreateManyInput[] = changed.map(([pid, stats]) => {
    const team = state.playerTeams[pid] ?? null;
    const g = team ? gameIdByTeam.get(team) : undefined;
    return { playerId: pid, season, week, seasonType: "REG", team, opponent: g ? (g.homeTeam === team ? g.awayTeam : g.homeTeam) : null, gameId: g?.id ?? null, stats };
  });
  await db.$transaction([
    ...(rows.length ? [db.playerWeekStat.deleteMany({ where: { season, week, seasonType: "REG", playerId: { in: rows.map((r) => r.playerId) } } }), db.playerWeekStat.createMany({ data: rows })] : []),
    ...gameUpdates,
  ]);

  const res = await processWeekUpdate({
    season,
    week,
    previous,
    next: new Map(changed),
    leagues: await seasonLeagues(season),
    games,
    gamesChanged: gameUpdates.length > 0,
    simulated: true,
    sendAlerts: state.alerts,
    wpMinIntervalMs: 0,
    now,
  });
  await broadcastStatus(nextState, season);
  if (finished) scheduleAutoClear(nextState, now);
  return { done: finished, message: `sim week ${week} step ${step}/${state.totalSteps}: ${res.changedPlayers} players, ${res.events} plays, ${res.alerts} alerts` };
}

// ───────────────────────────── reset ─────────────────────────────

export async function resetSimulation(): Promise<{ ok: boolean; week: number | null; stats: number; events: number }> {
  stopSimLoop();
  const state = await getSimState();
  if (!state) return { ok: false, week: null, stats: 0, events: 0 };
  // remove the lock first so any in-flight ticker stops at its next CAS
  await db.keyValue.deleteMany({ where: { key: { in: [SIM_KEY, PLAN_KEY] } } });
  planCache = null;
  const { season, week } = state;
  const startedAt = new Date(state.startedAt);
  const stats = await db.playerWeekStat.deleteMany({ where: { season, week, seasonType: "REG", playerId: { in: state.playerIds } } });
  await db.$transaction(Object.entries(state.snapshot).map(([id, snap]) => db.nflGame.updateMany({ where: { id }, data: snap })));
  const matchupIds = (await db.matchup.findMany({ where: { season, week }, select: { id: true } })).map((m) => m.id);
  if (matchupIds.length) await db.winProbPoint.deleteMany({ where: { matchupId: { in: matchupIds }, at: { gte: startedAt } } });
  const events = await db.scoringEvent.deleteMany({ where: { season, week, createdAt: { gte: startedAt } } });
  await db.notification.deleteMany({ where: { type: "TOUCHDOWN", createdAt: { gte: startedAt }, data: { path: ["simulated"], equals: true } } });
  for (const league of await seasonLeagues(season)) {
    await refreshWeekMatchups(league.id, season, week, league.settings);
    const evt: ScoresRefreshEvent = { week };
    publish(topics.league(league.id), "scores.refresh", evt);
  }
  await broadcastStatus(null, season);
  return { ok: true, week, stats: stats.count, events: events.count };
}

// ───────────────────────────── in-process driver ─────────────────────────────

interface SimLoop {
  timer: ReturnType<typeof setInterval> | null;
  clearTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  tick: () => Promise<void>;
}

const g = globalThis as unknown as { __cteSimLoop?: SimLoop };

async function loopTick() {
  const loop = g.__cteSimLoop;
  if (!loop || loop.busy) return;
  loop.busy = true;
  try {
    const r = await advanceSimulation();
    if (r.done) stopSimLoop();
  } catch (e) {
    console.error("[live-sim]", e);
  } finally {
    loop.busy = false;
  }
}

// keep the newest code after hot reloads (the interval always calls loop.tick)
if (g.__cteSimLoop) g.__cteSimLoop.tick = loopTick;

export function simLoopRunning(): boolean {
  return !!g.__cteSimLoop?.timer;
}

export function ensureSimLoop(intervalMs = SIM_INTERVAL_MS) {
  if (g.__cteSimLoop?.timer) return;
  const timer = setInterval(() => void g.__cteSimLoop?.tick(), intervalMs);
  timer.unref?.();
  g.__cteSimLoop = { timer, clearTimer: g.__cteSimLoop?.clearTimer ?? null, busy: false, tick: loopTick };
}

export function stopSimLoop() {
  const loop = g.__cteSimLoop;
  if (!loop) return;
  if (loop.timer) clearInterval(loop.timer);
  loop.timer = null;
}

/** Clear finished simulated results once their display window passes. */
function scheduleAutoClear(state: SimState, now = new Date()) {
  if (!g.__cteSimLoop) g.__cteSimLoop = { timer: null, clearTimer: null, busy: false, tick: loopTick };
  if (g.__cteSimLoop.clearTimer) clearTimeout(g.__cteSimLoop.clearTimer);
  const due = (state.completedAt ? new Date(state.completedAt).getTime() : now.getTime()) + SIM_CLEAR_AFTER_MS;
  const t = setTimeout(() => {
    if (g.__cteSimLoop) g.__cteSimLoop.clearTimer = null;
    void maintainSimulation().catch((e) => console.error("[live-sim]", e));
  }, Math.max(1000, due - now.getTime() + 1000));
  t.unref?.();
  g.__cteSimLoop.clearTimer = t;
}

/**
 * Keep a stored simulation healthy: resume ticking after a restart, clear finished results once
 * their display window passes, and cancel when real kickoffs approach. Cheap; safe to call often.
 */
export async function maintainSimulation(now = new Date()): Promise<SimState | null> {
  const state = await getSimState();
  if (!state) return null;
  if (now.getTime() >= new Date(state.firstRealKickoff).getTime() - REAL_KICKOFF_GUARD_MS) {
    await resetSimulation();
    return null;
  }
  if (state.status === "complete") {
    if (state.completedAt && now.getTime() - new Date(state.completedAt).getTime() >= SIM_CLEAR_AFTER_MS) {
      await resetSimulation();
      return null;
    }
    if (!g.__cteSimLoop?.clearTimer) scheduleAutoClear(state, now);
    return state;
  }
  if (!simLoopRunning()) {
    const last = state.lastTickAt ? new Date(state.lastTickAt).getTime() : new Date(state.startedAt).getTime();
    if (now.getTime() - last > state.intervalMs * 3) ensureSimLoop(state.intervalMs);
  }
  return state;
}
