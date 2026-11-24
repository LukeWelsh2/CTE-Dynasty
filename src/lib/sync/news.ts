// "sync-news" job entry point: ESPN player news + injury reports (+ injury alerts to managers).
// The implementation (src/lib/players/news-sync.ts) sends notifications (web-push / nodemailer), which can't be
// bundled for the edge runtime. The positive runtime check lets the bundler drop that import from the edge
// instrumentation build; in Node (server, jobs, scripts) it always runs.
export async function syncNewsAndInjuries(opts: { fantasyBatch?: number } = {}): Promise<{ news: number; injuries: number; alerts: number }> {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { syncNewsAndInjuriesImpl } = await import("@/lib/players/news-sync");
    return syncNewsAndInjuriesImpl(opts);
  }
  return { news: 0, injuries: 0, alerts: 0 };
}
