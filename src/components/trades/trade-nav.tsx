// Section navigation + league trade-rules strip shared by every trade page.
import { CalendarClock, Gavel, ShieldCheck, Ticket, Timer, DollarSign, Users } from "lucide-react";
import { TabLinks } from "@/components/ui/core";
import type { TradeRulesSummary } from "@/lib/trades/assets";

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
  const review = rules.reviewType === "NONE" ? "No review" : rules.reviewType === "COMMISSIONER" ? "Commissioner approval" : `League vote · ${rules.vetoVotesRequired} vetoes · ${rules.reviewPeriodHours}h`;
  const items: { icon: React.ReactNode; text: string; strong?: boolean }[] = [
    { icon: <CalendarClock size={13} />, text: rules.windowOpen ? rules.windowNote ?? "Trading open" : rules.windowReason ?? "Trading closed", strong: !rules.windowOpen || !!rules.windowNote?.includes("this week") },
    { icon: <Gavel size={13} />, text: review },
    { icon: <Timer size={13} />, text: `Offers expire after ${rules.offerExpirationHours}h` },
    ...(rules.picks && rules.pickSeasons.length ? [{ icon: <Ticket size={13} />, text: `Picks ${rules.pickSeasons[0]}–${rules.pickSeasons[rules.pickSeasons.length - 1]} tradable` }] : []),
    ...(rules.faab ? [{ icon: <DollarSign size={13} />, text: "FAB tradable" }] : []),
    ...(rules.capEnabled ? [{ icon: <ShieldCheck size={13} />, text: rules.requireCapCompliance ? "Must stay under the cap" : "Cap not enforced in trades" }] : []),
    ...(rules.maxTeams > 2 ? [{ icon: <Users size={13} />, text: `Up to ${rules.maxTeams} teams` }] : []),
    ...(rules.tradeBackCooldownDays > 0 ? [{ icon: <Timer size={13} />, text: `No trade-backs for ${rules.tradeBackCooldownDays} days` }] : []),
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
