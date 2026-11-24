// Real playoff bracket: creates playoff Matchup rows when the regular season ends, advances rounds as
// games go FINAL, and archives the season (TeamSeason rows, League.phase = OFFSEASON) after the final.
// Idempotent and safe to call from the daily job and the commissioner's "Recompute" button at once
// (a Postgres advisory lock serialises concurrent runs).
import type { Matchup, Prisma, Team } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { standingsFromMatchups, type StandingRow } from "@/lib/standings";
import { leagueSeeds } from "./seeding";
import { notify, leagueUserIds } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import { teamWeekScore, winProbability } from "@/lib/scoreboard";
import { hashString } from "@/lib/sim/rng";
import {
  advKey,
  bracketKindOf,
  bracketPlan,
  bracketWinner,
  finalPlacement,
  applyLastPlaceRule,
  localSlot,
  placementLabel,
  placementOrder,
  placementPairings,
  placementShape,
  playoffSchedule,
  resolvePlayoffTie,
  roundLabel,
  roundPairings,
  sideBrackets,
  SLOT_BASE,
  type BracketKind,
  type BracketPlan,
  type Pairing,
  type PlacementGame,
  type PlacementShape,
  type PlayoffTiebreaker,
} from "./structure";

export interface BracketEntry {
  teamId: string;
  /** seed inside this bracket (1 = top seed; in the toilet bowl 1 = worst team) */
  seed: number;
  /** number shown next to the team: playoff seed, or regular-season rank for side brackets */
  displaySeed: number;
}

export interface StoredSide {
  kind: "CONSOLATION" | "TOILET";
  /** championship-bracket rounds played before this bracket starts */
  offset: number;
  entries: BracketEntry[];
}

export interface StoredBracket {
  version: 1;
  season: number;
  createdAt: string;
  winners: BracketEntry[];
  sides: StoredSide[];
  thirdPlace: boolean;
  reseed: boolean;
  /** settings.playoffs.placementGames at creation (5th / 7th place games) */
  placementGames?: PlacementGame[];
  /** seeds were set by the commissioner (settings.playoffs.manualSeedingAllowed) */
  manual?: boolean;
}

export const bracketKey = (leagueId: string, season: number) => `playoff-bracket:${leagueId}:${season}`;
/** Commissioner's manual seed order (team ids by seed), applied when the bracket is (re)built. */
export const manualSeedsKey = (leagueId: string, season: number) => `playoff-seeds-manual:${leagueId}:${season}`;

export interface ManualSeeds {
  teamIds: string[];
  setBy: string | null;
  at: string;
}

export async function loadManualSeeds(leagueId: string, season: number, client: Tx | typeof db = db): Promise<ManualSeeds | null> {
  const row = await client.keyValue.findUnique({ where: { key: manualSeedsKey(leagueId, season) } });
  const v = row?.value as unknown as ManualSeeds | undefined;
  return v && Array.isArray(v.teamIds) ? v : null;
}

/** A manual seed list is usable when it names exactly the bracket's team count of distinct league teams. */
export function validManualSeeds(manual: readonly string[] | null | undefined, teamIds: readonly string[], playoffTeams: number): boolean {
  if (!manual) return false;
  const n = Math.min(playoffTeams, teamIds.length);
  const known = new Set(teamIds);
  return manual.length === n && new Set(manual).size === n && manual.every((id) => known.has(id));
}

type Tx = Prisma.TransactionClient;

export async function loadStoredBracket(leagueId: string, season: number, client: Tx | typeof db = db): Promise<StoredBracket | null> {
  const row = await client.keyValue.findUnique({ where: { key: bracketKey(leagueId, season) } });
  const v = row?.value as unknown as StoredBracket | undefined;
  return v && v.version === 1 && v.season === season ? v : null;
}

/** Seeds for every bracket from final regular-season standings (or the commissioner's manual seed order). */
export function buildBracketSeeds(standings: StandingRow[], settings: LeagueSettings, season: number, manual?: readonly string[] | null): StoredBracket {
  const byId = new Map(standings.map((r) => [r.team.id, r]));
  const useManual = !!settings.playoffs.manualSeedingAllowed && validManualSeeds(manual, standings.map((r) => r.team.id), settings.playoffs.teams);
  const seeds = useManual ? manual!.map((id) => byId.get(id)!) : leagueSeeds(standings, settings);
  const winners: BracketEntry[] = seeds.map((r, i) => ({ teamId: r.team.id, seed: i + 1, displaySeed: i + 1 }));
  const inPlayoffs = new Set(winners.map((w) => w.teamId));
  const nonPlayoff = standings.filter((r) => !inPlayoffs.has(r.team.id));
  const rankOf = new Map(standings.map((r) => [r.team.id, r.rank]));
  const wPlan = bracketPlan(winners.length);
  const mainRounds = wPlan.rounds;
  const sides: StoredSide[] = sideBrackets(
    nonPlayoff.map((r) => r.team.id),
    mainRounds,
    { consolation: settings.playoffs.consolationBracket, toilet: settings.playoffs.toiletBowl },
  ).map((sb) => ({
    kind: sb.kind,
    offset: sb.offset,
    entries: sb.teamIds.map((id, i) => ({ teamId: id, seed: i + 1, displaySeed: rankOf.get(id) ?? i + 1 })),
  }));
  const placementGames = placementShape(wPlan, settings.playoffs.placementGames) ? [...(settings.playoffs.placementGames ?? [])] : [];
  return {
    version: 1,
    season,
    createdAt: new Date().toISOString(),
    winners,
    sides,
    thirdPlace: settings.playoffs.thirdPlaceGame && mainRounds >= 2,
    reseed: settings.playoffs.reseed,
    placementGames,
    manual: useManual,
  };
}

/** Placement-game shape for a stored bracket (null when the league plays none). */
export function placementShapeFor(stored: StoredBracket | null): PlacementShape | null {
  if (!stored) return null;
  return placementShape(bracketPlan(stored.winners.length), stored.placementGames ?? []);
}

/**
 * Placement pool (local seed 1 = best playoff seed): the teams knocked out in the round before the semifinals,
 * known once every game of that round is decided.
 */
export function placementEntries(stored: StoredBracket, shape: PlacementShape | null, wGames: BracketGame[]): BracketEntry[] | null {
  if (!shape) return null;
  const plan = bracketPlan(stored.winners.length);
  const round = plan.rounds - 2;
  const games = wGames.filter((g) => g.round === round);
  if (games.length < shape.size || games.some((g) => !g.loserTeamId)) return null;
  const seedOf = new Map(stored.winners.map((e) => [e.teamId, e.seed]));
  const losers = games.map((g) => g.loserTeamId!).sort((a, b) => (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99));
  return losers.map((id, i) => ({ teamId: id, seed: i + 1, displaySeed: seedOf.get(id) ?? i + 1 }));
}

// ───────── Reading games out of Matchup rows ─────────

export interface BracketGame {
  kind: BracketKind;
  /** round inside its own bracket (1-based) */
  round: number;
  /** championship-bracket round it is played alongside (Matchup.bracketRound) */
  globalRound: number;
  slot: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSeed: number | null;
  awaySeed: number | null;
  homeScore: number;
  awayScore: number;
  homeProjected: number;
  awayProjected: number;
  homeWinProb: number;
  weeks: number[];
  status: "UPCOMING" | "LIVE" | "FINAL";
  winnerTeamId: string | null;
  loserTeamId: string | null;
  label: string | null;
  rows: Matchup[];
}

export function offsetFor(kind: BracketKind, stored: StoredBracket | null, mainRounds: number): number {
  if (kind === "WINNERS") return 0;
  if (kind === "THIRD") return mainRounds - 1;
  if (kind === "PLACEMENT") return placementShapeFor(stored)?.offset ?? Math.max(0, mainRounds - 2);
  return stored?.sides.find((s) => s.kind === kind)?.offset ?? 0;
}

export const gameKey = (kind: BracketKind, globalRound: number, slot: number) => `${kind}|${globalRound}|${slot}`;

/**
 * Group playoff Matchup rows (one per week) into bracket games with aggregate scores.
 * `ties` holds winners of tied games resolved with the playoff tiebreakers (gameKey → team id).
 */
export function bracketGames(rows: Matchup[], stored: StoredBracket | null, mainRounds: number, ties?: ReadonlyMap<string, string>): BracketGame[] {
  const groups = new Map<string, Matchup[]>();
  for (const m of rows) {
    const kind = bracketKindOf(m);
    if (!kind || m.bracketRound == null) continue;
    const k = gameKey(kind, m.bracketRound, localSlot(kind, m.bracketSlot));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  const out: BracketGame[] = [];
  for (const [k, legs] of groups) {
    legs.sort((a, b) => a.week - b.week);
    const [kindStr, gr, sl] = k.split("|");
    const kind = kindStr as BracketKind;
    const first = legs[0]!;
    const home = first.homeTeamId;
    const away = first.awayTeamId;
    let hs = 0;
    let as = 0;
    let hp = 0;
    let ap = 0;
    for (const r of legs) {
      const flip = r.homeTeamId !== home;
      hs += flip ? r.awayScore : r.homeScore;
      as += flip ? r.homeScore : r.awayScore;
      const done = r.status === "FINAL";
      hp += done ? (flip ? r.awayScore : r.homeScore) : flip ? r.awayProjected : r.homeProjected;
      ap += done ? (flip ? r.homeScore : r.awayScore) : flip ? r.homeProjected : r.awayProjected;
    }
    const complete = legs.every((r) => r.status === "FINAL");
    const status: BracketGame["status"] = complete ? "FINAL" : legs.some((r) => r.status !== "UPCOMING") ? "LIVE" : "UPCOMING";
    let winner: string | null = null;
    if (complete && home && away) {
      hs = Math.round(hs * 100) / 100;
      as = Math.round(as * 100) / 100;
      if (hs > as) winner = home;
      else if (as > hs) winner = away;
      else if (ties?.get(k)) winner = ties.get(k)!;
      // a tie the scoreboard already settled with the playoff tiebreakers: every week's row carries the game's winner
      else if (first.winnerTeamId && legs.every((r) => r.winnerTeamId === first.winnerTeamId)) winner = first.winnerTeamId;
      else winner = (first.homeSeed ?? 99) <= (first.awaySeed ?? 99) ? home : away; // tie → higher seed
    }
    const live = legs.find((r) => r.status === "LIVE") ?? legs.find((r) => r.status === "UPCOMING");
    const globalRound = Number(gr);
    out.push({
      kind,
      round: globalRound - offsetFor(kind, stored, mainRounds),
      globalRound,
      slot: Number(sl),
      homeTeamId: home,
      awayTeamId: away,
      homeSeed: first.homeSeed,
      awaySeed: first.awaySeed,
      homeScore: Math.round(hs * 100) / 100,
      awayScore: Math.round(as * 100) / 100,
      homeProjected: Math.round(hp * 100) / 100,
      awayProjected: Math.round(ap * 100) / 100,
      homeWinProb: live ? (live.homeTeamId === home ? live.homeWinProb : 1 - live.homeWinProb) : winner === home ? 1 : 0,
      weeks: legs.map((r) => r.week),
      status,
      winnerTeamId: winner,
      loserTeamId: winner ? (winner === home ? away : home) : null,
      label: first.label ? first.label.replace(/ \(Wk \d+ of \d+\)$/, "") : null,
      rows: legs,
    });
  }
  return out.sort((a, b) => SLOT_BASE[a.kind] - SLOT_BASE[b.kind] || a.globalRound - b.globalRound || a.slot - b.slot);
}

// ───────── One week of a multi-week game ─────────

/** One week of a multi-week playoff game, oriented to the row the context belongs to. */
export interface PlayoffGamePart {
  id: string;
  week: number;
  status: string;
  home: number;
  away: number;
}

/**
 * Where one week's Matchup row sits in its multi-week playoff game (settings.playoffs.weeksPerRound /
 * championshipWeeks) and the game's combined score, oriented to that row's home / away team. Views of a single
 * week use it to show the combined game score and "Week 1 of 2" context, and to name a winner only once the game
 * is decided (the bracket's result: the combined score, ties by the playoff tiebreakers).
 */
export interface PlayoffGameContext {
  /** this row's week within the game (1-based) */
  leg: number;
  /** number of weeks the game spans */
  legs: number;
  weeks: number[];
  /** every week of the game in order (this row's week included) */
  parts: PlayoffGamePart[];
  /** combined score of the game's weeks before this row's week */
  homeBefore: number;
  awayBefore: number;
  /** combined score through this row's week */
  homeThrough: number;
  awayThrough: number;
  /** combined score of every week so far (later weeks too: their live score, 0 before kickoff) */
  homeTotal: number;
  awayTotal: number;
  /** the whole game: FINAL once every week is final */
  status: "UPCOMING" | "LIVE" | "FINAL";
  /** the game's winner once every week is final */
  winnerTeamId: string | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Contexts (row id → context) for the rows of every multi-week playoff game among `rows` (single-week games and
 * regular season rows get none). Pass every playoff row of the season — a game's other weeks are needed to sum it.
 */
export function playoffGameContexts(rows: Matchup[], ties?: ReadonlyMap<string, string>): Map<string, PlayoffGameContext> {
  const out = new Map<string, PlayoffGameContext>();
  for (const g of bracketGames(rows.filter((r) => r.isPlayoff), null, 0, ties)) {
    if (g.rows.length < 2) continue;
    g.rows.forEach((row, i) => {
      const flip = row.homeTeamId !== g.homeTeamId;
      const parts: PlayoffGamePart[] = g.rows.map((r) => {
        // each week oriented to `row`'s home team (a week whose home team differs is turned around)
        const same = r.homeTeamId === row.homeTeamId;
        return { id: r.id, week: r.week, status: r.status, home: same ? r.homeScore : r.awayScore, away: same ? r.awayScore : r.homeScore };
      });
      const sum = (list: PlayoffGamePart[], side: "home" | "away") => cents(list.reduce((a, p) => a + p[side], 0));
      out.set(row.id, {
        leg: i + 1,
        legs: g.rows.length,
        weeks: g.weeks,
        parts,
        homeBefore: sum(parts.slice(0, i), "home"),
        awayBefore: sum(parts.slice(0, i), "away"),
        homeThrough: sum(parts.slice(0, i + 1), "home"),
        awayThrough: sum(parts.slice(0, i + 1), "away"),
        homeTotal: flip ? g.awayScore : g.homeScore,
        awayTotal: flip ? g.homeScore : g.awayScore,
        status: g.status,
        winnerTeamId: g.winnerTeamId,
      });
    });
  }
  return out;
}

/** The weeks of a game still to be decided, as live projections: `variance` is both teams' remaining variance. */
export interface PlayoffLegOutlook {
  homeProjected: number;
  awayProjected: number;
  variance: number;
}

/**
 * Home win probability for a whole multi-week game: the final weeks' combined score plus the live projection of
 * every week not final yet (normal approximation, like winProbability for one week). A decided game is 1 / 0.
 */
export function playoffGameWinProb(ctx: Pick<PlayoffGameContext, "parts" | "status" | "winnerTeamId">, homeTeamId: string | null, open: readonly PlayoffLegOutlook[]): number {
  if (ctx.status === "FINAL") return ctx.winnerTeamId ? (ctx.winnerTeamId === homeTeamId ? 1 : 0) : 0.5;
  const settled = ctx.parts.filter((p) => p.status === "FINAL");
  const diff = settled.reduce((a, p) => a + p.home - p.away, 0) + open.reduce((a, o) => a + o.homeProjected - o.awayProjected, 0);
  const variance = open.reduce((a, o) => a + o.variance, 0);
  return winProbability({ liveProjected: diff, variance }, { liveProjected: 0, variance: 0 });
}

/** "round:slot" → local seed that advanced (winner, or loser in the toilet bowl). */
export function advancersFor(games: BracketGame[], entries: BracketEntry[], loserAdvances: boolean): Map<string, number> {
  const seedOf = new Map(entries.map((e) => [e.teamId, e.seed]));
  const out = new Map<string, number>();
  for (const g of games) {
    const id = loserAdvances ? g.loserTeamId : g.winnerTeamId;
    if (!id) continue;
    const s = seedOf.get(id);
    if (s !== undefined) out.set(advKey(g.round, g.slot), s);
  }
  return out;
}

// ───────── Advancement ─────────

interface Effects {
  notifications: { title: string; body: string }[];
  chat: string[];
  refresh: boolean;
  week: number;
}

function teamName(teams: Map<string, Team>, id: string | null | undefined) {
  return (id && teams.get(id)?.name) || "TBD";
}

export interface AdvanceOptions {
  /** the commissioner just re-seeded the bracket (changes the announcement) */
  reseeded?: boolean;
}

const PLAYOFF_LOCK = (leagueId: string) => `playoffs:${leagueId}`;

export async function advancePlayoffs(leagueId: string, opts: AdvanceOptions = {}): Promise<string> {
  const effects: Effects = { notifications: [], chat: [], refresh: false, week: 0 };
  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${PLAYOFF_LOCK(leagueId)}))) AS l`;
      const league = await tx.league.findUnique({ where: { id: leagueId } });
      if (!league) return "league not found";
      if (league.phase !== "REGULAR" && league.phase !== "PLAYOFFS") return `phase ${league.phase}: nothing to do`;
      const settings = resolveSettings(league.settings);
      const season = league.season;
      const [teamsList, regular, playoffRows] = await Promise.all([
        tx.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } }),
        tx.matchup.findMany({ where: { leagueId, season, isPlayoff: false }, orderBy: { week: "asc" } }),
        tx.matchup.findMany({ where: { leagueId, season, isPlayoff: true }, orderBy: { week: "asc" } }),
      ]);
      if (!regular.length) return "no regular-season schedule";
      const open = regular.filter((m) => m.status !== "FINAL").length;
      if (open > 0) return `regular season in progress (${open} games left)`;
      const teams = new Map(teamsList.map((t) => [t.id, t]));
      const standings = standingsFromMatchups(teamsList, regular, settings);
      const sched = playoffSchedule(settings, teamsList.length);

      let stored = await loadStoredBracket(leagueId, season, tx);
      const starting = playoffRows.length === 0;
      if (!stored || starting) {
        const manual = settings.playoffs.manualSeedingAllowed ? await loadManualSeeds(leagueId, season, tx) : null;
        stored = buildBracketSeeds(standings, settings, season, manual?.teamIds);
        const value = stored as unknown as Prisma.InputJsonValue;
        await tx.keyValue.upsert({ where: { key: bracketKey(leagueId, season) }, create: { key: bracketKey(leagueId, season), value }, update: { value } });
      }

      const wPlan = bracketPlan(stored.winners.length);
      const ties = await resolveTies(bracketGames(playoffRows, stored, wPlan.rounds), leagueId, season, settings);
      const games = bracketGames(playoffRows, stored, wPlan.rounds, ties);
      const toCreate: Prisma.MatchupCreateManyInput[] = [];
      const has = new Set(games.map((g) => `${g.kind}|${g.round}|${g.slot}`));

      const queue = (
        kind: BracketKind,
        plan: BracketPlan,
        entries: BracketEntry[],
        offset: number,
        round: number,
        pairs: Pairing[],
        labelFor: (round: number, slot: number) => string = (r) => (kind === "THIRD" ? roundLabel("THIRD", 1, 1) : roundLabel(kind, r, plan.rounds)),
      ) => {
        const bySeed = new Map(entries.map((e) => [e.seed, e]));
        const globalRound = offset + round;
        const weeks = sched.roundWeeks[globalRound - 1] ?? [];
        for (const p of pairs) {
          if (p.home === null || p.away === null) continue;
          if (has.has(`${kind}|${round}|${p.slot}`)) continue;
          const h = bySeed.get(p.home);
          const a = bySeed.get(p.away);
          if (!h || !a) continue;
          has.add(`${kind}|${round}|${p.slot}`);
          const label = labelFor(round, p.slot);
          weeks.forEach((week, i) =>
            toCreate.push({
              leagueId,
              season,
              week,
              homeTeamId: h.teamId,
              awayTeamId: a.teamId,
              isPlayoff: true,
              isConsolation: kind !== "WINNERS",
              isChampionship: kind === "WINNERS" && round === plan.rounds,
              bracketRound: globalRound,
              bracketSlot: SLOT_BASE[kind] + p.slot,
              homeSeed: h.displaySeed,
              awaySeed: a.displaySeed,
              label: weeks.length > 1 ? `${label} (Wk ${i + 1} of ${weeks.length})` : label,
              status: "UPCOMING",
            }),
          );
        }
      };

      // championship bracket
      const wGames = games.filter((g) => g.kind === "WINNERS");
      const wAdv = advancersFor(wGames, stored.winners, false);
      for (let r = 1; r <= wPlan.rounds; r++) {
        const pairs = roundPairings(wPlan, r, stored.reseed, wAdv);
        if (!pairs) break;
        queue("WINNERS", wPlan, stored.winners, 0, r, pairs);
      }
      // 3rd place game: semifinal losers
      let thirdDone = !stored.thirdPlace;
      if (stored.thirdPlace && wPlan.rounds >= 2) {
        const semis = roundPairings(wPlan, wPlan.rounds - 1, stored.reseed, wAdv);
        const real = semis?.filter((p) => p.home !== null && p.away !== null) ?? [];
        const decided = real.length === 2 && real.every((p) => wAdv.has(advKey(wPlan.rounds - 1, p.slot)));
        if (decided) {
          const losers = real.map((p) => (wAdv.get(advKey(wPlan.rounds - 1, p.slot)) === p.home ? p.away! : p.home!)).sort((a, b) => a - b);
          queue("THIRD", { ...wPlan, rounds: 1 }, stored.winners, wPlan.rounds - 1, 1, [{ slot: 1, home: losers[0]!, away: losers[1]! }]);
        } else if (real.length < 2) thirdDone = true; // no 3rd place game possible (3-team bracket)
        const third = games.find((g) => g.kind === "THIRD");
        if (third?.winnerTeamId) thirdDone = true;
      }
      // placement games (5th / 7th place) among teams knocked out before the semifinals
      const pShape = placementShapeFor(stored);
      const pEntries = placementEntries(stored, pShape, wGames);
      let placementDone = !pShape;
      let placementTeams: string[] | null = null;
      if (pShape && pEntries) {
        const pGames = games.filter((g) => g.kind === "PLACEMENT");
        const pAdv = advancersFor(pGames, pEntries, false);
        for (let r = 1; r <= pShape.rounds; r++) {
          const pairs = placementPairings(pShape, r, pAdv);
          if (!pairs) break;
          queue("PLACEMENT", { ...wPlan, rounds: pShape.rounds }, pEntries, pShape.offset, r, pairs, (rr, slot) => placementLabel(pShape, rr, slot));
        }
        const order = placementOrder(pShape, pAdv);
        placementDone = order !== null;
        placementTeams = order ? order.map((seed) => pEntries[seed - 1]!.teamId) : null;
      }
      // side brackets
      const sideResults: { side: StoredSide; plan: BracketPlan; adv: Map<string, number>; games: BracketGame[] }[] = [];
      for (const side of stored.sides) {
        const plan = bracketPlan(side.entries.length);
        const sGames = games.filter((g) => g.kind === side.kind);
        const adv = advancersFor(sGames, side.entries, side.kind === "TOILET");
        for (let r = 1; r <= plan.rounds; r++) {
          const pairs = roundPairings(plan, r, stored.reseed, adv);
          if (!pairs) break;
          queue(side.kind, plan, side.entries, side.offset, r, pairs);
        }
        sideResults.push({ side, plan, adv, games: sGames });
      }

      const notes: string[] = [];
      if (toCreate.length) {
        await tx.matchup.createMany({ data: toCreate });
        effects.refresh = true;
        effects.week = Math.min(...toCreate.map((r) => r.week));
        notes.push(`created ${toCreate.length} playoff matchup rows`);
      }
      if (starting && wPlan.rounds > 0) {
        if (league.phase !== "PLAYOFFS") await tx.league.update({ where: { id: leagueId }, data: { phase: "PLAYOFFS" } });
        const seedsText = stored.winners.map((e) => `${e.seed}. ${teamName(teams, e.teamId)}`).join(", ");
        const byeCount = wPlan.byes;
        const byeText = byeCount ? ` Top ${byeCount === 1 ? "seed gets a bye" : `${byeCount} seeds get first-round byes`}.` : "";
        if (opts.reseeded) {
          effects.notifications.push({ title: `Playoff seeds updated`, body: `The commissioner set the ${season} playoff seeds: ${seedsText}.${byeText}` });
          effects.chat.push(`The commissioner updated the ${season} playoff seeds: ${seedsText}.`);
          notes.push("playoffs re-seeded");
        } else {
          effects.notifications.push({ title: `The ${season} playoff bracket is set`, body: `${seedsText}.${byeText}` });
          effects.chat.push(`The ${season} playoffs are set: ${seedsText}.`);
          notes.push("playoffs started");
        }
      } else if (toCreate.length) {
        const newRound = toCreate.filter((r) => !r.isConsolation);
        if (newRound.length) {
          const label = String(newRound[0]!.label ?? "Next round").replace(/ \(Wk \d+ of \d+\)$/, "");
          const pairs = [...new Map(newRound.map((r) => [`${r.homeTeamId}|${r.awayTeamId}`, r])).values()]
            .map((r) => `(${r.homeSeed}) ${teamName(teams, r.homeTeamId)} vs (${r.awaySeed}) ${teamName(teams, r.awayTeamId)}`)
            .join(" · ");
          effects.chat.push(`${label} matchups are set: ${pairs}.`);
        }
      }

      // finished?
      const champSeed = bracketWinner(wPlan, stored.reseed, wAdv);
      const sidesDone = sideResults.every((s) => bracketWinner(s.plan, stored!.reseed, s.adv) !== null);
      const allFinal = playoffRows.every((m) => m.status === "FINAL");
      if (wPlan.rounds > 0 && champSeed !== null && thirdDone && placementDone && sidesDone && allFinal && !toCreate.length) {
        await finalizeSeason(tx, { leagueId, season, teamsList, standings, stored, wPlan, wGames, games, sideResults, champSeed, placement: placementTeams, settings });
        const champ = stored.winners.find((e) => e.seed === champSeed)!;
        const final = wGames.find((g) => g.round === wPlan.rounds);
        const runnerUpId = final ? (final.winnerTeamId === final.homeTeamId ? final.awayTeamId : final.homeTeamId) : null;
        const score = final ? `${Math.max(final.homeScore, final.awayScore).toFixed(2)}–${Math.min(final.homeScore, final.awayScore).toFixed(2)}` : "";
        const trophy = settings.general.championTrophyName?.trim();
        effects.notifications.push({
          title: `${teamName(teams, champ.teamId)} win the ${season} championship`,
          body: `${teamName(teams, champ.teamId)} beat ${teamName(teams, runnerUpId)}${score ? ` ${score}` : ""} in the final${trophy ? ` to take ${trophy}` : ""}. Final standings are in the league history.`,
        });
        effects.chat.push(`${teamName(teams, champ.teamId)} are the ${season} ${league.name} champions, beating ${teamName(teams, runnerUpId)}${score ? ` ${score}` : ""}.`);
        effects.refresh = true;
        effects.week = sched.lastWeek;
        notes.push("season complete");
      } else if (wPlan.rounds === 0 && starting) {
        // fewer than 2 playoff teams: the regular-season leader is the champion
        await finalizeSeason(tx, { leagueId, season, teamsList, standings, stored, wPlan, wGames, games, sideResults, champSeed: stored.winners.length ? 1 : null, placement: null, settings });
        const champId = stored.winners[0]?.teamId ?? standings[0]?.team.id ?? null;
        if (champId) {
          effects.notifications.push({ title: `${teamName(teams, champId)} win the ${season} title`, body: `${teamName(teams, champId)} finished first in the regular season. Final standings are in the league history.` });
          effects.chat.push(`${teamName(teams, champId)} are the ${season} ${league.name} champions after finishing first in the regular season.`);
        }
        effects.refresh = true;
        notes.push("season complete (no playoff bracket)");
      }
      return notes.length ? notes.join("; ") : "bracket up to date";
    },
    { timeout: 60_000, maxWait: 30_000 },
  );

  if (effects.notifications.length || effects.chat.length) {
    const userIds = await leagueUserIds(leagueId);
    for (const n of effects.notifications) await notify({ userIds, leagueId, type: "PLAYOFFS", title: n.title, body: n.body, url: "/playoffs" }).catch(() => {});
    for (const c of effects.chat) await postSystemMessage(leagueId, c, { channel: "general", kind: "SYSTEM" }).catch(() => null);
  }
  if (effects.refresh) publish(topics.league(leagueId), "scores.refresh", { week: effects.week });
  return result;
}

// ───────── Commissioner seeding ─────────

/** Whether the commissioner may set seeds now (regular season final, no playoff game under way). */
export function seedingWindow(
  settings: LeagueSettings,
  phase: string,
  regular: Pick<Matchup, "status">[],
  playoffRows: Pick<Matchup, "status" | "homeScore" | "awayScore">[],
): { open: true } | { open: false; reason: string } {
  if (!settings.playoffs.manualSeedingAllowed) return { open: false, reason: "Manual seeding is turned off in league settings." };
  if (settings.playoffs.teams < 2) return { open: false, reason: "This league has no playoff bracket." };
  if (phase !== "REGULAR" && phase !== "PLAYOFFS") return { open: false, reason: "The season is over." };
  if (!regular.length) return { open: false, reason: "There is no regular-season schedule yet." };
  const left = regular.filter((m) => m.status !== "FINAL").length;
  if (left) return { open: false, reason: `Seeds can be set once the regular season is final (${left} game${left === 1 ? "" : "s"} left).` };
  if (playoffRows.some((m) => m.status !== "UPCOMING" || m.homeScore !== 0 || m.awayScore !== 0)) return { open: false, reason: "Playoff games are under way: seeds are locked." };
  return { open: true };
}

/**
 * Commissioner override: store the seed order (or clear it with null) and rebuild the bracket. Only allowed
 * between the end of the regular season and the first playoff kickoff; unplayed playoff rows are replaced.
 */
export async function setManualSeeds(leagueId: string, teamIds: string[] | null, actorId: string | null): Promise<{ ok: true; before: string[]; after: string[] } | { ok: false; error: string }> {
  const out = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${PLAYOFF_LOCK(leagueId)}))) AS l`;
      const league = await tx.league.findUnique({ where: { id: leagueId } });
      if (!league) return { ok: false as const, error: "League not found." };
      const settings = resolveSettings(league.settings);
      const season = league.season;
      const [teamsList, regular, playoffRows] = await Promise.all([
        tx.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" }, select: { id: true } }),
        tx.matchup.findMany({ where: { leagueId, season, isPlayoff: false }, select: { status: true } }),
        tx.matchup.findMany({ where: { leagueId, season, isPlayoff: true }, select: { id: true, status: true, homeScore: true, awayScore: true } }),
      ]);
      const win = seedingWindow(settings, league.phase, regular, playoffRows);
      if (!win.open) return { ok: false as const, error: win.reason };
      if (teamIds && !validManualSeeds(teamIds, teamsList.map((t) => t.id), settings.playoffs.teams)) {
        return { ok: false as const, error: `Pick ${Math.min(settings.playoffs.teams, teamsList.length)} different teams, one per seed.` };
      }
      const before = (await loadStoredBracket(leagueId, season, tx))?.winners.map((e) => e.teamId) ?? [];
      if (teamIds) {
        const value = { teamIds, setBy: actorId, at: new Date().toISOString() } satisfies ManualSeeds as unknown as Prisma.InputJsonValue;
        await tx.keyValue.upsert({ where: { key: manualSeedsKey(leagueId, season) }, create: { key: manualSeedsKey(leagueId, season), value }, update: { value } });
      } else {
        await tx.keyValue.deleteMany({ where: { key: manualSeedsKey(leagueId, season) } });
      }
      // nothing has been played: drop the unplayed bracket so advancePlayoffs rebuilds it with the new seeds
      if (playoffRows.length) await tx.matchup.deleteMany({ where: { id: { in: playoffRows.map((m) => m.id) }, status: "UPCOMING" } });
      await tx.keyValue.deleteMany({ where: { key: bracketKey(leagueId, season) } });
      return { ok: true as const, before };
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  if (!out.ok) return out;
  await advancePlayoffs(leagueId, { reseeded: true });
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { season: true } });
  const after = (await loadStoredBracket(leagueId, league?.season ?? 0))?.winners.map((e) => e.teamId) ?? [];
  return { ok: true, before: out.before, after };
}

/** Tied, completed playoff games → winner via settings.standings.playoffMatchupTiebreakers. */
export async function resolveTies(games: BracketGame[], leagueId: string, season: number, settings: LeagueSettings): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const tied = games.filter((g) => g.status === "FINAL" && g.homeTeamId && g.awayTeamId && g.homeScore === g.awayScore);
  if (!tied.length) return out;
  const chain: readonly PlayoffTiebreaker[] = settings.standings.playoffMatchupTiebreakers?.length ? settings.standings.playoffMatchupTiebreakers : ["HIGHER_SEED"];
  const needStats = chain.includes("BENCH_POINTS") || chain.includes("HIGHEST_STARTER");
  for (const g of tied) {
    let bench: [number, number] | null = null;
    let highest: [number, number] | null = null;
    if (needStats) {
      bench = [0, 0];
      highest = [0, 0];
      for (const week of g.weeks) {
        const [h, a] = await Promise.all([
          teamWeekScore(g.homeTeamId!, leagueId, season, week, settings),
          teamWeekScore(g.awayTeamId!, leagueId, season, week, settings),
        ]);
        bench[0] += h.benchPoints;
        bench[1] += a.benchPoints;
        highest[0] = Math.max(highest[0], ...h.starters.map((s) => s.points));
        highest[1] = Math.max(highest[1], ...a.starters.map((s) => s.points));
      }
    }
    const key = gameKey(g.kind, g.globalRound, g.slot);
    out.set(
      key,
      resolvePlayoffTie(
        chain,
        { key: `${leagueId}:${season}:${key}`, homeTeamId: g.homeTeamId!, awayTeamId: g.awayTeamId!, homeSeed: g.homeSeed, awaySeed: g.awaySeed, bench, highestStarter: highest },
        hashString,
      ),
    );
  }
  return out;
}

// ───────── Season history ─────────

/** Champion, runner-up and the 3rd place game's winner / loser from the season's playoff rows. */
export function playoffPlacings(playoffs: Matchup[]): { champion: string | null; runnerUp: string | null; third: string | null; fourth: string | null } {
  // the bracket's games (every week of a multi-week game summed); a final game carries the bracket's result —
  // combined score, a tie settled by the playoff tiebreakers — on every week's row
  const games = bracketGames(playoffs, null, 0).filter((g) => g.status === "FINAL" && g.winnerTeamId);
  const final = games.find((g) => g.kind === "WINNERS" && g.rows.some((r) => r.isChampionship));
  const third = games.find((g) => g.kind === "THIRD");
  let champion = final?.winnerTeamId ?? null;
  let runnerUp = final?.loserTeamId ?? null;
  if (!final) {
    // championship rows outside the bracket (no bracket position): total points, a tie to the last week's winner
    const rows = playoffs.filter((m) => m.isChampionship && !m.isConsolation && m.status === "FINAL" && m.bracketRound == null).sort((a, b) => a.week - b.week);
    const totals = new Map<string, number>();
    for (const m of rows) {
      if (m.homeTeamId) totals.set(m.homeTeamId, (totals.get(m.homeTeamId) ?? 0) + m.homeScore);
      if (m.awayTeamId) totals.set(m.awayTeamId, (totals.get(m.awayTeamId) ?? 0) + m.awayScore);
    }
    const ranked = [...totals.entries()].sort((x, y) => y[1] - x[1]);
    const lastWinner = rows[rows.length - 1]?.winnerTeamId ?? null;
    if (ranked.length === 2 && ranked[0]![1] === ranked[1]![1] && ranked[1]![0] === lastWinner) ranked.reverse();
    champion = ranked[0]?.[0] ?? null;
    runnerUp = ranked[1]?.[0] ?? null;
  }
  return { champion, runnerUp, third: third?.winnerTeamId ?? null, fourth: third?.loserTeamId ?? null };
}

/**
 * TeamSeason history rows for a finished season from its standings and playoff rows: the season rollover writes them
 * for teams the bracket's own archive (finalizeSeason) didn't cover. Final ranks 1–4 from playoffPlacings.
 */
export function seasonHistoryRows(leagueId: string, season: number, teams: { id: string; name: string; ownerId: string | null }[], standings: StandingRow[], playoffs: Matchup[]) {
  const rec = new Map(standings.map((r) => [r.team.id, r]));
  const inPlayoffs = new Set<string>();
  for (const m of playoffs) {
    if (m.isConsolation) continue;
    if (m.homeTeamId) inPlayoffs.add(m.homeTeamId);
    if (m.awayTeamId) inPlayoffs.add(m.awayTeamId);
  }
  const { champion, runnerUp, third, fourth } = playoffPlacings(playoffs);
  return teams.map((t) => {
    const r = rec.get(t.id);
    const finalRank = t.id === champion ? 1 : t.id === runnerUp ? 2 : t.id === third ? 3 : t.id === fourth ? 4 : null;
    return {
      leagueId,
      teamId: t.id,
      ownerId: t.ownerId,
      season,
      teamName: t.name,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      ties: r?.ties ?? 0,
      pointsFor: r?.pointsFor ?? 0,
      pointsAgainst: r?.pointsAgainst ?? 0,
      regularSeasonRank: r?.rank ?? null,
      finalRank,
      madePlayoffs: inPlayoffs.has(t.id),
      champion: t.id === champion,
      runnerUp: t.id === runnerUp,
    };
  });
}

async function finalizeSeason(
  tx: Tx,
  a: {
    leagueId: string;
    season: number;
    teamsList: Team[];
    standings: StandingRow[];
    stored: StoredBracket;
    wPlan: BracketPlan;
    wGames: BracketGame[];
    games: BracketGame[];
    sideResults: { side: StoredSide; plan: BracketPlan; adv: Map<string, number>; games: BracketGame[] }[];
    champSeed: number | null;
    /** finishing order of the placement-game pool (5th, 6th, ...) */
    placement: string[] | null;
    settings: LeagueSettings;
  },
) {
  const { stored, wPlan } = a;
  const rankOf = new Map(a.standings.map((r) => [r.team.id, r.rank]));
  const playoffTeams = stored.winners.map((e) => e.teamId);
  const champion = a.champSeed !== null ? stored.winners.find((e) => e.seed === a.champSeed)?.teamId ?? null : a.standings[0]?.team.id ?? null;
  const eliminatedRound = new Map<string, number>();
  for (const g of a.wGames) if (g.loserTeamId) eliminatedRound.set(g.loserTeamId, Math.max(eliminatedRound.get(g.loserTeamId) ?? 0, g.round));
  const third = a.games.find((g) => g.kind === "THIRD");
  const cons = a.sideResults.find((s) => s.side.kind === "CONSOLATION");
  const toilet = a.sideResults.find((s) => s.side.kind === "TOILET");
  const sideWinner = (s: (typeof a.sideResults)[number]) => {
    const seed = bracketWinner(s.plan, stored.reseed, s.adv);
    return s.side.entries.find((e) => e.seed === seed)?.teamId ?? null;
  };
  const consWinner = cons ? sideWinner(cons) : null;
  const toiletLast = toilet ? sideWinner(toilet) : null;
  const consElim = new Map<string, number>();
  for (const g of cons?.games ?? []) if (g.loserTeamId) consElim.set(g.loserTeamId, g.round);
  const toiletEscaped = new Map<string, number>();
  for (const g of toilet?.games ?? []) if (g.winnerTeamId) toiletEscaped.set(g.winnerTeamId, g.round);

  const order = champion
    ? finalPlacement({
        playoffTeams,
        champion,
        eliminatedRound,
        thirdPlace: third?.winnerTeamId && third.loserTeamId ? { winner: third.winnerTeamId, loser: third.loserTeamId } : null,
        placement: a.placement,
        consolation: cons && consWinner ? { teamIds: cons.side.entries.map((e) => e.teamId), winner: consWinner, eliminatedRound: consElim } : null,
        toilet: toilet && toiletLast ? { teamIds: toilet.side.entries.map((e) => e.teamId), last: toiletLast, escapedRound: toiletEscaped } : null,
        rankOf,
        allTeams: a.teamsList.map((t) => t.id),
      })
    : a.standings.map((r) => r.team.id);
  const ordered = applyLastPlaceRule(order, a.settings.niche.lastPlaceDeterminedBy, {
    rankOf,
    pointsFor: new Map(a.standings.map((r) => [r.team.id, r.pointsFor])),
    playoffTeams,
  });
  const finalRank = new Map(ordered.map((id, i) => [id, i + 1]));
  const finalGame = a.wGames.find((g) => g.round === wPlan.rounds);
  const runnerUp = finalGame?.loserTeamId ?? null;
  const byTeam = new Map(a.standings.map((r) => [r.team.id, r]));
  for (const t of a.teamsList) {
    const r = byTeam.get(t.id);
    const data = {
      ownerId: t.ownerId,
      teamName: t.name,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      ties: r?.ties ?? 0,
      pointsFor: r?.pointsFor ?? 0,
      pointsAgainst: r?.pointsAgainst ?? 0,
      regularSeasonRank: r?.rank ?? null,
      finalRank: finalRank.get(t.id) ?? null,
      madePlayoffs: playoffTeams.includes(t.id),
      champion: t.id === champion,
      runnerUp: t.id === runnerUp,
    };
    await tx.teamSeason.upsert({
      where: { teamId_season: { teamId: t.id, season: a.season } },
      create: { leagueId: a.leagueId, teamId: t.id, season: a.season, ...data },
      update: data,
    });
  }
  await tx.league.update({ where: { id: a.leagueId }, data: { phase: "OFFSEASON" } });
}
