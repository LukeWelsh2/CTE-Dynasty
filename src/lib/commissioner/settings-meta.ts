// Metadata for every commissioner-editable league setting: label, help text, control type and range.
// One catalog drives the settings editor UI, its zod validation (client + server), the settings history
// labels and the public rulebook. Pure + client-safe (no server imports).
//
// Paths are relative to their section, e.g. section "salaryCap" + path "deadMoney.currentSeasonPercent".
// tests/commissioner.test.ts asserts every key of LeagueSettings is covered here.

import type { LeagueSettings } from "@/lib/settings/schema";
import { WEEKDAYS } from "@/lib/settings/schema";
import { ALL_FANTASY_POSITIONS, STAT_BY_KEY } from "@/lib/settings/stat-catalog";

export type EditableSection = Exclude<keyof LeagueSettings, "scoring">;
export type SettingsSection = keyof LeagueSettings;

export interface Opt {
  value: string;
  label: string;
  /**
   * An older value kept only so leagues that already store it stay valid (validation still accepts it). It
   * behaves exactly like another option; the editor should list it only while it is the current value.
   */
  legacy?: boolean;
}

interface Base {
  path: string;
  label: string;
  help: string;
  /** relative path of a boolean (or a "path=VALUE|VALUE2" condition) that must hold for the field to be editable */
  enabledWhen?: string;
  /**
   * Nothing on the site applies this setting yet: its help text starts with "Not yet enforced" and says why, and
   * the public rulebook leaves it out. (tests/commissioner.test.ts keeps the flag and the help text in sync.)
   */
  notEnforced?: boolean;
}

export interface NumberField extends Base {
  kind: "number";
  min: number;
  max: number;
  step?: number;
  int?: boolean;
  nullable?: boolean;
  /** label of the "none" checkbox for nullable numbers */
  nullLabel?: string;
  prefix?: string;
  suffix?: string;
}

export type ItemField =
  | { key: string; label: string; kind: "text"; maxLength: number; minLength?: number; placeholder?: string; multiline?: boolean }
  | { key: string; label: string; kind: "number"; min: number; max: number; step?: number; int?: boolean; nullable?: boolean; prefix?: string; suffix?: string }
  | { key: string; label: string; kind: "toggle" }
  | { key: string; label: string; kind: "team" }
  | { key: string; label: string; kind: "select"; options: Opt[] };

export type FieldDef =
  | NumberField
  | (Base & { kind: "toggle" })
  | (Base & { kind: "select"; options: Opt[] })
  | (Base & { kind: "multi"; options: Opt[]; numeric?: boolean; minItems?: number })
  | (Base & { kind: "teams" })
  | (Base & { kind: "ordered"; options: Opt[] })
  | (Base & { kind: "text"; maxLength: number; minLength?: number; multiline?: boolean; placeholder?: string })
  | (Base & { kind: "datetime" })
  | (Base & { kind: "weekday" })
  | (Base & { kind: "timezone" })
  | (Base & { kind: "numberList"; min: number; max: number; step?: number; maxItems: number; suffix?: string })
  | (Base & { kind: "list"; item: ItemField[]; maxItems: number; addLabel: string; autoId?: string; emptyText: string })
  | (Base & { kind: "rivalries" })
  | (Base & { kind: "players" })
  | (Base & { kind: "slots" })
  | (Base & { kind: "positionLimits" })
  | (Base & { kind: "rookieScale" });

export interface GroupMeta {
  id: string;
  title: string;
  description?: string;
  fields: FieldDef[];
}

export interface SectionMeta {
  key: EditableSection;
  label: string;
  description: string;
  groups: GroupMeta[];
}

// ───────────────────────────── option lists ─────────────────────────────

const o = (pairs: [string, string][]): Opt[] => pairs.map(([value, label]) => ({ value, label }));

export const WEEKDAY_LABELS: Record<string, string> = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };
export const WEEKDAY_OPTIONS: Opt[] = WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_LABELS[d] }));
export const POSITION_OPTIONS: Opt[] = ALL_FANTASY_POSITIONS.map((p) => ({ value: p, label: p === "DEF" ? "DST" : p }));
export const IR_STATUS_OPTIONS = o([
  ["IR", "Injured Reserve"],
  ["Out", "Out"],
  ["Doubtful", "Doubtful"],
  ["Questionable", "Questionable"],
  ["PUP", "PUP"],
  ["NFI", "Non-football injury"],
  ["Sus", "Suspended"],
  ["NA", "Not active"],
  ["COV", "Illness list"],
  ["DNR", "Did not report"],
]);
export const SECTION_OPTIONS = o([
  ["general", "General"],
  ["roster", "Rosters"],
  ["lineup", "Lineups"],
  ["scoring", "Scoring"],
  ["matchups", "Matchups"],
  ["standings", "Standings"],
  ["playoffs", "Playoffs"],
  ["salaryCap", "Salary cap"],
  ["contracts", "Contracts"],
  ["keepers", "Keepers"],
  ["waivers", "Waivers & FAB"],
  ["trades", "Trades"],
  ["draft", "Drafts"],
  ["notifications", "Notifications"],
  ["niche", "Fun & custom rules"],
]);
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Halifax",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];
const STANDING_TB = o([
  ["H2H", "Head-to-head record"],
  ["POINTS_FOR", "Points for"],
  ["DIVISION_RECORD", "Division record"],
  ["POINTS_AGAINST", "Points against (more ranks higher)"],
  ["ALL_PLAY", "All-play record"],
  ["COIN_FLIP", "Coin flip"],
]);
const DIVISION_TB = STANDING_TB;
const PLAYOFF_TB = o([
  ["BENCH_POINTS", "Bench points"],
  ["HIGHER_SEED", "Higher seed"],
  ["HIGHEST_STARTER", "Highest-scoring starter"],
  ["COIN_FLIP", "Coin flip"],
]);
const DRAFT_TB = o([
  ["MAX_POTENTIAL_POINTS", "Lower max potential points"],
  ["POINTS_FOR", "Lower points for"],
  ["POINTS_AGAINST", "Higher points against"],
  ["COIN_FLIP", "Coin flip"],
]);

// ───────────────────────────── field builders ─────────────────────────────

type NumOpts = Partial<Omit<NumberField, "kind" | "path" | "label" | "help">>;
const num = (path: string, label: string, help: string, min: number, max: number, opts: NumOpts = {}): FieldDef => ({ kind: "number", path, label, help, min, max, int: true, ...opts });
const dec = (path: string, label: string, help: string, min: number, max: number, step: number, opts: NumOpts = {}): FieldDef => ({ kind: "number", path, label, help, min, max, step, int: false, ...opts });
const money = (path: string, label: string, help: string, max = 100_000, opts: NumOpts = {}): FieldDef => ({ kind: "number", path, label, help, min: 0, max, int: true, prefix: "$", ...opts });
const pct = (path: string, label: string, help: string, opts: NumOpts = {}): FieldDef => ({ kind: "number", path, label, help, min: 0, max: 100, int: false, step: 0.5, suffix: "%", ...opts });
const week = (path: string, label: string, help: string, nullLabel?: string, extra: Partial<Base> = {}): FieldDef => ({ kind: "number", path, label, help, min: 1, max: 18, int: true, prefix: "Wk", ...(nullLabel ? { nullable: true, nullLabel } : {}), ...extra });
const bool = (path: string, label: string, help: string, extra: Partial<Base> = {}): FieldDef => ({ kind: "toggle", path, label, help, ...extra });
const sel = (path: string, label: string, help: string, options: Opt[], extra: Partial<Base> = {}): FieldDef => ({ kind: "select", path, label, help, options, ...extra });
const multi = (path: string, label: string, help: string, options: Opt[], extra: { minItems?: number; numeric?: boolean; enabledWhen?: string } = {}): FieldDef => ({ kind: "multi", path, label, help, options, ...extra });
const text = (path: string, label: string, help: string, maxLength: number, extra: { minLength?: number; multiline?: boolean; placeholder?: string; enabledWhen?: string } = {}): FieldDef => ({ kind: "text", path, label, help, maxLength, ...extra });
const dt = (path: string, label: string, help: string, extra: Partial<Base> = {}): FieldDef => ({ kind: "datetime", path, label, help, ...extra });
const ordered = (path: string, label: string, help: string, options: Opt[]): FieldDef => ({ kind: "ordered", path, label, help, options });
/** extra props for a setting nothing applies yet (see Base.notEnforced) */
const NOT_ENFORCED = { notEnforced: true } as const;

// ───────────────────────────── sections ─────────────────────────────

export const SECTIONS: SectionMeta[] = [
  {
    key: "general",
    label: "General",
    description: "League identity, season length, dues and payouts.",
    groups: [
      {
        id: "identity",
        title: "League identity",
        fields: [
          text("leagueName", "League name", "Shown in the header, emails and the rulebook.", 60, { minLength: 2 }),
          text("shortName", "Short name", "2-8 characters for compact headers and the mobile app bar.", 8, { minLength: 2 }),
          sel("leagueType", "League type", "Dynasty leagues keep every player year to year; keeper leagues keep a limited number.", o([["DYNASTY", "Dynasty"], ["KEEPER", "Keeper"], ["REDRAFT", "Redraft"]])),
          num("teamCount", "Number of teams", "Must match the teams in the league. Add expansion teams under Members.", 4, 32),
          { kind: "timezone", path: "timezone", label: "League timezone", help: "Every deadline, lock time and waiver run is shown and processed in this timezone." },
          text("championTrophyName", "Championship trophy name", "What the champion takes home.", 60),
          text("commissionerMessage", "Commissioner message", "Pinned on the league home page and at the top of the rulebook.", 600, { multiline: true }),
          text("constitution", "League constitution / bylaws", "Free-text bylaws shown above the generated rules. Separate paragraphs with a blank line.", 20_000, { multiline: true }),
        ],
      },
      {
        id: "season",
        title: "Season",
        fields: [
          week("firstWeek", "First fantasy week", "NFL week the fantasy regular season starts."),
          num("regularSeasonWeeks", "Regular season weeks", "Number of regular season weeks before the playoffs.", 4, 17, { suffix: "wks" }),
          {
            kind: "weekday",
            path: "statCorrectionDay",
            label: "Stat correction cutoff day",
            help: "The daily stat-correction re-score of last week's matchups stops at the first cutoff at least 12 hours after the week's last kickoff, so later corrections no longer change results. Commissioner › Schedule shows each week's cutoff; recalculating after it is logged as an override.",
          },
          num("statCorrectionHour", "Stat correction cutoff hour", "Hour (0-23, league time) on the cutoff day.", 0, 23, { suffix: ":00" }),
        ],
      },
      {
        id: "divisions",
        title: "Divisions",
        description: "Assign teams to divisions under Members. Remove all divisions for a league without divisions.",
        fields: [
          {
            kind: "list",
            path: "divisions",
            label: "Divisions",
            help: "Division names. Teams reference divisions by their internal id, so renaming is safe.",
            item: [{ key: "name", label: "Division name", kind: "text", maxLength: 40, minLength: 1, placeholder: "e.g. East" }],
            maxItems: 8,
            addLabel: "Add division",
            autoId: "id",
            emptyText: "No divisions — every team competes in one table.",
          },
        ],
      },
      {
        id: "managers",
        title: "Managers",
        fields: [
          bool("allowCoManagers", "Allow co-managers", "Not yet enforced: each team has a single manager account, so a team can't be run by more than one manager.", NOT_ENFORCED),
          num("maxManagersPerTeam", "Max managers per team", "Not yet enforced (see co-managers). Including the primary owner.", 1, 4, { enabledWhen: "allowCoManagers", ...NOT_ENFORCED }),
          bool("showInactiveTeams", "Show inactive teams", "Not yet enforced: every team is always listed in standings and team lists.", NOT_ENFORCED),
        ],
      },
      {
        id: "dues",
        title: "Dues & payouts",
        fields: [
          money("leagueDues", "League dues", "Real-money buy-in per team (0 = free league). Tracked here; not collected by the site.", 100_000),
          dt("duesDueDate", "Dues due by", "Date dues must be paid. Shown in the rulebook and on the commissioner dashboard."),
          { kind: "teams", path: "duesPaidTeamIds", label: "Dues paid", help: "Check each team that has paid this season's dues." },
          {
            kind: "list",
            path: "payouts",
            label: "Payouts",
            help: "Prize for each finishing place or award.",
            item: [
              { key: "place", label: "Place / award", kind: "text", maxLength: 60, minLength: 1, placeholder: "Champion" },
              { key: "amount", label: "Amount", kind: "number", min: 0, max: 100_000, int: true, prefix: "$" },
            ],
            maxItems: 12,
            addLabel: "Add payout",
            emptyText: "No payouts configured.",
          },
        ],
      },
    ],
  },
  {
    key: "roster",
    label: "Rosters",
    description: "Starting lineup slots, roster size, IR and taxi squad rules.",
    groups: [
      {
        id: "slots",
        title: "Starting lineup",
        description: "Lineups for the current and future weeks are rebuilt when slots change (each team's previous lineup carries forward).",
        fields: [
          bool("idpEnabled", "Individual defensive players (IDP)", "Allow DL / LB / DB players and IDP lineup slots."),
          { kind: "slots", path: "slots", label: "Lineup slots", help: "Slot types in display order: label, how many, and which positions may fill them." },
        ],
      },
      {
        id: "size",
        title: "Roster size",
        fields: [
          num("maxActiveRoster", "Max active roster", "Starters + bench. IR and taxi spots are extra.", 5, 80),
          num("minActiveRoster", "Min active roster", "A team can't drop an active player if that would leave fewer than this; teams below it are flagged on Commissioner Home.", 0, 80),
          num("benchSize", "Bench spots", "Bench size shown on lineups (max active roster minus starters).", 0, 60),
          num("offseasonMaxActiveRoster", "Offseason roster limit", "Larger active-roster limit outside the regular season and playoffs (preseason, offseason and keeper window), until the roster cutdown deadline. Every move uses it: adds, waiver claims, trades, the salary auction, IR activations, taxi promotions and commissioner roster changes.", 5, 100, { nullable: true, nullLabel: "Same as in season" }),
          dt("rosterCutdownDate", "Roster cutdown deadline", "From this moment the offseason roster limit ends and Max active roster applies to every move again (a date without a time means the end of that day in the league time zone)."),
          bool("allowEmptyStarterSlots", "Allow empty starter slots", "Teams may save lineups with open starting slots (the empty-slot penalty still applies). Off: a slot can only be left open when no eligible player is available."),
          sel(
            "illegalRosterPolicy",
            "Illegal roster policy",
            "What happens when a team is over a roster limit (active roster, IR, taxi or a position maximum). Zero points: a team that is over a limit at any time while a week is being played scores 0 for that week. Adds, claims and roster moves that would break a limit are refused under every policy.",
            o([
              ["BLOCK_MOVES", "Block other moves until fixed (not yet enforced: the commissioner resolves it)"],
              ["ZERO_POINTS", "Team scores zero for the week"],
              ["COMMISSIONER", "Commissioner resolves"],
            ]),
          ),
        ],
      },
      {
        id: "limits",
        title: "Position limits",
        fields: [
          {
            kind: "positionLimits",
            path: "positionLimits",
            label: "Roster limits by position",
            help: "Minimum and maximum players at each position across the whole roster, IR and taxi included (blank max = no limit). Maximums block adds, claims and trades; teams under a minimum are flagged on Commissioner Home.",
          },
        ],
      },
      {
        id: "ir",
        title: "Injured reserve",
        fields: [
          num("irSlots", "IR slots", "Injured players stashed here do not count against the active roster.", 0, 10),
          bool("irRequireInjuryStatus", "Require an injury designation", "Only players with an eligible designation may be moved to IR."),
          multi("irEligibleStatuses", "Eligible designations", "Injury designations that qualify a player for IR.", IR_STATUS_OPTIONS, { enabledWhen: "irRequireInjuryStatus" }),
          bool("irCountsAgainstCap", "IR salaries count against the cap", "Turn off to exempt injured players' salaries."),
          num("irMinWeeks", "Minimum weeks on IR", "Anti-churn: a player must stay on IR at least this many weeks.", 0, 8, { suffix: "wks" }),
          bool("irAllowInOffseason", "IR allowed in the offseason", "Let managers keep players injured at season's end on IR."),
          sel("irActivationPolicy", "When an IR player is healthy", "What happens once a player on IR no longer has an eligible designation. Block: the team can't make other IR or taxi moves until he is activated or dropped. The manager is alerted under both Block and Bench.", o([
            ["BLOCK_MOVES", "Block IR and taxi moves until activated"],
            ["AUTO_BENCH", "Move to the bench (not yet enforced: the manager is alerted instead)"],
            ["NONE", "Nothing (manager's choice)"],
          ])),
        ],
      },
      {
        id: "taxi",
        title: "Taxi squad",
        fields: [
          num("taxiSlots", "Taxi slots", "Development spots for young players (0 disables the taxi squad).", 0, 10),
          num("taxiMaxYearsExp", "Max NFL experience", "Years of NFL experience a player can have to be taxi-eligible (0 = rookies only).", 0, 5, { suffix: "yrs" }),
          num("taxiMaxSeasonsOnTaxi", "Max seasons on taxi", "Not yet enforced: players leave the taxi squad only when they pass the experience limit (promoted at the season rollover).", 1, 5, NOT_ENFORCED),
          multi("taxiAddSources", "Players can join the taxi from", "How a player can be placed on the taxi squad.", o([
            ["ROOKIE_DRAFT", "Rookie draft"],
            ["AUCTION", "Salary auction"],
            ["WAIVERS", "Waivers"],
            ["FREE_AGENCY", "Free agency"],
            ["TRADE", "Trade"],
          ])),
          week("taxiDeadlineWeek", "Taxi deadline", "In season, players can be placed on the taxi squad until this week's first kickoff; after that they can only be promoted off it.", "No deadline"),
          bool("taxiPromotionAllowedInSeason", "Promotion allowed in season", "Managers may promote taxi players to the active roster during the season (off: offseason only)."),
          bool("taxiAllowReturnAfterPromotion", "Return after promotion", "A promoted player may go back to the taxi squad."),
          bool("taxiPlayersCanStart", "Taxi players can start", "Taxi players may fill starting slots (manual lineups, auto-filled lineups, best ball and auto-subs)."),
          bool("taxiCountsAgainstCap", "Full salary counts against the cap", "Off = only the taxi cap percentage counts."),
          pct("taxiCapPercent", "Taxi cap charge", "Share of a taxi player's salary that counts against the cap.", { enabledWhen: "taxiCountsAgainstCap=false" }),
          bool("taxiPoachingAllowed", "Taxi poaching", "Not yet enforced: other teams can't claim players off a taxi squad.", NOT_ENFORCED),
          bool("taxiOwnerCanMatchPoach", "Owner can block a poach", "Not yet enforced (see taxi poaching). The owner could promote the player to keep him.", { enabledWhen: "taxiPoachingAllowed", ...NOT_ENFORCED }),
          sel(
            "taxiPoachCompensation",
            "Poach compensation",
            "Not yet enforced (see taxi poaching). What the poaching team would give up.",
            o([
              ["NONE", "Nothing"],
              ["FAAB", "FAB to the owner"],
              ["DRAFT_PICK", "A draft pick"],
              ["SALARY_RAISE", "Higher salary"],
            ]),
            { enabledWhen: "taxiPoachingAllowed", ...NOT_ENFORCED },
          ),
          dec("taxiPoachSalaryMultiplier", "Poached salary multiplier", "Not yet enforced (see taxi poaching). The poaching team would pay the old salary times this.", 1, 5, 0.1, { suffix: "×", enabledWhen: "taxiPoachingAllowed", ...NOT_ENFORCED }),
        ],
      },
    ],
  },
  {
    key: "lineup",
    label: "Lineups",
    description: "Lock timing, carry-over, auto-subs and empty-slot rules.",
    groups: [
      {
        id: "locks",
        title: "Locks",
        fields: [
          sel("lockType", "Lineup lock", "When starters lock. With the first-Sunday lock, Thursday and Saturday players still lock at their own kickoff.", o([
            ["PER_GAME", "Each player at his own kickoff"],
            ["FIRST_GAME_OF_WEEK", "Whole lineup at the week's first kickoff"],
            ["SUNDAY_FIRST_GAME", "Whole lineup at the first Sunday kickoff"],
          ])),
          num("lockOffsetMinutes", "Lock before kickoff", "Lineups lock this many minutes before the kickoff that locks them, for every lock type (e.g. 5 = a 1:00 PM game locks at 12:55 PM).", 0, 60, { suffix: "min" }),
          bool("allowFutureWeekLineups", "Set future weeks", "Managers can set lineups for upcoming weeks."),
          sel(
            "defaultCarryOver",
            "Lineup carry-over",
            "The lineup a week starts with until the manager changes it: last week's lineup (players who can no longer start are removed; a saved change carries into later weeks the manager hasn't edited), the best projected lineup, or open slots. A team's first lineup of the season is always the best projected lineup, and a saved change also updates any later week that still shows the replaced lineup.",
            o([
              ["PREVIOUS_WEEK", "Previous week's lineup"],
              ["OPTIMAL_PROJECTED", "Best projected lineup"],
              ["EMPTY", "Empty"],
            ]),
          ),
        ],
      },
      {
        id: "subs",
        title: "Auto-subs & best ball",
        fields: [
          bool(
            "autoSubOutPlayers",
            "Auto-sub inactive starters",
            "A starter who doesn't play (ruled out — Out, IR, PUP, suspended or not active — or his game ends without a stat line) is replaced by the highest-scoring eligible bench player who plays. Starters on bye and empty slots aren't filled. Not used with best ball.",
          ),
          num("autoSubsMaxPerWeek", "Max auto-subs per week", "Most auto-subs per team each week (0 = unlimited).", 0, 5, { enabledWhen: "autoSubOutPlayers" }),
          bool("autoSubRequireLaterKickoff", "Sub must kick off later", "The replacement's game must kick off after the inactive starter's.", { enabledWhen: "autoSubOutPlayers" }),
          bool("autoSetForInactiveManagers", "Auto-set inactive managers", "Not yet enforced: inactive managers' lineups follow the lineup carry-over setting (choose Best projected lineup for the same effect).", NOT_ENFORCED),
          bool(
            "bestBall",
            "Best ball",
            "Each team's starters are its best possible lineup from actual points (live projections while games are in progress); saved lineups and auto-subs are ignored.",
          ),
          bool("eliminatedTeamsSetLineups", "Eliminated teams set lineups", "In playoff weeks, teams with no game that week can still set lineups (teams in a consolation or placement game always can)."),
        ],
      },
      {
        id: "empty",
        title: "Empty slots",
        fields: [
          dec("emptySlotPenalty", "Empty slot penalty", "Points deducted for each empty starting slot.", 0, 50, 0.5, { suffix: "pts" }),
          bool("emptyStarterAlerts", "Empty / inactive starter alerts", "Warn managers about empty, bye-week or OUT starters."),
          bool("benchPointsTiebreaker", "Bench points break ties", "More bench points win a tied regular season matchup (after the regular season tiebreaker, if one is set), even when ties are allowed. Tied playoff games use Standings › Playoff matchup tiebreakers."),
        ],
      },
    ],
  },
  {
    key: "matchups",
    label: "Matchups",
    description: "Matchup format, ties and how the schedule is generated.",
    groups: [
      {
        id: "format",
        title: "Format",
        fields: [
          sel(
            "format",
            "Matchup format",
            "How weekly results count in the standings. Median game: a score above the week's league median is an extra win, below it an extra loss.",
            o([
              ["H2H", "Head-to-head"],
              ["H2H_PLUS_MEDIAN", "Head-to-head + league median game"],
              ["ALL_PLAY", "All-play (not yet enforced: head-to-head results count)"],
              ["POINTS_ONLY", "Total points only (not yet enforced: head-to-head results count)"],
            ]),
          ),
          bool(
            "allowTies",
            "Allow ties",
            "On: a tied regular season matchup stays a tie unless the tiebreaker (or bench points, when that is on) separates the teams. Off: ties are always broken: the tiebreaker, then bench points, the highest-scoring starter and finally the home team.",
          ),
          sel(
            "tiebreaker",
            "Regular season tiebreaker",
            "Applied first to a tied regular season matchup (Home team always settles it). Who advances from a tied playoff game is set by Standings › Playoff matchup tiebreakers.",
            o([
              ["NONE", "None"],
              ["BENCH_POINTS", "Bench points"],
              ["HIGHEST_STARTER", "Highest-scoring starter"],
              ["HOME_TEAM", "Home team wins"],
            ]),
          ),
        ],
      },
      {
        id: "schedule",
        title: "Schedule",
        description: "Used when the schedule is regenerated under Schedule & Scores.",
        fields: [
          sel("scheduleType", "Schedule generator", "Round robin plays everyone; division-weighted adds extra division games.", o([
            ["ROUND_ROBIN", "Round robin"],
            ["DIVISION_WEIGHTED", "Division weighted"],
            ["MANUAL", "Manual (commissioner edits each week)"],
          ])),
          bool("divisionGamesTwice", "Play division rivals twice", "Each division opponent is played twice when weeks allow."),
          bool("divisionGamesLate", "Division games late", "Schedule the extra division games in the final regular season weeks."),
          sel(
            "oddTeamCountPolicy",
            "Odd team count",
            "With an odd number of teams, one team has no opponent each week.",
            o([
              ["BYE", "One team has a bye each week"],
              ["MEDIAN_OPPONENT", "Extra team plays the league median (not yet enforced: scheduled as a bye with no result)"],
            ]),
          ),
          week("rivalryWeek", "Rivalry week", "Every rivalry pairing plays this week.", "No rivalry week"),
          { kind: "rivalries", path: "rivalries", label: "Rivalries", help: "Fixed rival pairs that meet in rivalry week." },
        ],
      },
    ],
  },
  {
    key: "standings",
    label: "Standings",
    description: "Tiebreakers and power rankings.",
    groups: [
      {
        id: "tiebreakers",
        title: "Tiebreakers",
        fields: [
          ordered(
            "tiebreakers",
            "Standings tiebreakers",
            "Applied in order to teams with the same win percentage, as a group: head-to-head uses the record in games among the tied teams when they all met equally often (otherwise only a clean sweep counts). Once a step separates teams, those still tied start the list again. Last resort: points for, then a coin flip drawn once per season.",
            STANDING_TB,
          ),
          ordered("divisionTiebreakers", "Division tiebreakers", "Applied the same way to rank teams inside each division (division winners); after them, the overall standings order decides.", DIVISION_TB),
          ordered(
            "playoffMatchupTiebreakers",
            "Playoff matchup tiebreakers",
            "Decide who advances from a tied playoff game (a multi-week round compares combined scores); after them, the higher seed advances. Playoff games never end in a tie.",
            PLAYOFF_TB,
          ),
          ordered(
            "draftOrderTiebreakers",
            "Draft order tiebreakers",
            "Break ties in rookie draft order (same record, or same max potential points): the team with lower max potential points, fewer points for, more points against or the losing coin flip picks first. After them, the standings order decides.",
            DRAFT_TB,
          ),
        ],
      },
      {
        id: "display",
        title: "Display & power rankings",
        fields: [
          bool("divisionWinnersTopSeeds", "Division winners get top seeds", "Division winners are seeded ahead of wildcards."),
          bool("showAllPlayRecord", "Show all-play record", "Display each team's record against the whole league every week."),
          bool("showPowerRankings", "Show power rankings", "Weekly power rankings on the standings page."),
          dec("powerRanking.recordWeight", "Weight: record", "Share of the power score from win percentage.", 0, 1, 0.05, { enabledWhen: "showPowerRankings" }),
          dec("powerRanking.pointsWeight", "Weight: points", "Share from points scored.", 0, 1, 0.05, { enabledWhen: "showPowerRankings" }),
          dec("powerRanking.allPlayWeight", "Weight: all-play", "Share from all-play record.", 0, 1, 0.05, { enabledWhen: "showPowerRankings" }),
          dec("powerRanking.recentFormWeight", "Weight: recent form", "Share from the last few weeks.", 0, 1, 0.05, { enabledWhen: "showPowerRankings" }),
        ],
      },
    ],
  },
  {
    key: "playoffs",
    label: "Playoffs",
    description: "Bracket size, seeding, byes and consolation games.",
    groups: [
      {
        id: "bracket",
        title: "Bracket",
        fields: [
          num("teams", "Playoff teams", "0 disables the playoffs.", 0, 16),
          week("startWeek", "Playoffs start", "First playoff week (usually the week after the regular season)."),
          num("weeksPerRound", "Weeks per round", "Two-week rounds add both weeks' scores.", 1, 2),
          num("championshipWeeks", "Championship weeks", "A two-week final adds both weeks.", 1, 2),
          num("byes", "First-round byes", "Top seeds that skip the first round.", 0, 8),
          bool("reseed", "Re-seed each round", "Highest remaining seed always plays the lowest."),
          bool("lockRostersInPlayoffs", "Lock rosters in the playoffs", "No adds, drops or trades once the playoffs start."),
          bool("manualSeedingAllowed", "Commissioner can set seeds", "Allow manual seeding overrides."),
          bool("medianGameInPlayoffs", "Median game in the playoffs", "Show each playoff team's result against the week's league median on the bracket (needs the median game; it never decides who advances)."),
        ],
      },
      {
        id: "seeding",
        title: "Seeding",
        fields: [
          sel("seeding", "Seed by", "Primary seeding order.", o([["RECORD", "Record (then tiebreakers)"], ["POINTS_FOR", "Total points"]])),
          bool("divisionWinnersQualify", "Division winners qualify", "Every division winner makes the playoffs."),
          num("wildcardsByPoints", "Wildcards by points", "Final playoff spots go to the highest scorers not already in.", 0, 8),
        ],
      },
      {
        id: "consolation",
        title: "Consolation",
        fields: [
          bool("consolationBracket", "Consolation bracket", "Non-playoff teams play for draft position or pride."),
          bool("thirdPlaceGame", "Third place game", "Semifinal losers play for third."),
          multi("placementGames", "More placement games", "Additional placement games.", o([["FIFTH", "5th place"], ["SEVENTH", "7th place"]])),
          bool("toiletBowl", "Toilet bowl", "Losers advance: the last team standing finishes last."),
          sel(
            "consolationStakes",
            "Consolation stakes",
            "What the consolation bracket is played for, as stated in the rulebook. The rookie-pick reward itself is Drafts › Consolation winner; a FAB bonus is paid by the commissioner (Rosters › FAB balance).",
            o([
              ["NONE", "Nothing"],
              ["ROOKIE_PICK", "Rookie draft position"],
              ["PUNISHMENT", "Avoiding the last-place punishment"],
              ["FAAB_BONUS", "FAB bonus"],
            ]),
          ),
          bool(
            "eliminatedTeamsCanTransact",
            "Eliminated teams can transact",
            "Off: during the playoffs, teams out of the championship bracket (including teams that missed the playoffs) can't add players, make waiver claims or trade. A first-round bye never eliminates a team; a multi-week round eliminates its losers once all its weeks are final.",
          ),
        ],
      },
    ],
  },
  {
    key: "salaryCap",
    label: "Salary cap",
    description: "Cap amount, floor, enforcement and dead money.",
    groups: [
      {
        id: "cap",
        title: "Cap",
        fields: [
          bool("enabled", "Salary cap", "Teams must stay under a total salary limit."),
          money("cap", "Salary cap", "Total salary a team may carry.", 100_000, { min: 1, enabledWhen: "enabled" }),
          money("floor", "Salary floor", "Minimum total salary a team should carry. Commissioner Home flags teams under it; the commissioner applies the floor penalty.", 100_000, { enabledWhen: "enabled" }),
          sel(
            "capType",
            "Cap type",
            "Hard: while the cap is enforced, moves that would put a team over the cap are blocked. Soft: teams may go over by up to the max overage — every cap check (adds, waiver claims, trades, auction bids, roster moves and contract changes) uses cap + max overage as the limit — and owe a luxury tax on the overage.",
            o([["HARD", "Hard cap"], ["SOFT", "Soft cap (luxury tax)"]]),
            { enabledWhen: "enabled" },
          ),
          money("softCapMaxOverage", "Max overage", "Largest allowed overage on a soft cap: every cap check uses the cap plus this as the limit. No limit: the cap never blocks a move; overages only owe the luxury tax.", 100_000, { nullable: true, nullLabel: "No limit", enabledWhen: "capType=SOFT" }),
          dec("luxuryTaxRate", "Luxury tax rate", "Tax charged per $1 over the cap (rounded up to whole dollars).", 0, 3, 0.05, { suffix: "×", enabledWhen: "capType=SOFT" }),
          sel(
            "luxuryTaxPaidAs",
            "Tax paid as",
            "How the luxury tax is charged. Commissioner Home shows each team's tax; real-money tax is added to the dues ledger, FAB tax is applied with Rosters › FAB balance.",
            o([
              ["NEXT_YEAR_CAP", "Less cap next season (not yet enforced: teams share one league cap)"],
              ["FAAB", "FAB"],
              ["DUES", "Real money"],
            ]),
            { enabledWhen: "capType=SOFT" },
          ),
          money("minSalary", "Minimum salary", "Lowest salary any player can have.", 1000, { min: 0, enabledWhen: "enabled" }),
          money("maxSalary", "Maximum salary", "Highest salary for one player.", 100_000, { nullable: true, nullLabel: "No maximum", enabledWhen: "enabled" }),
          money("emptyRosterSpotCharge", "Empty roster spot charge", "Not yet enforced: empty active-roster spots add nothing to a team's cap number.", 1000, { enabledWhen: "enabled", ...NOT_ENFORCED }),
          money("annualCapIncrease", "Annual cap increase", "Added to the cap at each season rollover.", 10_000, { enabledWhen: "enabled" }),
          bool("allowCapSpaceTrading", "Cap space can be traded", "Not yet enforced: trades can't include cap room (every team shares one league cap).", { enabledWhen: "enabled", ...NOT_ENFORCED }),
        ],
      },
      {
        id: "enforcement",
        title: "Enforcement",
        fields: [
          bool(
            "enforceInSeason",
            "Enforce in season",
            "During the regular season and playoffs, block adds, waiver claims, trades (when they must be cap-compliant), auction bids, roster moves and contract changes that would put a team over the cap. Off: nothing is checked against the cap in season. Outside the season, Offseason enforcement decides.",
            { enabledWhen: "enabled" },
          ),
          sel("offseasonEnforcement", "Offseason enforcement", "How the cap applies outside the regular season and playoffs (preseason, offseason and keeper window) to every move: adds, waiver claims, trades, auction bids, roster moves and contract changes. Warn only, and Allow until the compliance date before that date, let over-cap moves through with a warning.", o([
            ["BLOCK_OVER_CAP_MOVES", "Block over-cap moves"],
            ["ALLOW_UNTIL_COMPLIANCE_DATE", "Allow until the compliance date"],
            ["WARN_ONLY", "Warn only"],
          ]), { enabledWhen: "enabled" }),
          dt("complianceDate", "Cap compliance deadline", "Every team must be cap-compliant by this date. With Allow until the compliance date, offseason moves that would put a team over the cap are blocked from then on (with no date set they're never blocked).", { enabledWhen: "enabled" }),
          sel(
            "overCapPenalty",
            "Over the cap at the deadline",
            "Consequence for a team still over the cap at the compliance deadline. The deadline and over-cap teams are shown on Commissioner Home; the commissioner applies the consequence.",
            o([
              ["COMMISSIONER_RESOLVES", "Commissioner resolves"],
              ["FREEZE_TRANSACTIONS", "Transactions frozen"],
              ["FORFEIT_PICK", "Forfeit a draft pick"],
            ]),
            { enabledWhen: "enabled" },
          ),
          sel(
            "floorPenalty",
            "Under the floor",
            "Consequence for a team under the salary floor. Commissioner Home flags those teams; the commissioner applies the consequence.",
            o([
              ["NONE", "None"],
              ["CHARGE_DIFFERENCE", "Charged the difference as dead money"],
              ["FORFEIT_PICK", "Forfeit a draft pick"],
            ]),
            { enabledWhen: "enabled" },
          ),
          sel(
            "rolloverMode",
            "Unused cap rollover",
            "Not yet enforced: every team shares one league cap, so unused room can't carry into next season (rollover room has to be granted by the commissioner).",
            o([["NONE", "No rollover"], ["PERCENT_UNUSED", "A percentage of unused room"], ["FULL_UNUSED", "All unused room"]]),
            { enabledWhen: "enabled", ...NOT_ENFORCED },
          ),
          pct("rolloverPercent", "Rollover percentage", "Not yet enforced (see unused cap rollover). Share of unused room carried over.", { enabledWhen: "rolloverMode=PERCENT_UNUSED", ...NOT_ENFORCED }),
          money("rolloverMax", "Rollover maximum", "Not yet enforced (see unused cap rollover). Cap on the amount carried over.", 100_000, {
            nullable: true,
            nullLabel: "No maximum",
            enabledWhen: "rolloverMode=PERCENT_UNUSED|FULL_UNUSED",
            ...NOT_ENFORCED,
          }),
        ],
      },
      {
        id: "dead",
        title: "Dead money",
        fields: [
          bool("deadMoney.enabled", "Dead money on cuts", "Releasing a player leaves part of his salary on the cap."),
          pct("deadMoney.currentSeasonPercent", "Current season", "Share of the salary charged this season.", { enabledWhen: "deadMoney.enabled" }),
          pct("deadMoney.futureSeasonPercent", "Each future season", "Share charged for every remaining contract year.", { enabledWhen: "deadMoney.enabled" }),
          pct("deadMoney.preseasonCutPercent", "Preseason cut charge", "Current-season charge, instead of the current-season share, for cuts made while the league is in the preseason phase (future-season charges still apply).", {
            nullable: true,
            nullLabel: "Same as in season",
            enabledWhen: "deadMoney.enabled",
          }),
          week("deadMoney.waivedInSeasonBeforeWeek", "Penalty-free cuts before", "Cuts made before this week (outside the preseason phase) carry no dead money.", "Never penalty-free", { enabledWhen: "deadMoney.enabled" }),
          bool("deadMoney.rookieContractsExempt", "Rookie contracts exempt", "No dead money when cutting a player on a rookie deal.", { enabledWhen: "deadMoney.enabled" }),
          bool("deadMoney.forgivenIfClaimed", "Forgiven if claimed", "No dead money if another team claims the player off waivers.", { enabledWhen: "deadMoney.enabled" }),
          bool("deadMoney.retirementForgives", "Retirement forgives", "When a released player retires, his dead money for the current and future seasons is wiped (checked daily; seasons already played stay on the books).", { enabledWhen: "deadMoney.enabled" }),
          bool("deadMoney.deadMoneyTradable", "Dead money can be traded", "Not yet enforced: dead money stays with the team that cut the player.", { enabledWhen: "deadMoney.enabled", ...NOT_ENFORCED }),
          num("deadMoney.amnestyCutsPerTeam", "Amnesty cuts per team", "One-time penalty-free releases per team (the commissioner applies them).", 0, 3, { enabledWhen: "deadMoney.enabled" }),
        ],
      },
    ],
  },
  {
    key: "contracts",
    label: "Contracts",
    description: "Contract lengths, raises, extensions, franchise tags and the rookie scale.",
    groups: [
      {
        id: "length",
        title: "Contract length",
        fields: [
          bool("enabled", "Multi-year contracts", "Players carry contracts with years remaining."),
          num("minYears", "Minimum years", "Shortest contract.", 1, 5, { enabledWhen: "enabled" }),
          num("maxYears", "Maximum years", "Longest contract.", 1, 10, { enabledWhen: "enabled" }),
          num(
            "defaultFreeAgentYears",
            "Free agent default years",
            "Default contract length for auction lots (and lots won by a proxy bid), free agents taken in the rookie draft and commissioner adds. Waiver and free-agent pickups sign for Waivers › Pickup contract years.",
            1,
            10,
            { enabledWhen: "enabled" },
          ),
          num("inSeasonPickupMaxYears", "In-season pickup max years", "Not yet enforced: every pickup signs for Waivers › Pickup contract years.", 1, 10, { enabledWhen: "enabled", ...NOT_ENFORCED }),
          bool("auctionWinnerChoosesYears", "Auction winner picks years", "Not yet enforced: auction contract lengths follow Drafts › Salary auction › Contract years.", { enabledWhen: "enabled", ...NOT_ENFORCED }),
          {
            kind: "list",
            path: "lengthLimits",
            label: "Long-contract limits",
            help: "Limit how many long contracts a team can hold, e.g. at most 3 contracts of 4+ years.",
            item: [
              { key: "years", label: "Years or more", kind: "number", min: 2, max: 10, int: true, suffix: "+ yrs" },
              { key: "maxCount", label: "Max contracts", kind: "number", min: 0, max: 40, int: true },
            ],
            maxItems: 6,
            addLabel: "Add limit",
            emptyText: "No limits on long contracts.",
            enabledWhen: "enabled",
          },
          sel(
            "expiredContractsBecome",
            "Expired contracts",
            "What happens when a contract ends. Expired players who aren't kept are released at the season rollover and go where Keepers › Released players go to says.",
            o([
              ["FREE_AGENT", "Released (free agency or the auction pool)"],
              ["RFA", "Restricted free agency (not yet enforced: released like any expired contract)"],
            ]),
          ),
          num("rfaMatchWindowHours", "RFA match window", "Not yet enforced (see expired contracts). Hours the owner would have to match a restricted free agent's winning bid.", 1, 168, {
            suffix: "hrs",
            enabledWhen: "expiredContractsBecome=RFA",
            ...NOT_ENFORCED,
          }),
        ],
      },
      {
        id: "raises",
        title: "Raises & extensions",
        fields: [
          pct("annualRaisePercent", "Annual raise", "Salary grows by this much each season of a contract.", { max: 100 }),
          sel("raiseRounding", "Raise rounding", "How raised salaries round to whole dollars.", o([["UP", "Round up"], ["NEAREST", "Nearest dollar"], ["DOWN", "Round down"]])),
          sel("raiseAppliesTo", "Raises apply to", "Which contracts escalate.", o([["ALL", "All contracts"], ["ALL_EXCEPT_ROOKIE", "All except rookie deals"], ["VETERANS_ONLY", "Veterans only"]])),
          bool("extensionsAllowed", "Extensions", "Managers can extend contracts."),
          pct("extensionRaisePercent", "Extension raise", "Raise per year added by an extension.", { max: 200, enabledWhen: "extensionsAllowed" }),
          num("extensionMaxYearsAdded", "Max years added", "Longest extension.", 1, 5, { enabledWhen: "extensionsAllowed" }),
          num("extensionsPerTeamPerSeason", "Extensions per team per season", "Limit on extensions each season.", 0, 10, { nullable: true, nullLabel: "No limit", enabledWhen: "extensionsAllowed" }),
          sel("extensionWindow", "Extension window", "When extensions may be signed.", o([
            ["FINAL_YEAR_OFFSEASON", "Offseason before the final year"],
            ["ANY_OFFSEASON", "Any offseason"],
            ["ANY_TIME", "Any time"],
          ]), { enabledWhen: "extensionsAllowed" }),
        ],
      },
      {
        id: "tag",
        title: "Franchise tag",
        fields: [
          bool("franchiseTag.enabled", "Franchise tag", "Keep an expiring player one more year at a premium salary."),
          num("franchiseTag.perTeam", "Tags per team", "Tags each team may use per season.", 0, 3, { enabledWhen: "franchiseTag.enabled" }),
          sel("franchiseTag.eligibility", "Eligible players", "Who can be tagged.", o([["EXPIRING_ONLY", "Expiring contracts only"], ["ANY_PLAYER", "Any player"]]), { enabledWhen: "franchiseTag.enabled" }),
          sel("franchiseTag.costMethod", "Tag salary", "How the tagged salary is set.", o([["TOP5_AVG_AT_POSITION", "Average of the top salaries at his position"], ["RAISE_PERCENT", "Current salary plus a raise"]]), { enabledWhen: "franchiseTag.enabled" }),
          num("franchiseTag.topN", "Top salaries averaged", "How many top salaries at the position are averaged.", 3, 12, { enabledWhen: "franchiseTag.costMethod=TOP5_AVG_AT_POSITION" }),
          pct("franchiseTag.raisePercent", "Tag raise", "Raise over the current salary when the tag salary is set by a raise.", { max: 200, enabledWhen: "franchiseTag.costMethod=RAISE_PERCENT" }),
          dec("franchiseTag.consecutiveMultiplier", "Consecutive tag multiplier", "A second straight tag costs this multiple.", 1, 2, 0.05, { suffix: "×", enabledWhen: "franchiseTag.enabled" }),
          num("franchiseTag.maxConsecutive", "Max consecutive tags", "Times the same player can be tagged in a row.", 1, 3, { enabledWhen: "franchiseTag.enabled" }),
          num("franchiseTag.years", "Tag length", "Contract years granted by a tag.", 1, 2, { suffix: "yr", enabledWhen: "franchiseTag.enabled" }),
        ],
      },
      {
        id: "rookie",
        title: "Rookie contracts",
        fields: [
          num("rookieContractYears", "Rookie contract years", "Length of contracts for drafted rookies.", 1, 6),
          bool("rookieFourthYearOption", "Rookie option year", "Owners may exercise an option year on rookie deals."),
          multi("rookieOptionRounds", "Option-eligible rounds", "Draft rounds whose picks get the option.", o([["1", "Round 1"], ["2", "Round 2"], ["3", "Round 3"], ["4", "Round 4"], ["5", "Round 5"]]), { numeric: true, enabledWhen: "rookieFourthYearOption" }),
          pct("rookieOptionRaisePercent", "Option year raise", "Salary raise for the option year.", { max: 300, enabledWhen: "rookieFourthYearOption" }),
          money("undraftedRookieSalary", "Undrafted rookie salary", "Not yet enforced: undrafted rookies sign like any other free agent or waiver pickup.", 1000, { nullable: true, nullLabel: "League minimum", ...NOT_ENFORCED }),
          { kind: "rookieScale", path: "rookieScale", label: "Rookie salary scale", help: "Salary for each pick of each round (pick 1 first). Rounds come from the rookie draft settings." },
        ],
      },
    ],
  },
  {
    key: "keepers",
    label: "Keepers",
    description: "Keeper window, limits and salary escalation.",
    groups: [
      {
        id: "window",
        title: "Keeper window",
        fields: [
          bool("enabled", "Keeper designations", "Managers designate keepers each offseason."),
          sel("selectionBy", "Keepers chosen by", "Who designates keepers.", o([["OWNERS", "Managers"], ["COMMISSIONER", "Commissioner"]]), { enabledWhen: "enabled" }),
          dt("windowOpens", "Window opens", "When keeper designations open.", { enabledWhen: "enabled" }),
          dt("deadline", "Keeper deadline", "Designations lock at this time.", { enabledWhen: "enabled" }),
        ],
      },
      {
        id: "limits",
        title: "Limits",
        fields: [
          num("maxKeepers", "Max keepers", "Players each team may keep.", 0, 60, { nullable: true, nullLabel: "No limit (dynasty)", enabledWhen: "enabled" }),
          num("minKeepers", "Min keepers", "Players each team must keep.", 0, 60, { enabledWhen: "enabled" }),
          num("maxYearsKept", "Max years kept", "Seasons the same player may be kept.", 1, 15, { nullable: true, nullLabel: "No limit", enabledWhen: "enabled" }),
          bool("rookiesCountTowardLimit", "Rookies count toward the limit", "Rookie-contract players use a keeper spot.", { enabledWhen: "enabled" }),
          bool("requireContractYears", "Require contract years", "Only players with contract years remaining can be kept.", { enabledWhen: "enabled" }),
          bool("allowKeepingIR", "Allow keeping IR players", "Players on IR may be kept.", { enabledWhen: "enabled" }),
          bool("mustBeCapCompliant", "Keepers must fit the cap", "A team's keepers must fit under next season's cap.", { enabledWhen: "enabled" }),
          sel(
            "releasedPlayersReturnTo",
            "Released players go to",
            "Where players released at the season rollover (expired contracts that weren't kept) go. Auction pool: they can only be signed in that season's salary auction, and become free agents once it is complete (or once the regular season starts, if that season has no auction). Applies even with keeper designations off.",
            o([["AUCTION_POOL", "Next salary auction"], ["FREE_AGENCY", "Free agency"]]),
          ),
          bool("tradeCarriesKeeperCost", "Trades carry keeper cost", "A traded player's keeper price and years move with him.", { enabledWhen: "enabled" }),
        ],
      },
      {
        id: "escalation",
        title: "Keeper salary escalation",
        fields: [
          sel("escalation.type", "Escalation", "How a kept player's salary rises.", o([["PERCENT", "Percentage raise"], ["FLAT", "Flat raise"], ["NONE", "No raise"]]), { enabledWhen: "enabled" }),
          dec("escalation.value", "Raise amount", "Percent or dollars, per the escalation type.", 0, 500, 0.5, { enabledWhen: "escalation.type=PERCENT|FLAT" }),
          money("escalation.minIncrease", "Minimum raise", "Smallest raise in dollars.", 1000, { enabledWhen: "escalation.type=PERCENT|FLAT" }),
        ],
      },
    ],
  },
  {
    key: "waivers",
    label: "Waivers & FAB",
    description: "Waiver type, FAB budget, run schedule and acquisition limits.",
    groups: [
      {
        id: "type",
        title: "Waiver system",
        fields: [
          sel("type", "Waiver type", "How claims are awarded.", o([["FAB", "Free agent budget (blind bids)"], ["PRIORITY", "Waiver priority"], ["FREE_FOR_ALL", "First come, first served"]])),
          sel("priorityType", "Priority order", "How the waiver priority order changes.", o([["ROLLING", "Rolling (a successful claim goes to the back)"], ["RESET_WEEKLY_BY_RECORD", "Reset weekly by reverse standings"]])),
          sel("tiebreaker", "Claim tiebreaker", "Breaks ties between equal claims.", o([["PRIORITY", "Waiver priority"], ["WORST_RECORD", "Worst record"], ["EARLIEST_CLAIM", "Earliest claim"]])),
          num("waiverPeriodHours", "Waiver period", "Hours a dropped player stays on waivers.", 0, 168, { suffix: "hrs" }),
          bool("continuousFreeAgency", "Continuous free agency", "Players who clear waivers can be added instantly."),
          bool("lockPlayersAfterGameStart", "Lock players at kickoff", "Free agents go on waivers once their game starts."),
          bool("newPlayersStartOnWaivers", "New players start on waivers", "Not yet enforced: players new to the pool (e.g. after the NFL draft) can be added right away.", NOT_ENFORCED),
          sel("playoffMode", "Waivers in the playoffs", "Waiver handling once the playoffs start.", o([["SAME_AS_REGULAR", "Same as regular season"], ["FAB_ONLY", "FAB only"], ["FROZEN", "Priority order frozen"]])),
          bool("offseasonWaivers", "Offseason waivers", "Run waivers in the offseason (otherwise free agency is open)."),
          bool("disableAdds", "Freeze all adds", "Commissioner freeze: no one can add players."),
        ],
      },
      {
        id: "schedule",
        title: "Run schedule",
        fields: [
          multi("processDays", "Waiver run days", "Days waiver claims are processed.", WEEKDAY_OPTIONS, { minItems: 1 }),
          num("processHour", "Run hour", "Hour (0-23, league time) claims process.", 0, 23, { suffix: ":00" }),
        ],
      },
      {
        id: "fab",
        title: "Free agent budget",
        fields: [
          money("faabBudget", "Season FAB budget", "Budget each team starts the season with.", 10_000, { enabledWhen: "type=FAB" }),
          money("minBid", "Minimum bid", "Lowest bid allowed.", 1000, { enabledWhen: "type=FAB" }),
          money("bidIncrement", "Bid increment", "Bids must be a multiple of this.", 100, { min: 1, enabledWhen: "type=FAB" }),
          bool("allowZeroBids", "Allow $0 bids", "Claims can be made for nothing.", { enabledWhen: "type=FAB" }),
          sel("revealBids", "Reveal bids after a run", "What the transaction log shows after waivers process.", o([["ALL_BIDS", "Every bid"], ["WINNING_ONLY", "Winning bids only"], ["NONE", "No bid amounts"]]), { enabledWhen: "type=FAB" }),
          bool("faabRollover", "Unused FAB rolls over", "Unspent budget carries into next season.", { enabledWhen: "type=FAB" }),
          bool("faabTradable", "FAB can be traded", "FAB may be included in trades.", { enabledWhen: "type=FAB" }),
          money("weeklyFaabAllowance", "Weekly FAB allowance", "FAB added to every team each week.", 1000, { enabledWhen: "type=FAB" }),
        ],
      },
      {
        id: "contracts",
        title: "Pickup contracts",
        fields: [
          bool("salaryEqualsBid", "Salary equals winning bid", "A won claim's salary is the winning bid (at least the minimum salary)."),
          dec("salaryMultiplier", "Bid-to-salary multiplier", "Salary = winning bid × this.", 0, 5, 0.05, { suffix: "×", enabledWhen: "salaryEqualsBid" }),
          num("signedContractYears", "Pickup contract years", "Contract years for players added off waivers or free agency.", 1, 10),
        ],
      },
      {
        id: "limits",
        title: "Limits",
        fields: [
          num("maxAcquisitionsPerWeek", "Max adds per week", "Adds per team per week.", 1, 50, { nullable: true, nullLabel: "No limit" }),
          num("maxAcquisitionsPerSeason", "Max adds per season", "Adds per team per season.", 1, 500, { nullable: true, nullLabel: "No limit" }),
          num("maxPendingClaims", "Max pending claims", "Claims a team may have pending at once.", 1, 100, { nullable: true, nullLabel: "No limit" }),
          num("maxClaimsWonPerRun", "Max claims won per run", "Claims a team can win in one waiver run.", 1, 20, { nullable: true, nullLabel: "No limit" }),
          num("dropCooldownHours", "Re-add cooldown", "Hours before a team can re-add a player it dropped.", 0, 336, { suffix: "hrs" }),
          bool(
            "eliminatedTeamsCanAdd",
            "Eliminated teams can add",
            "Off: during the playoffs, teams out of the championship bracket (including teams that missed the playoffs) can't add free agents or make waiver claims. A first-round bye never eliminates a team; a multi-week round eliminates its losers once all its weeks are final.",
          ),
          money("addDropFee", "Add/drop fee", "Real-money fee per transaction, collected with dues.", 100),
          { kind: "players", path: "undroppablePlayerIds", label: "Undroppable players", help: "Players who cannot be dropped (and so never hit waivers)." },
        ],
      },
    ],
  },
  {
    key: "trades",
    label: "Trades",
    description: "Trade deadline, review process and tradable assets.",
    groups: [
      {
        id: "window",
        title: "Trading window",
        fields: [
          bool("enabled", "Trading", "Managers can propose trades."),
          week("deadlineWeek", "Trade deadline", "Last week trades can be completed.", "No deadline", { enabledWhen: "enabled" }),
          bool("allowDuringPlayoffs", "Trades in the playoffs", "Allow trades after the playoffs begin.", { enabledWhen: "enabled" }),
          bool("allowOffseasonTrades", "Offseason trades", "Allow trades in the offseason.", { enabledWhen: "enabled" }),
          num("offerExpirationHours", "Offers expire after", "Hours before an unanswered offer expires.", 1, 336, { suffix: "hrs", enabledWhen: "enabled" }),
          sel("lockedPlayersPolicy", "Players who already played", "Trades involving players whose games have started.", o([["PROCESS_AFTER_UNLOCK", "Process after the week ends"], ["BLOCK", "Block until next week"]]), { enabledWhen: "enabled" }),
          num("tradeBackCooldownDays", "Trade-back cooldown", "Days before a player can be traded back to the team he came from.", 0, 365, { suffix: "days", enabledWhen: "enabled" }),
          bool("showTradeBlock", "Trade block", "Managers can list players and picks they're shopping."),
        ],
      },
      {
        id: "review",
        title: "Review",
        fields: [
          sel("reviewType", "Trade review", "How accepted trades are approved.", o([["NONE", "No review (instant)"], ["COMMISSIONER", "Commissioner approval"], ["LEAGUE_VOTE", "League vote (veto)"]]), { enabledWhen: "enabled" }),
          num("reviewPeriodHours", "Review period", "Hours accepted trades wait before processing.", 0, 168, { suffix: "hrs", enabledWhen: "reviewType=COMMISSIONER|LEAGUE_VOTE" }),
          num("vetoVotesRequired", "Veto votes required", "Votes needed to veto a trade.", 1, 30, { enabledWhen: "reviewType=LEAGUE_VOTE" }),
          sel("voteEligibility", "Who can vote", "Teams eligible to vote on a trade.", o([["NON_INVOLVED_TEAMS", "Teams not in the trade"], ["ALL_TEAMS", "Every team"]]), { enabledWhen: "reviewType=LEAGUE_VOTE" }),
          sel("commissionerTradesReviewedBy", "Commissioner's own trades", "Who reviews trades involving the commissioner's team.", o([["NONE", "Normal process"], ["CO_COMMISSIONER", "Co-commissioner"], ["LEAGUE_VOTE", "League vote"]]), { enabledWhen: "enabled" }),
        ],
      },
      {
        id: "assets",
        title: "Assets & limits",
        fields: [
          bool("allowDraftPickTrading", "Draft picks", "Future rookie picks can be traded.", { enabledWhen: "enabled" }),
          num("futurePickYears", "Pick years tradable", "Seasons of future picks each team holds and may trade.", 1, 5, { enabledWhen: "allowDraftPickTrading" }),
          bool("pickTradingRequiresPaidDues", "Pick trades require paid dues", "A team can trade draft picks only once its dues are marked paid (General › Dues paid). No effect in a free league."),
          bool("allowFaabTrading", "FAB", "FAB can be included in trades.", { enabledWhen: "enabled" }),
          bool("irPlayersTradable", "IR players", "Players on IR can be traded.", { enabledWhen: "enabled" }),
          bool("taxiPlayersTradable", "Taxi players", "Players on taxi squads can be traded.", { enabledWhen: "enabled" }),
          pct("salaryRetentionMaxPercent", "Max salary retention", "Share of a traded player's salary the sender may keep paying (as dead money).", { max: 50, enabledWhen: "enabled" }),
          bool("requireCapCompliance", "Must be cap-compliant", "Whenever the cap is enforced, a trade fails if it leaves a team over the cap (the soft-cap limit for soft caps) with more salary than before. Off, or while the cap only warns: the trade shows a warning instead.", { enabledWhen: "enabled" }),
          bool("allowUnbalanced", "Unbalanced trades", "Allow uneven player counts (e.g. 3-for-1).", { enabledWhen: "enabled" }),
          num("maxPlayersPerSide", "Max players per side", "Most players one team can send.", 1, 20, { nullable: true, nullLabel: "No limit", enabledWhen: "enabled" }),
          bool("allowMultiTeamTrades", "Multi-team trades", "Trades between three or more teams.", { enabledWhen: "enabled" }),
          num("maxTeamsPerTrade", "Max teams per trade", "Teams allowed in one trade.", 2, 6, { enabledWhen: "allowMultiTeamTrades" }),
        ],
      },
    ],
  },
  {
    key: "draft",
    label: "Drafts",
    description: "Rookie draft order and lottery, plus the salary auction.",
    groups: [
      {
        id: "rookie",
        title: "Rookie draft",
        fields: [
          num("rookie.rounds", "Rounds", "Rounds in the rookie draft (also the picks each team holds per season).", 1, 7),
          sel("rookie.style", "Draft style", "Linear repeats the order each round; snake reverses it.", o([["LINEAR", "Linear"], ["SNAKE", "Snake"]])),
          sel(
            "rookie.orderMethod",
            "Draft order",
            "How last season sets the rookie draft order. Reverse standings: worst record first. Reverse max potential points: lowest total of each regular season week's best possible lineup (from the players the team had that week) first. Lottery: the worst teams draw for the top picks, everyone else follows reverse standings.",
            [
              { value: "REVERSE_STANDINGS", label: "Reverse standings" },
              { value: "REVERSE_MAX_PF", label: "Reverse max potential points" },
              // identical to REVERSE_MAX_PF in @/lib/draft/logic; kept so leagues that stored it stay valid
              { value: "REVERSE_POTENTIAL_POINTS", label: "Reverse potential points (same as max potential points)", legacy: true },
              { value: "LOTTERY", label: "Lottery for the worst teams" },
            ],
          ),
          bool("rookie.playoffTeamsByFinish", "Playoff teams by finish", "Non-playoff teams pick first; playoff teams follow in reverse order of playoff finish (champion last)."),
          sel(
            "rookie.consolationWinnerPick",
            "Consolation winner",
            "Reward for the consolation bracket champion (a non-playoff team), once that bracket is decided: the No. 1 slot in the draft order, or the first slot after the lottery picks (No. 1 when there is no lottery).",
            o([["NONE", "No special pick"], ["FIRST_NON_PLAYOFF", "First non-playoff pick"], ["FIRST_OVERALL", "First overall pick"]]),
          ),
          sel("rookie.eligibility", "Eligible players", "Who can be drafted.", o([["ROOKIES_ONLY", "Rookies only"], ["ROOKIES_AND_FREE_AGENTS", "Rookies and free agents"]])),
          dt("rookie.scheduledFor", "Draft start", "When the rookie draft begins."),
        ],
      },
      {
        id: "clock",
        title: "Rookie draft clock",
        fields: [
          num("rookie.pickTimerMinutes", "Pick timer", "Minutes per pick (slow drafts use hours).", 1, 2880, { suffix: "min" }),
          sel("rookie.onTimeout", "When the clock expires", "What happens when a team runs out of time. Skip: the team can still make the missed pick later while the draft is live.", o([["AUTOPICK", "Autopick"], ["SKIP", "Skip; pick later"]])),
          sel("rookie.autopickSource", "Autopick from", "Where autopicks come from.", o([["BIG_BOARD", "Team's big board"], ["LEAGUE_RANKINGS", "League rookie rankings"], ["ADP", "ADP"]])),
          bool("rookie.overnightPause", "Overnight pause", "Stop the clock overnight."),
          num("rookie.pauseStartHour", "Pause starts", "Hour (league time) the clock stops.", 0, 23, { suffix: ":00", enabledWhen: "rookie.overnightPause" }),
          num("rookie.pauseEndHour", "Pause ends", "Hour (league time) the clock restarts.", 0, 23, { suffix: ":00", enabledWhen: "rookie.overnightPause" }),
          bool("rookie.tradingDuringDraft", "Trading during the draft", "Picks of a season can be traded while that season's rookie draft is live or paused. Off: they're locked until the draft is complete."),
        ],
      },
      {
        id: "lottery",
        title: "Draft lottery",
        fields: [
          num("rookie.lottery.teams", "Lottery teams", "Teams in the lottery: the first this many in reverse standings (non-playoff teams first when playoff teams pick by finish).", 2, 16, { enabledWhen: "rookie.orderMethod=LOTTERY" }),
          { kind: "numberList", path: "rookie.lottery.odds", label: "Lottery odds", help: "Chance of the first pick for each lottery team, worst record first. Must add up to 100%.", min: 0, max: 100, step: 0.5, maxItems: 16, suffix: "%", enabledWhen: "rookie.orderMethod=LOTTERY" },
          num("rookie.lottery.picksDrawn", "Picks drawn", "Picks decided by the draw; the remaining lottery teams pick in their pre-lottery order.", 1, 16, { nullable: true, nullLabel: "Every lottery pick", enabledWhen: "rookie.orderMethod=LOTTERY" }),
          num("rookie.lottery.maxDropSpots", "Max drop", "A team can fall at most this many spots below its pre-lottery slot (applied to the draw and the odds table).", 1, 15, { nullable: true, nullLabel: "No limit", enabledWhen: "rookie.orderMethod=LOTTERY" }),
          bool("rookie.lottery.liveReveal", "Live reveal", "Reveal the lottery pick by pick on the lottery page.", { enabledWhen: "rookie.orderMethod=LOTTERY" }),
        ],
      },
      {
        id: "auction",
        title: "Salary auction",
        description: "Each auction keeps the rules it started with; changes apply to auctions that haven't started.",
        fields: [
          money("auction.budget", "Auction budget", "Budget each team brings to the auction (while the salary cap is enforced, a team can never bid more than its room under the cap, or the soft-cap limit).", 100_000, { min: 1 }),
          money("auction.minBid", "Minimum bid", "Opening and lowest bid (never below the league minimum salary when the cap is on).", 1000, { min: 1 }),
          money("auction.bidIncrement", "Bid increment", "Smallest raise over the current bid.", 100, { min: 1 }),
          sel(
            "auction.nominatorOpeningBid",
            "Nominator's opening bid",
            "Any amount: the nominator opens at any bid from the minimum up to their max bid. Minimum bid only: every nomination opens at the minimum bid.",
            o([["ANY_AMOUNT", "Any amount"], ["MIN_BID", "Minimum bid only"]]),
          ),
          sel(
            "auction.maxBidRule",
            "Max bid",
            "Limit on a single bid. Either way a bid can't exceed the league maximum salary.",
            o([["BUDGET_MINUS_OPEN_SLOTS", "Budget minus $min per other open roster spot"], ["BUDGET", "Remaining budget"]]),
          ),
          num("auction.rosterSpotsToFill", "Roster spots to fill", "Players each team buys (never more than its open active-roster spots).", 1, 80),
          bool("auction.includesRookies", "Rookies in the auction", "First-year players can be nominated. Off: rookies are left out of the auction pool."),
          bool("auction.proxyBidding", "Proxy bidding", "Managers can set a maximum bid on their targets and the auction raises their bid up to it automatically, even while they're away. Off: max bids are refused."),
          sel("auction.contractYearsMode", "Contract years", "How auction contracts get their length.", o([["WINNER_CHOOSES", "Winner chooses"], ["FIXED", "Fixed length"]])),
          num("auction.fixedContractYears", "Fixed contract years", "Length when contracts are fixed.", 1, 10, { enabledWhen: "auction.contractYearsMode=FIXED" }),
          dt("auction.scheduledFor", "Auction start", "When the salary auction begins."),
        ],
      },
      {
        id: "auctionClock",
        title: "Auction clock",
        fields: [
          sel("auction.nominationOrder", "Nomination order", "Default order teams nominate in (it can be changed when an auction is created).", o([["RANDOM", "Random"], ["REVERSE_STANDINGS", "Reverse standings"], ["CUSTOM", "Commissioner sets it"]])),
          num("auction.nominationSeconds", "Nomination clock", "Seconds to nominate.", 10, 600, { suffix: "sec" }),
          bool(
            "auction.autoNominateOnTimeout",
            "Auto-nominate on timeout",
            "When the nominator's clock runs out, the top available player on their targets list (else the best available by ADP) is nominated at the minimum bid. Off: the turn is skipped.",
          ),
          num("auction.bidSeconds", "Bid clock", "Seconds on the clock after a nomination.", 5, 300, { suffix: "sec" }),
          num("auction.resetSecondsOnBid", "Clock reset on bid", "Seconds the clock resets to after each new high bid.", 3, 120, { suffix: "sec" }),
        ],
      },
    ],
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "League-wide defaults for alerts, recaps and chat posts.",
    groups: [
      {
        id: "alerts",
        title: "Alerts",
        fields: [
          sel("touchdownAlertsDefault", "Touchdown alerts default", "Default TD alert scope for new managers.", o([
            ["MY_STARTERS", "My starters"],
            ["MY_ROSTER", "My whole roster"],
            ["MY_MATCHUP", "My matchup (both teams)"],
            ["LEAGUE", "Every league TD"],
            ["OFF", "Off"],
          ])),
          bool("injuryAlerts", "Injury alerts", "Alert managers about injury news on their players."),
          num("lineupReminderHoursBefore", "Lineup reminder", "Hours before kickoff to warn about injured / bye starters.", 0, 48, { suffix: "hrs" }),
        ],
      },
      {
        id: "recap",
        title: "Weekly recap",
        fields: [
          bool("weeklyRecapEnabled", "Weekly recap", "Generate and email a recap after each week."),
          { kind: "weekday", path: "weeklyRecapDay", label: "Recap day", help: "Day the recap goes out.", enabledWhen: "weeklyRecapEnabled" },
          num("weeklyRecapHour", "Recap hour", "Hour (0-23, league time).", 0, 23, { suffix: ":00", enabledWhen: "weeklyRecapEnabled" }),
        ],
      },
      {
        id: "chat",
        title: "League feed & chat",
        fields: [
          bool("tradeAlertsToLeague", "Announce trades", "Notify the league when a trade completes."),
          bool("transactionsToChat", "Transactions in chat", "Post adds, drops and waiver results in league chat."),
          bool("announcementsToChat", "Announcements in chat", "Post commissioner announcements in league chat."),
          bool("announcementsNotify", "Announcement alerts", "Send commissioner announcements as push / email alerts."),
          bool("settingsChangeNotifyDefault", "Announce rule changes", "Default for notifying managers when settings are saved."),
        ],
      },
    ],
  },
  {
    key: "commissioner",
    label: "Commissioner",
    description: "Commissioner powers, transparency and setting locks.",
    groups: [
      {
        id: "powers",
        title: "Powers",
        fields: [
          bool("canEditLineups", "Edit any lineup", "The commissioner may set lineups for any team."),
          bool("canEditPastScores", "Edit past scores", "Score adjustments and re-scores for completed weeks."),
          bool("coCommissionerFullPowers", "Co-commissioners have full powers", "Off = co-commissioners cannot change league settings."),
          bool("ownTeamActionsRequireCoCommish", "Own-team actions need a co-commissioner", "Commissioner overrides on their own team must be made by a co-commissioner."),
        ],
      },
      {
        id: "transparency",
        title: "Transparency",
        fields: [
          bool("auditLogVisibleToLeague", "Public action log", "Show recent commissioner actions on the rulebook page."),
          bool("notifyAffectedOwners", "Notify affected managers", "Alert a manager when the commissioner changes their roster, contracts or FAB."),
          bool("managersSeeOtherQueues", "Managers see other draft queues", "Not yet enforced: draft queues and big boards are always private to their team.", NOT_ENFORCED),
          bool("publicTradeVotes", "Public trade votes", "Show who voted to veto a trade."),
        ],
      },
      {
        id: "locks",
        title: "Setting locks",
        fields: [
          multi("lockedSectionsInSeason", "Locked during the season", "These settings sections cannot be edited during the regular season and playoffs.", SECTION_OPTIONS),
          multi("sectionsRequiringVote", "Changes need a league vote", "In-season changes to these sections must record the league vote result.", SECTION_OPTIONS),
          pct("voteThresholdPercent", "Vote threshold", "Share of managers needed to pass a rule change.", { min: 50 }),
        ],
      },
    ],
  },
  {
    key: "niche",
    label: "Fun & custom",
    description: "Median games, punishments, side games and your league's own rules.",
    groups: [
      {
        id: "weekly",
        title: "Weekly extras",
        fields: [
          bool("medianGameEachWeek", "Median game", "Every team also plays the league median score each week."),
          bool("weeklyHighScoreBonusWin", "High score bonus win", "The week's top scorer gets an extra win."),
          money("weeklyHighScorePrize", "Weekly high score prize", "Real-money prize for the week's top score.", 10_000),
          week("reverseScoringWeek", "Reverse scoring week", "The lower score wins each regular season matchup this week (tied scores still go to the usual tiebreakers). All-play, median and high-score results still reward the higher score, and playoff games are always decided by the normal score.", "None"),
          week("chaosWeek", "Chaos week", "A week played under a special rule.", "None"),
          text("chaosWeekRule", "Chaos week rule", "Describe the special rule.", 300, { multiline: true, enabledWhen: "chaosWeek" }),
          multi("weeklyAwards", "Weekly awards", "Awards handed out in each weekly recap.", o([
            ["TOP_SCORE", "Top score"],
            ["LOWEST_SCORE", "Lowest score"],
            ["BIGGEST_BLOWOUT", "Biggest blowout"],
            ["CLOSEST_GAME", "Closest game"],
            ["BENCH_BLUNDER", "Bench blunder"],
            ["WAIVER_HERO", "Waiver hero"],
          ])),
        ],
      },
      {
        id: "accountability",
        title: "Accountability",
        fields: [
          num(
            "minimumStartersOrForfeit",
            "Minimum starters",
            "A team with fewer starters who play than this loses its regular season matchup whatever the score (empty slots and starters on bye, ruled out or without a stat line don't count; auto-subs do). If both teams fall short, the score decides. Playoff games are decided by the score alone. 0 = off.",
            0,
            30,
          ),
          bool("tankingProtection", "Tanking protection", "The commissioner may penalize teams that knowingly start inactive players."),
          num("inactiveManagerFlagDays", "Inactive manager flag", "Days without logging in before a manager is flagged.", 1, 120, { suffix: "days" }),
          money("emptyStarterFine", "Empty starter fine", "Real-money fine per empty starting slot.", 1000),
        ],
      },
      {
        id: "lastplace",
        title: "Last place",
        fields: [
          bool("tacoTrophy", "Last-place trophy", "Award a last-place trophy."),
          text("lastPlaceTrophyName", "Trophy name", "What last place 'wins'.", 60, { enabledWhen: "tacoTrophy" }),
          sel("lastPlaceDeterminedBy", "Last place decided by", "How last place is determined.", o([["TOILET_BOWL_LOSER", "Toilet bowl loser"], ["REGULAR_SEASON_RECORD", "Regular season record"], ["POINTS_FOR", "Fewest points"]])),
          text("lastPlacePunishment", "Punishment", "What the last-place manager has to do.", 1000, { multiline: true }),
          dt("punishmentDeadline", "Punishment deadline", "When the punishment must be completed."),
          sel(
            "lastPlaceDraftPenalty",
            "Draft penalty",
            "Extra penalty for last place. Pick swap: once the season is final, the last-place team trades rookie draft slots with the team right after it (it picks one spot later).",
            o([
              ["NONE", "None"],
              ["LOSE_FAAB", "Loses FAB (the commissioner applies it)"],
              ["PICK_SWAP", "Pick swap"],
            ]),
          ),
        ],
      },
      {
        id: "sidegames",
        title: "Side games & trophies",
        fields: [
          bool("guillotine", "Guillotine", "Not yet enforced: the site doesn't eliminate the week's lowest scorer or release their roster.", NOT_ENFORCED),
          num("guillotineEliminatedPerWeek", "Teams eliminated per week", "Not yet enforced (see guillotine).", 1, 2, { enabledWhen: "guillotine", ...NOT_ENFORCED }),
          bool("survivorPoolEnabled", "Survivor pool", "Side game run by the commissioner (the lowest weekly scorer among survivors is out); listed in the rulebook."),
          bool("pickemEnabled", "NFL pick'em", "Side game picking NFL winners each week, run by the commissioner; listed in the rulebook."),
          bool("bountyEnabled", "Bounties", "Rewards for beating a specific team (e.g. the defending champ), paid by the commissioner; listed in the rulebook."),
          text("bountyDescription", "Bounty details", "Shown in the rulebook.", 500, { multiline: true, enabledWhen: "bountyEnabled" }),
          bool("hallOfFameEnabled", "Hall of fame", "Not yet enforced: league history always shows champions and records.", NOT_ENFORCED),
          {
            kind: "list",
            path: "rivalryTrophies",
            label: "Rivalry trophies",
            help: "Named trophies for rivalry games.",
            item: [
              { key: "name", label: "Trophy", kind: "text", maxLength: 60, minLength: 1, placeholder: "The Helmet Cup" },
              { key: "teamA", label: "Team A", kind: "team" },
              { key: "teamB", label: "Team B", kind: "team" },
            ],
            maxItems: 16,
            addLabel: "Add trophy",
            emptyText: "No rivalry trophies.",
          },
        ],
      },
      {
        id: "custom",
        title: "Custom league rules",
        description: "Your league's own rules, shown in the rulebook. Enforced by the commissioner.",
        fields: [
          {
            kind: "list",
            path: "custom",
            label: "Custom rules",
            help: "Add any rule the site doesn't enforce automatically.",
            item: [
              { key: "title", label: "Rule", kind: "text", maxLength: 80, minLength: 1, placeholder: "No tanking" },
              { key: "description", label: "Details", kind: "text", maxLength: 1000, minLength: 1, multiline: true },
              { key: "since", label: "Since season", kind: "number", min: 1990, max: 2100, int: true, nullable: true },
              { key: "enabled", label: "In effect", kind: "toggle" },
            ],
            maxItems: 40,
            addLabel: "Add rule",
            autoId: "id",
            emptyText: "No custom rules yet.",
          },
        ],
      },
    ],
  },
];

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s])) as Record<EditableSection, SectionMeta>;

export const SECTION_LABELS: Record<SettingsSection, string> = {
  ...(Object.fromEntries(SECTIONS.map((s) => [s.key, s.label])) as Record<EditableSection, string>),
  scoring: "Scoring",
};

export function isEditableSection(s: string): s is EditableSection {
  return s in SECTION_BY_KEY;
}

/** Every field of a section, flattened */
export function sectionFields(section: EditableSection): FieldDef[] {
  return SECTION_BY_KEY[section].groups.flatMap((g) => g.fields);
}

/** Lookup "salaryCap.deadMoney.currentSeasonPercent" -> field + section */
const FIELD_INDEX = new Map<string, { section: EditableSection; field: FieldDef }>();
for (const s of SECTIONS) for (const g of s.groups) for (const f of g.fields) FIELD_INDEX.set(`${s.key}.${f.path}`, { section: s.key, field: f });

export function fieldForPath(fullPath: string): { section: EditableSection; field: FieldDef; rest: string } | null {
  const parts = fullPath.split(".");
  for (let i = parts.length; i >= 2; i--) {
    const hit = FIELD_INDEX.get(parts.slice(0, i).join("."));
    if (hit) return { ...hit, rest: parts.slice(i).join(".") };
  }
  return null;
}

// ───────────────────────────── path helpers ─────────────────────────────

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Immutable set: returns a copy of obj with path set to value */
export function setAt<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const base = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  return { ...base, [head]: rest.length ? setAt(base[head], rest.join("."), value) : value } as T;
}

/** Evaluate a field's `enabledWhen` against the section value */
export function fieldEnabled(field: { enabledWhen?: string }, sectionValue: unknown): boolean {
  if (!field.enabledWhen) return true;
  const [path, values] = field.enabledWhen.split("=");
  const v = getAt(sectionValue, path);
  if (values === undefined) return v !== null && v !== undefined && v !== false && v !== 0 && v !== "";
  return values.split("|").some((x) => String(v) === x);
}

// ───────────────────────────── display helpers ─────────────────────────────

export interface FormatLookups {
  teams?: Map<string, string>;
  players?: Map<string, string>;
  tz?: string;
}

function fmtNum(f: NumberField, v: number): string {
  const n = Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 1000) / 1000);
  if (f.prefix === "$") return `$${n}`;
  if (f.prefix === "Wk") return `Week ${n}`;
  if (f.suffix === "%") return `${n}%`;
  if (f.suffix === "×") return `${n}×`;
  if (f.suffix === ":00") return hour12(v);
  if (f.suffix) return `${n} ${f.suffix}`;
  return n;
}

function hour12(h: number) {
  const hh = ((h % 24) + 24) % 24;
  return hh === 0 ? "12 AM" : hh === 12 ? "12 PM" : hh < 12 ? `${hh} AM` : `${hh - 12} PM`;
}

function fmtDate(iso: string, tz = "America/New_York") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
}

const optLabel = (opts: Opt[], v: unknown) => opts.find((x) => x.value === String(v))?.label ?? String(v);

/** Readable value for the rulebook and settings history */
export function formatFieldValue(field: FieldDef, value: unknown, lk: FormatLookups = {}): string {
  if (value === undefined) return "—";
  switch (field.kind) {
    case "number":
      if (value === null) return field.nullLabel ?? "None";
      return typeof value === "number" ? fmtNum(field, value) : String(value);
    case "toggle":
      return value ? "Yes" : "No";
    case "select":
      return optLabel(field.options, value);
    case "multi":
    case "ordered": {
      const arr = Array.isArray(value) ? value : [];
      if (!arr.length) return "None";
      return arr.map((v) => optLabel(field.options, v)).join(field.kind === "ordered" ? " → " : ", ");
    }
    case "teams": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      if (!arr.length) return "None";
      return arr.map((id) => lk.teams?.get(id) ?? "Removed team").join(", ");
    }
    case "players": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      if (!arr.length) return "None";
      return arr.map((id) => lk.players?.get(id) ?? id).join(", ");
    }
    case "text":
      return value ? String(value) : "—";
    case "datetime":
      return value ? fmtDate(String(value), lk.tz) : "Not set";
    case "weekday":
      return WEEKDAY_LABELS[String(value)] ?? String(value);
    case "timezone":
      return String(value);
    case "numberList": {
      const arr = Array.isArray(value) ? (value as number[]) : [];
      return arr.length ? arr.map((n) => `${n}${field.suffix ?? ""}`).join(" / ") : "None";
    }
    case "list": {
      const arr = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      if (!arr.length) return field.emptyText;
      return arr
        .map((row) =>
          field.item
            .filter((i) => i.kind !== "toggle")
            .map((i) => {
              const v = row[i.key];
              if (i.kind === "team") return lk.teams?.get(String(v)) ?? "?";
              if (i.kind === "number") return v === null || v === undefined ? "" : `${i.prefix ?? ""}${v}${i.suffix ? ` ${i.suffix}` : ""}`;
              return String(v ?? "");
            })
            .filter(Boolean)
            .join(" "),
        )
        .join("; ");
    }
    case "rivalries": {
      const arr = Array.isArray(value) ? (value as [string, string][]) : [];
      if (!arr.length) return "None";
      return arr.map(([a, b]) => `${lk.teams?.get(a) ?? "?"} vs ${lk.teams?.get(b) ?? "?"}`).join("; ");
    }
    case "slots": {
      const arr = Array.isArray(value) ? (value as { label: string; count: number }[]) : [];
      return arr.map((s) => `${s.count > 1 ? `${s.count} ` : ""}${s.label}`).join(", ");
    }
    case "positionLimits": {
      const m = (value ?? {}) as Record<string, { min: number; max: number | null }>;
      const parts = Object.entries(m).map(([p, l]) => `${p === "DEF" ? "DST" : p} ${l.min}-${l.max ?? "∞"}`);
      return parts.length ? parts.join(", ") : "No limits";
    }
    case "rookieScale": {
      const m = (value ?? {}) as Record<string, number[]>;
      return Object.entries(m)
        .map(([r, arr]) => `Rd ${r}: $${arr.join("/")}`)
        .join("; ");
    }
  }
}

/** Label for a settings path (history diffs). Falls back to the path itself. */
export function labelForPath(fullPath: string): string {
  if (fullPath.startsWith("scoring.")) return scoringPathLabel(fullPath);
  const hit = fieldForPath(fullPath);
  if (!hit) return fullPath;
  const sec = SECTION_LABELS[hit.section];
  return `${sec}: ${hit.field.label}${hit.rest ? ` (${hit.rest})` : ""}`;
}

const SCORING_LABELS: Record<string, string> = {
  preset: "Scoring preset",
  decimals: "Decimal places",
  bonuses: "Milestone bonuses",
  fieldGoalsByDistance: "Field goal distance tiers",
  useFieldGoalDistance: "Score field goals by distance",
  pointsAllowedTiers: "Points allowed tiers",
  yardsAllowedTiers: "Yards allowed tiers",
  longTdBonuses: "Long touchdown bonuses",
  negativePointsFloor: "Negative points floor",
  roundToDecimals: "Round to decimal places",
};

export function scoringPathLabel(fullPath: string): string {
  const parts = fullPath.split(".").slice(1);
  const stat = (k: string | undefined) => (k ? STAT_BY_KEY[k]?.label ?? k : "");
  if (parts[0] === "rules") return `Scoring: ${stat(parts[1]) || "points per stat"}`;
  if (parts[0] === "positionOverrides") return `Scoring: ${parts[1] === "DEF" ? "DST" : parts[1] ?? ""} ${parts[2] ? `${stat(parts[2])} override` : "overrides"}`;
  return `Scoring: ${SCORING_LABELS[parts[0]] ?? parts.join(".")}`;
}
