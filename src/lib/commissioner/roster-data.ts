// Server-side roster helpers shared by the commissioner roster page and actions.
import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Amnesty cuts a team has used over the life of the league: commissioner transactions flagged
 * `details.amnesty` (written by the force-drop and dead-money tools).
 */
export async function amnestyUsedCount(leagueId: string, teamId: string, tx: Tx = db): Promise<number> {
  return tx.transaction.count({ where: { leagueId, teamId, type: "COMMISSIONER", details: { path: ["amnesty"], equals: true } } });
}
