// Small presentational pieces shared by team pages (server-safe, no hooks).
import { cn, fmtMoney } from "@/lib/utils";
import type { Difficulty } from "@/lib/team/types";

// tinted pills (DESIGN.md: bg-<hue>-500/10 + text-<hue>-700 / dark -300)
const TONE: Record<Difficulty, string> = {
  easy: "bg-green-500/10 text-green-700 ring-green-600/20 dark:bg-green-400/15 dark:text-green-300 dark:ring-green-400/20",
  avg: "bg-ink/[0.06] text-muted ring-ink/10 dark:bg-white/[0.07] dark:ring-white/10",
  tough: "bg-red-500/10 text-red-700 ring-red-600/20 dark:bg-red-400/15 dark:text-red-300 dark:ring-red-400/20",
};

const TONE_LABEL: Record<Difficulty, string> = { easy: "Easy", avg: "Avg", tough: "Tough" };

/** Opponent-rank chip: rank 1 = toughest defense vs the position */
export function DifficultyChip({ rank, of, tone, perGame, showLabel, className }: { rank: number; of: number; tone: Difficulty; perGame?: number; showLabel?: boolean; className?: string }) {
  const title = `${ordinalNum(rank)} of ${of} vs position${perGame !== undefined ? ` · ${perGame.toFixed(1)} FPts allowed/game` : ""} (1 = toughest)`;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums leading-4 ring-1 ring-inset", TONE[tone], className)}>
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

/** Horizontal cap meter (the kit's Meter look): committed vs cap with dead money hatched in red */
export function CapMeter({ committed, deadMoney, cap, className }: { committed: number; deadMoney: number; cap: number; className?: string }) {
  const pct = cap > 0 ? Math.min(100, (committed / cap) * 100) : 0;
  const deadPct = cap > 0 ? Math.min(pct, (deadMoney / cap) * 100) : 0;
  const over = committed > cap;
  return (
    <div className={cn("w-full", className)}>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]"
        role="meter"
        aria-label="Salary cap used"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={committed}
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-expo", over ? "bg-loss" : pct > 92 ? "bg-amber-500" : "bg-brand-600 dark:bg-brand-400")}
          style={{ width: `${pct}%` }}
        />
        {deadPct > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-[repeating-linear-gradient(45deg,rgb(220_38_38/0.9)_0_3px,rgb(220_38_38/0.55)_3px_6px)]"
            style={{ width: `${deadPct}%` }}
            title={`Dead money ${fmtMoney(deadMoney)}`}
          />
        )}
      </div>
    </div>
  );
}

/** "Active 25/27" count chip with over-limit styling */
export function CountPill({ label, value, max, money, className }: { label: string; value: number; max: number | null; money?: boolean; className?: string }) {
  const over = max !== null && value > max;
  const full = max !== null && value === max;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-sunken px-2.5 py-1 text-xs ring-1 ring-inset ring-line/80", over && "bg-red-500/10 ring-red-500/25 dark:bg-red-400/10", className)}>
      <span className="font-medium text-muted">{label}</span>
      <span className={cn("numeral font-semibold", over ? "text-loss" : full ? "text-amber-700 dark:text-amber-300" : "text-ink")}>
        {money ? fmtMoney(value) : value}
        {max !== null && <span className="font-medium text-muted">/{max}</span>}
      </span>
    </span>
  );
}

const TAG = "inline-flex h-4 items-center rounded px-1 text-[10px] font-bold uppercase leading-none";

export function ContractBadges({ isRookie, isTagged, years, className }: { isRookie: boolean; isTagged: boolean; years: number | null; className?: string }) {
  return (
    <span className={cn("inline-flex gap-0.5", className)}>
      {isRookie && (
        <span title="Rookie contract" className={cn(TAG, "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300")}>
          R
        </span>
      )}
      {isTagged && (
        <span title="Franchise tag" className={cn(TAG, "bg-purple-500/10 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300")}>
          FT
        </span>
      )}
      {years !== null && years <= 1 && (
        <span title="Expiring after this season" className={cn(TAG, "bg-amber-400/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300")}>
          EXP
        </span>
      )}
    </span>
  );
}
