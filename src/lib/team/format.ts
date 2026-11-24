// Pure display helpers for team pages (client-safe): kickoff formatting, game state lines, bye weeks.

export interface GameLike {
  homeTeam: string;
  awayTeam: string;
  startTime: Date | string;
  state: string;
  statusDetail?: string | null;
  homeScore: number;
  awayScore: number;
  period?: number | null;
  clock?: string | null;
}

export interface GameLine {
  /** "@BUF" / "vs KC" / "BYE" */
  opp: string;
  oppTeam: string | null;
  /** "Sun 1:00 PM", "Q3 7:04", "Final" */
  status: string;
  /** "W 24-17" for finals, "14-10" live (team's score first) */
  score: string | null;
  result: "W" | "L" | "T" | null;
  state: "pre" | "in" | "post" | "bye";
}

export function formatKickoff(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  try {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
  }
}

export function formatDate(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Game summary from one NFL team's perspective. */
export function gameLine(game: GameLike | null | undefined, team: string | null | undefined, timeZone: string): GameLine {
  if (!game || !team) return { opp: "BYE", oppTeam: null, status: team ? "Bye week" : "Free agent", score: null, result: null, state: "bye" };
  const home = game.homeTeam === team;
  const oppTeam = home ? game.awayTeam : game.homeTeam;
  const opp = home ? `vs ${oppTeam}` : `@${oppTeam}`;
  const mine = home ? game.homeScore : game.awayScore;
  const theirs = home ? game.awayScore : game.homeScore;
  if (game.state === "post") {
    const result = mine > theirs ? "W" : mine < theirs ? "L" : "T";
    return { opp, oppTeam, status: "Final", score: `${result} ${mine}-${theirs}`, result, state: "post" };
  }
  if (game.state === "in") {
    const status = game.period && game.clock ? `${game.period > 4 ? "OT" : `Q${game.period}`} ${game.clock}` : game.statusDetail ?? "Live";
    return { opp, oppTeam, status, score: `${mine}-${theirs}`, result: null, state: "in" };
  }
  return { opp, oppTeam, status: formatKickoff(game.startTime, timeZone), score: null, result: null, state: "pre" };
}

/**
 * Bye week(s) per NFL team: weeks (inside the span of weeks that have games) where the team has no game.
 */
export function byeWeeksByTeam(games: { week: number; homeTeam: string; awayTeam: string }[]): Map<string, number[]> {
  const weeks = new Set<number>();
  const played = new Map<string, Set<number>>();
  for (const g of games) {
    weeks.add(g.week);
    for (const t of [g.homeTeam, g.awayTeam]) {
      if (!played.has(t)) played.set(t, new Set());
      played.get(t)!.add(g.week);
    }
  }
  const all = [...weeks].sort((a, b) => a - b);
  const out = new Map<string, number[]>();
  for (const [t, set] of played) out.set(t, all.filter((w) => !set.has(w)));
  return out;
}

/** "in 2h 15m" / "in 3d" until a date (null once passed) */
export function countdown(to: Date | string, now = new Date()): string | null {
  const ms = new Date(to).getTime() - now.getTime();
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

export function positionRank(pos: string): number {
  const i = POSITION_ORDER.indexOf(pos);
  return i === -1 ? 99 : i;
}
