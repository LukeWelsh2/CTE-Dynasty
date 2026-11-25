"use client";
// /settings/notifications — phone alerts on this device, registered devices, test alert, per-type channel
// toggles, touchdown alert scope, quiet hours, weekly recap email and SMS fallback.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, BellRing, CheckCircle2, ChevronDown, Laptop, Loader2, Moon, Save, Send, Smartphone, Tablet, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Panel, SummaryStrip, buttonClass } from "@/components/ui/core";
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

function StatusLine({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-5 sm:text-sm">{title}</div>
        <p className="mt-0.5 max-w-[60ch] text-[13px] text-muted">{sub}</p>
      </div>
    </div>
  );
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

  const CHANNELS = ["push", "email", "inApp"] as const;
  const chLabel = (ch: (typeof CHANNELS)[number]) => (ch === "push" ? "Push" : ch === "email" ? "Email" : "In-app");
  const pushOn = Object.values(v.prefs).filter((c) => c.push).length;
  const deviceStatus = !device ? "…" : thisDeviceId ? "On" : iosNeedsInstall ? "Install" : !device.supported ? "N/A" : device.permission === "denied" ? "Blocked" : "Off";

  return (
    <div className="space-y-4 pb-20">
      <SummaryStrip
        items={[
          { label: "Device", value: deviceStatus, tone: thisDeviceId ? "good" : device?.permission === "denied" ? "bad" : undefined, sub: `${props.devices.length} registered`, title: "Phone alerts on this device" },
          { label: "Push", value: `${pushOn}/${props.types.length}`, sub: "alert types" },
          { label: "Quiet", value: v.quietHours ? hourLabel(v.quietStart).replace(":00", "") : "Off", sub: v.quietHours ? `to ${hourLabel(v.quietEnd).replace(":00", "")}` : "hours" },
        ]}
      />

      {/* ── Phone alerts ── */}
      <Panel id="devices" title="Phone alerts" subtitle="Push notifications on your phone or computer" noPad>
        {!props.serverPush && (
          <div className="mx-4 mb-3 rounded-control bg-amber-400/15 px-3 py-2 text-[13px] text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
            {props.isCommish
              ? "Push alerts aren't switched on for this site yet — the server is missing its VAPID keys. Generate them with `npx web-push generate-vapid-keys` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (see the README)."
              : "Phone alerts aren't switched on for this league yet — ask the commissioner. Your choices below still apply to in-app and email alerts, and to phone alerts once they're on."}
          </div>
        )}

        <div className="border-t border-line/70 px-4 py-3">
          <h3 className="eyebrow mb-2">This device</h3>
          {!device ? (
            <div className="flex items-center gap-2 text-[15px] text-muted sm:text-sm">
              <Loader2 size={15} className="animate-spin" /> Checking…
            </div>
          ) : thisDeviceId ? (
            <StatusLine icon={<CheckCircle2 size={20} className="text-win" />} title="Alerts are on for this device" sub="You get the alert types switched on under “Push” below." />
          ) : iosNeedsInstall ? (
            <StatusLine
              icon={<Smartphone size={20} className="text-brand-600 dark:text-brand-400" />}
              title="Add CTE Dynasty to your Home Screen first"
              sub="iPhone only allows alerts from installed web apps. Follow the iPhone steps below, open the app from your Home Screen, then come back here."
            />
          ) : !device.supported ? (
            <StatusLine icon={<BellOff size={20} className="text-muted" />} title="This browser can't receive push alerts" sub="Try Chrome, Edge, Firefox or Safari 16.4+." />
          ) : device.permission === "denied" ? (
            <StatusLine icon={<BellOff size={20} className="text-loss" />} title="Notifications are blocked" sub="Allow notifications for this site in your browser or phone settings, then reload this page." />
          ) : (
            <StatusLine icon={<BellRing size={20} className="text-brand-600 dark:text-brand-400" />} title="Alerts are off on this device" sub="Turn them on for touchdown alerts, trade offers and draft clock pings." />
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {!thisDeviceId && (
              <Button size="md" onClick={enable} disabled={enabling || !props.serverPush || !device?.supported || device.permission === "denied" || iosNeedsInstall}>
                {enabling ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />} Enable alerts on this device
              </Button>
            )}
            <Button
              size="md"
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
              {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send a test alert
            </Button>
          </div>
        </div>

        <div className="border-t border-line/70">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <h3 className="eyebrow">My devices</h3>
            <span className="numeral text-[13px] font-semibold text-muted">{props.devices.length}</span>
          </div>
          {props.devices.length === 0 ? (
            <p className="px-4 pb-3 text-[15px] text-muted sm:text-sm">No devices yet. Enable alerts on each phone or computer you want pinged.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {props.devices.map((d) => {
                const l = deviceLabel(d.userAgent);
                const mine = d.id === thisDeviceId;
                return (
                  <li key={d.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                    <DeviceIcon kind={l.icon} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold sm:text-sm">
                        <span className="truncate">
                          {l.device} · {l.browser}
                        </span>
                        {mine && <Badge tone="green">This device</Badge>}
                      </div>
                      <div className="truncate text-[13px] text-muted">
                        Added {timeAgo(d.createdAt)}
                        {d.lastUsedAt ? ` · last alert ${timeAgo(d.lastUsedAt)}` : " · no alerts yet"}
                      </div>
                    </div>
                    <button type="button" onClick={() => remove(d)} disabled={removing === d.id} className={buttonClass("ghost", "sm", "text-loss")} aria-label={`Remove ${l.device} · ${l.browser}`}>
                      {removing === d.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <details className="group/how border-t border-line/70" open={iosNeedsInstall || undefined}>
          <summary className="flex min-h-12 cursor-pointer select-none list-none items-center gap-3 px-4 text-[15px] font-semibold text-ink hover:bg-sunken/70 sm:text-sm [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1 truncate">How to set up alerts</span>
            <span className="hidden shrink-0 text-[13px] font-medium text-muted sm:inline">iPhone · Android · desktop</span>
            <ChevronDown size={18} className="shrink-0 text-faint transition-transform duration-200 group-open/how:rotate-180" aria-hidden />
          </summary>
          <div className="grid gap-4 px-4 pb-4 pt-1 text-[15px] sm:text-sm md:grid-cols-3">
            <div>
              <div className="mb-1 font-semibold">iPhone / iPad (iOS 16.4+)</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Open this site in <b className="text-ink">Safari</b>.</li>
                <li>
                  Tap <b className="text-ink">Share</b> (the square with an arrow), then <b className="text-ink">Add to Home Screen</b> → <b className="text-ink">Add</b>.
                </li>
                <li>Open <b className="text-ink">CTE Dynasty</b> from the new Home Screen icon and sign in.</li>
                <li>
                  Come back here and tap <b className="text-ink">Enable alerts on this device</b>, then <b className="text-ink">Allow</b>.
                </li>
                <li>Tap “Send a test alert” to check. Focus modes can silence alerts — allow CTE Dynasty in Settings › Focus.</li>
              </ol>
            </div>
            <div>
              <div className="mb-1 font-semibold">Android</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Open this site in Chrome (or Edge / Samsung Internet).</li>
                <li>
                  Tap <b className="text-ink">Enable alerts on this device</b> and choose <b className="text-ink">Allow</b>.
                </li>
                <li>Optional: menu ⋮ → <b className="text-ink">Install app</b> for a full-screen app.</li>
                <li>If nothing arrives, check Settings › Apps › Chrome › Notifications.</li>
              </ol>
            </div>
            <div>
              <div className="mb-1 font-semibold">Desktop</div>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Chrome, Edge, Firefox and Safari (macOS 13+) all work.</li>
                <li>
                  Click <b className="text-ink">Enable alerts on this device</b> and allow notifications.
                </li>
                <li>Alerts arrive while the browser is running, even with the tab closed.</li>
                <li>Turn alerts on separately on each device you use.</li>
              </ol>
            </div>
          </div>
        </details>
      </Panel>

      {/* ── TD scope ── */}
      <Panel title="Touchdown alerts" subtitle="Which touchdowns ping you during games" noPad>
        <div role="radiogroup" aria-label="Touchdown alert scope" className="divide-y divide-line/70 border-t border-line/70">
          {TD_SCOPES.map((sc) => {
            const on = v.tdScope === sc.value;
            return (
              <button
                key={sc.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setV((p) => ({ ...p, tdScope: sc.value }))}
                className={cn("flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-sunken/70", on && "bg-brand-600/[0.05] dark:bg-brand-400/10")}
              >
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-brand-600 dark:border-brand-400" : "border-ink/25 dark:border-white/30")}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-brand-600 dark:bg-brand-400" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[15px] font-semibold leading-5 sm:text-sm", on && "text-brand-600 dark:text-brand-400")}>{sc.label}</span>
                  <span className="block text-[13px] leading-[18px] text-muted">{sc.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {v.tdScope !== "OFF" && !v.prefs.TOUCHDOWN?.push && !v.prefs.TOUCHDOWN?.inApp && (
          <p className="border-t border-line/70 px-4 py-3 text-[13px] text-amber-800 dark:text-amber-300">Touchdown alerts are off for every channel under “Game day” below, so you won&apos;t get them.</p>
        )}
      </Panel>

      {/* ── per type ── */}
      <Panel
        title="Alert types"
        subtitle="How you hear about each kind of event"
        noPad
        actions={
          <button type="button" onClick={resetDefaults} className={buttonClass("plain", "sm")}>
            Reset
          </button>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,52px)] items-center border-t border-line/70 bg-sunken/60 py-1.5 pl-4 pr-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,72px)]">
          <span className="eyebrow">Every alert</span>
          {CHANNELS.map((ch) => (
            <div key={ch} className="flex flex-col items-center">
              <span className="eyebrow">{chLabel(ch)}</span>
              <button
                type="button"
                className="min-h-7 rounded-md px-1.5 text-[12px] font-semibold text-brand-600 hover:bg-brand-600/[0.08] dark:text-brand-400"
                onClick={() => setAll(ch, !allOn(ch))}
                aria-label={`${allOn(ch) ? "Turn off" : "Turn on"} ${chLabel(ch)} for every alert`}
              >
                {allOn(ch) ? "None" : "All"}
              </button>
            </div>
          ))}
        </div>
        {groups.map((g, gi) => {
          const on = (ch: (typeof CHANNELS)[number]) => g.types.filter((t) => (v.prefs[t] ?? typeBy.get(t)!.defaults)[ch]).length;
          return (
            <details key={g.key} className="group/grp border-t border-line/70" open={gi === 0 || undefined}>
              <summary className="flex min-h-12 cursor-pointer select-none list-none items-center gap-3 px-4 text-[15px] font-semibold hover:bg-sunken/70 sm:text-sm [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                <span className="numeral shrink-0 text-[13px] font-medium text-muted">
                  Push {on("push")}/{g.types.length}
                </span>
                <ChevronDown size={18} className="shrink-0 text-faint transition-transform duration-200 group-open/grp:rotate-180" aria-hidden />
              </summary>
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {g.types.map((t) => {
                  const meta = typeBy.get(t)!;
                  const c = v.prefs[t] ?? meta.defaults;
                  return (
                    <li key={t} className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_repeat(3,52px)] items-center py-2 pl-4 pr-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,72px)]">
                      <span className="min-w-0 pr-2">
                        <span className="block text-[15px] font-semibold leading-5 sm:text-sm">{meta.label}</span>
                        {NOTIFICATION_HINTS[t] && <span className="block text-[12px] leading-4 text-muted">{NOTIFICATION_HINTS[t]}</span>}
                      </span>
                      {CHANNELS.map((ch) => (
                        <span key={ch} className="flex justify-center">
                          <Toggle checked={c[ch]} onChange={(next) => setChannel(t, ch, next)} label={<span className="sr-only">{`${meta.label} — ${chLabel(ch)}`}</span>} />
                        </span>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Quiet hours" info={<p>Push alerts pause overnight in your time zone ({props.timezone.replace(/_/g, " ")}). They still land in your notification inbox. Change your time zone on the Profile tab.</p>}>
          <Toggle checked={v.quietHours} onChange={(on) => setV((p) => ({ ...p, quietHours: on }))} label={<span className="text-[15px] font-semibold sm:text-sm">Pause push alerts overnight</span>} />
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
          <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
            <Moon size={14} className="shrink-0" aria-hidden /> {props.timezone.replace(/_/g, " ")}
          </p>
        </Panel>

        <Panel title="Weekly recap email">
          <Toggle checked={v.weeklyRecapEmail} onChange={(on) => setV((p) => ({ ...p, weeklyRecapEmail: on }))} label={<span className="text-[15px] font-semibold sm:text-sm">Email me the weekly recap</span>} />
          <p className="mt-2 text-[13px] text-muted">
            {props.leagueRecapsOn ? "Awards, blowouts, bench blunders and previews after each week." : "The commissioner has turned weekly recaps off, so none are sent right now."}
          </p>
        </Panel>

        <Panel title="Text message fallback">
          <Toggle checked={v.smsEnabled} onChange={(on) => setV((p) => ({ ...p, smsEnabled: on }))} label={<span className="text-[15px] font-semibold sm:text-sm">Text me touchdowns if push fails</span>} />
          <label className={cn("mt-3 block", !v.smsEnabled && "opacity-60")}>
            <span className="label">Mobile number</span>
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV((p) => ({ ...p, phone: e.target.value }))} placeholder="(555) 123-4567" />
          </label>
          <p className="mt-2 text-[13px] text-muted">
            {props.smsAvailable ? "Only when none of your devices could be reached. Message rates apply." : "Texts aren't configured on this server yet (no SMS provider)."}
          </p>
        </Panel>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 px-3 md:bottom-4" aria-live="polite">
        <div
          className={cn(
            "mx-auto flex max-w-xl items-center gap-2 rounded-2xl bg-raised px-3 py-2 shadow-pop ring-1 ring-line/70 transition-all",
            dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold sm:text-sm">Unsaved changes</span>
          <Button size="md" variant="ghost" onClick={() => setV(initial)} disabled={pending}>
            Discard
          </Button>
          <Button size="md" onClick={save} disabled={pending}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
