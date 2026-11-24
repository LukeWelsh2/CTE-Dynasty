// Main league navigation (CBS-style tab bar with dropdowns).
export interface NavItem {
  label: string;
  href: string;
  /** path prefixes that mark this tab active */
  match?: string[];
  children?: { label: string; href: string; description?: string }[];
  commishOnly?: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { label: "Home", href: "/", match: ["/$"] },
  {
    label: "My Team",
    href: "/team",
    match: ["/team"],
    children: [
      { label: "Roster & Lineup", href: "/team", description: "Set your starters, view stats" },
      { label: "Lineup Insights", href: "/team/insights", description: "Start/sit help, injury & bye alerts" },
      { label: "Contracts & Cap", href: "/team/contracts", description: "Salaries, years, cap space" },
      { label: "Draft Picks", href: "/team/picks", description: "Your rookie picks (3 years)" },
      { label: "Keepers", href: "/team/keepers", description: "End-of-year keeper designations" },
      { label: "All Teams", href: "/teams", description: "Every roster in the league" },
    ],
  },
  {
    label: "Players",
    href: "/players",
    match: ["/players", "/news", "/injuries", "/rookies"],
    children: [
      { label: "All Players", href: "/players", description: "Search every NFL player" },
      { label: "Free Agents", href: "/players?status=available", description: "Add players & place FAB bids" },
      { label: "Player News", href: "/news", description: "Latest headlines and analysis" },
      { label: "Injury Report", href: "/injuries", description: "League-wide injury tracker" },
      { label: "Rookie Rankings", href: "/rookies", description: "Updated through the offseason" },
    ],
  },
  {
    label: "Scoring",
    href: "/scoring",
    match: ["/scoring", "/schedule"],
    children: [
      { label: "Live Scoreboard", href: "/scoring", description: "Every matchup this week" },
      { label: "My Matchup", href: "/scoring/my", description: "Head-to-head live scoring" },
      { label: "Schedule", href: "/schedule", description: "Full season schedule" },
    ],
  },
  {
    label: "Standings",
    href: "/standings",
    match: ["/standings", "/playoffs"],
    children: [
      { label: "Standings", href: "/standings" },
      { label: "Power Rankings", href: "/standings/power" },
      { label: "Playoff Bracket & Odds", href: "/playoffs", description: "Updated daily" },
    ],
  },
  {
    label: "Trades",
    href: "/trades",
    match: ["/trades"],
    children: [
      { label: "Trade Center", href: "/trades", description: "Offers sent & received" },
      { label: "Propose a Trade", href: "/trades/new" },
      { label: "Trade Calculator", href: "/trades/calculator", description: "Value with salary, picks & injuries" },
      { label: "Trade Block", href: "/trades/block" },
      { label: "Trade History", href: "/trades/history" },
    ],
  },
  {
    label: "Transactions",
    href: "/transactions",
    match: ["/transactions", "/waivers"],
    children: [
      { label: "Transaction Log", href: "/transactions" },
      { label: "Waivers & FAB", href: "/waivers", description: "Pending claims and FAB budgets" },
    ],
  },
  {
    label: "Draft",
    href: "/draft",
    match: ["/draft"],
    children: [
      { label: "Draft Center", href: "/draft" },
      { label: "Rookie Draft Room", href: "/draft/rookie" },
      { label: "Salary Auction Room", href: "/draft/auction" },
      { label: "My Big Board", href: "/draft/board" },
      { label: "Draft Results", href: "/draft/results" },
    ],
  },
  {
    label: "League",
    href: "/league",
    match: ["/league", "/chat", "/managers", "/rules", "/recaps", "/history"],
    children: [
      { label: "League Chat", href: "/chat", description: "Live chat with the league" },
      { label: "Managers", href: "/managers", description: "Profiles & in-depth stats" },
      { label: "League Rules", href: "/rules" },
      { label: "Rule Suggestions", href: "/rules/suggestions", description: "Propose & vote on changes" },
      { label: "Weekly Recaps", href: "/recaps" },
      { label: "History & Records", href: "/history" },
    ],
  },
  {
    label: "Commish",
    href: "/commissioner",
    match: ["/commissioner"],
    commishOnly: true,
    children: [
      { label: "Commissioner Home", href: "/commissioner" },
      { label: "League Settings", href: "/commissioner/settings" },
      { label: "Scoring Rules", href: "/commissioner/settings/scoring" },
      { label: "Members & Invites", href: "/commissioner/members" },
      { label: "Rosters & Contracts", href: "/commissioner/rosters" },
      { label: "Trades Review", href: "/commissioner/trades" },
      { label: "Schedule & Scores", href: "/commissioner/schedule" },
      { label: "Season & Phases", href: "/commissioner/season" },
      { label: "Emails & Jobs", href: "/commissioner/system" },
    ],
  },
];
