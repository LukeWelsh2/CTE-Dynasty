"use client";
// Keeper designation checkbox (saves immediately) and the "clear all" button.
import { useOptimistic, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clearKeepersAction, setKeeperAction } from "@/lib/keepers/actions";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function KeeperToggle({ teamId, playerId, playerName, checked, disabled, title }: { teamId: string; playerId: string; playerName: string; checked: boolean; disabled?: boolean; title?: string }) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(checked);
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5", (disabled || pending) && "cursor-not-allowed opacity-60")} title={title}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-line accent-brand-600"
        checked={optimistic}
        disabled={disabled || pending}
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
      <span className="text-xs font-semibold">{pending ? <Loader2 size={12} className="animate-spin" /> : "Keep"}</span>
    </label>
  );
}

export function ClearKeepersButton({ teamId, disabled }: { teamId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      className={buttonClass("ghost", "sm")}
      onClick={() => {
        if (!window.confirm("Remove every keeper designation for this team?")) return;
        start(async () => {
          const r = await clearKeepersAction({ teamId });
          if (!r.ok) toast.error(r.error);
          else if (r.message) toast.success(r.message);
        });
      }}
    >
      {pending && <Loader2 size={14} className="animate-spin" />}
      Clear all
    </button>
  );
}
