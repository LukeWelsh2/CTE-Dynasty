// CLI: npm run sync:players | npm run sync:all
// Pulls NFL data from Sleeper + ESPN into the database.
import { db } from "@/lib/db";
import { syncPlayers, syncWeekStats, syncWeekProjections } from "@/lib/sync/sleeper";
import { syncSeasonSchedule } from "@/lib/sync/espn-schedule";
import { getNflState } from "@/lib/nfl/state";

async function main() {
  const what = process.argv[2] ?? "all";
  const t0 = Date.now();
  const state = await getNflState(true);
  console.log(`NFL state: season ${state.season}, week ${state.week} (${state.seasonType})`);

  if (what === "players" || what === "all") {
    const n = await syncPlayers();
    console.log(`players: ${n}`);
  }
  if (what === "schedule" || what === "all") {
    const n = await syncSeasonSchedule(state.season);
    console.log(`schedule games: ${n}`);
  }
  if (what === "stats" || what === "all") {
    const through = state.seasonType === "regular" ? state.week : 18;
    for (let w = 1; w <= through; w++) {
      const r = await syncWeekStats(state.season, w);
      console.log(`stats week ${w}: ${r.count}`);
    }
  }
  if (what === "projections" || what === "all") {
    for (let w = Math.max(1, state.week - 1); w <= 18; w++) {
      const n = await syncWeekProjections(state.season, w);
      console.log(`projections week ${w}: ${n}`);
    }
  }
  if (what === "news" || what === "all") {
    try {
      const mod = await import("@/lib/sync/news");
      const r = await mod.syncNewsAndInjuries();
      console.log(`news/injuries:`, r);
    } catch (e) {
      console.log("news sync skipped:", (e as Error).message);
    }
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
