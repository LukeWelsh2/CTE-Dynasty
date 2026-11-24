// Section navigation + league trade-rules strip shared by every trade page, and the pure (client-safe) cap wording
// and drop math the trade pages and the accept dialog share.
import { Ban, CalendarClock, Gavel, Lock, Scale, ShieldCheck, Ticket, Timer, DollarSign, Users } from "lucide-react";
import { InfoButton, TabLinks } from "@/components/ui/core";
import type { TradeRulesSummary } from "@/lib/trades/assets";
import { cn, fmtMoney } from "@/lib/utils";

/**
 * The cap chip of the rules strip, as checkTrade applies the cap: over-cap trades must be fixed while
 * trades.requireCapCompliance holds under a blocking cap (requireCapCompliance), only carry a warning while the cap is
 * checked at all (capEnforcement WARN, or BLOCK without trades.requireCapCompliance) and nothing otherwise.
 */
export function tradeCapRuleText(rules: Pick<TradeRulesSummary, "requireCapCompliance" | "capMode" | "capLimit" | "capLimitLabel">): string {
  if (rules.requireCapCompliance && rules.capLimit !== null) return `Must stay under the ${fmtMoney(rules.capLimit)} ${rules.capLimitLabel}`;
  if (rules.capMode !== "OFF" && rules.capLimit !== null) return "Cap is only a warning in trades";
  return "Cap not enforced in trades";
}

/** A drop the accept dialog offers: its cap hit (spotCapHit) and the dead money its release adds this season. */
export interface AcceptDropCap {
  id: string;
  capHit: number;
  deadMoney: number;
  status: string;
}

/**
 * What the drops picked in the accept dialog clear, counted the way the server's checkTrade counts them: each drop takes
 * its cap hit off this season's payroll (an IR player who doesn't count against the cap frees $0, a taxi player only
 * his taxi share) and adds the dead money of his release; only an active player clears an active-roster spot.
 */
export function acceptDropTally(candidates: readonly AcceptDropCap[], dropIds: readonly string[]): { freed: number; activeDrops: number } {
  const picked = candidates.filter((c) => dropIds.includes(c.id));
  return {
    freed: picked.reduce((a, c) => a + c.capHit - c.deadMoney, 0),
    activeDrops: picked.filter((c) => c.status !== "IR" && c.status !== "TAXI").length,
  };
}

export function TradesNav({ active, showBlock, isCommish, counts }: { active: string; showBlock: boolean; isCommish?: boolean; counts?: { received?: number } }) {
  const tabs = [
    { key: "center", label: counts?.received ? `Offers (${counts.received})` : "Offers", href: "/trades" },
    { key: "new", label: "Propose", href: "/trades/new" },
    { key: "calculator", label: "Calculator", href: "/trades/calculator" },
    ...(showBlock ? [{ key: "block", label: "Trade block", href: "/trades/block" }] : []),
    { key: "history", label: "History", href: "/trades/history" },
    ...(isCommish ? [{ key: "commish", label: "Commish review", href: "/commissioner/trades" }] : []),
  ];
  return <TabLinks tabs={tabs} active={active} />;
}

/**
 * The trading window as one status line (open / closing this week / closed) with every league trade rule behind an ⓘ
 * sheet — the rules are reference material, the window is the one thing a manager needs at a glance.
 */
export function TradeRulesStrip({ rules, className }: { rules: TradeRulesSummary; className?: string }) {
  const review =
    rules.reviewType === "NONE"
      ? "No review"
      : rules.reviewType === "COMMISSIONER"
        ? "Commissioner approval"
        : `League vote · ${rules.vetoVotesRequired} vetoes · ${rules.reviewPeriodHours}h${rules.voteEligibility === "ALL_TEAMS" ? " · every team votes" : ""}`;
  const untradable = [!rules.irTradable && "IR", !rules.taxiTradable && "taxi"].filter(Boolean).join(" and ");
  const windowText = rules.windowOpen ? rules.windowNote ?? "Trading open" : rules.windowReason ?? "Trading closed";
  const urgent = !rules.windowOpen || !!rules.windowNote?.includes("this week");
  const items: { icon: React.ReactNode; label: string; text: string }[] = [
    { icon: <CalendarClock size={15} />, label: "Window", text: windowText },
    { icon: <Gavel size={15} />, label: "Review", text: review },
    { icon: <Timer size={15} />, label: "Offers expire", text: `After ${rules.offerExpirationHours}h` },
    ...(rules.picks && rules.pickSeasons.length ? [{ icon: <Ticket size={15} />, label: "Draft picks", text: `${rules.pickSeasons[0]}–${rules.pickSeasons[rules.pickSeasons.length - 1]} tradable${rules.picksNeedDues ? " once dues are paid" : ""}` }] : []),
    ...(rules.faab ? [{ icon: <DollarSign size={15} />, label: "FAB", text: "Tradable" }] : []),
    ...(rules.capEnabled ? [{ icon: <ShieldCheck size={15} />, label: "Salary cap", text: tradeCapRuleText(rules) }] : []),
    ...(rules.maxTeams > 2 ? [{ icon: <Users size={15} />, label: "Teams per trade", text: `Up to ${rules.maxTeams}` }] : []),
    ...(rules.tradeBackCooldownDays > 0 ? [{ icon: <Timer size={15} />, label: "Trade-backs", text: `Not for ${rules.tradeBackCooldownDays} days` }] : []),
    ...(rules.maxPlayersPerSide ? [{ icon: <Users size={15} />, label: "Players per side", text: `Max ${rules.maxPlayersPerSide}` }] : []),
    ...(!rules.allowUnbalanced ? [{ icon: <Scale size={15} />, label: "Player counts", text: "Even counts only" }] : []),
    ...(untradable ? [{ icon: <Ban size={15} />, label: "Untradable", text: `${untradable[0].toUpperCase()}${untradable.slice(1)} players` }] : []),
    ...(rules.lockedPlayersPolicy === "BLOCK" ? [{ icon: <Lock size={15} />, label: "Locked players", text: "Players who already played wait for next week" }] : []),
    ...(rules.retainMax > 0 ? [{ icon: <DollarSign size={15} />, label: "Salary retention", text: `Up to ${rules.retainMax}% of a salary` }] : []),
  ];
  return (
    <div className={cn("mb-3 flex min-h-10 items-center gap-2", className)}>
      <span
        title={windowText}
        className={cn(
          "inline-flex min-w-0 items-start gap-2 rounded-xl px-3 py-1.5 text-[13px] font-semibold leading-[18px]",
          !rules.windowOpen ? "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300" : urgent ? "bg-amber-400/15 text-amber-800 dark:text-amber-300" : "bg-green-500/10 text-green-700 dark:bg-green-400/15 dark:text-green-300",
        )}
      >
        <span aria-hidden className={cn("mt-[5px] h-2 w-2 shrink-0 rounded-full", !rules.windowOpen ? "bg-loss" : urgent ? "bg-amber-500" : "bg-win")} />
        <span className="line-clamp-2 min-w-0">{windowText}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center text-[13px] font-medium text-muted">
        Rules
        <InfoButton title="Trade rules" label="League trade rules">
          <ul className="divide-y divide-line/70">
            {items.map((it) => (
              <li key={it.label} className="flex min-h-11 items-center gap-3 py-2 text-[14px]">
                <span className="shrink-0 text-muted">{it.icon}</span>
                <span className="w-28 shrink-0 text-muted">{it.label}</span>
                <span className="min-w-0 flex-1 text-right font-medium text-ink">{it.text}</span>
              </li>
            ))}
          </ul>
        </InfoButton>
      </span>
    </div>
  );
}
