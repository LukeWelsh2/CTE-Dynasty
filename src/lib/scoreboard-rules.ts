// Pure matchup-scoring rules used by @/lib/scoreboard (no DB access, unit tested in tests/scoring.test.ts):
// winner / tiebreak resolution, forfeits, reverse-scoring weeks and inactive-starter auto-subs.
import type { LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";

export type TieBreak = "BENCH_POINTS" | "HIGHEST_STARTER" | "HOME_TEAM";

export interface SideResult {
  teamId: string;
  points: number;
  benchPoints: number;
  /** best single starter score (HIGHEST_STARTER tiebreak) */
  topStarter: number;
  /** true when the team started fewer than niche.minimumStartersOrForfeit players who played */
  forfeit?: boolean;
}

/**
 * Ordered tiebreak chain for a matchup:
 * matchups.tiebreaker first, then bench points when lineup.benchPointsTiebreaker is on, and — when the
 * league doesn't allow ties, or it's a playoff game that must produce a winner — bench points,
 * highest starter and finally the home team.
 */
export function tiebreakChain(settings: Pick<LeagueSettings, "matchups" | "lineup">, opts: { mustHaveWinner?: boolean } = {}): TieBreak[] {
  const chain: TieBreak[] = [];
  const add = (t: TieBreak) => {
    if (!chain.includes(t)) chain.push(t);
  };
  const tb = settings.matchups.tiebreaker;
  if (tb && tb !== "NONE") add(tb);
  if (settings.lineup.benchPointsTiebreaker) add("BENCH_POINTS");
  if (opts.mustHaveWinner || !settings.matchups.allowTies) {
    add("BENCH_POINTS");
    add("HIGHEST_STARTER");
    add("HOME_TEAM");
  }
  return chain;
}

/**
 * Winner of a final matchup (null = tie). `reverse` = niche.reverseScoringWeek (lowest score wins).
 * A forfeiting team loses to a non-forfeiting one regardless of score.
 */
export function decideWinner(
  home: SideResult,
  away: SideResult,
  settings: Pick<LeagueSettings, "matchups" | "lineup">,
  opts: { reverse?: boolean; mustHaveWinner?: boolean } = {},
): string | null {
  if (home.forfeit && !away.forfeit) return away.teamId;
  if (away.forfeit && !home.forfeit) return home.teamId;
  const sign = opts.reverse ? -1 : 1;
  const diff = sign * (round2(home.points) - round2(away.points));
  if (diff > 0) return home.teamId;
  if (diff < 0) return away.teamId;
  for (const t of tiebreakChain(settings, opts)) {
    if (t === "HOME_TEAM") return home.teamId;
    const [h, a] = t === "BENCH_POINTS" ? [home.benchPoints, away.benchPoints] : [home.topStarter, away.topStarter];
    if (round2(h) > round2(a)) return home.teamId;
    if (round2(a) > round2(h)) return away.teamId;
  }
  return null;
}

const OUT_STATUSES = new Set(["out", "ir", "pup", "sus", "na", "cov", "dnr"]);

/** Injury designation that means the player won't play (Out / IR / PUP / suspended …). */
export function isRuledOut(injuryStatus: string | null | undefined): boolean {
  return OUT_STATUSES.has((injuryStatus ?? "").trim().toLowerCase());
}

export interface SubCandidate {
  playerId: string;
  position: string;
  injuryStatus: string | null;
  /** NFL game state for the week; "bye" when the player's team doesn't play */
  gameState: "pre" | "in" | "post" | "bye";
  kickoff: Date | null;
  /** player recorded a stat line this week */
  hasStats: boolean;
  /** value used to pick the best replacement (actual points once played, projection before) */
  value: number;
}

/**
 * Did a starter sit out? True once the game is over with no stat line, or when he's ruled out and hasn't
 * recorded anything (so a stale "Out" tag never removes a player who actually played).
 */
export function didNotPlay(c: Pick<SubCandidate, "gameState" | "hasStats" | "injuryStatus">): boolean {
  if (c.gameState === "bye" || c.hasStats) return false;
  return c.gameState === "post" || isRuledOut(c.injuryStatus);
}

/**
 * lineup.autoSubOutPlayers: replace inactive starters with the best eligible bench player.
 * Returns slot index (into `starters`) -> bench playerId. Honors autoSubsMaxPerWeek (0 = unlimited) and
 * autoSubRequireLaterKickoff (the replacement's game must start after the starter's).
 */
export function planAutoSubs(
  starters: { eligible: string[]; player: SubCandidate | null }[],
  bench: SubCandidate[],
  settings: Pick<LeagueSettings, "lineup">,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!settings.lineup.autoSubOutPlayers) return out;
  const max = settings.lineup.autoSubsMaxPerWeek > 0 ? settings.lineup.autoSubsMaxPerWeek : Infinity;
  const used = new Set<string>();
  starters.forEach((s, i) => {
    if (out.size >= max || !s.player || !didNotPlay(s.player)) return;
    const starterKick = s.player.kickoff?.getTime() ?? null;
    let best: SubCandidate | null = null;
    for (const b of bench) {
      if (used.has(b.playerId) || b.gameState === "bye" || didNotPlay(b)) continue;
      if (!s.eligible.includes(normalizePosition(b.position))) continue;
      if (settings.lineup.autoSubRequireLaterKickoff && starterKick !== null && (b.kickoff?.getTime() ?? 0) <= starterKick) continue;
      if (!best || b.value > best.value) best = b;
    }
    if (best) {
      out.set(i, best.playerId);
      used.add(best.playerId);
    }
  });
  return out;
}

/** niche.minimumStartersOrForfeit: number of starters who played (or still can) this week. */
export function playingStarters(starters: (Pick<SubCandidate, "gameState" | "hasStats" | "injuryStatus"> | null)[]): number {
  return starters.filter((s) => s && s.gameState !== "bye" && !didNotPlay(s)).length;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
