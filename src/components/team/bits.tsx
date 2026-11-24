// Small presentational pieces shared by team pages (server-safe, no hooks).
import { cn, fmtMoney } from "@/lib/utils";
import type { Difficulty } from "@/lib/team/types";

const TONE: Record<Difficulty, string> = {
  easy: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800",
  avg: "bg-sunken text-muted border-line",
  tough: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800",
};

const TONE_LABEL: Record<Difficulty, string> = { easy: "Easy", avg: "Avg", tough: "Tough" };

/** Opponent-rank chip: rank 1 = toughest defense vs the position */
export function DifficultyChip({ rank, of, tone, perGame, showLabel, className }: { rank: number; of: number; tone: Difficulty; perGame?: number; showLabel?: boolean; className?: string }) {
  const title = `${ordinalNum(rank)} of ${of} vs position${perGame !== undefined ? ` · ${perGame.toFixed(1)} FPts allowed/game` : ""} (1 = toughest)`;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-bold tabular-nums leading-4", TONE[tone], className)}>
      {showLabel && <span className="uppercase tracking-wide">{TONE_LABEL[tone]}</span>}
      {rank}
    </span>
  );
}

function ordinalNum(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Horizontal cap meter: committed vs cap with dead money highlighted */
export function CapMeter({ committed, deadMoney, cap, className }: { committed: number; deadMoney: number; cap: number; className?: string }) {
  const pct = cap > 0 ? Math.min(100, (committed / cap) * 100) : 0;
  const deadPct = cap > 0 ? Math.min(pct, (deadMoney / cap) * 100) : 0;
  const over = committed > cap;
  return (
    <div className={cn("w-full", className)}>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line"
        role="meter"
        aria-label="Salary cap used"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={committed}
      >
        <div className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-loss" : pct > 92 ? "bg-amber-500" : "bg-brand-600 dark:bg-brand-500")} style={{ width: `${pct}%` }} />
        {deadPct > 0 && <div className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(45deg,rgb(220_38_38/0.85)_0_3px,rgb(220_38_38/0.55)_3px_6px)]" style={{ width: `${deadPct}%` }} title={`Dead money ${fmtMoney(deadMoney)}`} />}
      </div>
    </div>
  );
}

/** "Active 25/27" count with over-limit styling */
export function CountPill({ label, value, max, money, className }: { label: string; value: number; max: number | null; money?: boolean; className?: string }) {
  const over = max !== null && value > max;
  const full = max !== null && value === max;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 text-xs", className)}>
      <span className="font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className={cn("font-bold tabular-nums", over ? "text-loss" : full ? "text-amber-600 dark:text-amber-400" : "text-ink")}>
        {money ? fmtMoney(value) : value}
        {max !== null && <span className="font-medium text-muted">/{max}</span>}
      </span>
    </span>
  );
}

export function ContractBadges({ isRookie, isTagged, years, className }: { isRookie: boolean; isTagged: boolean; years: number | null; className?: string }) {
  return (
    <span className={cn("inline-flex gap-0.5", className)}>
      {isRookie && <span title="Rookie contract" className="rounded bg-sky-100 px-1 text-[9px] font-extrabold uppercase leading-4 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">R</span>}
      {isTagged && <span title="Franchise tag" className="rounded bg-purple-100 px-1 text-[9px] font-extrabold uppercase leading-4 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200">FT</span>}
      {years !== null && years <= 1 && <span title="Expiring after this season" className="rounded bg-amber-100 px-1 text-[9px] font-extrabold uppercase leading-4 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">EXP</span>}
    </span>
  );
}
