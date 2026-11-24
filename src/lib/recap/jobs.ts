// Weekly recap delivery: the "weekly-recap" background job (runs hourly) and the commissioner's
// "send now". Emails go to every manager who hasn't opted out (NotificationPreference.weeklyRecapEmail or
// the RECAP email channel), personalized with a "Your week" box; everyone also gets the in-app / push
// notification per their RECAP preferences. Idempotent: WeeklyRecap.sentAt is claimed before sending.
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { sendEmail } from "@/lib/email";
import { NOTIFICATION_DEFAULTS, sendPushToUser } from "@/lib/notify";
import { publish, topics } from "@/lib/realtime/bus";
import { isRecapDue, latestCompletedWeek } from "./compute";
import { buildWeeklyRecap, RecapError } from "./generate";
import { renderRecapEmail } from "./html";
import { isRecapContent, type RecapContent } from "./types";

export interface SendRecapResult {
  recapId: string;
  week: number;
  emailed: number;
  optedOut: number;
  failed: number;
  notified: number;
  /** no SMTP configured: emails were saved as previews (EmailLog PREVIEW / .emails) */
  preview: boolean;
}

export interface SendRecapOptions {
  /** rebuild the recap from fresh data before sending (the scheduled job does) */
  rebuild?: boolean;
  /** send again even though the recap was already sent */
  resend?: boolean;
}

type ChannelPrefs = Record<string, { push?: boolean; email?: boolean; inApp?: boolean }>;

function inQuietHours(pref: { quietStart: number | null; quietEnd: number | null } | null, tz: string, now = new Date()): boolean {
  if (!pref || pref.quietStart === null || pref.quietEnd === null) return false;
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now)) % 24;
  } catch {
    hour = now.getUTCHours();
  }
  return pref.quietStart <= pref.quietEnd ? hour >= pref.quietStart && hour < pref.quietEnd : hour >= pref.quietStart || hour < pref.quietEnd;
}

/** Recipient decision for the recap email (pure; exported for tests). */
export function wantsRecapEmail(pref: { weeklyRecapEmail: boolean; prefs: unknown } | null | undefined): boolean {
  if (!pref) return NOTIFICATION_DEFAULTS.RECAP.email;
  if (pref.weeklyRecapEmail === false) return false;
  const channel = ((pref.prefs ?? {}) as ChannelPrefs).RECAP;
  return channel?.email ?? NOTIFICATION_DEFAULTS.RECAP.email;
}

function recapUrl(content: Pick<RecapContent, "week" | "season">, currentSeason: number): string {
  return content.season === currentSeason ? `/recaps/${content.week}` : `/recaps/${content.week}?season=${content.season}`;
}

/**
 * Email + notify the league for one week's recap. Builds the recap first when it doesn't exist yet (or
 * `rebuild`). Throws RecapError when it was already sent (unless `resend`) or the week isn't final.
 */
export async function sendRecap(leagueId: string, season: number, week: number, opts: SendRecapOptions = {}): Promise<SendRecapResult> {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { id: true, name: true, season: true, settings: true } });
  if (!league) throw new RecapError("League not found.");
  const settings = resolveSettings(league.settings);
  const leagueName = settings.general.leagueName || league.name;

  let recap = await db.weeklyRecap.findUnique({ where: { leagueId_season_week: { leagueId, season, week } } });
  if (recap?.sentAt && !opts.resend) throw new RecapError(`The Week ${week} recap was already sent.`);
  let content: RecapContent;
  if (!recap || opts.rebuild || !isRecapContent(recap.content)) {
    const built = await buildWeeklyRecap(leagueId, season, week);
    content = built.content;
    recap = await db.weeklyRecap.findUniqueOrThrow({ where: { id: built.id } });
  } else {
    content = recap.content as unknown as RecapContent;
  }

  // claim the send (another worker / double click can't send twice)
  const previousSentAt = recap.sentAt;
  const now = new Date();
  const claim = await db.weeklyRecap.updateMany({ where: opts.resend ? { id: recap.id } : { id: recap.id, sentAt: null }, data: { sentAt: now } });
  if (!claim.count) throw new RecapError(`The Week ${week} recap was already sent.`);

  const members = await db.leagueMember.findMany({
    where: { leagueId },
    include: { user: { include: { notificationPrefs: true } } },
  });
  const ownedTeams = await db.team.findMany({ where: { leagueId, ownerId: { in: members.map((m) => m.userId) } }, select: { id: true, ownerId: true } });
  const teamByOwner = new Map(ownedTeams.map((t) => [t.ownerId!, t.id]));

  const result: SendRecapResult = { recapId: recap.id, week, emailed: 0, optedOut: 0, failed: 0, notified: 0, preview: false };
  const title = `${content.weekLabel} recap is live`;
  const url = recapUrl(content, league.season);
  try {
    for (const m of members) {
      const u = m.user;
      const teamId = m.teamId ?? teamByOwner.get(u.id) ?? null;
      if (wantsRecapEmail(u.notificationPrefs)) {
        const email = renderRecapEmail(content, leagueName, { teamId });
        const res = await sendEmail({ to: u.email, subject: email.subject, html: email.html, text: email.text, type: "RECAP", leagueId });
        if (res.ok) result.emailed++;
        else result.failed++;
        if (res.preview) result.preview = true;
      } else {
        result.optedOut++;
      }
      // in-app + push (email handled above, so notify()'s email channel isn't used)
      const channel = { ...NOTIFICATION_DEFAULTS.RECAP, ...(((u.notificationPrefs?.prefs ?? {}) as ChannelPrefs).RECAP ?? {}) };
      if (channel.inApp || channel.push) {
        const n = await db.notification.create({
          data: { userId: u.id, leagueId, type: "RECAP", title, body: content.headline, url, data: { season, week } },
        });
        publish(topics.user(u.id), "notification", n);
        result.notified++;
        if (channel.push && !inQuietHours(u.notificationPrefs, u.timezone)) {
          const sent = await sendPushToUser(u.id, { title, body: content.headline, url, tag: `RECAP-${season}-${week}`, data: { season, week } });
          if (sent) await db.notification.update({ where: { id: n.id }, data: { pushedAt: new Date() } }).catch(() => {});
        }
      }
    }
  } catch (e) {
    if (!result.emailed && !result.notified) await db.weeklyRecap.update({ where: { id: recap.id }, data: { sentAt: previousSentAt } }).catch(() => {});
    throw e;
  }
  publish(topics.league(leagueId), "recap.published", { season, week, headline: content.headline, url });
  return result;
}

/**
 * Background job: for each league with weekly recaps enabled, when the league-local time is on the recap
 * day at/after the recap hour, build + send the most recent completed week once.
 */
export async function runWeeklyRecaps(now = new Date()): Promise<string> {
  const leagues = await db.league.findMany({ select: { id: true, name: true, season: true, settings: true } });
  const out: string[] = [];
  for (const l of leagues) {
    const s = resolveSettings(l.settings);
    if (!s.notifications.weeklyRecapEnabled) continue;
    if (!isRecapDue(now, s.general.timezone || "America/New_York", s.notifications.weeklyRecapDay, s.notifications.weeklyRecapHour)) continue;
    const matchups = await db.matchup.findMany({ where: { leagueId: l.id, season: l.season }, select: { week: true, status: true } });
    const week = latestCompletedWeek(matchups);
    if (!week) continue;
    const existing = await db.weeklyRecap.findUnique({ where: { leagueId_season_week: { leagueId: l.id, season: l.season, week } }, select: { sentAt: true } });
    if (existing?.sentAt) continue;
    try {
      const r = await sendRecap(l.id, l.season, week, { rebuild: true });
      out.push(`${l.name} week ${week}: ${r.emailed} emailed${r.preview ? " (preview)" : ""}, ${r.optedOut} opted out, ${r.notified} notified`);
    } catch (e) {
      out.push(`${l.name} week ${week}: ${(e as Error).message}`);
    }
  }
  return out.length ? out.join("; ") : "no recaps due";
}
