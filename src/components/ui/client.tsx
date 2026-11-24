"use client";
// Client-side UI widgets: modal / sheet, dropdown, theme toggle, submit buttons, client tabs, segmented control,
// switch and the live (tweening) number. Recipes: docs/DESIGN.md.
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { Loader2, Moon, Sun, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buttonClass, SheetGrabber } from "./core";
import { ScrollRow } from "./scroll-row";

/**
 * Dialog. Phones: a bottom sheet with a grabber (body scrolls inside, footer pinned above the home indicator).
 * sm+: a centered dialog. Solid raised surface over a scrim — no glass.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };
  return createPortal(
    <div className="scrim animate-backdrop fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn("animate-sheet max-h-sheet relative flex w-full flex-col overflow-hidden rounded-t-sheet bg-raised text-ink shadow-pop sm:rounded-2xl", widths[size])}
      >
        <SheetGrabber />
        <div className="flex shrink-0 items-center justify-between gap-3 pb-1.5 pl-4 pr-2 pt-4 sm:py-2.5 sm:pl-5">
          <div id={titleId} className="min-w-0 text-[17px] font-semibold leading-snug tracking-[-0.01em]">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink active:scale-95 sm:h-9 sm:w-9"
            aria-label="Close"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/[0.06] dark:bg-white/10">
              <X size={16} strokeWidth={2.4} />
            </span>
          </button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2 sm:px-5", !footer && "pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-5")}>{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line/70 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-3 [&>*]:min-h-11 sm:[&>*]:min-h-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Submit button that shows a spinner while its parent <form action={...}> is pending */
export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  pendingText,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Parameters<typeof buttonClass>[0]; size?: Parameters<typeof buttonClass>[1]; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || rest.disabled} className={buttonClass(variant, size, className)} {...rest}>
      {pending && <Loader2 size={14} className="animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/**
 * Button that runs a server action with optional confirm + toast.
 * action should return { ok: boolean, message?: string, error?: string } or void.
 */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  size = "sm",
  className,
  successMessage,
  onDone,
  disabled,
  title,
}: {
  action: () => Promise<{ ok?: boolean; error?: string; message?: string } | void>;
  children: React.ReactNode;
  confirm?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  className?: string;
  successMessage?: string;
  onDone?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title={title}
      disabled={pending || disabled}
      className={buttonClass(variant, size, className)}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          try {
            const res = await action();
            if (res && res.ok === false) toast.error(res.error ?? "Something went wrong");
            else {
              if (successMessage || (res && res.message)) toast.success((res && res.message) || successMessage!);
              onDone?.();
            }
          } catch (e) {
            toast.error((e as Error).message);
          }
        });
      }}
    >
      {pending && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/** Light / dark switch for the navy top bar (persists in localStorage; applied before paint by the root layout). */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      type="button"
      className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white active:scale-95", className)}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("cte-theme", next ? "dark" : "light");
        } catch {}
      }}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/**
 * Menu anchored to its trigger. Rows: `className={menuItemClass}` (from ./core). A solid raised card that stays
 * inside the viewport and opens upward when there's more room above (rows near the bottom, above the tab bar).
 */
export function Dropdown({
  trigger,
  children,
  align = "left",
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const box = ref.current;
    if (!open || !menu || !box) return;
    menu.style.transform = "";
    menu.style.maxHeight = "";
    menu.classList.remove("bottom-full", "mb-1.5");
    menu.classList.add("mt-1.5");
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const r = menu.getBoundingClientRect();
    let dx = 0;
    if (r.right > vw - 8) dx = vw - 8 - r.right;
    if (r.left + dx < 8) dx = 8 - r.left;
    if (dx) menu.style.transform = `translateX(${Math.round(dx)}px)`;
    const t = box.getBoundingClientRect();
    const bottomBar = vw < 768 ? 72 : 8; // the phone tab bar
    const below = vh - t.bottom - bottomBar;
    const above = t.top - 8;
    if (r.height > below && above > below) {
      menu.classList.remove("mt-1.5");
      menu.classList.add("bottom-full", "mb-1.5");
      if (r.height > above) menu.style.maxHeight = `${Math.floor(above)}px`;
    } else if (r.height > below) {
      menu.style.maxHeight = `${Math.max(160, Math.floor(below))}px`;
    }
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          ref={menuRef}
          className={cn(
            "dropdown-menu raised animate-menu absolute z-50 mt-1.5 min-w-[200px] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain py-1.5 text-ink",
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Tabs switched on the client. `variant="segmented"` renders an iOS segmented control instead of the underline row. */
export function ClientTabs({
  tabs,
  initial,
  className,
  variant = "underline",
  full,
}: {
  tabs: { key: string; label: React.ReactNode; content: React.ReactNode }[];
  initial?: string;
  className?: string;
  variant?: "underline" | "segmented";
  /** segmented only: stretch to the container width */
  full?: boolean;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  return (
    <div className={className}>
      {variant === "segmented" ? (
        <ScrollRow role="tablist" snap={false} className={cn("segmented mb-3", full ? "segmented-full" : "w-fit max-w-full")}>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={t.key === active} onClick={() => setActive(t.key)} className="segmented-item">
              {t.label}
            </button>
          ))}
        </ScrollRow>
      ) : (
        <ScrollRow role="tablist" className="mb-3 gap-1 border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.key === active}
              onClick={() => setActive(t.key)}
              className={cn(
                "relative -mb-px min-h-11 shrink-0 whitespace-nowrap px-3 text-sm font-semibold transition-colors sm:min-h-10",
                t.key === active ? "text-ink after:absolute after:inset-x-2.5 after:bottom-0 after:h-[3px] after:rounded-full after:bg-gold-500" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </ScrollRow>
      )}
      {tabs.find((t) => t.key === active)?.content}
    </div>
  );
}

/** iOS-style segmented control (client state). For URL-driven options use `SegmentedLinks` from ./core. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  full,
  className,
  ariaLabel,
}: {
  options: { value: T; label: React.ReactNode; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  full?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <ScrollRow role="radiogroup" aria-label={ariaLabel} snap={false} className={cn("segmented", full ? "segmented-full" : "w-fit max-w-full", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className="segmented-item disabled:opacity-40"
        >
          {o.label}
        </button>
      ))}
    </ScrollRow>
  );
}

/** iOS switch for forms (renders a visually hidden checkbox with `name`, so it posts like one). */
export function Toggle({ name, defaultChecked, label, onChange, checked: controlled }: { name?: string; defaultChecked?: boolean; label?: React.ReactNode; onChange?: (v: boolean) => void; checked?: boolean }) {
  const [inner, setInner] = useState(!!defaultChecked);
  const checked = controlled ?? inner;
  return (
    <label className="inline-flex min-h-8 cursor-pointer select-none items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        name={name}
        className="peer sr-only"
        checked={checked}
        onChange={(e) => {
          setInner(e.target.checked);
          onChange?.(e.target.checked);
        }}
      />
      {/* 28×48 on phones (finger-sized), 22×38 from sm up; the knob slides on a spring */}
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-ink/[0.14] transition-colors duration-200 ease-out after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow-[0_2px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.04)] after:transition-transform after:duration-200 after:ease-spring peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/50 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 sm:h-[22px] sm:w-[38px] sm:after:h-[18px] sm:after:w-[18px] sm:peer-checked:after:translate-x-4 dark:bg-white/[0.16] dark:peer-checked:bg-brand-500"
      />
      {label && <span>{label}</span>}
    </label>
  );
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * A number that tweens to its new value (700ms) and flashes green / red on change — live scores, win %, projections.
 * Renders tabular figures; style it with classes (`numeral text-[44px] font-semibold`). Respects reduced motion.
 */
export function LiveNumber({
  value,
  decimals = 2,
  className,
  format,
  flash = true,
}: {
  value: number;
  decimals?: number;
  className?: string;
  /** custom formatter for the displayed (tweening) value, e.g. (n) => `${Math.round(n)}%` */
  format?: (n: number) => string;
  /** color flash on change (default on) */
  flash?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<{ d: "up" | "down"; n: number } | null>(null);
  const from = useRef(value);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (flash) setDir((p) => ({ d: value > start ? "up" : "down", n: (p?.n ?? 0) + 1 }));
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (raf.current) cancelAnimationFrame(raf.current);
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 700);
      const v = start + (value - start) * easeOutExpo(t);
      from.current = v;
      setShown(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else {
        from.current = value;
        raf.current = null;
      }
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, flash]);
  const text = format ? format(shown) : shown.toFixed(decimals);
  return (
    <span key={dir?.n ?? 0} className={cn("numeral inline-block", dir && (dir.d === "up" ? "num-up" : "num-down"), className)} aria-live="off">
      {text}
    </span>
  );
}
