// /settings/notifications — phone alerts, devices, per-type channels, TD scope, quiet hours, recap email, SMS.
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { NOTIFICATION_DEFAULTS, pushEnabled, type NotificationType } from "@/lib/notify";
import { resolvePrefs, TD_SCOPES, type TdScope } from "@/lib/profiles/schema";
import { PageHeader } from "@/components/ui/core";
import { SettingsTabs } from "@/components/community/settings-tabs";
import { NotificationSettings } from "@/components/community/notification-settings";

export const metadata: Metadata = { title: "Notifications & Phone Alerts" };
export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const ctx = await getLeagueContext();
  const [user, pref, devices] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { phone: true, timezone: true } }),
    db.notificationPreference.findUnique({ where: { userId: ctx.user.id } }),
    db.pushSubscription.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const prefs = resolvePrefs(NOTIFICATION_DEFAULTS, pref?.prefs);
  const types = (Object.keys(NOTIFICATION_DEFAULTS) as NotificationType[]).map((k) => {
    const { label, ...defaults } = NOTIFICATION_DEFAULTS[k];
    return { key: k, label, defaults };
  });
  const scopes = TD_SCOPES.map((s) => s.value as string);
  const tdScope = (pref && scopes.includes(pref.tdScope) ? pref.tdScope : ctx.settings.notifications.touchdownAlertsDefault) as TdScope;
  const smsAvailable = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);

  return (
    <div className="mx-auto max-w-4xl">
      <SettingsTabs active="notifications" userId={ctx.user.id} />
      <PageHeader kicker="Account settings" title="Alert settings" subtitle="Phone, email and in-app alerts" />
      <NotificationSettings
        key={pref?.updatedAt.getTime() ?? 0}
        types={types}
        prefs={prefs}
        tdScope={tdScope}
        quietStart={pref?.quietStart ?? null}
        quietEnd={pref?.quietEnd ?? null}
        weeklyRecapEmail={pref?.weeklyRecapEmail ?? true}
        smsEnabled={pref?.smsEnabled ?? false}
        phone={user.phone ?? ""}
        devices={devices.map((d) => ({ id: d.id, endpoint: d.endpoint, userAgent: d.userAgent, createdAt: d.createdAt.toISOString(), lastUsedAt: d.lastUsedAt?.toISOString() ?? null }))}
        serverPush={pushEnabled()}
        smsAvailable={smsAvailable}
        leagueRecapsOn={ctx.settings.notifications.weeklyRecapEnabled}
        timezone={user.timezone}
        isCommish={ctx.isCommish}
      />
    </div>
  );
}
