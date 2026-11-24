// Background job registry. Jobs run in-process (started from src/instrumentation.ts) using croner.
// Each job returns an optional status message. Run one manually with: npm run job -- <name>
import { db } from "@/lib/db";
import { getNflState } from "@/lib/nfl/state";

export interface JobDef {
  name: string;
  /** croner pattern (6 fields = with seconds). Times are in America/New_York. */
  schedule: string;
  description: string;
  run: () => Promise<string | void>;
  /** don't record JobRun rows (very frequent jobs) */
  quiet?: boolean;
}

const LIVE_SECONDS = Math.max(10, Number(process.env.LIVE_POLL_SECONDS || 20));

export const JOBS: JobDef[] = [
  {
    name: "sync-players",
    schedule: "15 4 * * *",
    description: "Refresh every NFL player (team, injury, depth chart, bio) from Sleeper",
    run: async () => {
      const { syncPlayers } = await import("@/lib/sync/sleeper");
      return `players: ${await syncPlayers()}`;
    },
  },
  {
    name: "sync-games",
    schedule: "7 * * * *",
    description: "Refresh this week's and next week's NFL games, kickoff times and betting odds",
    run: async () => {
      const { syncWeekGames } = await import("@/lib/sync/espn-schedule");
      const s = await getNflState(true);
      const a = await syncWeekGames(s.season, s.week);
      const b = s.week < 18 ? await syncWeekGames(s.season, s.week + 1) : [];
      return `games: ${a.length + b.length}`;
    },
  },
  {
    name: "sync-projections",
    schedule: "20 */6 * * *",
    description: "Refresh weekly projections for the current and next two weeks",
    run: async () => {
      const { syncWeekProjections } = await import("@/lib/sync/sleeper");
      const s = await getNflState();
      let n = 0;
      for (let w = s.week; w <= Math.min(18, s.week + 2); w++) n += await syncWeekProjections(s.season, w);
      return `projections: ${n}`;
    },
  },
  {
    name: "sync-stat-corrections",
    schedule: "30 5 * * *",
    description: "Re-pull last week's and this week's stats (stat corrections)",
    run: async () => {
      const { syncWeekStats } = await import("@/lib/sync/sleeper");
      const s = await getNflState();
      let n = 0;
      for (const w of [s.week - 1, s.week].filter((w) => w >= 1)) n += (await syncWeekStats(s.season, w)).count;
      const { refreshAllLeagues } = await import("@/lib/jobs/league-refresh");
      await refreshAllLeagues({ includePreviousWeek: true });
      return `stats rows: ${n}`;
    },
  },
  {
    name: "sync-news",
    schedule: "*/10 * * * *",
    description: "Player news + injury reports (ESPN / Sleeper)",
    run: async () => {
      const { syncNewsAndInjuries } = await import("@/lib/sync/news");
      return JSON.stringify(await syncNewsAndInjuries());
    },
  },
  {
    name: "live-scoring",
    schedule: `*/${LIVE_SECONDS} * * * * *`,
    description: "Live scoring poller: pulls in-game stats, updates matchups instantly, sends touchdown alerts",
    quiet: true,
    run: async () => {
      const { runLiveTick } = await import("@/lib/live/poller");
      return runLiveTick();
    },
  },
  {
    name: "refresh-matchups",
    schedule: "*/15 * * * *",
    description: "Recompute projections and win probabilities for every league's current week",
    run: async () => {
      const { refreshAllLeagues } = await import("@/lib/jobs/league-refresh");
      return refreshAllLeagues();
    },
  },
  {
    name: "playoff-odds",
    schedule: "0 6 * * *",
    description: "Daily Monte Carlo playoff / championship odds and bracket update",
    run: async () => {
      const { computeAllPlayoffOdds } = await import("@/lib/sim/playoff-odds");
      return computeAllPlayoffOdds();
    },
  },
  {
    name: "process-waivers",
    schedule: "1 * * * *",
    description: "Process FAB / waiver claims when a league's waiver run is due",
    run: async () => {
      const { processDueWaivers } = await import("@/lib/waivers/process");
      return processDueWaivers();
    },
  },
  {
    name: "trade-review",
    schedule: "*/5 * * * *",
    description: "Complete trades whose review period ended, expire stale offers",
    run: async () => {
      const { processTradeReviews } = await import("@/lib/trades/jobs");
      return processTradeReviews();
    },
  },
  {
    name: "draft-clock",
    schedule: "*/2 * * * * *",
    description: "Live draft timers: close auction lots, autopick expired rookie draft picks",
    quiet: true,
    run: async () => {
      const { tickDrafts } = await import("@/lib/draft/clock");
      return tickDrafts();
    },
  },
  {
    name: "rookie-rankings",
    schedule: "45 6 * * *",
    description: "Recompute rookie rankings and snapshot movement (offseason)",
    run: async () => {
      const { refreshAllRookieRankings } = await import("@/lib/rookies/rankings");
      return refreshAllRookieRankings();
    },
  },
  {
    name: "keeper-deadlines",
    schedule: "5 * * * *",
    description: "Keeper window reminders and deadline lock",
    run: async () => {
      const { processKeeperDeadlines } = await import("@/lib/keepers/jobs");
      return processKeeperDeadlines();
    },
  },
  {
    name: "lineup-warnings",
    schedule: "0 * * * *",
    description: "Warn managers starting injured / bye-week players before kickoff",
    run: async () => {
      const { sendLineupWarnings } = await import("@/lib/insights/jobs");
      return sendLineupWarnings();
    },
  },
  {
    name: "weekly-recap",
    schedule: "10 * * * *",
    description: "Generate + email the weekly recap when the league's recap day/hour arrives",
    run: async () => {
      const { runWeeklyRecaps } = await import("@/lib/recap/jobs");
      return runWeeklyRecaps();
    },
  },
  {
    name: "cleanup",
    schedule: "40 3 * * *",
    description: "Delete expired sessions, old job logs, uploaded images nothing uses any more",
    run: async () => {
      const a = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const b = await db.jobRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 14 * 864e5) } } });
      const { cleanupOrphanUploads } = await import("@/lib/profiles/uploads-cleanup");
      const c = await cleanupOrphanUploads();
      return `sessions: ${a.count}, jobRuns: ${b.count}, uploads: ${c}`;
    },
  },
  {
    name: "proposal-deadlines",
    schedule: "7 * * * *",
    description: "Announce rule-suggestion votes whose deadline passed and remind the commissioner to decide",
    run: async () => {
      const { processProposalDeadlines } = await import("@/lib/proposals/jobs");
      return processProposalDeadlines();
    },
  },
];

const running = new Set<string>();

export async function runJob(name: string): Promise<string> {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  if (running.has(name)) return "skipped (already running)";
  running.add(name);
  const rec = job.quiet ? null : await db.jobRun.create({ data: { name } }).catch(() => null);
  try {
    const msg = (await job.run()) ?? "ok";
    if (rec) await db.jobRun.update({ where: { id: rec.id }, data: { status: "OK", message: String(msg).slice(0, 2000), finishedAt: new Date() } });
    return String(msg);
  } catch (e) {
    const message = (e as Error).stack ?? String(e);
    if (rec) await db.jobRun.update({ where: { id: rec.id }, data: { status: "ERROR", message: message.slice(0, 2000), finishedAt: new Date() } }).catch(() => {});
    else console.error(`[job ${name}]`, message);
    return `error: ${(e as Error).message}`;
  } finally {
    running.delete(name);
  }
}
