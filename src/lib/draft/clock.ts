// Draft clock entry point for the job registry ("draft-clock", every 2s).
// The engine (src/lib/draft/tick.ts) pulls in notifications (web-push / nodemailer), which can't be bundled
// for the edge runtime. The positive runtime check below lets the bundler drop that import from the edge
// instrumentation build; in Node (server, jobs, scripts) it always runs.
export async function tickDrafts(): Promise<string> {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { tickDraftsImpl } = await import("@/lib/draft/tick");
    return tickDraftsImpl();
  }
  return "skipped (edge runtime)";
}
