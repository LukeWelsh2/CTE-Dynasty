"use client";
// Client-side UI widgets: modal, dropdown, theme toggle, submit buttons, client tabs.
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { Loader2, Moon, Sun, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buttonClass } from "./core";
import { ScrollRow } from "./scroll-row";

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
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  // Phones: a bottom sheet (body scrolls inside, footer pinned above the home indicator). sm+: a centered dialog.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "animate-sheet max-h-sheet flex w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-panel text-ink shadow-pop sm:rounded-xl",
          widths[size],
        )}
      >
        <div className="relative flex shrink-0 items-center justify-between gap-3 border-b border-line py-2 pl-4 pr-2 sm:py-2.5">
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line sm:hidden" />
          <div id={titleId} className="min-w-0 pt-1 font-display text-lg font-bold uppercase leading-tight tracking-wide sm:pt-0">
            {title}
          </div>
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-4", !footer && "pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4")}>{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-sunken/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-3">{footer}</div>
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

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      type="button"
      className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white", className)}
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
  // keep the menu on screen: shift it sideways inside the viewport and open it upward when there is more room
  // above than below (rows near the bottom of a phone screen, above the tab bar)
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const box = ref.current;
    if (!open || !menu || !box) return;
    menu.style.transform = "";
    menu.style.maxHeight = "";
    menu.classList.remove("bottom-full", "mb-1");
    menu.classList.add("mt-1");
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
      menu.classList.remove("mt-1");
      menu.classList.add("bottom-full", "mb-1");
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
            "dropdown-menu absolute z-50 mt-1 min-w-[200px] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel py-1 text-ink shadow-pop",
            align === "right" ? "right-0" : "left-0",
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

export function ClientTabs({ tabs, initial, className }: { tabs: { key: string; label: React.ReactNode; content: React.ReactNode }[]; initial?: string; className?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  return (
    <div className={className}>
      <ScrollRow role="tablist" className="mb-3 gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            onClick={() => setActive(t.key)}
            className={cn(
              "-mb-px min-h-10 shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold sm:min-h-9",
              t.key === active ? "border-gold-500 text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </ScrollRow>
      {tabs.find((t) => t.key === active)?.content}
    </div>
  );
}

/** Toggle switch for forms (renders a hidden checkbox input with name) */
export function Toggle({ name, defaultChecked, label, onChange, checked: controlled }: { name?: string; defaultChecked?: boolean; label?: React.ReactNode; onChange?: (v: boolean) => void; checked?: boolean }) {
  const [inner, setInner] = useState(!!defaultChecked);
  const checked = controlled ?? inner;
  return (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm">
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
      {/* 24×44 on phones (finger-sized), the compact 20×36 switch from sm up */}
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/50 sm:h-5 sm:w-9 sm:after:h-4 sm:after:w-4 sm:peer-checked:after:translate-x-4" />
      {label && <span>{label}</span>}
    </label>
  );
}
