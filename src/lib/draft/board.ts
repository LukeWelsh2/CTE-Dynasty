// Personal big boards (BigBoardEntry) for a rookie class. Tier breaks are stored per team/class in KeyValue
// (BigBoardEntry has no tier column): the player ids that start a new tier.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const tierKey = (teamId: string, classYear: number) => `bigboard-tiers:${teamId}:${classYear}`;

export async function getTierBreaks(teamId: string, classYear: number): Promise<string[]> {
  const row = await db.keyValue.findUnique({ where: { key: tierKey(teamId, classYear) } });
  const v = (row?.value ?? []) as unknown;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export interface BoardEntryInput {
  playerId: string;
  note?: string | null;
}

/** Replace a team's board for a class (ranks follow the given order). */
export async function saveBigBoard(input: { leagueId: string; teamId: string; classYear: number; entries: BoardEntryInput[]; tierBreaks: string[] }) {
  const seen = new Set<string>();
  const entries = input.entries.filter((e) => (seen.has(e.playerId) ? false : (seen.add(e.playerId), true)));
  const existing = await db.player.findMany({ where: { id: { in: entries.map((e) => e.playerId) } }, select: { id: true } });
  const ok = new Set(existing.map((p) => p.id));
  const rows = entries.filter((e) => ok.has(e.playerId));
  const breaks = input.tierBreaks.filter((id) => rows.some((r, i) => i > 0 && r.playerId === id));
  const key = tierKey(input.teamId, input.classYear);
  await db.$transaction([
    db.bigBoardEntry.deleteMany({ where: { teamId: input.teamId, classYear: input.classYear } }),
    db.bigBoardEntry.createMany({
      data: rows.map((r, i) => ({ leagueId: input.leagueId, teamId: input.teamId, classYear: input.classYear, playerId: r.playerId, rank: i + 1, note: r.note?.trim() ? r.note.trim().slice(0, 280) : null })),
    }),
    db.keyValue.upsert({ where: { key }, create: { key, value: breaks as Prisma.InputJsonValue }, update: { value: breaks as Prisma.InputJsonValue } }),
  ]);
  return rows.length;
}

/** Copy the league rookie rankings onto a board: replace the order, or append players not yet on it. */
export async function importLeagueRankings(input: { leagueId: string; teamId: string; classYear: number; mode: "replace" | "append" }) {
  let rankings = await db.rookieRanking.findMany({ where: { leagueId: input.leagueId, classYear: input.classYear, playerId: { not: null } }, orderBy: { rank: "asc" }, select: { playerId: true, tier: true } });
  if (!rankings.length) {
    rankings = await db.rookieRanking.findMany({ where: { leagueId: input.leagueId, classYear: input.classYear - 1, playerId: { not: null } }, orderBy: { rank: "asc" }, select: { playerId: true, tier: true } });
  }
  if (!rankings.length) return 0;
  const current = await db.bigBoardEntry.findMany({ where: { teamId: input.teamId, classYear: input.classYear }, orderBy: { rank: "asc" } });
  const notes = new Map(current.map((c) => [c.playerId, c.note]));
  const rostered = new Set((await db.rosterSpot.findMany({ where: { leagueId: input.leagueId, playerId: { in: rankings.map((r) => r.playerId!) } }, select: { playerId: true } })).map((r) => r.playerId));
  const fresh = rankings.filter((r) => !rostered.has(r.playerId!));
  let entries: BoardEntryInput[];
  let breaks: string[];
  if (input.mode === "replace") {
    entries = fresh.map((r) => ({ playerId: r.playerId!, note: notes.get(r.playerId!) ?? null }));
    breaks = fresh.filter((r, i) => i > 0 && r.tier !== fresh[i - 1].tier).map((r) => r.playerId!);
  } else {
    const have = new Set(current.map((c) => c.playerId));
    entries = [...current.map((c) => ({ playerId: c.playerId, note: c.note })), ...fresh.filter((r) => !have.has(r.playerId!)).map((r) => ({ playerId: r.playerId!, note: null }))];
    breaks = await getTierBreaks(input.teamId, input.classYear);
  }
  return saveBigBoard({ leagueId: input.leagueId, teamId: input.teamId, classYear: input.classYear, entries, tierBreaks: breaks });
}
