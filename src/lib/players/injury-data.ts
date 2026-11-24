// Injury report lookups shared by the news sync and the players pages.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface LatestInjuryReport {
  id: string;
  playerId: string;
  externalId: string | null;
  status: string;
  bodyPart: string | null;
  shortComment: string | null;
  longComment: string | null;
  returnDate: Date | null;
  reportedAt: Date;
  source: string;
}

/** Latest injury report per player (DISTINCT ON), optionally limited to some players. */
export async function latestInjuryReports(playerIds?: string[]): Promise<Map<string, LatestInjuryReport>> {
  if (playerIds && !playerIds.length) return new Map();
  const where = playerIds ? Prisma.sql`WHERE "playerId" IN (${Prisma.join(playerIds)})` : Prisma.empty;
  const rows = await db.$queryRaw<LatestInjuryReport[]>`
    SELECT DISTINCT ON ("playerId") "id", "playerId", "externalId", "status", "bodyPart", "shortComment", "longComment", "returnDate", "reportedAt", "source"
    FROM "InjuryReport"
    ${where}
    ORDER BY "playerId", "reportedAt" DESC, "createdAt" DESC`;
  return new Map(rows.map((r) => [r.playerId, r]));
}
