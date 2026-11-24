// Trade value visuals: per-asset value bars with component tooltips, the fairness meter, cap impact.
// Presentational only (no hooks) so both server pages and client builders can use them.
import { cn } from "@/lib/utils";
import { COMPONENT_COLORS, money, signed } from "@/lib/trades/format";
import { OUTLOOK_LABEL, fmtValue, type TeamOutlook, type ValueComponent } from "@/lib/value/model";

export function ValueBar({ value, max, components, className, label }: { value: number; max: number; components?: ValueComponent[]; className?: string; label?: string }) {
  const width = max > 0 ? Math.max(2, Math.min(100, (Math.max(0, value) / max) * 100)) : 0;
  const pos = (components ?? []).filter((c) => c.value > 0);
  const posTotal = pos.reduce((a, c) => a + c.value, 0);
  return (
    <span className={cn("group relative inline-flex w-full min-w-[96px] items-center gap-2 outline-none", className)} tabIndex={components?.length ? 0 : -1} aria-label={label ? `${label} value ${fmtValue(value)}` : undefined}>
      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line">
        <span className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${width}%` }}>
          {pos.length ? (
            pos.map((c) => <span key={c.key} className={cn("h-full", COMPONENT_COLORS[c.key] ?? "bg-brand-600")} style={{ width: `${(c.value / posTotal) * 100}%` }} />)
          ) : (
            <span className="h-full w-full bg-brand-600" />
          )}
        </span>
      </span>
      <span className={cn("w-9 shrink-0 text-right text-xs font-bold tabular-nums", value < 0 ? "text-loss" : "text-ink")}>{fmtValue(value)}</span>
      {components && components.length > 0 && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-72 max-w-[85vw] rounded-lg border border-line bg-panel p-2.5 text-left text-xs shadow-pop group-hover:block group-focus:block">
          {label && <span className="mb-1.5 block font-semibold text-ink">{label}</span>}
          <span className="block space-y-1">
            {components.map((c) => (
              <span key={c.key} className="flex items-start gap-2">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-sm", COMPONENT_COLORS[c.key] ?? "bg-brand-600")} />
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2">
                    <span className="font-medium text-ink">{c.label}</span>
                    <span className={cn("tabular-nums font-semibold", c.value < 0 ? "text-loss" : "text-ink")}>{signed(c.value, 1)}</span>
                  </span>
                  {c.note && <span className="block text-[11px] leading-snug text-muted">{c.note}</span>}
                </span>
              </span>
            ))}
          </span>
          <span className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold text-ink">
            <span>Total value</span>
            <span className="tabular-nums">{fmtValue(value)}</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** Inline component chips for places where hover isn't practical (detail page) */
export function ComponentList({ components, className }: { components: ValueComponent[]; className?: string }) {
  if (!components.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)}>
      {components.map((c) => (
        <li key={c.key} title={c.note} className="inline-flex items-center gap-1 rounded border border-line bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-muted">
          <span className={cn("h-1.5 w-1.5 rounded-sm", COMPONENT_COLORS[c.key] ?? "bg-brand-600")} />
          {c.label}
          <span className={cn("font-bold tabular-nums", c.value < 0 ? "text-loss" : "text-ink")}>{signed(c.value, 1)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface MeterTeam {
  teamId: string;
  name: string;
  received: number;
  net: number;
  outlook?: TeamOutlook;
  color?: string;
}

const VERDICT_TONE = {
  fair: "text-win",
  slight: "text-amber-600 dark:text-amber-400",
  lopsided: "text-loss",
} as const;

/** Fairness meter: each team's received value as a share of the deal, verdict and fairness %. */
export function FairnessMeter({
  teams,
  fairness,
  verdict,
  tone,
  className,
  compact,
}: {
  teams: MeterTeam[];
  fairness: number;
  verdict: string;
  tone: keyof typeof VERDICT_TONE;
  className?: string;
  compact?: boolean;
}) {
  const total = teams.reduce((a, t) => a + Math.max(0, t.received), 0);
  const palette = ["#1f3fa1", "#f5b301", "#16a34a", "#9333ea"];
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("font-display font-bold uppercase tracking-wide", compact ? "text-sm" : "text-lg", VERDICT_TONE[tone])}>{verdict}</span>
        <span className="text-xs text-muted">
          Fairness <span className="font-bold tabular-nums text-ink">{Math.round(fairness * 100)}%</span>
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line" role="img" aria-label={teams.map((t) => `${t.name} receives ${fmtValue(t.received)}`).join(", ")}>
        {total > 0 &&
          teams.map((t, i) => (
            <span key={t.teamId} className="h-full border-r border-panel last:border-r-0" style={{ width: `${(Math.max(0, t.received) / total) * 100}%`, background: t.color ?? palette[i % palette.length] }} />
          ))}
      </div>
      {!compact && (
        <div className="grid gap-1 text-xs" style={{ gridTemplateColumns: `repeat(${Math.min(teams.length, 4)}, minmax(0, 1fr))` }}>
          {teams.map((t, i) => (
            <div key={t.teamId} className={cn("min-w-0", i === teams.length - 1 && teams.length === 2 && "text-right")}>
              <div className="flex items-center gap-1 truncate font-semibold text-ink" style={i === teams.length - 1 && teams.length === 2 ? { justifyContent: "flex-end" } : undefined}>
                <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: t.color ?? palette[i % palette.length] }} />
                <span className="truncate">{t.name}</span>
              </div>
              <div className="text-muted">
                gets <span className="font-bold tabular-nums text-ink">{fmtValue(t.received)}</span>
                <span className={cn("ml-1 tabular-nums", t.net >= 0 ? "text-win" : "text-loss")}>({signed(t.net, 1)})</span>
                {t.outlook && <span className="ml-1 hidden sm:inline">· {OUTLOOK_LABEL[t.outlook]}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CapLine({ before, after, cap, label = "Cap" }: { before: number; after: number; cap: number; label?: string }) {
  const delta = after - before;
  const over = after > cap;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums text-ink">{money(before)}</span>
      <span className="text-muted">→</span>
      <span className={cn("font-semibold tabular-nums", over ? "text-loss" : "text-ink")}>{money(after)}</span>
      {delta !== 0 && <span className={cn("tabular-nums", delta > 0 ? "text-loss" : "text-win")}>({delta > 0 ? "+" : "−"}${Math.abs(delta)})</span>}
      <span className={cn("tabular-nums", over ? "font-semibold text-loss" : "text-muted")}>· {over ? `${money(after - cap)} over` : `${money(cap - after)} room`}</span>
    </span>
  );
}
