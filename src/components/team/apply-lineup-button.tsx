"use client";
// One-click "apply" for insight recommendations: saves a complete lineup via the lineup server action.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";
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
  size = "xs",
  className,
}: {
  teamId: string;
  week: number;
  lineup: LineupAssignmentLite[];
  label?: string;
  successMessage?: string;
  variant?: "primary" | "secondary" | "gold" | "success";
  disabled?: boolean;
  /** xs: 40px on phones / 28px from sm (row buttons) · md: 40px primary button */
  size?: "xs" | "md";
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || disabled}
      className={size === "md" ? buttonClass(variant, "md", className) : buttonClass(variant, "xs", cn("h-10 px-3 text-[13px] sm:h-7 sm:px-2.5 sm:text-xs", className))}
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
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} className={size === "xs" ? "hidden sm:block" : undefined} />}
      {label}
    </button>
  );
}
