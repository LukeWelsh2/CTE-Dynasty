// Small server helpers shared by the rookie draft, auction and clock (safe to import from jobs/scripts).
import type { Draft, League } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { notify, teamUserIds, leagueUserIds, type NotificationType } from "@/lib/notify";
import type { DraftEventType } from "@/lib/draft/events";
import { draftTxWeek } from "@/lib/draft/data";

export class DraftError extends Error {}

export function emit(draftId: string, type: DraftEventType, data: Record<string, unknown> = {}) {
  publish(topics.draft(draftId), type, { draftId, ...data });
}

export async function loadDraft(draftId: string): Promise<Draft & { league: League; settingsResolved: LeagueSettings }> {
  const d = await db.draft.findUnique({ where: { id: draftId }, include: { league: true } });
  if (!d) throw new DraftError("Draft not found");
  return { ...d, settingsResolved: resolveSettings(d.league.settings) };
}

export async function txWeekFor(league: League, draftSeason: number): Promise<number> {
  const settings = resolveSettings(league.settings);
  const nfl = await getNflState();
  return draftTxWeek(league, draftSeason, leagueWeekFor(league, settings, nfl));
}

const pending = new Set<Promise<unknown>>();
function track(p: Promise<unknown>) {
  const q = p.catch((e) => console.error("[draft notify]", e)).finally(() => pending.delete(q));
  pending.add(q);
}

/** Fire-and-forget notification to a team's managers (never blocks or fails a draft action). */
export function notifyTeam(teamId: string, leagueId: string, type: NotificationType, title: string, body: string, url: string) {
  track(teamUserIds(teamId).then((userIds) => notify({ userIds, leagueId, type, title, body, url })));
}

export function notifyLeague(leagueId: string, type: NotificationType, title: string, body: string, url: string) {
  track(leagueUserIds(leagueId).then((userIds) => notify({ userIds, leagueId, type, title, body, url })));
}

/** Wait for queued notifications (used by the clock so one-off job runs don't exit mid-send). */
export async function flushNotifications() {
  while (pending.size) await Promise.allSettled([...pending]);
}

export async function audit(leagueId: string, actorId: string | null | undefined, action: string, targetId: string, details: Record<string, unknown> = {}) {
  await db.auditLog.create({ data: { leagueId, actorId: actorId ?? null, action, targetType: "Draft", targetId, details: details as never } }).catch(() => {});
}

export function draftOrderIds(draft: Pick<Draft, "order">): string[] {
  return Array.isArray(draft.order) ? (draft.order as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

export function roomUrl(draft: Pick<Draft, "id" | "type">) {
  return draft.type === "AUCTION" ? `/draft/auction?id=${draft.id}` : `/draft/rookie?id=${draft.id}`;
}

export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 48) return rem ? `${h}h ${rem}m` : `${h}h`;
  return `${Math.round(h / 24)} days`;
}
