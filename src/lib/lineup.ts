// Weekly lineups: creation (carry-forward), game locks, validation and optimal lineup.
import type { NflGame, Player } from "@prisma/client";
import { db } from "@/lib/db";
import { expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";

export interface LineupAssignment {
  slot: string;
  slotIndex: number;
  playerId: string | null;
}

export interface SlotView {
  slot: string;
  slotIndex: number;
  label: string;
  eligible: string[];
  playerId: string | null;
}

/** NFL games for a week keyed by team abbreviation */
export async function weekGamesByTeam(season: number, week: number): Promise<Map<string, NflGame>> {
  const games = await db.nflGame.findMany({ where: { season, week, seasonType: "REG" } });
  const m = new Map<string, NflGame>();
  for (const g of games) {
    m.set(g.homeTeam, g);
    m.set(g.awayTeam, g);
  }
  return m;
}

/** settings.lineup.lockOffsetMinutes in milliseconds (players lock this long before kickoff). */
export function lockOffsetMs(settings: Pick<LeagueSettings, "lineup">): number {
  return Math.max(0, settings.lineup.lockOffsetMinutes ?? 0) * 60_000;
}

/** Is a player's lineup spot locked for this week? Honors lineup.lockType and lineup.lockOffsetMinutes. */
export function isLocked(
  team: string | null | undefined,
  games: Map<string, NflGame>,
  settings: LeagueSettings,
  realNow = new Date(),
): boolean {
  // a player locks lockOffsetMinutes before kickoff: compare kickoffs with a clock shifted forward by the offset
  const now = new Date(realNow.getTime() + lockOffsetMs(settings));
  const all = [...new Set(games.values())];
  if (settings.lineup.lockType === "FIRST_GAME_OF_WEEK") {
    const first = all.reduce<Date | null>((a, g) => (!a || g.startTime < a ? g.startTime : a), null);
    return !!first && first <= now;
  }
  if (settings.lineup.lockType === "SUNDAY_FIRST_GAME") {
    const sunday = all.filter((g) => g.startTime.getUTCDay() === 0).reduce<Date | null>((a, g) => (!a || g.startTime < a ? g.startTime : a), null);
    const g = team ? games.get(team) : undefined;
    if (g && g.startTime <= now) return true; // Thu/Sat games still lock individually
    return !!sunday && sunday <= now;
  }
  if (!team) return false; // free agent / no team -> never locked
  const g = games.get(team);
  if (!g) return false; // bye week
  return g.startTime <= now || g.state !== "pre";
}

/** Players on bye this week */
export function isOnBye(team: string | null | undefined, games: Map<string, NflGame>): boolean {
  if (!team) return true;
  return !games.has(team);
}

/** Roster statuses that may fill a starting slot (taxi players only when roster.taxiPlayersCanStart). */
export function canStart(status: string, settings: Pick<LeagueSettings, "roster">): boolean {
  return status === "ACTIVE" || (status === "TAXI" && !!settings.roster.taxiPlayersCanStart);
}

/**
 * Get a team's lineup for a week, creating it on first access per settings.lineup.defaultCarryOver:
 * PREVIOUS_WEEK carries forward the most recent earlier lineup (dropping players no longer startable),
 * OPTIMAL_PROJECTED builds the best projected lineup, EMPTY starts with every slot open.
 * A team's very first lineup is always auto-filled.
 */
export async function getLineup(teamId: string, leagueId: string, season: number, week: number, settings: LeagueSettings): Promise<SlotView[]> {
  const slots = expandSlots(settings);
  let rows = await db.lineupSlot.findMany({ where: { teamId, season, week } });
  if (!rows.length) {
    const mode = settings.lineup.defaultCarryOver ?? "PREVIOUS_WEEK";
    const prev = await db.lineupSlot.findFirst({ where: { teamId, season, week: { lt: week } }, orderBy: { week: "desc" }, select: { week: true } });
    const roster = await db.rosterSpot.findMany({ where: { teamId }, select: { playerId: true, status: true } });
    const startable = new Set(roster.filter((r) => canStart(r.status, settings)).map((r) => r.playerId));
    let source: { slot: string; slotIndex: number; playerId: string | null }[] = [];
    if (prev && mode === "PREVIOUS_WEEK") source = await db.lineupSlot.findMany({ where: { teamId, season, week: prev.week } });
    const data = slots.map((s) => {
      const p = source.find((r) => r.slot === s.key && r.slotIndex === s.index);
      const playerId = p?.playerId && startable.has(p.playerId) ? p.playerId : null;
      return { leagueId, teamId, season, week, slot: s.key, slotIndex: s.index, playerId };
    });
    await db.lineupSlot.createMany({ data, skipDuplicates: true });
    rows = await db.lineupSlot.findMany({ where: { teamId, season, week } });
    if (!prev || mode === "OPTIMAL_PROJECTED") {
      // brand new team (or a league that defaults to the best projected lineup): auto-fill
      await autoFillLineup(teamId, leagueId, season, week, settings);
      rows = await db.lineupSlot.findMany({ where: { teamId, season, week } });
    }
  }
  return slots.map((s) => {
    const r = rows.find((x) => x.slot === s.key && x.slotIndex === s.index);
    return { slot: s.key, slotIndex: s.index, label: s.label, eligible: s.eligible, playerId: r?.playerId ?? null };
  });
}

/**
 * Greedy optimal lineup: fill the most restrictive slots first with the highest scoring eligible player.
 * `value` maps playerId -> points (projected or actual).
 */
export function optimalLineup(
  players: Pick<Player, "id" | "position">[],
  value: Map<string, number>,
  settings: LeagueSettings,
  opts: { locked?: Map<string, string>; excluded?: Set<string> } = {},
): LineupAssignment[] {
  const slots = expandSlots(settings);
  const order = [...slots].sort((a, b) => a.eligible.length - b.eligible.length);
  const used = new Set<string>();
  const result = new Map<string, string | null>();
  // keep locked assignments (slotKey#index -> playerId)
  for (const [k, pid] of opts.locked ?? []) {
    result.set(k, pid);
    if (pid) used.add(pid);
  }
  for (const s of order) {
    const k = `${s.key}#${s.index}`;
    if (result.has(k)) continue;
    let best: string | null = null;
    let bestV = -Infinity;
    for (const p of players) {
      if (used.has(p.id) || opts.excluded?.has(p.id)) continue;
      if (!s.eligible.includes(normalizePosition(p.position))) continue;
      const v = value.get(p.id) ?? 0;
      if (v > bestV) {
        bestV = v;
        best = p.id;
      }
    }
    result.set(k, best);
    if (best) used.add(best);
  }
  return slots.map((s) => ({ slot: s.key, slotIndex: s.index, playerId: result.get(`${s.key}#${s.index}`) ?? null }));
}

export async function autoFillLineup(teamId: string, leagueId: string, season: number, week: number, settings: LeagueSettings) {
  const statuses = settings.roster.taxiPlayersCanStart ? ["ACTIVE", "TAXI"] : ["ACTIVE"];
  const roster = await db.rosterSpot.findMany({ where: { teamId, status: { in: statuses as ("ACTIVE" | "TAXI")[] } }, include: { player: true } });
  const projs = await db.playerWeekProjection.findMany({ where: { season, week, playerId: { in: roster.map((r) => r.playerId) } } });
  const { calcPoints } = await import("@/lib/scoring/engine");
  const value = new Map<string, number>();
  for (const r of roster) {
    const pr = projs.find((p) => p.playerId === r.playerId);
    const injured = ["Out", "IR", "Doubtful", "PUP", "Sus"].includes(r.player.injuryStatus ?? "");
    value.set(r.playerId, (pr ? calcPoints(pr.stats as Record<string, number>, r.player.position, settings.scoring).points : 0) - (injured ? 100 : 0) + (r.player.searchRank ? 1 / r.player.searchRank : 0));
  }
  const lineup = optimalLineup(roster.map((r) => r.player), value, settings);
  await saveLineup(teamId, leagueId, season, week, lineup);
  return lineup;
}

/**
 * Save a team's lineup for a week. Later weeks that were already created but never changed (they still
 * match this week's previous lineup slot for slot) are untouched carry-forwards, so the change carries
 * into them too — viewing a future week early doesn't freeze it. Pass `{ propagate: false }` to skip.
 */
export async function saveLineup(
  teamId: string,
  leagueId: string,
  season: number,
  week: number,
  lineup: LineupAssignment[],
  opts: { propagate?: boolean } = {},
) {
  const key = (slot: string, idx: number) => `${slot}#${idx}`;
  const before = opts.propagate === false ? [] : await db.lineupSlot.findMany({ where: { teamId, season, week } });
  await db.$transaction(
    lineup.map((a) =>
      db.lineupSlot.upsert({
        where: { teamId_season_week_slot_slotIndex: { teamId, season, week, slot: a.slot, slotIndex: a.slotIndex } },
        create: { leagueId, teamId, season, week, slot: a.slot, slotIndex: a.slotIndex, playerId: a.playerId },
        update: { playerId: a.playerId },
      }),
    ),
  );
  if (opts.propagate === false || !before.length) return;
  const oldMap = new Map(before.map((r) => [key(r.slot, r.slotIndex), r.playerId ?? null]));
  const changed = lineup.some((a) => (oldMap.get(key(a.slot, a.slotIndex)) ?? null) !== a.playerId);
  if (!changed) return;
  const later = await db.lineupSlot.findMany({ where: { teamId, season, week: { gt: week } }, orderBy: { week: "asc" } });
  const byWeek = new Map<number, typeof later>();
  for (const r of later) byWeek.set(r.week, [...(byWeek.get(r.week) ?? []), r]);
  const rostered = new Set((await db.rosterSpot.findMany({ where: { teamId }, select: { playerId: true } })).map((r) => r.playerId));
  for (const [w, rows] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    // a week the manager edited (differs from the old lineup) breaks the chain: it and everything after it stay
    const same = rows.length === oldMap.size && rows.every((r) => (oldMap.get(key(r.slot, r.slotIndex)) ?? null) === (r.playerId ?? null));
    if (!same) break;
    await db.$transaction(
      lineup.map((a) =>
        db.lineupSlot.updateMany({
          where: { teamId, season, week: w, slot: a.slot, slotIndex: a.slotIndex },
          data: { playerId: a.playerId && rostered.has(a.playerId) ? a.playerId : null },
        }),
      ),
    );
  }
}

/**
 * Validate a proposed lineup. `current` is the saved lineup (to check locked slots didn't change).
 * Returns a list of errors (empty = valid).
 */
export function validateLineup(
  proposed: LineupAssignment[],
  current: LineupAssignment[],
  roster: { playerId: string; status: string; player: Pick<Player, "position" | "team" | "fullName"> }[],
  games: Map<string, NflGame>,
  settings: LeagueSettings,
  now = new Date(),
): string[] {
  const errors: string[] = [];
  const slots = expandSlots(settings);
  const byId = new Map(roster.map((r) => [r.playerId, r]));
  const seen = new Set<string>();
  for (const a of proposed) {
    const def = slots.find((s) => s.key === a.slot && s.index === a.slotIndex);
    if (!def) {
      errors.push(`Unknown lineup slot ${a.slot}`);
      continue;
    }
    const cur = current.find((c) => c.slot === a.slot && c.slotIndex === a.slotIndex);
    const curPlayer = cur?.playerId ? byId.get(cur.playerId) : undefined;
    if (cur?.playerId !== a.playerId) {
      if (curPlayer && isLocked(curPlayer.player.team, games, settings, now)) errors.push(`${curPlayer.player.fullName}'s game has started — that slot is locked.`);
      if (cur?.playerId && !curPlayer) {
        // previous player no longer rostered: fine to replace
      }
    }
    if (!a.playerId) continue;
    const r = byId.get(a.playerId);
    if (!r) {
      errors.push(`Player is not on your roster.`);
      continue;
    }
    if (!canStart(r.status, settings)) errors.push(`${r.player.fullName} is on ${r.status} and can't start.`);
    if (!def.eligible.includes(normalizePosition(r.player.position))) errors.push(`${r.player.fullName} (${r.player.position}) can't play ${def.label}.`);
    if (seen.has(a.playerId)) errors.push(`${r.player.fullName} is in the lineup twice.`);
    seen.add(a.playerId);
    if (cur?.playerId !== a.playerId && isLocked(r.player.team, games, settings, now)) errors.push(`${r.player.fullName}'s game has started — can't move into the lineup.`);
  }
  return [...new Set(errors)];
}
