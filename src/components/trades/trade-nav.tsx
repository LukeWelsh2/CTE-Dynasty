// Section navigation + league trade-rules strip shared by every trade page, and the pure (client-safe) cap wording
// and drop math the trade pages and the accept dialog share.
import { Ban, CalendarClock, Gavel, Lock, Scale, ShieldCheck, Ticket, Timer, DollarSign, Users } from "lucide-react";
import { TabLinks } from "@/components/ui/core";
import type { TradeRulesSummary } from "@/lib/trades/assets";
import { fmtMoney } from "@/lib/utils";

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
    { key: "center", label: counts?.received ? `Trade Center (${counts.received})` : "Trade Center", href: "/trades" },
    { key: "new", label: "Propose", href: "/trades/new" },
    { key: "calculator", label: "Calculator", href: "/trades/calculator" },
    ...(showBlock ? [{ key: "block", label: "Trade Block", href: "/trades/block" }] : []),
    { key: "history", label: "History", href: "/trades/history" },
    ...(isCommish ? [{ key: "commish", label: "Commish Review", href: "/commissioner/trades" }] : []),
  ];
  return <TabLinks tabs={tabs} active={active} />;
}

export function TradeRulesStrip({ rules }: { rules: TradeRulesSummary }) {
  const review =
    rules.reviewType === "NONE"
      ? "No review"
      : rules.reviewType === "COMMISSIONER"
        ? "Commissioner approval"
        : `League vote · ${rules.vetoVotesRequired} vetoes · ${rules.reviewPeriodHours}h${rules.voteEligibility === "ALL_TEAMS" ? " · every team votes" : ""}`;
  const untradable = [!rules.irTradable && "IR", !rules.taxiTradable && "taxi"].filter(Boolean).join(" and ");
  const items: { icon: React.ReactNode; text: string; strong?: boolean }[] = [
    { icon: <CalendarClock size={13} />, text: rules.windowOpen ? rules.windowNote ?? "Trading open" : rules.windowReason ?? "Trading closed", strong: !rules.windowOpen || !!rules.windowNote?.includes("this week") },
    { icon: <Gavel size={13} />, text: review },
    { icon: <Timer size={13} />, text: `Offers expire after ${rules.offerExpirationHours}h` },
    ...(rules.picks && rules.pickSeasons.length ? [{ icon: <Ticket size={13} />, text: `Picks ${rules.pickSeasons[0]}–${rules.pickSeasons[rules.pickSeasons.length - 1]} tradable${rules.picksNeedDues ? " once dues are paid" : ""}` }] : []),
    ...(rules.faab ? [{ icon: <DollarSign size={13} />, text: "FAB tradable" }] : []),
    ...(rules.capEnabled ? [{ icon: <ShieldCheck size={13} />, text: tradeCapRuleText(rules) }] : []),
    ...(rules.maxTeams > 2 ? [{ icon: <Users size={13} />, text: `Up to ${rules.maxTeams} teams` }] : []),
    ...(rules.tradeBackCooldownDays > 0 ? [{ icon: <Timer size={13} />, text: `No trade-backs for ${rules.tradeBackCooldownDays} days` }] : []),
    ...(rules.maxPlayersPerSide ? [{ icon: <Users size={13} />, text: `Max ${rules.maxPlayersPerSide} player${rules.maxPlayersPerSide === 1 ? "" : "s"} per side` }] : []),
    ...(!rules.allowUnbalanced ? [{ icon: <Scale size={13} />, text: "Even player counts only" }] : []),
    ...(untradable ? [{ icon: <Ban size={13} />, text: `${untradable[0].toUpperCase()}${untradable.slice(1)} players can't be traded` }] : []),
    ...(rules.lockedPlayersPolicy === "BLOCK" ? [{ icon: <Lock size={13} />, text: "Players who already played wait for next week" }] : []),
    ...(rules.retainMax > 0 ? [{ icon: <DollarSign size={13} />, text: `Senders may keep paying up to ${rules.retainMax}% of a salary` }] : []),
  ];
  return (
    <ul className="scroll-thin -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {items.map((it, i) => (
        <li key={i} className={`chip shrink-0 ${it.strong ? (rules.windowOpen ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200" : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200") : ""}`}>
          <span className="text-muted">{it.icon}</span>
          {it.text}
        </li>
      ))}
    </ul>
  );
}
