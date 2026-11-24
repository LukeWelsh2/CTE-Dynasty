// Rookie draft lottery: weighted draw for the worst teams, saved in KeyValue and applied to the draft order.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { publish, topics } from "@/lib/realtime/bus";
import { postSystemMessage } from "@/lib/chat-system";
import { drawLottery, normalizeOdds, seededRandom } from "@/lib/draft/logic";
import { computeRookieOrder, lotteryKey, type LotteryRecord } from "@/lib/draft/order";
import { applyRookieOrder } from "@/lib/draft/rookie";
import { DraftError, audit } from "@/lib/draft/shared";
import { rookieRules } from "@/lib/draft/data";

export async function runLottery(leagueId: string, season: number, actorId: string | null): Promise<LotteryRecord> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  if (settings.draft.rookie.orderMethod !== "LOTTERY") throw new DraftError("This league's rookie draft order doesn't use a lottery (League Settings → Draft).");
  const draft = await db.draft.findFirst({ where: { leagueId, season, type: "ROOKIE" } });
  if (draft && draft.status !== "SCHEDULED") throw new DraftError("The rookie draft has already started — the lottery is locked.");
  const order = await computeRookieOrder(leagueId, season, settings);
  if (order.status === "NO_RESULTS") throw new DraftError(`There are no ${season - 1} results to seed a lottery yet.`);
  const pool = order.lotteryPool;
  if (pool.length < 2) throw new DraftError("The lottery needs at least two teams (League Settings → Draft → lottery teams).");
  const seed = crypto.randomInt(1, 2 ** 31 - 1);
  const lot = settings.draft.rookie.lottery;
  const odds = normalizeOdds(pool.length, lot.odds);
  const rules = { picksDrawn: lot.picksDrawn ?? null, maxDropSpots: lot.maxDropSpots ?? null };
  const result = drawLottery(pool, odds, seededRandom(seed), rules);
  const record: LotteryRecord = { season, drawnAt: new Date().toISOString(), drawnById: actorId, pool, odds, result, seed, official: true, ...rules };
  const key = lotteryKey(leagueId, season);
  await db.keyValue.upsert({ where: { key }, create: { key, value: record as unknown as Prisma.InputJsonValue }, update: { value: record as unknown as Prisma.InputJsonValue } });
  await audit(leagueId, actorId, "draft.lottery", key, { season, pool, result, seed, ...rules });
  if (draft && !rookieRules(draft, settings).manualOrder) {
    const updated = await computeRookieOrder(leagueId, season, settings);
    await applyRookieOrder(draft.id, updated.rows.map((r) => r.teamId), { manual: false, settings });
  }
  const teams = await db.team.findMany({ where: { id: { in: result } }, select: { id: true, name: true } });
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "?";
  publish(topics.league(leagueId), "draft.lottery", { season, result, liveReveal: lot.liveReveal !== false });
  void postSystemMessage(leagueId, `${season} draft lottery results: ${result.map((id, i) => `${i + 1}. ${name(id)}`).join(" · ")}`, { channel: "general", kind: "SYSTEM", data: { season } }).catch(() => {});
  return record;
}

/** Commissioner: clear the official lottery (before the rookie draft starts) so it can be drawn again. */
export async function clearLottery(leagueId: string, season: number, actorId: string | null) {
  const draft = await db.draft.findFirst({ where: { leagueId, season, type: "ROOKIE" } });
  if (draft && draft.status !== "SCHEDULED") throw new DraftError("The rookie draft has already started — the lottery is locked.");
  await db.keyValue.deleteMany({ where: { key: lotteryKey(leagueId, season) } });
  await audit(leagueId, actorId, "draft.lottery_clear", lotteryKey(leagueId, season), { season });
  if (draft) {
    const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
    const settings = resolveSettings(league.settings);
    if (!rookieRules(draft, settings).manualOrder) {
      const updated = await computeRookieOrder(leagueId, season, settings);
      await applyRookieOrder(draft.id, updated.rows.map((r) => r.teamId), { manual: false, settings });
    }
  }
}
