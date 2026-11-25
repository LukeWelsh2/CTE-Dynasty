"use client";
// Keeper designation toggle (saves immediately) and the "clear all" button. The toggle is a 44px tap target holding a
// 24px check circle (blue when kept); the real checkbox stays in the DOM for keyboard and screen readers.
import { useOptimistic, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clearKeepersAction, setKeeperAction } from "@/lib/keepers/actions";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function KeeperToggle({ teamId, playerId, playerName, checked, disabled, title }: { teamId: string; playerId: string; playerName: string; checked: boolean; disabled?: boolean; title?: string }) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(checked);
  const off = disabled || pending;
  return (
    <label className={cn("relative -m-2.5 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full", off && "cursor-not-allowed")} title={title ?? (optimistic ? "Kept" : "Keep")}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={optimistic}
        disabled={off}
        aria-label={`Keep ${playerName}`}
        onChange={(e) => {
          const keep = e.target.checked;
          start(async () => {
            setOptimistic(keep);
            try {
              const r = await setKeeperAction({ teamId, playerId, keep });
              if (!r.ok) toast.error(r.error);
              else if (r.message) toast.success(r.message);
            } catch (err) {
              toast.error((err as Error).message);
            }
          });
        }}
      />
      <span
        aria-hidden
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-panel",
          optimistic ? "bg-brand-600 text-white" : "shadow-[inset_0_0_0_1.5px_rgb(var(--c-ink)/0.25)]",
          disabled && "opacity-40",
        )}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : optimistic ? <Check size={14} strokeWidth={3} /> : null}
      </span>
    </label>
  );
}

export function ClearKeepersButton({ teamId, disabled }: { teamId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      className={buttonClass("plain", "md")}
      onClick={() => {
        if (!window.confirm("Remove every keeper designation for this team?")) return;
        start(async () => {
          const r = await clearKeepersAction({ teamId });
          if (!r.ok) toast.error(r.error);
          else if (r.message) toast.success(r.message);
        });
      }}
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      Clear all
    </button>
  );
}
