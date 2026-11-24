"use client";
// Live evaluation panel: the verdict + fairness bar, rule problems, then what each team gets (asset rows with value)
// and its cap / roster / FAB impact. Shared by the trade builder and the calculator. How values are built is behind ⓘ.
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { InfoButton } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { fmtValue, OUTLOOK_LABEL } from "@/lib/value/model";
import type { TradePreview } from "@/lib/trades/evaluate";
import type { TeamImpact } from "@/lib/trades/rules";
import { AssetLine } from "@/components/trades/trade-card";
import { CapLine, FairnessMeter } from "@/components/trades/value-display";

export interface PreviewResponse {
  evaluation: TradePreview;
  validation: { errors: string[]; warnings: string[]; impacts: TeamImpact[] } | null;
}

function Problem({ tone, children }: { tone: "error" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-[18px]",
        tone === "error" ? "bg-red-500/10 text-red-800 dark:bg-red-400/15 dark:text-red-200" : "bg-amber-400/15 text-amber-900 dark:text-amber-200",
      )}
    >
      {tone === "error" ? <XCircle size={15} className="mt-px shrink-0" aria-hidden /> : <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function PreviewPanel({ preview, loading, capEnabled, emptyText = "Add players, picks or FAB to see the evaluation." }: { preview: PreviewResponse | null; loading: boolean; capEnabled: boolean; emptyText?: string }) {
  const ev = preview?.evaluation;
  if (!ev || !ev.assets.length) {
    return (
      <div className="flex items-center gap-2 rounded-card bg-sunken px-4 py-6 text-[14px] text-muted">
        {loading && <Loader2 size={15} className="animate-spin" aria-hidden />}
        {emptyText}
      </div>
    );
  }
  const maxValue = Math.max(10, ...ev.assets.map((a) => a.value));
  const multi = ev.teams.length > 2;
  const nameOf = new Map(ev.teams.map((t) => [t.teamId, t.name]));
  const impacts = new Map((preview?.validation?.impacts ?? []).map((i) => [i.teamId, i]));
  const errors = preview?.validation?.errors ?? [];
  const warnings = preview?.validation ? preview.validation.warnings : ev.warnings;
  return (
    <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[17px] font-bold tracking-[-0.01em] text-ink">Evaluation</h3>
          <InfoButton title="How values work">
            <p className="text-[15px] text-ink/85">
              Values: {ev.mode === "auto" ? "each asset for the team receiving it (team outlook)" : `${OUTLOOK_LABEL[ev.mode]} weighting for every team`}. Side totals include a consolidation adjustment — one stud is worth more than two mid-level pieces with the
              same raw sum.
            </p>
          </InfoButton>
        </div>
        <FairnessMeter teams={ev.teams.map((t) => ({ teamId: t.teamId, name: t.name, received: t.received, net: t.net, outlook: t.outlook }))} fairness={ev.fairness} verdict={ev.verdict} tone={ev.verdictTone} />
      </section>
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.map((e) => (
            <Problem key={e} tone="error">
              {e}
            </Problem>
          ))}
          {warnings.map((w) => (
            <Problem key={w} tone="warn">
              {w}
            </Problem>
          ))}
        </div>
      )}
      <div className={cn("grid gap-3", multi ? "xl:grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2")}>
        {ev.teams.map((t) => {
          const incoming = ev.assets.filter((a) => a.toTeamId === t.teamId);
          const imp = impacts.get(t.teamId);
          return (
            <section key={t.teamId} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
                <span className="min-w-0 truncate text-[15px] font-semibold text-ink" title={t.name}>
                  {t.name} gets
                </span>
                <span className="shrink-0 text-right">
                  <span className="numeral text-[20px] font-semibold leading-6 text-ink">{fmtValue(t.received)}</span>
                  {Math.abs(t.consolidation) >= 0.5 && <span className="numeral block text-[12px] leading-4 text-muted">raw {fmtValue(t.receivedRaw)}</span>}
                </span>
              </div>
              <div className="divide-y divide-line/70 px-4">
                {incoming.length ? (
                  incoming.map((a) => <AssetLine key={a.key} asset={a} maxValue={maxValue} dense fromName={multi ? nameOf.get(a.fromTeamId) : undefined} />)
                ) : (
                  <p className="py-2 text-[13px] text-muted">Nothing yet.</p>
                )}
              </div>
              {(t.cap || t.roster) && (
                <div className="space-y-0.5 border-t border-line/70 px-4 py-2.5">
                  {capEnabled && t.cap && (
                    <div>
                      <CapLine before={t.cap.before} after={t.cap.after} cap={t.cap.cap} label="Cap" />
                    </div>
                  )}
                  {capEnabled && t.cap && t.cap.nextAfter !== t.cap.nextBefore && (
                    <div>
                      <CapLine before={t.cap.nextBefore} after={t.cap.nextAfter} cap={t.cap.nextCap} label="Next yr" />
                    </div>
                  )}
                  {t.roster && (
                    <div className="numeral text-[13px] leading-5">
                      <span className="text-muted">Roster</span>{" "}
                      <span className="text-ink">
                        {t.roster.activeBefore} → <b className={cn(t.roster.overflow > 0 && t.roster.activeAfter > t.roster.activeBefore && "text-loss")}>{t.roster.activeAfter}</b> / {t.roster.max}
                      </span>
                      {imp && imp.faabAfter !== imp.faabBefore && (
                        <span className="ml-2 text-muted">
                          FAB ${imp.faabBefore} → <b className="text-ink">${imp.faabAfter}</b>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
