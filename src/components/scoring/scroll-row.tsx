"use client";
// Horizontal scroller that brings the active item ([aria-current]) into view on mount (week pickers on phones).
import { useEffect, useRef } from "react";

export function ScrollRow({ className, label, children }: { className?: string; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !active) return;
    const target = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2;
    if (target > 0) el.scrollLeft = target;
  }, []);
  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  );
}
