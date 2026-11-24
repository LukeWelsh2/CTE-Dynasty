"use client";
// Live evaluation panel: what each team receives (value bars with component tooltips), fairness meter,
// cap + roster impact and rule problems. Shared by the trade builder and the calculator.
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
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

export function PreviewPanel({ preview, loading, capEnabled, emptyText = "Add players, picks or FAB to see the evaluation." }: { preview: PreviewResponse | null; loading: boolean; capEnabled: boolean; emptyText?: string }) {
  const ev = preview?.evaluation;
  if (!ev || !ev.assets.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-panel/60 px-4 py-6 text-sm text-muted">
        {loading && <Loader2 size={14} className="animate-spin" />}
        {emptyText}
      </div>
    );
  }
  const maxValue = Math.max(10, ...ev.assets.map((a) => a.value));
  const multi = ev.teams.length > 2;
  const nameOf = new Map(ev.teams.map((t) => [t.teamId, t.name]));
  const impacts = new Map((preview?.validation?.impacts ?? []).map((i) => [i.teamId, i]));
  return (
    <div className={cn("space-y-3 transition-opacity", loading && "opacity-60")}>
      <div className="rounded-lg border border-line bg-panel p-3 shadow-panel">
        <FairnessMeter teams={ev.teams.map((t) => ({ teamId: t.teamId, name: t.name, received: t.received, net: t.net, outlook: t.outlook }))} fairness={ev.fairness} verdict={ev.verdict} tone={ev.verdictTone} />
        <p className="mt-2 text-[11px] text-muted">
          Values: {ev.mode === "auto" ? "each asset for the team receiving it (team outlook)" : `${OUTLOOK_LABEL[ev.mode]} weighting for every team`}. Side totals include a consolidation adjustment — one stud is worth more than two
          mid-level pieces with the same raw sum.
        </p>
      </div>
      {preview?.validation && (preview.validation.errors.length > 0 || preview.validation.warnings.length > 0) && (
        <div className="space-y-1.5">
          {preview.validation.errors.map((e) => (
            <p key={e} className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100">
              <XCircle size={14} className="mt-px shrink-0" /> {e}
            </p>
          ))}
          {preview.validation.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
              <AlertTriangle size={14} className="mt-px shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
      {!preview?.validation && ev.warnings.length > 0 && (
        <div className="space-y-1.5">
          {ev.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
              <AlertTriangle size={14} className="mt-px shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
      <div className={cn("grid gap-3", multi ? "xl:grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2")}>
        {ev.teams.map((t) => {
          const incoming = ev.assets.filter((a) => a.toTeamId === t.teamId);
          const imp = impacts.get(t.teamId);
          return (
            <div key={t.teamId} className="rounded-lg border border-line bg-panel shadow-panel">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-sunken/70 px-3 py-1.5">
                <span className="truncate text-sm font-bold text-ink">{t.name} gets</span>
                <span className="text-right">
                  <span className="font-display text-lg font-bold tabular-nums text-ink">{fmtValue(t.received)}</span>
                  {Math.abs(t.consolidation) >= 0.5 && <span className="ml-1 text-[10px] text-muted">(raw {fmtValue(t.receivedRaw)})</span>}
                </span>
              </div>
              <div className="divide-y divide-line/60 px-3">
                {incoming.length ? (
                  incoming.map((a) => <AssetLine key={a.key} asset={a} maxValue={maxValue} dense fromName={multi ? nameOf.get(a.fromTeamId) : undefined} />)
                ) : (
                  <p className="py-2 text-xs text-muted">Nothing yet.</p>
                )}
              </div>
              {(t.cap || t.roster) && (
                <div className="space-y-0.5 border-t border-line px-3 py-1.5">
                  {capEnabled && t.cap && <CapLine before={t.cap.before} after={t.cap.after} cap={t.cap.cap} label="Cap" />}
                  {capEnabled && t.cap && t.cap.nextAfter !== t.cap.nextBefore && <CapLine before={t.cap.nextBefore} after={t.cap.nextAfter} cap={t.cap.nextCap} label="Next yr" />}
                  {t.roster && (
                    <div className="text-xs">
                      <span className="text-muted">Roster</span>{" "}
                      <span className="tabular-nums text-ink">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
