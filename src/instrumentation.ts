// Next.js calls register() once when the server starts. We boot the background job scheduler here
// (live scoring, waivers, recaps, data sync). Disable with JOBS_ENABLED=false.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.JOBS_ENABLED === "false") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("@/lib/jobs/scheduler");
  startScheduler();
}
