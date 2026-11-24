// Pure formatting helpers for live scoring + schedule pages (safe in server and client components).
import { normalizePosition } from "@/lib/settings/stat-catalog";
import type { LeagueSettings } from "@/lib/settings/schema";
import type { StatMap } from "@/lib/scoring/engine";
import { lastFantasyWeek } from "@/lib/league-week";

/** ESPN numeric team ids (the scoreboard's `situation.possession` uses them) → our abbreviations */
export const ESPN_TEAM_IDS: Record<string, string> = {
  "1": "ATL", "2": "BUF", "3": "CHI", "4": "CIN", "5": "CLE", "6": "DAL", "7": "DEN", "8": "DET",
  "9": "GB", "10": "TEN", "11": "IND", "12": "KC", "13": "LV", "14": "LAR", "15": "MIA", "16": "MIN",
  "17": "NE", "18": "NO", "19": "NYG", "20": "NYJ", "21": "PHI", "22": "ARI", "23": "PIT", "24": "LAC",
  "25": "SF", "26": "SEA", "27": "TB", "28": "WAS", "29": "CAR", "30": "JAX", "33": "BAL", "34": "HOU",
};

/** Normalize a possession value (ESPN team id or abbreviation) to one of the game's teams. */
export function possessionTeam(possession: string | null | undefined, game: { homeTeam: string; awayTeam: string }): string | null {
  if (!possession) return null;
  const abbr = ESPN_TEAM_IDS[possession] ?? (possession === "WSH" ? "WAS" : possession);
  return abbr === game.homeTeam || abbr === game.awayTeam ? abbr : null;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export interface ClockGame {
  state: string;
  period: number | null;
  clock: string | null;
  statusDetail: string | null;
  startTime: Date | string;
}

/** "Sun 1:00 PM" in the league timezone */
export function kickoffLabel(start: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(start));
}

/** "Thu, Nov 26" in the league timezone */
export function dateLabel(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(d));
}

/** "11:42 PM" in the league timezone */
export function timeLabel(d: Date | string, tz: string, seconds = false): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), timeZone: tz }).format(new Date(d));
}

const PERIOD_NAMES = ["", "1st", "2nd", "3rd", "4th"];

/** Game status chip text: "Sun 1:00 PM" · "Q3 4:21" · "Half" · "OT 3:12" · "Final" · "Final/OT" */
export function gameStatusLabel(g: ClockGame, tz: string): string {
  if (g.state === "pre") {
    if (g.statusDetail && /postponed|delayed|canceled|cancelled/i.test(g.statusDetail)) return g.statusDetail;
    return kickoffLabel(g.startTime, tz);
  }
  if (g.state === "post") return (g.period ?? 4) > 4 ? "Final/OT" : "Final";
  const detail = g.statusDetail ?? "";
  if (/half/i.test(detail)) return "Half";
  const period = g.period ?? 1;
  const clock = g.clock ?? "";
  if (/^end/i.test(detail) || (clock === "0:00" && period <= 4)) return period === 2 ? "Half" : `End ${period <= 4 ? PERIOD_NAMES[period] : "OT"}`;
  if (period > 4) return `OT ${clock}`.trim();
  return `Q${period} ${clock}`.trim();
}

/** "@ SF" or "vs SF" from the perspective of `team` */
export function opponentLabel(team: string | null | undefined, game: { homeTeam: string; awayTeam: string } | null): string {
  if (!team || !game) return "BYE";
  return game.homeTeam === team ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`;
}

/** NFL game score from the perspective of `team`: "W 27-17", "L 10-24", "T 20-20", or "17-10" while live */
export function teamGameScore(team: string, game: { homeTeam: string; homeScore: number; awayScore: number; state: string }): string {
  const mine = game.homeTeam === team ? game.homeScore : game.awayScore;
  const theirs = game.homeTeam === team ? game.awayScore : game.homeScore;
  if (game.state === "post") return `${mine > theirs ? "W" : mine < theirs ? "L" : "T"} ${mine}-${theirs}`;
  return `${mine}-${theirs}`;
}

/** Compact CBS-style live stat line, e.g. "18/27 245 yd 2 TD" or "12-88-1 rush, 3-21 rec". */
export function statLine(stats: StatMap | null | undefined, position: string): string {
  if (!stats) return "";
  const s = stats;
  const pos = normalizePosition(position);
  const parts: string[] = [];
  const yd = (y: number) => (y < 0 ? `(${y})` : `${y}`);
  const triple = (a: number, y: number, td: number) => `${a}-${yd(y)}${td ? `-${td}` : ""}`;
  const rush = () => {
    if (n(s.rush_att) > 0 || n(s.rush_yd) !== 0 || n(s.rush_td) > 0) parts.push(`${triple(n(s.rush_att), n(s.rush_yd), n(s.rush_td))} rush`);
  };
  const rec = () => {
    if (n(s.rec) > 0 || n(s.rec_tgt) > 0 || n(s.rec_td) > 0) parts.push(`${triple(n(s.rec), n(s.rec_yd), n(s.rec_td))} rec`);
  };
  if (pos === "QB") {
    if (n(s.pass_att) > 0) {
      let p = `${n(s.pass_cmp)}/${n(s.pass_att)} ${n(s.pass_yd)} yd`;
      if (n(s.pass_td)) p += ` ${n(s.pass_td)} TD`;
      if (n(s.pass_int)) p += ` ${n(s.pass_int)} INT`;
      parts.push(p);
    }
    rush();
    rec();
  } else if (pos === "RB") {
    rush();
    rec();
  } else if (pos === "WR" || pos === "TE") {
    rec();
    rush();
  } else if (pos === "K") {
    if (n(s.fga) > 0 || n(s.fgm) > 0) parts.push(`FG ${n(s.fgm)}/${Math.max(n(s.fga), n(s.fgm))}${n(s.fgm_lng) ? ` (${n(s.fgm_lng)})` : ""}`);
    if (n(s.xpa) > 0 || n(s.xpm) > 0) parts.push(`XP ${n(s.xpm)}/${Math.max(n(s.xpa), n(s.xpm))}`);
  } else if (pos === "DEF") {
    if (n(s.sack)) parts.push(`${n(s.sack)} sk`);
    if (n(s.int)) parts.push(`${n(s.int)} INT`);
    if (n(s.fum_rec)) parts.push(`${n(s.fum_rec)} FR`);
    const tds = n(s.def_td) + n(s.def_st_td);
    if (tds) parts.push(`${tds} TD`);
    if (n(s.safe)) parts.push(`${n(s.safe)} SAF`);
    if ("pts_allow" in s) parts.push(`${n(s.pts_allow)} PA`);
    if ("yds_allow" in s) parts.push(`${n(s.yds_allow)} YA`);
  } else {
    const tkl = n(s.idp_tkl_solo) + n(s.idp_tkl_ast);
    if (tkl) parts.push(`${tkl} tkl`);
    if (n(s.idp_sack)) parts.push(`${n(s.idp_sack)} sk`);
    if (n(s.idp_int)) parts.push(`${n(s.idp_int)} INT`);
    if (n(s.idp_ff)) parts.push(`${n(s.idp_ff)} FF`);
    if (n(s.idp_pass_def)) parts.push(`${n(s.idp_pass_def)} PD`);
  }
  if (pos !== "DEF" && n(s.fum_lost)) parts.push(`${n(s.fum_lost)} FL`);
  return parts.join(", ");
}

export function fmtScore(v: number, decimals = 2): string {
  return (Math.round(v * 100) / 100).toFixed(decimals);
}

/** Win probability as a whole percent, never showing 0/100 while a game can still flip */
export function wpPercent(p: number, final = false): number {
  const pct = Math.round(p * 100);
  if (final) return pct;
  return Math.min(99, Math.max(1, pct));
}

// ───────────────────────────── Season calendar from settings ─────────────────────────────

export function regularSeasonLastWeek(settings: LeagueSettings): number {
  return settings.general.firstWeek + settings.general.regularSeasonWeeks - 1;
}

export function playoffRounds(settings: LeagueSettings): number {
  return Math.ceil(Math.log2(Math.max(2, settings.playoffs.teams)));
}

/** Last fantasy week (end of the championship) */
export function championshipEndWeek(settings: LeagueSettings): number {
  return lastFantasyWeek(settings);
}

export interface PlayoffWeekInfo {
  round: number;
  rounds: number;
  label: string;
  isChampionship: boolean;
}

/** Playoff round for a week (null for regular-season weeks). */
export function playoffWeekInfo(week: number, settings: LeagueSettings): PlayoffWeekInfo | null {
  const start = settings.playoffs.startWeek;
  const end = championshipEndWeek(settings);
  if (week < start || week > end) return null;
  const rounds = playoffRounds(settings);
  const per = Math.max(1, settings.playoffs.weeksPerRound);
  const round = Math.min(rounds, Math.floor((week - start) / per) + 1);
  const fromEnd = rounds - round;
  let label = fromEnd === 0 ? "Championship" : fromEnd === 1 ? "Semifinals" : fromEnd === 2 ? "Quarterfinals" : `Playoffs · Round ${round}`;
  if (fromEnd === 0 && settings.playoffs.championshipWeeks > 1) {
    const champStart = start + (rounds - 1) * per;
    const idx = week - champStart + 1;
    const total = per - 1 + settings.playoffs.championshipWeeks;
    if (total > 1) label = `Championship · Week ${Math.max(1, idx)} of ${total}`;
  } else if (per > 1) {
    label += ` · Week ${((week - start) % per) + 1} of ${per}`;
  }
  return { round, rounds, label, isChampionship: fromEnd === 0 };
}

/** Label for a stored matchup row (playoff round, championship, consolation, custom label). */
export function matchupRoundLabel(
  m: { isPlayoff: boolean; isChampionship: boolean; isConsolation: boolean; label: string | null; week: number },
  settings: LeagueSettings,
): string | null {
  if (m.label) return m.label;
  if (m.isChampionship) return "Championship";
  if (m.isConsolation) return "Consolation";
  if (m.isPlayoff) return playoffWeekInfo(m.week, settings)?.label ?? "Playoffs";
  if (settings.matchups.rivalryWeek && m.week === settings.matchups.rivalryWeek) return "Rivalry Week";
  return null;
}

export interface KeyDate {
  key: string;
  label: string;
  week: number;
  detail: string;
}

/** League key dates derived from settings (weeks; the page attaches calendar dates). */
export function leagueKeyDates(settings: LeagueSettings): KeyDate[] {
  const out: KeyDate[] = [];
  const regEnd = regularSeasonLastWeek(settings);
  if (settings.roster.taxiSlots > 0 && settings.roster.taxiDeadlineWeek) {
    out.push({ key: "taxi", label: "Taxi squad deadline", week: settings.roster.taxiDeadlineWeek, detail: "Last week to promote / stash taxi players" });
  }
  if (settings.matchups.rivalryWeek) out.push({ key: "rivalry", label: "Rivalry week", week: settings.matchups.rivalryWeek, detail: "Rivals meet head-to-head" });
  if (settings.niche.reverseScoringWeek) out.push({ key: "reverse", label: "Reverse scoring week", week: settings.niche.reverseScoringWeek, detail: "Lowest score wins" });
  if (settings.trades.enabled && settings.trades.deadlineWeek) {
    out.push({ key: "trade", label: "Trade deadline", week: settings.trades.deadlineWeek, detail: `No trades after week ${settings.trades.deadlineWeek}` });
  }
  out.push({ key: "regend", label: "Regular season ends", week: regEnd, detail: `${settings.general.regularSeasonWeeks}-week regular season` });
  const champEnd = championshipEndWeek(settings);
  out.push({
    key: "playoffs",
    label: "Playoffs begin",
    week: settings.playoffs.startWeek,
    detail: `${settings.playoffs.teams} teams${settings.playoffs.byes ? `, ${settings.playoffs.byes} byes` : ""}`,
  });
  const champStart = settings.playoffs.startWeek + (playoffRounds(settings) - 1) * Math.max(1, settings.playoffs.weeksPerRound);
  out.push({
    key: "championship",
    label: "Championship",
    week: Math.min(champStart, champEnd),
    detail: champEnd > champStart ? `Weeks ${champStart}–${champEnd}` : `Week ${champEnd}`,
  });
  return out.sort((a, b) => a.week - b.week || a.key.localeCompare(b.key));
}
