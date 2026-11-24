// Targeted League.settings updates made by season controls (keeper window dates, cap growth at rollover).
// Merges into the stored JSON, bumps settingsVersion and records a LeagueSettingsHistory row.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { deepMerge, diffSettings, resolveSettings } from "@/lib/settings/schema";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function patchLeagueSettings(
  leagueId: string,
  patch: Record<string, unknown>,
  opts: { actorId?: string | null; note?: string; tx?: Tx } = {},
): Promise<{ changed: number }> {
  const run = async (tx: Tx) => {
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true, settingsVersion: true } });
    const raw = (league.settings ?? {}) as Record<string, unknown>;
    const merged = deepMerge(raw, patch) as Record<string, unknown>;
    const before = resolveSettings(raw);
    const after = resolveSettings(merged);
    const changes = diffSettings(before, after);
    if (!changes.length) return { changed: 0 };
    const version = league.settingsVersion + 1;
    await tx.league.update({ where: { id: leagueId }, data: { settings: merged as Prisma.InputJsonValue, settingsVersion: version } });
    await tx.leagueSettingsHistory.create({
      data: {
        leagueId,
        version,
        changedById: opts.actorId ?? null,
        changes: changes as unknown as Prisma.InputJsonValue,
        snapshot: after as unknown as Prisma.InputJsonValue,
        note: opts.note ?? null,
      },
    });
    return { changed: changes.length };
  };
  return opts.tx ? run(opts.tx) : db.$transaction((tx) => run(tx));
}
