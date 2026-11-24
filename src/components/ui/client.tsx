"use client";
// Client-side UI widgets: modal, dropdown, theme toggle, submit buttons, client tabs.
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { Loader2, Moon, Sun, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buttonClass } from "./core";

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
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn("flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-xl border border-line bg-panel shadow-pop sm:rounded-xl", widths[size])}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div id={titleId} className="font-display text-lg font-bold uppercase tracking-wide">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-sunken/60 px-4 py-3">{footer}</div>}
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
      className={cn("rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white", className)}
      aria-label="Toggle dark mode"
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
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn("absolute z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-line bg-panel py-1 text-ink shadow-pop", align === "right" ? "right-0" : "left-0", className)}
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
      <div className="scroll-thin mb-3 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold", t.key === active ? "border-gold-500 text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.find((t) => t.key === active)?.content}
    </div>
  );
}

/** Toggle switch for forms (renders a hidden checkbox input with name) */
export function Toggle({ name, defaultChecked, label, onChange, checked: controlled }: { name?: string; defaultChecked?: boolean; label?: React.ReactNode; onChange?: (v: boolean) => void; checked?: boolean }) {
  const [inner, setInner] = useState(!!defaultChecked);
  const checked = controlled ?? inner;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
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
      <span className="relative h-5 w-9 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-600 peer-checked:after:translate-x-4" />
      {label && <span>{label}</span>}
    </label>
  );
}
