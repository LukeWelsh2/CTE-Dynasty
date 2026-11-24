// Next.js calls register() once when the server starts. We boot the background job scheduler here
// (live scoring, waivers, recaps, data sync). Disable with JOBS_ENABLED=false.
//
// The import must sit inside a *positive* NEXT_RUNTIME check: webpack only drops the job graph
// (which pulls in Node-only packages like web-push) from the edge bundle when the import is
// lexically inside the `=== "nodejs"` branch. An early `return` is not enough.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.JOBS_ENABLED !== "false" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startScheduler } = await import("@/lib/jobs/scheduler");
    startScheduler();
  }
}
