"use client";
// Registers the service worker and offers to enable phone push notifications (TD alerts etc).
import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast.error("This browser doesn't support push. On iPhone, add CTE Dynasty to your Home Screen first (Share → Add to Home Screen).");
    return false;
  }
  const keyRes = await fetch("/api/push/key").then((r) => r.json()).catch(() => null);
  if (!keyRes?.publicKey) {
    toast.error("Push notifications are not configured on the server yet (VAPID keys missing).");
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    toast.error("Notifications were blocked. Enable them in your browser/phone settings.");
    return false;
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey) }));
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (res.ok) toast.success("Phone alerts enabled! You'll get touchdown alerts and league updates.");
  return res.ok;
}

export function PushPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      if (localStorage.getItem("cte-push-dismissed")) return;
    } catch {}
    if (typeof Notification !== "undefined" && Notification.permission === "default") setShow(true);
  }, []);
  if (!show) return null;
  return (
    <div className="border-b border-gold-500/40 bg-gold-300/20">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-3 py-2 text-sm">
        <BellRing size={16} className="shrink-0 text-gold-600" />
        <span className="flex-1">Get a phone alert the moment one of your players scores a touchdown.</span>
        <button
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-800"
          onClick={async () => {
            if (await subscribeToPush()) setShow(false);
          }}
        >
          Enable alerts
        </button>
        <button
          aria-label="Dismiss"
          className="text-muted hover:text-ink"
          onClick={() => {
            setShow(false);
            try {
              localStorage.setItem("cte-push-dismissed", "1");
            } catch {}
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
