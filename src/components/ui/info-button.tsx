"use client";
// ⓘ button that opens a sheet with "how this works" content — the place for explanations, rules and footnotes
// that would otherwise sit as paragraphs in the page flow (docs/DESIGN.md §5 "Words only when necessary").
// Phones: a bottom sheet; sm+: a centered dialog. Self-contained (no imports from ./core or ./client) so the
// server-safe kit (Panel, SectionHeader) can render it without an import cycle.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function InfoButton({
  title,
  children,
  label,
  className,
  size = 16,
}: {
  /** sheet title */
  title: React.ReactNode;
  children: React.ReactNode;
  /** accessible name of the button (defaults to "About <title>") */
  label?: string;
  className?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  const name = label ?? (typeof title === "string" ? `About ${title.toLowerCase()}` : "More info");
  return (
    <>
      <button
        type="button"
        aria-label={name}
        title={name}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          // 32px hit area around a 16px glyph
          "-my-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-ink/[0.05] hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/50 dark:hover:text-brand-400",
          className,
        )}
      >
        <Info size={size} strokeWidth={2} aria-hidden />
      </button>
      {open &&
        mounted &&
        createPortal(
          <div className="scrim animate-backdrop fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="animate-sheet max-h-sheet relative flex w-full flex-col overflow-hidden rounded-t-sheet bg-raised text-ink shadow-pop sm:max-w-md sm:rounded-2xl"
            >
              <span aria-hidden className="absolute left-1/2 top-1.5 h-[5px] w-9 -translate-x-1/2 rounded-full bg-ink/15 sm:hidden dark:bg-white/20" />
              <div className="flex shrink-0 items-center justify-between gap-3 pb-1 pl-5 pr-2 pt-4 sm:pt-3">
                <div id={titleId} className="min-w-0 text-[17px] font-bold leading-snug tracking-[-0.01em]">
                  {title}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/[0.06] dark:bg-white/10">
                    <X size={16} strokeWidth={2.4} />
                  </span>
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 text-[15px] leading-relaxed text-ink/90 sm:pb-5 sm:text-sm">
                {children}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
