"use client";
// One-click "apply" for insight recommendations: saves a complete lineup via the lineup server action.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { saveLineupAction } from "@/lib/team/actions";
import type { LineupAssignmentLite } from "@/lib/team/lineup-model";

export function ApplyLineupButton({
  teamId,
  week,
  lineup,
  label = "Apply",
  successMessage,
  variant = "primary",
  disabled,
}: {
  teamId: string;
  week: number;
  lineup: LineupAssignmentLite[];
  label?: string;
  successMessage?: string;
  variant?: "primary" | "secondary" | "gold" | "success";
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || disabled}
      className={buttonClass(variant, "xs", "h-7 px-2.5")}
      onClick={() =>
        start(async () => {
          try {
            const res = await saveLineupAction({ teamId, week, lineup });
            if (!res.ok) toast.error(res.error);
            else {
              toast.success(successMessage ?? res.message ?? "Lineup updated");
              router.refresh();
            }
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
      {label}
    </button>
  );
}
