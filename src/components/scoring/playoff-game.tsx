// One week of a multi-week playoff game (settings.playoffs.weeksPerRound / championshipWeeks): pure helpers and a
// small presentational line shared by the scoreboard, matchup page, schedule and league home. Every view of a single
// week names a result only once the whole game is decided (the bracket's result on the combined score) and shows the
// combined score so far otherwise. No hooks: usable from server and client components.
import type { PlayoffGameContext, PlayoffGamePart } from "@/lib/playoffs/bracket";
import { fmtScore } from "@/lib/live/format";
import { cn } from "@/lib/utils";

export type { PlayoffGameContext };

/** "Week 1 of 2" */
export function legLabel(g: Pick<PlayoffGameContext, "leg" | "legs">): string {
  return `Week ${g.leg} of ${g.legs}`;
}

const sum = (parts: PlayoffGamePart[], side: "home" | "away") => Math.round(parts.reduce((a, p) => a + p[side], 0) * 100) / 100;

/**
 * The context with one week's live score patched in (a score.update event for that week's row, in that row's
 * orientation, which is the context's own orientation for its own row). The game only turns FINAL on the server,
 * where the bracket settles it.
 */
export function patchGameWeek(g: PlayoffGameContext, rowId: string, home: number, away: number, status: string): PlayoffGameContext {
  if (!g.parts.some((p) => p.id === rowId)) return g;
  const parts = g.parts.map((p) => (p.id === rowId ? { ...p, home, away, status } : p));
  const i = g.leg - 1;
  return {
    ...g,
    parts,
    homeBefore: sum(parts.slice(0, i), "home"),
    awayBefore: sum(parts.slice(0, i), "away"),
    homeThrough: sum(parts.slice(0, i + 1), "home"),
    awayThrough: sum(parts.slice(0, i + 1), "away"),
    homeTotal: sum(parts, "home"),
    awayTotal: sum(parts, "away"),
    status: g.status === "FINAL" ? "FINAL" : parts.some((p) => p.status !== "UPCOMING") ? "LIVE" : "UPCOMING",
  };
}

/**
 * Games among week rows, counting a multi-week playoff game once (by its first week): how many there are and how many
 * are fully played (a multi-week game: every week final).
 */
export function countGames(rows: readonly { id: string; status: string; game?: Pick<PlayoffGameContext, "parts" | "status"> | null }[]): { total: number; played: number } {
  let total = 0;
  let played = 0;
  for (const r of rows) {
    if (r.game && r.game.parts[0]?.id !== r.id) continue;
    total++;
    if (r.game ? r.game.status === "FINAL" : r.status === "FINAL") played++;
  }
  return { total, played };
}

/** The game's result for one team: W / L once the game is decided, otherwise null. */
export function gameResultFor(g: Pick<PlayoffGameContext, "status" | "winnerTeamId">, teamId: string | null | undefined): "W" | "L" | null {
  if (g.status !== "FINAL" || !g.winnerTeamId || !teamId) return null;
  return g.winnerTeamId === teamId ? "W" : "L";
}

export interface GameSides {
  homeId: string | null;
  homeName: string;
  awayName: string;
}

/**
 * Where the whole game stands, for one week's view: "Ravens win 245.30–230.10 over 2 weeks", "Ravens lead 230.10–190.20
 * · Week 2 of 2 live", "Ravens lead 140.20–100.10 after Week 1 of 2", "Tied 120.00–120.00 after Week 1 of 2" or, before
 * kickoff, "2-week game: Weeks 15–16 combined".
 */
export function gameStateText(g: PlayoffGameContext, sides: GameSides, decimals = 2): string {
  const f = (n: number) => fmtScore(n, decimals);
  if (g.status === "FINAL" && g.winnerTeamId) {
    const homeWon = g.winnerTeamId === sides.homeId;
    const [w, ws, ls] = homeWon ? [sides.homeName, g.homeTotal, g.awayTotal] : [sides.awayName, g.awayTotal, g.homeTotal];
    return ws === ls ? `${w} wins on the tiebreaker after a ${f(ws)}–${f(ls)} tie over ${g.legs} weeks` : `${w} wins ${f(ws)}–${f(ls)} over ${g.legs} weeks`;
  }
  const live = g.parts.findIndex((p) => p.status === "LIVE");
  const lastFinal = g.parts.map((p) => p.status).lastIndexOf("FINAL");
  if (live === -1 && lastFinal === -1) return `${g.legs}-week game: Weeks ${g.weeks[0]}–${g.weeks[g.weeks.length - 1]} combined`;
  const h = g.homeTotal;
  const a = g.awayTotal;
  const lead = h > a ? `${sides.homeName} leads ${f(h)}–${f(a)}` : a > h ? `${sides.awayName} leads ${f(a)}–${f(h)}` : `Tied ${f(h)}–${f(a)}`;
  return live !== -1 ? `${lead} · Week ${live + 1} of ${g.legs} live` : `${lead} after Week ${lastFinal + 1} of ${g.legs}`;
}

/** Compact one-liner for small tiles: "Wk 1 of 2 · CP leads 140.2–100.1", "CP wins 245.3–230.1 (2 wks)", "CP wins 240.0–240.0 (2 wks, tiebreaker)". */
export function gameStateShort(g: PlayoffGameContext, sides: { homeId: string | null; home: string; away: string }, decimals = 1): string {
  const f = (n: number) => fmtScore(n, decimals);
  if (g.status === "FINAL" && g.winnerTeamId) {
    const homeWon = g.winnerTeamId === sides.homeId;
    const [w, ws, ls] = homeWon ? [sides.home, g.homeTotal, g.awayTotal] : [sides.away, g.awayTotal, g.homeTotal];
    return `${w} wins ${f(ws)}–${f(ls)} (${g.legs} wks${ws === ls ? ", tiebreaker" : ""})`;
  }
  const started = g.parts.some((p) => p.status !== "UPCOMING");
  if (!started) return `Wk ${g.leg} of ${g.legs} · combined score`;
  const h = g.homeTotal;
  const a = g.awayTotal;
  const lead = h > a ? `${sides.home} leads ${f(h)}–${f(a)}` : a > h ? `${sides.away} leads ${f(a)}–${f(h)}` : `Tied ${f(h)}–${f(a)}`;
  return `Wk ${g.leg} of ${g.legs} · ${lead}`;
}

/** The combined-score line under one week's score of a multi-week playoff game. */
export function PlayoffGameLine({ game, sides, decimals = 2, className }: { game: PlayoffGameContext; sides: GameSides; decimals?: number; className?: string }) {
  const decided = game.status === "FINAL" && !!game.winnerTeamId;
  return (
    <p className={cn("flex min-w-0 items-baseline gap-1.5 text-[11px] leading-snug", className)}>
      <span className={cn("shrink-0 rounded px-1 py-px text-[9px] font-extrabold uppercase tracking-wider", decided ? "bg-gold-300/40 text-gold-700 dark:text-gold-300" : "bg-sunken text-muted")}>
        {decided ? `${game.legs}-wk total` : legLabel(game)}
      </span>
      <span className={cn("min-w-0", decided ? "font-semibold text-ink" : "text-muted")}>{gameStateText(game, sides, decimals)}</span>
    </p>
  );
}
