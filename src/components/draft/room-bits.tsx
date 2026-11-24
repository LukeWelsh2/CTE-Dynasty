"use client";
// Pieces shared by the live rookie draft room and the auction room (client): the room title block, the compact fixed
// clock bar that appears once the big clock card scrolls away, position filter chips and the phone tab switch.
import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { InfoButton } from "@/components/ui/info-button";
import { chipClass } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./bits";

/** Room title: eyebrow + name + status, ONE grey line of facts (+ ⓘ with the rules), live-connection dot, actions. */
export function RoomHeader({
  eyebrow,
  name,
  status,
  facts,
  info,
  connected,
  actions,
}: {
  eyebrow: string;
  name: string;
  status: string;
  facts: string;
  info?: React.ReactNode;
  connected: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <div className="eyebrow mb-1 flex items-center gap-2">
          {eyebrow}
          <span className={cn("inline-flex items-center gap-1 normal-case tracking-normal", connected ? "text-win" : "text-loss")} title={connected ? "Live updates connected" : "Reconnecting…"}>
            {connected ? <Wifi size={13} aria-hidden /> : <WifiOff size={13} aria-hidden />} {connected ? "Live" : "Offline"}
          </span>
        </div>
        <h1 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[24px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[28px]">
          <span className="min-w-0 break-words">{name}</span> <StatusBadge status={status} />
        </h1>
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[13px] text-muted">
          <span className="min-w-0 truncate">{facts}</span>
          {info && (
            <InfoButton title="Room rules">
              {info}
            </InfoButton>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** True once `ref`'s element has scrolled above the top of the viewport (for the compact fixed clock bar). */
export function useScrolledPast<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, past };
}

/** Compact clock bar pinned to the top of the screen while the big clock card is out of view. */
export function FixedClockBar({ show, children, tone, onTap, label }: { show: boolean; children: React.ReactNode; tone?: "mine" | "urgent"; onTap?: () => void; label: string }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)]">
      <button
        type="button"
        onClick={onTap}
        aria-label={label}
        className={cn(
          "bar-top pointer-events-auto mx-auto flex h-12 w-full max-w-[1400px] animate-rise items-center gap-2.5 bg-chrome px-3 text-left sm:px-4",
          tone === "mine" && "shadow-[inset_0_-2px_0_rgb(var(--c-accent)),0_1px_0_rgb(var(--c-line))]",
          tone === "urgent" && "shadow-[inset_0_-2px_0_rgb(var(--c-live)),0_1px_0_rgb(var(--c-line))]",
        )}
      >
        {children}
      </button>
    </div>
  );
}

/** Position filter chips in a sideways-scrolling row (40px on phones). */
export function PosChips({ positions, value, onChange, label = "Filter by position" }: { positions: string[]; value: string; onChange: (p: string) => void; label?: string }) {
  return (
    <ScrollRow role="group" aria-label={label} className="-mx-3 gap-2 px-3 sm:mx-0 sm:px-0">
      {["ALL", ...positions].map((p) => (
        <button key={p} type="button" aria-pressed={value === p} data-active={value === p || undefined} onClick={() => onChange(p)} className={chipClass(value === p, "md")}>
          {p === "ALL" ? "All" : p}
        </button>
      ))}
    </ScrollRow>
  );
}

/** Phone tab switch (segmented, full width). Items with `mobileOnly` hide from lg, where they sit in the side rail. */
export function RoomTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: React.ReactNode; mobileOnly?: boolean }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" aria-label="Room views" className="segmented segmented-full">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn("segmented-item !px-2", t.mobileOnly && "lg:!hidden")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
