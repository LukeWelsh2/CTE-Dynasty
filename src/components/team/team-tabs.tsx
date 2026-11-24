import { TabLinks } from "@/components/ui/core";

export type TeamTab = "roster" | "insights" | "contracts" | "picks" | "keepers" | "teams";

/** Sub-navigation shared by the My Team pages. `teamId` keeps a commissioner on the team they're managing. */
export function TeamTabs({ active, teamId, keepers = true }: { active: TeamTab; teamId?: string | null; keepers?: boolean }) {
  const q = teamId ? `?team=${encodeURIComponent(teamId)}` : "";
  const tabs = [
    { key: "roster", label: "Roster & Lineup", href: `/team${q}` },
    { key: "insights", label: "Insights", href: `/team/insights${q}` },
    { key: "contracts", label: "Contracts & Cap", href: `/team/contracts${q}` },
    { key: "picks", label: "Draft Picks", href: `/team/picks${q}` },
    ...(keepers ? [{ key: "keepers", label: "Keepers", href: "/team/keepers" }] : []),
    { key: "teams", label: "All Teams", href: "/teams" },
  ];
  return <TabLinks tabs={tabs} active={active} />;
}
