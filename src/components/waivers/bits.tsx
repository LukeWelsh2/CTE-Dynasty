// Small server-safe pieces shared by the transactions, waivers, keepers and season pages.
import { TabLinks } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function TxNav({ active }: { active: "log" | "waivers" }) {
  return (
    <TabLinks
      active={active}
      tabs={[
        { key: "log", label: "Transaction Log", href: "/transactions" },
        { key: "waivers", label: "Waivers & FAB", href: "/waivers" },
      ]}
    />
  );
}

/** Money chip: "$12 FAB", "$4 sal" */
export function MoneyChip({ amount, kind, className }: { amount: number; kind: "fab" | "salary" | "dead"; className?: string }) {
  const tone =
    kind === "fab"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
      : kind === "dead"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
        : "border-line bg-sunken text-ink";
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-px text-[11px] font-bold tabular-nums leading-4", tone, className)}>
      ${amount}
      <span className="ml-0.5 font-semibold uppercase tracking-wide opacity-70">{kind === "fab" ? "FAB" : kind === "dead" ? "dead" : "sal"}</span>
    </span>
  );
}

/** Payroll vs cap bar */
export function PayrollMeter({ committed, cap, dead = 0, className }: { committed: number; cap: number; dead?: number; className?: string }) {
  const pct = cap > 0 ? Math.min(100, (committed / cap) * 100) : 0;
  const deadPct = cap > 0 ? Math.min(pct, (dead / cap) * 100) : 0;
  const over = committed > cap;
  return (
    <div className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line", className)} role="meter" aria-label="Payroll against the cap" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={committed}>
      <div className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-loss" : pct > 92 ? "bg-amber-500" : "bg-brand-600 dark:bg-brand-500")} style={{ width: `${pct}%` }} />
      {deadPct > 0 && <div className="absolute inset-y-0 left-0 bg-red-500/70" style={{ width: `${deadPct}%` }} />}
    </div>
  );
}

/** Label + value line for rule summaries */
export function RuleLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
