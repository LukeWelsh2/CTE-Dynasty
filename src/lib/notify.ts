// Notification fan-out: in-app (Notification rows + live event), Web Push to phones, optional email / SMS.
//   await notify({ userIds: [...], leagueId, type: "TOUCHDOWN", title, body, url })
import webpush from "web-push";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";
import { sendEmail, emailLayout } from "@/lib/email";

export type NotificationType =
  | "TOUCHDOWN"
  | "TRADE_PROPOSED"
  | "TRADE_ACCEPTED"
  | "TRADE_REJECTED"
  | "TRADE_COMPLETED"
  | "TRADE_VETOED"
  | "TRADE_REVIEW"
  | "TRADE_CANCELLED"
  | "WAIVER_RESULT"
  | "CHAT_MENTION"
  | "CHAT_MESSAGE"
  | "DRAFT_ON_CLOCK"
  | "DRAFT_PICK"
  | "AUCTION_OUTBID"
  | "INJURY"
  | "LINEUP_WARNING"
  | "RECAP"
  | "RULE_PROPOSAL"
  | "KEEPER_DEADLINE"
  | "PLAYOFFS"
  | "COMMISSIONER"
  | "SYSTEM";

/** Defaults for each channel when the user has no explicit preference */
export const NOTIFICATION_DEFAULTS: Record<NotificationType, { push: boolean; email: boolean; inApp: boolean; label: string }> = {
  TOUCHDOWN: { push: true, email: false, inApp: true, label: "Touchdown alerts" },
  TRADE_PROPOSED: { push: true, email: true, inApp: true, label: "Trade offers" },
  TRADE_ACCEPTED: { push: true, email: false, inApp: true, label: "Trade accepted" },
  TRADE_REJECTED: { push: true, email: false, inApp: true, label: "Trade rejected" },
  TRADE_COMPLETED: { push: true, email: false, inApp: true, label: "Trades completed in the league" },
  TRADE_VETOED: { push: true, email: false, inApp: true, label: "Trade vetoed" },
  TRADE_REVIEW: { push: true, email: false, inApp: true, label: "Trades needing review / vote" },
  TRADE_CANCELLED: { push: false, email: false, inApp: true, label: "Trade offers withdrawn, expired or reversed" },
  WAIVER_RESULT: { push: true, email: false, inApp: true, label: "Waiver / FAB results" },
  CHAT_MENTION: { push: true, email: false, inApp: true, label: "@mentions in chat" },
  CHAT_MESSAGE: { push: false, email: false, inApp: false, label: "Every chat message" },
  DRAFT_ON_CLOCK: { push: true, email: true, inApp: true, label: "You're on the clock" },
  DRAFT_PICK: { push: false, email: false, inApp: true, label: "Draft picks made" },
  AUCTION_OUTBID: { push: true, email: false, inApp: true, label: "Outbid in the auction" },
  INJURY: { push: true, email: false, inApp: true, label: "Injury news on your players" },
  LINEUP_WARNING: { push: true, email: false, inApp: true, label: "Lineup warnings (injured / bye starters)" },
  RECAP: { push: true, email: true, inApp: true, label: "Weekly recap" },
  RULE_PROPOSAL: { push: false, email: false, inApp: true, label: "New rule proposals & votes" },
  KEEPER_DEADLINE: { push: true, email: true, inApp: true, label: "Keeper deadline reminders" },
  PLAYOFFS: { push: true, email: false, inApp: true, label: "Playoff bracket, clinches & champion" },
  COMMISSIONER: { push: true, email: true, inApp: true, label: "Commissioner announcements" },
  SYSTEM: { push: false, email: false, inApp: true, label: "System messages" },
};

/** Escape user-provided text (chat previews, proposal titles, comments) before it goes into email HTML. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let vapidReady: boolean | null = null;
function ensureVapid() {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (vapidReady = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  return (vapidReady = true);
}

export function pushEnabled() {
  return ensureVapid();
}

export interface NotifyInput {
  userIds: string[];
  leagueId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
  /** force channels regardless of preferences */
  forceEmail?: boolean;
  emailHtml?: string;
  /**
   * Turn individual channels off for this call (preferences still apply to the rest), e.g.
   * `{ email: false }` when the caller already sends its own personalized email.
   */
  channels?: { inApp?: boolean; push?: boolean; email?: boolean };
}

function inQuietHours(pref: { quietStart: number | null; quietEnd: number | null } | null, tz: string) {
  if (!pref || pref.quietStart === null || pref.quietEnd === null) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date())) % 24;
  return pref.quietStart <= pref.quietEnd ? hour >= pref.quietStart && hour < pref.quietEnd : hour >= pref.quietStart || hour < pref.quietEnd;
}

export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string; data?: unknown }) {
  if (!ensureVapid()) return 0;
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...payload, url: payload.url ?? "/" }),
          { TTL: 60 * 60 },
        );
        sent++;
        await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }),
  );
  return sent;
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return false;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body.slice(0, 300) }),
  }).catch(() => null);
  return !!res?.ok;
}

export async function notify(input: NotifyInput) {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  if (!userIds.length) return;
  const users = await db.user.findMany({ where: { id: { in: userIds } }, include: { notificationPrefs: true } });
  const defaults = NOTIFICATION_DEFAULTS[input.type];
  for (const u of users) {
    const prefs = (u.notificationPrefs?.prefs ?? {}) as Record<string, { push?: boolean; email?: boolean; inApp?: boolean }>;
    const p = { ...defaults, ...(prefs[input.type] ?? {}) };
    if (input.channels?.inApp === false) p.inApp = false;
    if (input.channels?.push === false) p.push = false;
    if (input.channels?.email === false) p.email = false;
    let notification = null;
    if (p.inApp || p.push) {
      notification = await db.notification.create({
        data: {
          userId: u.id,
          leagueId: input.leagueId ?? null,
          type: input.type,
          title: input.title,
          body: input.body,
          url: input.url ?? null,
          data: (input.data ?? undefined) as never,
        },
      });
      publish(topics.user(u.id), "notification", notification);
    }
    if (p.push && !inQuietHours(u.notificationPrefs, u.timezone)) {
      const n = await sendPushToUser(u.id, { title: input.title, body: input.body, url: input.url, tag: input.type, data: input.data });
      if (n && notification) await db.notification.update({ where: { id: notification.id }, data: { pushedAt: new Date() } }).catch(() => {});
      if (!n && u.notificationPrefs?.smsEnabled && u.phone && input.type === "TOUCHDOWN") await sendSms(u.phone, `${input.title}: ${input.body}`);
    }
    if ((p.email || input.forceEmail) && input.channels?.email !== false) {
      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const link = input.url ? `<p><a href="${appUrl}${escapeHtml(input.url)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open in CTE Dynasty</a></p>` : "";
      await sendEmail({
        to: u.email,
        subject: input.title,
        html: input.emailHtml ?? emailLayout(escapeHtml(input.title), `<p style="font-size:15px;line-height:1.5">${escapeHtml(input.body)}</p>${link}`),
        type: input.type === "RECAP" ? "RECAP" : input.type.startsWith("TRADE") ? "TRADE" : "GENERIC",
        leagueId: input.leagueId ?? null,
      });
    }
  }
}

/** All user ids of managers in a league */
export async function leagueUserIds(leagueId: string): Promise<string[]> {
  const members = await db.leagueMember.findMany({ where: { leagueId }, select: { userId: true } });
  return members.map((m) => m.userId);
}

/** User ids that manage a team (owner + co-managers via membership) */
export async function teamUserIds(teamId: string): Promise<string[]> {
  const team = await db.team.findUnique({ where: { id: teamId }, select: { ownerId: true, member: { select: { userId: true } } } });
  return [team?.ownerId, team?.member?.userId].filter((x): x is string => !!x);
}
