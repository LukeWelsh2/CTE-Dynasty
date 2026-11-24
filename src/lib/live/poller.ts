// Live scoring tick (job "live-scoring", every LIVE_POLL_SECONDS).
// Idle path: one cheap query — are any of this NFL week's games in progress, about to kick off, or
// just finished? If not (and SIMULATED_LIVE isn't on) return "idle" without any external calls.
// Live path: refresh ESPN game clocks → pull Sleeper stats → shared pipeline (events, matchups,
// live events, win-probability history, touchdown alerts).
import { db } from "@/lib/db";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { resolveSettings } from "@/lib/settings/schema";
import { syncWeekGames } from "@/lib/sync/espn-schedule";
import { syncWeekStats } from "@/lib/sync/sleeper";
import { processWeekUpdate } from "@/lib/live/pipeline";
import { ensureSimLoop, maintainSimulation, simAvailability, simLoopRunning, startSimulation } from "@/lib/live/simulate";

/** Poll this long before kickoff (clock / inactive updates) */
const PRE_KICKOFF_MS = 5 * 60_000;
/** Games that kicked off within this window and are final keep being polled for late stat changes */
const RECENT_FINAL_MS = 4 * 60 * 60_000;
/** How often the idle path also checks on a stored simulation (resume after restarts) */
const SIM_CHECK_MS = 60_000;

const g = globalThis as unknown as { __cteLive?: { lastSimCheck: number; gamesKey: string } };
const mem = (g.__cteLive ??= { lastSimCheck: 0, gamesKey: "" });

export async function runLiveTick(): Promise<string> {
  const nfl = await getNflState();
  const now = new Date();
  const simulatedEnv = process.env.SIMULATED_LIVE === "true";
  const { season, week } = nfl;

  const live =
    nfl.seasonType === "regular"
      ? await db.nflGame.findFirst({
          where: {
            season,
            week,
            seasonType: "REG",
            OR: [
              { state: "in" },
              { state: "pre", startTime: { lte: new Date(now.getTime() + PRE_KICKOFF_MS) } },
              { state: "post", startTime: { gte: new Date(now.getTime() - RECENT_FINAL_MS) } },
            ],
          },
          select: { id: true },
        })
      : null;

  if (!live) {
    if (simulatedEnv) return runSimulatedEnv(season, week);
    if (now.getTime() - mem.lastSimCheck > SIM_CHECK_MS) {
      mem.lastSimCheck = now.getTime();
      const sim = await maintainSimulation(now);
      if (sim) return `simulating week ${sim.week} (${sim.status} ${sim.step}/${sim.totalSteps})`;
    }
    return "idle";
  }

  // (a) game clocks / scores / possession
  const games = await syncWeekGames(season, week);
  const gamesKey = JSON.stringify(games.map((x) => [x.id, x.state, x.clock, x.homeScore, x.awayScore, x.possession, x.redZone]));
  const gamesChanged = gamesKey !== mem.gamesKey;
  mem.gamesKey = gamesKey;

  // (b) stats snapshot (previous = what the DB had, next = provider now)
  const { previous, next } = await syncWeekStats(season, week);

  // (c-e) leagues currently playing this NFL week
  const leagues = (await db.league.findMany({ where: { season } }))
    .map((l) => ({ league: l, settings: resolveSettings(l.settings) }))
    .filter((x) => leagueWeekFor(x.league, x.settings, nfl) === week)
    .map((x) => ({ id: x.league.id, settings: x.settings }));

  // First sync of the week arriving mid-game (poller was down at kickoff): record the plays, but don't
  // fire a burst of stale touchdown alerts.
  const catchUp = previous.size === 0 && [...next.values()].some((st) => (st.pass_td ?? 0) + (st.rush_td ?? 0) + (st.rec_td ?? 0) > 0);
  const res = await processWeekUpdate({ season, week, previous, next, leagues, games, gamesChanged, sendAlerts: !catchUp });
  const inProgress = games.filter((x) => x.state === "in").length;
  return `live week ${week}: ${inProgress} in progress, ${res.changedPlayers} players changed, ${res.events} plays, ${res.matchupsChanged} matchups, ${res.alerts} alerts${catchUp ? " (catch-up sync, alerts suppressed)" : ""}`;
}

/** SIMULATED_LIVE=true: keep a simulation of the current week running whenever its real games haven't started. */
async function runSimulatedEnv(season: number, week: number): Promise<string> {
  const sim = await maintainSimulation();
  if (sim) {
    if (sim.status === "running" && !simLoopRunning()) ensureSimLoop(sim.intervalMs);
    return `simulating week ${sim.week} (${sim.status} ${sim.step}/${sim.totalSteps})`;
  }
  const avail = await simAvailability(season, week);
  if (!avail.ok) return `idle (simulation unavailable: ${avail.reason})`;
  const res = await startSimulation({ season, week, speed: "normal", alerts: true, startedById: null, leagueId: null, driver: "env" });
  return res.ok ? `simulation started for week ${week}` : `idle (${res.error})`;
}
