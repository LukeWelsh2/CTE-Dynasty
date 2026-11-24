// Catalog of every stat the scoring engine understands. Keys match the Sleeper stats feed.
// Used by the commissioner scoring editor, player stat tables and the scoring breakdown UI.

export type StatGroup =
  | "Passing"
  | "Rushing"
  | "Receiving"
  | "Misc Offense"
  | "Kicking"
  | "Team Defense"
  | "Special Teams"
  | "IDP";

export interface StatDef {
  key: string;
  label: string;
  short: string;
  group: StatGroup;
  /** Show in default stat tables for these positions */
  positions?: string[];
}

export const STAT_CATALOG: StatDef[] = [
  // Passing
  { key: "pass_att", label: "Pass Attempts", short: "Att", group: "Passing", positions: ["QB"] },
  { key: "pass_cmp", label: "Completions", short: "Cmp", group: "Passing", positions: ["QB"] },
  { key: "pass_inc", label: "Incompletions", short: "Inc", group: "Passing" },
  { key: "pass_yd", label: "Passing Yards", short: "Yds", group: "Passing", positions: ["QB"] },
  { key: "pass_td", label: "Passing TD", short: "TD", group: "Passing", positions: ["QB"] },
  { key: "pass_int", label: "Interceptions Thrown", short: "Int", group: "Passing", positions: ["QB"] },
  { key: "pass_int_td", label: "Pick Six Thrown", short: "Pick6", group: "Passing" },
  { key: "pass_2pt", label: "Passing 2PT Conversion", short: "2PT", group: "Passing" },
  { key: "pass_sack", label: "Times Sacked", short: "Sk", group: "Passing" },
  { key: "pass_fd", label: "Passing First Down", short: "1D", group: "Passing" },
  { key: "pass_cmp_40p", label: "40+ Yard Completion", short: "40+", group: "Passing" },
  { key: "pass_td_40p", label: "40+ Yard Passing TD", short: "40+TD", group: "Passing" },
  { key: "pass_td_50p", label: "50+ Yard Passing TD", short: "50+TD", group: "Passing" },
  // Rushing
  { key: "rush_att", label: "Rush Attempts", short: "Att", group: "Rushing", positions: ["QB", "RB"] },
  { key: "rush_yd", label: "Rushing Yards", short: "Yds", group: "Rushing", positions: ["QB", "RB", "WR"] },
  { key: "rush_td", label: "Rushing TD", short: "TD", group: "Rushing", positions: ["QB", "RB", "WR"] },
  { key: "rush_2pt", label: "Rushing 2PT Conversion", short: "2PT", group: "Rushing" },
  { key: "rush_fd", label: "Rushing First Down", short: "1D", group: "Rushing" },
  { key: "rush_40p", label: "40+ Yard Rush", short: "40+", group: "Rushing" },
  { key: "rush_td_40p", label: "40+ Yard Rushing TD", short: "40+TD", group: "Rushing" },
  { key: "rush_td_50p", label: "50+ Yard Rushing TD", short: "50+TD", group: "Rushing" },
  // Receiving
  { key: "rec_tgt", label: "Targets", short: "Tgt", group: "Receiving", positions: ["RB", "WR", "TE"] },
  { key: "rec", label: "Receptions", short: "Rec", group: "Receiving", positions: ["RB", "WR", "TE"] },
  { key: "rec_yd", label: "Receiving Yards", short: "Yds", group: "Receiving", positions: ["RB", "WR", "TE"] },
  { key: "rec_td", label: "Receiving TD", short: "TD", group: "Receiving", positions: ["RB", "WR", "TE"] },
  { key: "rec_2pt", label: "Receiving 2PT Conversion", short: "2PT", group: "Receiving" },
  { key: "rec_fd", label: "Receiving First Down", short: "1D", group: "Receiving" },
  { key: "rec_40p", label: "40+ Yard Reception", short: "40+", group: "Receiving" },
  { key: "rec_td_40p", label: "40+ Yard Receiving TD", short: "40+TD", group: "Receiving" },
  { key: "rec_td_50p", label: "50+ Yard Receiving TD", short: "50+TD", group: "Receiving" },
  // Misc offense
  { key: "fum", label: "Fumbles", short: "Fum", group: "Misc Offense" },
  { key: "fum_lost", label: "Fumbles Lost", short: "FL", group: "Misc Offense", positions: ["QB", "RB", "WR", "TE"] },
  { key: "fum_rec_td", label: "Fumble Recovery TD", short: "FRTD", group: "Misc Offense" },
  // Kicking
  { key: "fgm", label: "Field Goals Made", short: "FGM", group: "Kicking", positions: ["K"] },
  { key: "fga", label: "Field Goals Attempted", short: "FGA", group: "Kicking", positions: ["K"] },
  { key: "fgm_0_19", label: "FG Made 0-19", short: "0-19", group: "Kicking" },
  { key: "fgm_20_29", label: "FG Made 20-29", short: "20-29", group: "Kicking" },
  { key: "fgm_30_39", label: "FG Made 30-39", short: "30-39", group: "Kicking" },
  { key: "fgm_40_49", label: "FG Made 40-49", short: "40-49", group: "Kicking" },
  { key: "fgm_50_59", label: "FG Made 50-59", short: "50-59", group: "Kicking" },
  { key: "fgm_60p", label: "FG Made 60+", short: "60+", group: "Kicking" },
  { key: "fgm_50p", label: "FG Made 50+", short: "50+", group: "Kicking" },
  { key: "fgm_yds", label: "FG Yards Made", short: "FGYd", group: "Kicking" },
  { key: "fgmiss", label: "FG Missed", short: "FGMs", group: "Kicking", positions: ["K"] },
  { key: "fgmiss_0_19", label: "FG Missed 0-19", short: "Ms0-19", group: "Kicking" },
  { key: "fgmiss_20_29", label: "FG Missed 20-29", short: "Ms20-29", group: "Kicking" },
  { key: "fgmiss_30_39", label: "FG Missed 30-39", short: "Ms30-39", group: "Kicking" },
  { key: "fgmiss_40_49", label: "FG Missed 40-49", short: "Ms40-49", group: "Kicking" },
  { key: "fgmiss_50p", label: "FG Missed 50+", short: "Ms50+", group: "Kicking" },
  { key: "xpm", label: "Extra Points Made", short: "XPM", group: "Kicking", positions: ["K"] },
  { key: "xpa", label: "Extra Points Attempted", short: "XPA", group: "Kicking" },
  { key: "xpmiss", label: "Extra Points Missed", short: "XPMs", group: "Kicking" },
  // Team defense
  { key: "sack", label: "Sacks", short: "Sack", group: "Team Defense", positions: ["DEF"] },
  { key: "int", label: "Interceptions", short: "Int", group: "Team Defense", positions: ["DEF"] },
  { key: "fum_rec", label: "Fumbles Recovered", short: "FR", group: "Team Defense", positions: ["DEF"] },
  { key: "ff", label: "Forced Fumbles", short: "FF", group: "Team Defense" },
  { key: "def_td", label: "Defensive TD", short: "TD", group: "Team Defense", positions: ["DEF"] },
  { key: "safe", label: "Safeties", short: "Sfty", group: "Team Defense", positions: ["DEF"] },
  { key: "blk_kick", label: "Blocked Kicks", short: "Blk", group: "Team Defense" },
  { key: "def_pass_def", label: "Passes Defended", short: "PD", group: "Team Defense" },
  { key: "tkl_loss", label: "Tackles for Loss", short: "TFL", group: "Team Defense" },
  { key: "qb_hit", label: "QB Hits", short: "QBH", group: "Team Defense" },
  { key: "def_3_and_out", label: "3-and-Outs Forced", short: "3&O", group: "Team Defense" },
  { key: "def_4_and_stop", label: "4th Down Stops", short: "4DS", group: "Team Defense" },
  { key: "def_2pt", label: "Defensive 2PT Return", short: "D2PT", group: "Team Defense" },
  { key: "pts_allow", label: "Points Allowed", short: "PA", group: "Team Defense", positions: ["DEF"] },
  { key: "yds_allow", label: "Yards Allowed", short: "YdA", group: "Team Defense", positions: ["DEF"] },
  // Special teams
  { key: "st_td", label: "Special Teams TD (player)", short: "STTD", group: "Special Teams" },
  { key: "def_st_td", label: "Special Teams TD (team)", short: "STTD", group: "Special Teams" },
  { key: "kr_yd", label: "Kick Return Yards", short: "KRYd", group: "Special Teams" },
  { key: "pr_yd", label: "Punt Return Yards", short: "PRYd", group: "Special Teams" },
  { key: "def_kr_yd", label: "Team Kick Return Yards", short: "KRYd", group: "Special Teams" },
  { key: "def_pr_yd", label: "Team Punt Return Yards", short: "PRYd", group: "Special Teams" },
  { key: "st_ff", label: "Special Teams Forced Fumble", short: "STFF", group: "Special Teams" },
  { key: "st_fum_rec", label: "Special Teams Fumble Recovery", short: "STFR", group: "Special Teams" },
  // IDP
  { key: "idp_tkl", label: "Tackles", short: "Tkl", group: "IDP" },
  { key: "idp_tkl_solo", label: "Solo Tackles", short: "Solo", group: "IDP" },
  { key: "idp_tkl_ast", label: "Assisted Tackles", short: "Ast", group: "IDP" },
  { key: "idp_tkl_loss", label: "Tackles for Loss", short: "TFL", group: "IDP" },
  { key: "idp_sack", label: "Sacks", short: "Sack", group: "IDP" },
  { key: "idp_qb_hit", label: "QB Hits", short: "QBH", group: "IDP" },
  { key: "idp_int", label: "Interceptions", short: "Int", group: "IDP" },
  { key: "idp_ff", label: "Forced Fumbles", short: "FF", group: "IDP" },
  { key: "idp_fum_rec", label: "Fumble Recoveries", short: "FR", group: "IDP" },
  { key: "idp_pass_def", label: "Passes Defended", short: "PD", group: "IDP" },
  { key: "idp_def_td", label: "Defensive TD", short: "TD", group: "IDP" },
  { key: "idp_safe", label: "Safeties", short: "Sfty", group: "IDP" },
  { key: "idp_blk_kick", label: "Blocked Kicks", short: "Blk", group: "IDP" },
];

export const STAT_BY_KEY: Record<string, StatDef> = Object.fromEntries(STAT_CATALOG.map((s) => [s.key, s]));

export const STAT_GROUPS: StatGroup[] = [
  "Passing",
  "Rushing",
  "Receiving",
  "Misc Offense",
  "Kicking",
  "Team Defense",
  "Special Teams",
  "IDP",
];

/** Default stat columns shown in player tables, by position filter */
export const DEFAULT_STAT_COLUMNS: Record<string, string[]> = {
  ALL: ["pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost"],
  QB: ["pass_cmp", "pass_att", "pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "fum_lost"],
  RB: ["rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"],
  WR: ["rec_tgt", "rec", "rec_yd", "rec_td", "rush_att", "rush_yd", "rush_td", "fum_lost"],
  TE: ["rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"],
  FLEX: ["rush_att", "rush_yd", "rush_td", "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost"],
  K: ["fgm", "fga", "fgm_40_49", "fgm_50p", "fgmiss", "xpm", "xpmiss"],
  DEF: ["sack", "int", "fum_rec", "def_td", "safe", "pts_allow", "yds_allow"],
  IDP: ["idp_tkl_solo", "idp_tkl_ast", "idp_sack", "idp_int", "idp_ff", "idp_pass_def"],
};

export const OFFENSE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export const ALL_FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"] as const;
export const IDP_POSITIONS = ["DL", "LB", "DB"] as const;

/** Map raw NFL positions to fantasy positions used for slot eligibility */
export function normalizePosition(pos: string | null | undefined): string {
  if (!pos) return "UNK";
  const p = pos.toUpperCase();
  if (["DE", "DT", "NT", "DL", "EDGE"].includes(p)) return "DL";
  if (["LB", "ILB", "OLB", "MLB"].includes(p)) return "LB";
  if (["CB", "S", "SS", "FS", "DB"].includes(p)) return "DB";
  if (p === "PK" || p === "K/P") return "K";
  if (p === "DST" || p === "D/ST") return "DEF";
  return p;
}
