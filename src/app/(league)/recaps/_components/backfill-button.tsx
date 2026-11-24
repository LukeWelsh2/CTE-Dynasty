"use client";
// Commissioner: write every completed week that has no recap yet.
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { ActionButton } from "@/components/ui/client";
import { generateMissingRecapsAction } from "@/lib/recap/actions";

export function BackfillRecapsButton({ season, missing }: { season: number; missing: number }) {
  const router = useRouter();
  return (
    <ActionButton
      action={() => generateMissingRecapsAction({ season })}
      onDone={() => router.refresh()}
      variant="secondary"
      size="sm"
      title="Write the recap for every completed week that doesn't have one yet"
    >
      <PenLine size={14} aria-hidden /> Write {missing} missing recap{missing === 1 ? "" : "s"}
    </ActionButton>
  );
}
