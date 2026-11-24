"use client";
// Horizontally scrolling row (tabs, pills, the score ticker): snaps to its children, fades the edge that has
// more content (so phones show the row scrolls) and scrolls the active child into view on mount. It is its
// own module (no imports from ./core) so server components like TabLinks can render it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Fade = "" | "l" | "r" | "lr";

export function ScrollRow({
  as: Tag = "div",
  className,
  children,
  snap = true,
  ...rest
}: {
  as?: "div" | "nav" | "ul";
  className?: string;
  children: React.ReactNode;
  /** snap children to the start edge while scrolling (default on) */
  snap?: boolean;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  const ref = useRef<HTMLElement | null>(null);
  const [fade, setFade] = useState<Fade>("");

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 2;
    const right = max - el.scrollLeft > 2;
    setFade(left && right ? "lr" : left ? "l" : right ? "r" : "");
  }, []);

  // bring the active tab / pill into view (centered) without scrolling the page vertically
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"], [data-active="true"]');
    if (active && el.scrollWidth > el.clientWidth) {
      const s = el.getBoundingClientRect();
      const a = active.getBoundingClientRect();
      if (a.left < s.left || a.right > s.right) el.scrollLeft += a.left - s.left - (s.width - a.width) / 2;
    }
    update();
  }, [update]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [update, children]);

  return (
    <Tag
      ref={ref as never}
      onScroll={update}
      data-fade={fade || undefined}
      className={cn("scroll-thin scroll-fade flex overflow-x-auto overscroll-x-contain", snap && "snap-x snap-proximity [&>*]:snap-start", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
