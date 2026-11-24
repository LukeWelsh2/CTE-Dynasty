// Starts croner schedules for every job in the registry (once per process).
import { Cron } from "croner";
import { JOBS, runJob } from "@/lib/jobs/registry";

const g = globalThis as unknown as { __cteScheduler?: Cron[] };

export function startScheduler() {
  if (g.__cteScheduler) return g.__cteScheduler;
  const crons = JOBS.map(
    (j) =>
      new Cron(j.schedule, { timezone: "America/New_York", protect: true, catch: true }, () => {
        void runJob(j.name);
      }),
  );
  g.__cteScheduler = crons;
  console.log(`[cte] scheduler started with ${crons.length} jobs`);
  return crons;
}
