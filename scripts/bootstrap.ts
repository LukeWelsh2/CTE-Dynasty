// First boot on an empty database: pull the NFL data (players, schedule, stats, projections, news) and build the
// demo CTE Dynasty league, so a fresh deployment is usable straight away. Does nothing once a league exists.
//   tsx scripts/bootstrap.ts     (run by scripts/docker-start.sh before the server starts; SEED_DEMO=false skips it)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { db } from "@/lib/db";

const STEPS: [label: string, args: string[]][] = [
  ["NFL data sync", ["scripts/sync.ts", "all"]],
  ["demo league", ["scripts/seed.ts"]],
];

async function main() {
  const leagues = await db.league.count();
  await db.$disconnect();
  if (leagues > 0) {
    console.log("[cte] league found, skipping first-boot setup");
    return;
  }
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  for (const [label, args] of STEPS) {
    const t0 = Date.now();
    console.log(`[cte] first boot: ${label}…`);
    const r = spawnSync(tsx, args, { stdio: "inherit", env: process.env });
    if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status ?? r.signal})`);
    console.log(`[cte] first boot: ${label} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

main().catch((e) => {
  console.error("[cte] first-boot setup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
