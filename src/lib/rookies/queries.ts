// Read model for the /rookies page: rankings with player details, ADP, movement and rank history.
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { getAdpMap } from "@/lib/draft/data";
import { draftCapitalFromMetadata, rankMovement, rankingKey } from "@/lib/rookies/logic";
import { excludedPlayers } from "@/lib/rookies/rankings";

export interface RankingRowView {
  id: string;
  key: string;
  rank: number;
  previousRank: number | null;
  movement: number;
  isNew: boolean;
  tier: number;
  playerId: string | null;
  name: string;
  position: string;
  nflTeam: string | null;
  college: string | null;
  age: number | null;
  injuryStatus: string | null;
  draftRound: number | null;
  draftPick: number | null;
  adp: number | null;
  autoScore: number | null;
  notes: string | null;
  source: "AUTO" | "COMMISSIONER";
  history: (number | null)[];
  rosteredBy: { teamId: string; name: string; abbrev: string } | null;
}

export interface RankingsView {
  classYear: number;
  rows: RankingRowView[];
  updatedAt: string | null;
  snapshotCount: number;
  firstSnapshotAt: string | null;
  excluded: { id: string; fullName: string; position: string; team: string | null }[];
}

export async function getRookieRankingsView(leagueId: string, classYear: number, season: number, _settings: LeagueSettings): Promise<RankingsView> {
  const [rows, snaps, excludedIds, adp] = await Promise.all([
    db.rookieRanking.findMany({
      where: { leagueId, classYear },
      orderBy: { rank: "asc" },
      include: { player: { select: { id: true, fullName: true, position: true, team: true, college: true, age: true, injuryStatus: true, metadata: true } } },
    }),
    db.rookieRankingSnapshot.findMany({ where: { leagueId, classYear }, orderBy: { takenAt: "desc" }, take: 30 }),
    excludedPlayers(leagueId, classYear),
    getAdpMap(Math.min(classYear, season)),
  ]);
  const playerIds = rows.map((r) => r.playerId).filter((x): x is string => !!x);
  const [spots, excluded] = await Promise.all([
    playerIds.length ? db.rosterSpot.findMany({ where: { leagueId, playerId: { in: playerIds } }, select: { playerId: true, team: { select: { id: true, name: true, abbrev: true } } } }) : Promise.resolve([]),
    excludedIds.size ? db.player.findMany({ where: { id: { in: [...excludedIds] } }, select: { id: true, fullName: true, position: true, team: true } }) : Promise.resolve([]),
  ]);
  const spotBy = new Map(spots.map((s) => [s.playerId, s.team]));
  const history = [...snaps].reverse();
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const snapRanks = history.map((s) => {
    const m = new Map<string, number>();
    for (const d of (s.data as { rank: number; playerId?: string | null; prospectName?: string | null; position: string }[]) ?? []) m.set(rankingKey(d), d.rank);
    return m;
  });
  const updatedAt = rows.reduce<Date | null>((a, r) => (!a || r.updatedAt > a ? r.updatedAt : a), null);
  return {
    classYear,
    updatedAt: updatedAt?.toISOString() ?? null,
    snapshotCount: snaps.length,
    firstSnapshotAt: history[0]?.takenAt.toISOString() ?? null,
    excluded,
    rows: rows.map((r) => {
      const key = rankingKey(r);
      const cap = r.player ? draftCapitalFromMetadata(r.player.metadata) : { round: null, pick: null };
      const team = r.playerId ? spotBy.get(r.playerId) : null;
      const hist = snapRanks.map((m) => m.get(key) ?? null);
      // the line always ends at the current rank: replace today's snapshot point, or append one
      if (history.length && history[history.length - 1].takenAt >= todayUtc) hist[hist.length - 1] = r.rank;
      else hist.push(r.rank);
      return {
        id: r.id,
        key,
        rank: r.rank,
        previousRank: r.previousRank,
        movement: rankMovement(r.previousRank, r.rank),
        isNew: r.previousRank === null && snaps.length > 1,
        tier: r.tier,
        playerId: r.playerId,
        name: r.player?.fullName ?? r.prospectName ?? "Unknown prospect",
        position: r.position,
        nflTeam: r.player?.team ?? r.nflTeam,
        college: r.player?.college ?? r.college,
        age: r.player?.age ?? null,
        injuryStatus: r.player?.injuryStatus ?? null,
        draftRound: r.draftRound ?? cap.round,
        draftPick: r.draftPick ?? cap.pick,
        adp: r.playerId ? adp.get(r.playerId) ?? null : null,
        autoScore: r.autoScore,
        notes: r.notes,
        source: r.source === "COMMISSIONER" ? "COMMISSIONER" : "AUTO",
        history: hist,
        rosteredBy: team ? { teamId: team.id, name: team.name, abbrev: team.abbrev } : null,
      };
    }),
  };
}
