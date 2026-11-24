// Trade value visuals: per-asset value bars with component tooltips, the fairness meter, cap impact.
// Presentational only (no hooks) so both server pages and client builders can use them. v3 (docs/DESIGN.md): one
// blue for the first side, grey for the other, verdict in win / amber / loss, numbers tabular.
import { cn } from "@/lib/utils";
import { COMPONENT_COLORS as BASE_COLORS, money, signed } from "@/lib/trades/format";
import { OUTLOOK_LABEL, fmtValue, type TeamOutlook, type ValueComponent } from "@/lib/value/model";

// value-component colour keys (gold is for trophies only in v3: the contract share reads amber)
const COMPONENT_COLORS: Record<string, string> = { ...BASE_COLORS, contract: "bg-amber-500" };

/** Value number with a thin bar under it, scaled to the biggest asset in view (component breakdown on hover / focus). */
export function ValueBar({ value, max, components, className, label }: { value: number; max: number; components?: ValueComponent[]; className?: string; label?: string }) {
  const width = max > 0 ? Math.max(3, Math.min(100, (Math.max(0, value) / max) * 100)) : 0;
  const pos = (components ?? []).filter((c) => c.value > 0);
  const posTotal = pos.reduce((a, c) => a + c.value, 0);
  return (
    <span
      className={cn("group relative flex w-14 flex-col items-end gap-1 outline-none", className)}
      tabIndex={components?.length ? 0 : -1}
      aria-label={label ? `${label} value ${fmtValue(value)}` : undefined}
    >
      <span className={cn("numeral text-[15px] font-semibold leading-5", value < 0 ? "text-loss" : "text-ink")}>{fmtValue(value)}</span>
      <span className="flex h-1 w-full justify-start overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]" aria-hidden>
        <span className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }}>
          {pos.length ? (
            pos.map((c) => <span key={c.key} className={cn("h-full", COMPONENT_COLORS[c.key] ?? "bg-brand-600")} style={{ width: `${(c.value / posTotal) * 100}%` }} />)
          ) : (
            <span className="h-full w-full bg-brand-600 dark:bg-brand-400" />
          )}
        </span>
      </span>
      {components && components.length > 0 && (
        <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-72 max-w-[85vw] rounded-xl bg-raised p-3 text-left text-[13px] shadow-pop md:group-hover:block md:group-focus:block">
          {label && <span className="mb-1.5 block font-semibold text-ink">{label}</span>}
          <ComponentList components={components} />
          <span className="mt-1.5 flex justify-between border-t border-line/70 pt-1.5 font-semibold text-ink">
            <span>Total value</span>
            <span className="numeral">{fmtValue(value)}</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** What a value is made of: one line per component (colour key · label · signed points, grey note under). */
export function ComponentList({ components, className }: { components: ValueComponent[]; className?: string }) {
  if (!components.length) return null;
  return (
    <ul className={cn("space-y-1.5", className)}>
      {components.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-[13px] leading-[18px]">
          <span className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-sm", COMPONENT_COLORS[c.key] ?? "bg-brand-600")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex justify-between gap-2">
              <span className="font-medium text-ink">{c.label}</span>
              <span className={cn("numeral shrink-0 font-semibold", c.value < 0 ? "text-loss" : "text-ink")}>{signed(c.value, 1)}</span>
            </span>
            {c.note && <span className="block text-[12px] leading-4 text-muted">{c.note}</span>}
          </span>
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
  slight: "text-amber-700 dark:text-amber-300",
  lopsided: "text-loss",
} as const;

/** Side colours: the one blue for the first team, greys for the rest (team colours stay in the logos). */
const SIDE_COLORS = ["rgb(var(--c-accent))", "rgb(var(--c-ink) / 0.5)", "rgb(var(--c-ink) / 0.28)", "rgb(var(--c-ink) / 0.14)"];
export const sideColor = (i: number) => SIDE_COLORS[i % SIDE_COLORS.length]!;

/** Fairness meter: verdict + fairness %, each team's received value as a share of the deal, and (full) a legend. */
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
  const two = teams.length === 2;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("min-w-0 truncate font-semibold", compact ? "text-[14px]" : "text-[15px]", VERDICT_TONE[tone])} title={verdict}>
          {verdict}
        </span>
        <span className="shrink-0 text-[13px] text-muted">
          Fairness <span className="numeral font-semibold text-ink">{Math.round(fairness * 100)}%</span>
        </span>
      </div>
      <div className="mt-1.5 flex h-2 w-full gap-[3px]" role="img" aria-label={teams.map((t) => `${t.name} receives ${fmtValue(t.received)}`).join(", ")}>
        {total > 0 ? (
          teams.map((t, i) => (
            <span
              key={t.teamId}
              className="wp-seg h-full min-w-[3px] rounded-full"
              style={{ width: `${(Math.max(0, t.received) / total) * 100}%`, ["--seg" as string]: t.color ?? sideColor(i) }}
            />
          ))
        ) : (
          <span className="h-full w-full rounded-full bg-ink/[0.07] dark:bg-white/[0.08]" />
        )}
      </div>
      {!compact && (
        <div className={cn("mt-2 grid gap-x-3 gap-y-1.5", two ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
          {teams.map((t, i) => {
            const right = two && i === 1;
            return (
              <div key={t.teamId} className={cn("min-w-0", right && "text-right")}>
                <div className={cn("flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink", right && "justify-end")}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color ?? sideColor(i) }} aria-hidden />
                  <span className="truncate" title={t.name}>
                    {t.name}
                  </span>
                </div>
                <div className="numeral text-[13px] text-muted">
                  gets <span className="font-semibold text-ink">{fmtValue(t.received)}</span> <span className={t.net >= 0 ? "text-win" : "text-loss"}>{signed(t.net, 1)}</span>
                  {t.outlook && <span className="hidden sm:inline"> · {OUTLOOK_LABEL[t.outlook]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Cap $294 → $321 +$27 · $21 over" (13px, never wraps mid-number). */
export function CapLine({ before, after, cap, label = "Cap" }: { before: number; after: number; cap: number; label?: string }) {
  const delta = after - before;
  const over = after > cap;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 text-[13px] leading-5">
      <span className="text-muted">{label}</span>
      <span className="numeral text-ink">{money(before)}</span>
      <span className="text-faint" aria-hidden>
        →
      </span>
      <span className={cn("numeral font-semibold", over ? "text-loss" : "text-ink")}>{money(after)}</span>
      {delta !== 0 && <span className={cn("numeral", delta > 0 ? "text-loss" : "text-win")}>{delta > 0 ? "+" : "−"}${Math.abs(delta)}</span>}
      <span className={cn("numeral whitespace-nowrap", over ? "font-semibold text-loss" : "text-muted")}>· {over ? `${money(after - cap)} over` : `${money(cap - after)} room`}</span>
    </span>
  );
}
