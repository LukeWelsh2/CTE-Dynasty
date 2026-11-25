// Small server-safe pieces shared by the transactions, waivers, keepers and season pages.
import { TabLinks } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function TxNav({ active }: { active: "log" | "waivers" }) {
  return (
    <TabLinks
      active={active}
      tabs={[
        { key: "log", label: "Transactions", href: "/transactions" },
        { key: "waivers", label: "Waivers & FAB", href: "/waivers" },
      ]}
    />
  );
}

/** Money chip: "$12 FAB", "$4 sal", "$2 dead" — a quiet tinted pill, tabular, never wraps. */
export function MoneyChip({ amount, kind, className }: { amount: number; kind: "fab" | "salary" | "dead"; className?: string }) {
  const tone =
    kind === "fab"
      ? "bg-green-500/10 text-green-800 dark:bg-green-400/15 dark:text-green-300"
      : kind === "dead"
        ? "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300"
        : "bg-ink/[0.05] text-ink dark:bg-white/[0.08]";
  return (
    <span className={cn("numeral inline-flex shrink-0 items-center rounded-full px-2 py-px text-[12px] font-semibold leading-[18px]", tone, className)}>
      ${amount}
      <span className="ml-1 text-[11px] font-semibold uppercase tracking-[0.04em] opacity-75">{kind === "fab" ? "FAB" : kind === "dead" ? "dead" : "sal"}</span>
    </span>
  );
}

/** Payroll vs cap bar (dead money shaded at the start). */
export function PayrollMeter({ committed, cap, dead = 0, className }: { committed: number; cap: number; dead?: number; className?: string }) {
  const pct = cap > 0 ? Math.min(100, (committed / cap) * 100) : 0;
  const deadPct = cap > 0 ? Math.min(pct, (dead / cap) * 100) : 0;
  const over = committed > cap;
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]", className)} role="meter" aria-label="Payroll against the cap" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={committed}>
      <div className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-loss" : pct > 92 ? "bg-amber-500" : "bg-brand-600 dark:bg-brand-400")} style={{ width: `${pct}%` }} />
      {deadPct > 0 && <div className="absolute inset-y-0 left-0 rounded-l-full bg-loss/60" style={{ width: `${deadPct}%` }} />}
    </div>
  );
}

/** Label + value line for rule summaries (a StatRow-style key / value line). */
export function RuleLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-baseline justify-between gap-4 border-b border-line/70 py-2 text-[15px] last:border-0 sm:text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
