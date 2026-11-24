// NFL teams reference data
export interface NflTeam {
  abbr: string;
  espnAbbr: string;
  city: string;
  name: string;
  conference: "AFC" | "NFC";
  division: "East" | "North" | "South" | "West";
  primary: string;
  secondary: string;
}

export const NFL_TEAMS: NflTeam[] = [
  { abbr: "ARI", espnAbbr: "ARI", city: "Arizona", name: "Cardinals", conference: "NFC", division: "West", primary: "#97233F", secondary: "#FFB612" },
  { abbr: "ATL", espnAbbr: "ATL", city: "Atlanta", name: "Falcons", conference: "NFC", division: "South", primary: "#A71930", secondary: "#000000" },
  { abbr: "BAL", espnAbbr: "BAL", city: "Baltimore", name: "Ravens", conference: "AFC", division: "North", primary: "#241773", secondary: "#9E7C0C" },
  { abbr: "BUF", espnAbbr: "BUF", city: "Buffalo", name: "Bills", conference: "AFC", division: "East", primary: "#00338D", secondary: "#C60C30" },
  { abbr: "CAR", espnAbbr: "CAR", city: "Carolina", name: "Panthers", conference: "NFC", division: "South", primary: "#0085CA", secondary: "#101820" },
  { abbr: "CHI", espnAbbr: "CHI", city: "Chicago", name: "Bears", conference: "NFC", division: "North", primary: "#0B162A", secondary: "#C83803" },
  { abbr: "CIN", espnAbbr: "CIN", city: "Cincinnati", name: "Bengals", conference: "AFC", division: "North", primary: "#FB4F14", secondary: "#000000" },
  { abbr: "CLE", espnAbbr: "CLE", city: "Cleveland", name: "Browns", conference: "AFC", division: "North", primary: "#311D00", secondary: "#FF3C00" },
  { abbr: "DAL", espnAbbr: "DAL", city: "Dallas", name: "Cowboys", conference: "NFC", division: "East", primary: "#041E42", secondary: "#869397" },
  { abbr: "DEN", espnAbbr: "DEN", city: "Denver", name: "Broncos", conference: "AFC", division: "West", primary: "#FB4F14", secondary: "#002244" },
  { abbr: "DET", espnAbbr: "DET", city: "Detroit", name: "Lions", conference: "NFC", division: "North", primary: "#0076B6", secondary: "#B0B7BC" },
  { abbr: "GB", espnAbbr: "GB", city: "Green Bay", name: "Packers", conference: "NFC", division: "North", primary: "#203731", secondary: "#FFB612" },
  { abbr: "HOU", espnAbbr: "HOU", city: "Houston", name: "Texans", conference: "AFC", division: "South", primary: "#03202F", secondary: "#A71930" },
  { abbr: "IND", espnAbbr: "IND", city: "Indianapolis", name: "Colts", conference: "AFC", division: "South", primary: "#002C5F", secondary: "#A2AAAD" },
  { abbr: "JAX", espnAbbr: "JAX", city: "Jacksonville", name: "Jaguars", conference: "AFC", division: "South", primary: "#006778", secondary: "#D7A22A" },
  { abbr: "KC", espnAbbr: "KC", city: "Kansas City", name: "Chiefs", conference: "AFC", division: "West", primary: "#E31837", secondary: "#FFB81C" },
  { abbr: "LV", espnAbbr: "LV", city: "Las Vegas", name: "Raiders", conference: "AFC", division: "West", primary: "#000000", secondary: "#A5ACAF" },
  { abbr: "LAC", espnAbbr: "LAC", city: "Los Angeles", name: "Chargers", conference: "AFC", division: "West", primary: "#0080C6", secondary: "#FFC20E" },
  { abbr: "LAR", espnAbbr: "LAR", city: "Los Angeles", name: "Rams", conference: "NFC", division: "West", primary: "#003594", secondary: "#FFA300" },
  { abbr: "MIA", espnAbbr: "MIA", city: "Miami", name: "Dolphins", conference: "AFC", division: "East", primary: "#008E97", secondary: "#FC4C02" },
  { abbr: "MIN", espnAbbr: "MIN", city: "Minnesota", name: "Vikings", conference: "NFC", division: "North", primary: "#4F2683", secondary: "#FFC62F" },
  { abbr: "NE", espnAbbr: "NE", city: "New England", name: "Patriots", conference: "AFC", division: "East", primary: "#002244", secondary: "#C60C30" },
  { abbr: "NO", espnAbbr: "NO", city: "New Orleans", name: "Saints", conference: "NFC", division: "South", primary: "#D3BC8D", secondary: "#101820" },
  { abbr: "NYG", espnAbbr: "NYG", city: "New York", name: "Giants", conference: "NFC", division: "East", primary: "#0B2265", secondary: "#A71930" },
  { abbr: "NYJ", espnAbbr: "NYJ", city: "New York", name: "Jets", conference: "AFC", division: "East", primary: "#125740", secondary: "#FFFFFF" },
  { abbr: "PHI", espnAbbr: "PHI", city: "Philadelphia", name: "Eagles", conference: "NFC", division: "East", primary: "#004C54", secondary: "#A5ACAF" },
  { abbr: "PIT", espnAbbr: "PIT", city: "Pittsburgh", name: "Steelers", conference: "AFC", division: "North", primary: "#FFB612", secondary: "#101820" },
  { abbr: "SF", espnAbbr: "SF", city: "San Francisco", name: "49ers", conference: "NFC", division: "West", primary: "#AA0000", secondary: "#B3995D" },
  { abbr: "SEA", espnAbbr: "SEA", city: "Seattle", name: "Seahawks", conference: "NFC", division: "West", primary: "#002244", secondary: "#69BE28" },
  { abbr: "TB", espnAbbr: "TB", city: "Tampa Bay", name: "Buccaneers", conference: "NFC", division: "South", primary: "#D50A0A", secondary: "#34302B" },
  { abbr: "TEN", espnAbbr: "TEN", city: "Tennessee", name: "Titans", conference: "AFC", division: "South", primary: "#0C2340", secondary: "#4B92DB" },
  { abbr: "WAS", espnAbbr: "WSH", city: "Washington", name: "Commanders", conference: "NFC", division: "East", primary: "#5A1414", secondary: "#FFB612" },
];

export const NFL_TEAM_BY_ABBR: Record<string, NflTeam> = Object.fromEntries(NFL_TEAMS.map((t) => [t.abbr, t]));

/** ESPN uses WSH for Washington; Sleeper uses WAS */
export function fromEspnAbbr(abbr: string): string {
  if (abbr === "WSH") return "WAS";
  return abbr;
}

export function teamLogoUrl(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const t = NFL_TEAM_BY_ABBR[abbr];
  const code = (t?.espnAbbr ?? abbr).toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`;
}

export function teamFullName(abbr: string | null | undefined): string {
  if (!abbr) return "Free Agent";
  const t = NFL_TEAM_BY_ABBR[abbr];
  return t ? `${t.city} ${t.name}` : abbr;
}
