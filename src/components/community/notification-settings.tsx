"use client";
// /settings/notifications — phone alerts on this device, registered devices, test alert, per-type channel
// toggles, touchdown alert scope, quiet hours, weekly recap email and SMS fallback.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, BellRing, CheckCircle2, Laptop, Loader2, Moon, Save, Send, Smartphone, Tablet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Panel, buttonClass } from "@/components/ui/core";
import { Toggle } from "@/components/ui/client";
import { subscribeToPush } from "@/components/layout/push-prompt";
import { removePushDeviceAction, saveNotificationPrefsAction, sendTestNotificationAction } from "@/lib/profiles/actions";
import { NOTIFICATION_HINTS, TD_SCOPES, deviceLabel, groupNotificationTypes, hourLabel, type ChannelPref, type TdScope } from "@/lib/profiles/schema";
import { cn, timeAgo } from "@/lib/utils";

export interface DeviceRow {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface NotificationSettingsProps {
  types: { key: string; label: string; defaults: ChannelPref }[];
  prefs: Record<string, ChannelPref>;
  tdScope: TdScope;
  quietStart: number | null;
  quietEnd: number | null;
  weeklyRecapEmail: boolean;
  smsEnabled: boolean;
  phone: string;
  devices: DeviceRow[];
  serverPush: boolean;
  smsAvailable: boolean;
  leagueRecapsOn: boolean;
  timezone: string;
  isCommish: boolean;
}

type DeviceState = { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | "unsupported"; endpoint: string | null };

function useDeviceState() {
  const [s, setS] = useState<DeviceState | null>(null);
  const refresh = async () => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
    let endpoint: string | null = null;
    if (supported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        endpoint = (await reg?.pushManager.getSubscription())?.endpoint ?? null;
      } catch {
        endpoint = null;
      }
    }
    setS({ supported, ios, standalone, permission: supported ? Notification.permission : "unsupported", endpoint });
  };
  useEffect(() => {
    void refresh();
  }, []);
  return [s, refresh] as const;
}

function DeviceIcon({ kind }: { kind: "phone" | "tablet" | "desktop" }) {
  const I = kind === "phone" ? Smartphone : kind === "tablet" ? Tablet : Laptop;
  return <I size={18} className="shrink-0 text-muted" />;
}

export function NotificationSettings(props: NotificationSettingsProps) {
  const router = useRouter();
  const [device, refreshDevice] = useDeviceState();
  const [enabling, setEnabling] = useState(false);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [removing, setRemoving] = useState<string | null>(null);

  const initial = useMemo(
    () => ({
      prefs: props.prefs,
      tdScope: props.tdScope,
      quietHours: props.quietStart !== null && props.quietEnd !== null,
      quietStart: props.quietStart ?? 23,
      quietEnd: props.quietEnd ?? 8,
      weeklyRecapEmail: props.weeklyRecapEmail,
      smsEnabled: props.smsEnabled,
      phone: props.phone,
    }),
    [props],
  );
  const [v, setV] = useState(initial);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const groups = useMemo(() => groupNotificationTypes(props.types.map((t) => t.key)), [props.types]);
  const typeBy = useMemo(() => new Map(props.types.map((t) => [t.key, t])), [props.types]);

  const setChannel = (type: string, ch: keyof ChannelPref, on: boolean) => setV((p) => ({ ...p, prefs: { ...p.prefs, [type]: { ...p.prefs[type], [ch]: on } } }));
  const setAll = (ch: keyof ChannelPref, on: boolean) => setV((p) => ({ ...p, prefs: Object.fromEntries(Object.entries(p.prefs).map(([k, c]) => [k, { ...c, [ch]: on }])) }));
  const resetDefaults = () => setV((p) => ({ ...p, prefs: Object.fromEntries(props.types.map((t) => [t.key, { ...t.defaults }])) }));
  const allOn = (ch: keyof ChannelPref) => Object.values(v.prefs).every((c) => c[ch]);

  const thisDeviceId = device?.endpoint ? props.devices.find((d) => d.endpoint === device.endpoint)?.id ?? null : null;
  const iosNeedsInstall = !!device?.ios && !device.standalone;

  const enable = async () => {
    setEnabling(true);
    try {
      const ok = await subscribeToPush();
      await refreshDevice();
      if (ok) router.refresh();
    } finally {
      setEnabling(false);
    }
  };

  const remove = async (d: DeviceRow) => {
    setRemoving(d.id);
    try {
      if (d.id === thisDeviceId) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          await (await reg?.pushManager.getSubscription())?.unsubscribe();
        } catch {
          /* the server row is removed either way */
        }
      }
      const res = await removePushDeviceAction(d.id);
      if (!res.ok) toast.error(res.error);
      else toast.success(res.message ?? "Device removed");
      await refreshDevice();
      router.refresh();
    } finally {
      setRemoving(null);
    }
  };

  const save = () =>
    start(async () => {
      const res = await saveNotificationPrefsAction(v);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved");
        router.refresh();
      }
    });

  return (
    <div className="space-y-4 pb-16">
      {/* ── Phone alerts ── */}
      <Panel id="devices" title="Phone alerts" subtitle="Instant push notifications on your phone, tablet or computer">
        {!props.serverPush && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
            {props.isCommish
              ? "Push alerts aren't switched on for this site yet — the server is missing its VAPID keys. Generate them with `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (see the README)."
              : "Phone alerts aren't switched on for this league yet — ask the commissioner to turn them on. Your choices below still apply to in-app and email alerts, and to phone alerts once they're on."}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-lg border border-line p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">This device</div>
            {!device ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Checking…
              </div>
            ) : thisDeviceId ? (
              <div className="mt-2 flex items-start gap-2">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-win" />
                <div>
                  <div className="font-semibold">Alerts are on for this device</div>
                  <p className="text-xs text-muted">You&apos;ll get the alert types switched on under “Push” below.</p>
                </div>
              </div>
            ) : iosNeedsInstall ? (
              <div className="mt-2 flex items-start gap-2">
                <Smartphone size={20} className="mt-0.5 shrink-0 text-brand-600" />
                <div>
                  <div className="font-semibold">Add CTE Dynasty to your Home Screen first</div>
                  <p className="text-xs text-muted">iPhone only allows alerts from installed web apps. Follow the iPhone steps, then open the app from your Home Screen and come back here.</p>
                </div>
              </div>
            ) : !device.supported ? (
              <div className="mt-2 flex items-start gap-2">
                <BellOff size={20} className="mt-0.5 shrink-0 text-muted" />
                <div>
                  <div className="font-semibold">This browser can&apos;t receive push alerts</div>
                  <p className="text-xs text-muted">Try Chrome, Edge, Firefox or Safari 16.4+.</p>
                </div>
              </div>
            ) : device.permission === "denied" ? (
              <div className="mt-2 flex items-start gap-2">
                <BellOff size={20} className="mt-0.5 shrink-0 text-loss" />
                <div>
                  <div className="font-semibold">Notifications are blocked</div>
                  <p className="text-xs text-muted">Allow notifications for this site in your browser or phone settings, then reload this page.</p>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex items-start gap-2">
                <BellRing size={20} className="mt-0.5 shrink-0 text-gold-500" />
                <div>
                  <div className="font-semibold">Alerts are off on this device</div>
                  <p className="text-xs text-muted">Turn them on to get touchdown alerts, trade offers and draft clock pings.</p>
                </div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!thisDeviceId && (
                <Button size="sm" onClick={enable} disabled={enabling || !props.serverPush || !device?.supported || device.permission === "denied" || iosNeedsInstall}>
                  {enabling ? <Loader2 size={14} className="animate-spin" /> : <BellRing size={14} />} Enable alerts on this device
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={testing || !props.devices.length || !props.serverPush}
                onClick={() =>
                  startTest(async () => {
                    const res = await sendTestNotificationAction();
                    if (!res.ok) toast.error(res.error);
                    else toast.success(res.message ?? "Test alert sent");
                    router.refresh();
                  })
                }
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send test notification
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted">My devices</span>
              <Badge>{props.devices.length}</Badge>
            </div>
            {props.devices.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted">No devices yet. Enable alerts on each phone or computer you want pinged.</p>
            ) : (
              <ul className="divide-y divide-line">
                {props.devices.map((d) => {
                  const l = deviceLabel(d.userAgent);
                  const mine = d.id === thisDeviceId;
                  return (
                    <li key={d.id} className="flex items-center gap-2.5 px-3 py-2">
                      <DeviceIcon kind={l.icon} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">
                            {l.device} · {l.browser}
                          </span>
                          {mine && <Badge tone="green">This device</Badge>}
                        </div>
                        <div className="text-[11px] text-muted">
                          Added {timeAgo(d.createdAt)}
                          {d.lastUsedAt ? ` · last alert ${timeAgo(d.lastUsedAt)}` : " · no alerts sent yet"}
                        </div>
                      </div>
                      <button type="button" onClick={() => remove(d)} disabled={removing === d.id} className={buttonClass("ghost", "xs", "text-loss")} aria-label={`Remove ${l.device}`}>
                        {removing === d.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <details className="group mt-3 rounded-lg border border-line bg-sunken/40" open={iosNeedsInstall || undefined}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold">How to set up alerts on iPhone, Android and desktop</summary>
          <div className="grid gap-4 px-3 pb-3 pt-1 text-sm md:grid-cols-3">
            <div>
              <div className="mb-1 font-bold">iPhone / iPad (iOS 16.4 or newer)</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Open this site in <b className="text-ink">Safari</b>.</li>
                <li>
                  Tap the <b className="text-ink">Share</b> button (square with an arrow), then <b className="text-ink">Add to Home Screen</b> → <b className="text-ink">Add</b>.
                </li>
                <li>Open <b className="text-ink">CTE Dynasty</b> from the new Home Screen icon and sign in.</li>
                <li>
                  Come back to <b className="text-ink">Notifications &amp; Phone Alerts</b> and tap <b className="text-ink">Enable alerts on this device</b>, then <b className="text-ink">Allow</b>.
                </li>
                <li>Tap “Send test notification” to make sure it works. Focus modes can silence alerts — allow CTE Dynasty in Settings › Focus.</li>
              </ol>
            </div>
            <div>
              <div className="mb-1 font-bold">Android</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Open this site in Chrome (or Edge / Samsung Internet).</li>
                <li>
                  Tap <b className="text-ink">Enable alerts on this device</b> and choose <b className="text-ink">Allow</b>.
                </li>
                <li>Optional: menu ⋮ → <b className="text-ink">Install app</b> / Add to Home screen for a full-screen app.</li>
                <li>If nothing arrives, check Settings › Apps › Chrome › Notifications.</li>
              </ol>
            </div>
            <div>
              <div className="mb-1 font-bold">Desktop</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Chrome, Edge, Firefox and Safari (macOS 13+) all work.</li>
                <li>
                  Click <b className="text-ink">Enable alerts on this device</b> and allow notifications when asked.
                </li>
                <li>Alerts arrive while the browser is running, even with the tab closed.</li>
                <li>Turn alerts on separately on each device you use.</li>
              </ol>
            </div>
          </div>
        </details>
      </Panel>

      {/* ── TD scope ── */}
      <Panel title="Touchdown alerts" subtitle="Which touchdowns ping you during games">
        <div role="radiogroup" aria-label="Touchdown alert scope" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {TD_SCOPES.map((s) => {
            const on = v.tdScope === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setV((p) => ({ ...p, tdScope: s.value }))}
                className={cn("rounded-lg border p-2.5 text-left transition-colors", on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:bg-brand-900/30" : "border-line hover:bg-sunken")}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", on ? "border-brand-600" : "border-line")}>{on && <span className="h-2 w-2 rounded-full bg-brand-600" />}</span>
                  {s.label}
                </div>
                <div className="mt-0.5 pl-6 text-xs text-muted">{s.hint}</div>
              </button>
            );
          })}
        </div>
        {v.tdScope !== "OFF" && !v.prefs.TOUCHDOWN?.push && !v.prefs.TOUCHDOWN?.inApp && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Touchdown alerts are switched off for every channel in the table below, so you won&apos;t get them.</p>
        )}
      </Panel>

      {/* ── per type ── */}
      <Panel
        title="Alert types"
        subtitle="Choose how you hear about each kind of league event"
        noPad
        actions={
          <button type="button" onClick={resetDefaults} className={buttonClass("ghost", "xs")}>
            Reset to defaults
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="tbl w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left">Alert</th>
                {(["push", "email", "inApp"] as const).map((ch) => (
                  <th key={ch} className="w-[52px] !px-1 !text-center sm:w-24">
                    <div>{ch === "push" ? "Push" : ch === "email" ? "Email" : "In-app"}</div>
                    <button type="button" className="text-[10px] font-semibold normal-case text-brand-600 hover:underline dark:text-brand-300" onClick={() => setAll(ch, !allOn(ch))}>
                      {allOn(ch) ? "none" : "all"}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr>
                  <td colSpan={4} className="bg-sunken/70 text-[11px] font-bold uppercase tracking-wide text-muted">
                    {g.label}
                  </td>
                </tr>
                {g.types.map((t) => {
                  const meta = typeBy.get(t)!;
                  const c = v.prefs[t] ?? meta.defaults;
                  return (
                    <tr key={t}>
                      <td>
                        <div className="font-semibold">{meta.label}</div>
                        {NOTIFICATION_HINTS[t] && <div className="text-[11px] text-muted">{NOTIFICATION_HINTS[t]}</div>}
                      </td>
                      {(["push", "email", "inApp"] as const).map((ch) => (
                        <td key={ch} className="!px-1 text-center">
                          <span className="inline-flex">
                            <Toggle checked={c[ch]} onChange={(on) => setChannel(t, ch, on)} label={<span className="sr-only">{`${meta.label} — ${ch === "inApp" ? "in-app" : ch}`}</span>} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Quiet hours" subtitle={`Push alerts pause overnight (${props.timezone.replace(/_/g, " ")})`}>
          <Toggle checked={v.quietHours} onChange={(on) => setV((p) => ({ ...p, quietHours: on }))} label={<span className="font-semibold">Pause push alerts during quiet hours</span>} />
          <div className={cn("mt-3 grid grid-cols-2 gap-2", !v.quietHours && "pointer-events-none opacity-50")}>
            <label className="block">
              <span className="label">From</span>
              <select className="input" value={v.quietStart} onChange={(e) => setV((p) => ({ ...p, quietStart: Number(e.target.value) }))} disabled={!v.quietHours}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Until</span>
              <select className="input" value={v.quietEnd} onChange={(e) => setV((p) => ({ ...p, quietEnd: Number(e.target.value) }))} disabled={!v.quietHours}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
            <Moon size={13} className="mt-px shrink-0" /> Alerts still land in your notification inbox. Change your time zone on the Profile tab.
          </p>
        </Panel>

        <Panel title="Weekly recap email">
          <Toggle checked={v.weeklyRecapEmail} onChange={(on) => setV((p) => ({ ...p, weeklyRecapEmail: on }))} label={<span className="font-semibold">Email me the weekly league recap</span>} />
          <p className="mt-2 text-xs text-muted">
            {props.leagueRecapsOn
              ? "Awards, blowouts, bench blunders and next week's previews, sent after each week wraps up."
              : "The commissioner has turned off weekly recaps for this league, so none will be sent until they're switched back on."}
          </p>
        </Panel>

        <Panel title="Text message fallback">
          <Toggle checked={v.smsEnabled} onChange={(on) => setV((p) => ({ ...p, smsEnabled: on }))} label={<span className="font-semibold">Text me touchdown alerts if push fails</span>} />
          <label className={cn("mt-3 block", !v.smsEnabled && "opacity-60")}>
            <span className="label">Mobile number</span>
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV((p) => ({ ...p, phone: e.target.value }))} placeholder="(555) 123-4567" />
          </label>
          <p className="mt-2 text-xs text-muted">
            {props.smsAvailable ? "Used only when none of your devices could be reached. Standard message rates apply." : "Text messages aren't configured on this server (no SMS provider), so this only takes effect once the commissioner adds one."}
          </p>
        </Panel>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-30 px-3 md:bottom-4" aria-live="polite">
        <div
          className={cn(
            "mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-pop transition-all",
            dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
          )}
        >
          <span className="flex-1 text-sm font-semibold">You have unsaved changes</span>
          <Button size="sm" variant="ghost" onClick={() => setV(initial)} disabled={pending}>
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
