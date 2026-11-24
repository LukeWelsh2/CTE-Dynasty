"use client";
// Schedule team picker: a pill that opens the phone's own picker (native <select> laid over it) to view any other
// team's schedule. "My team" / "League" are the segmented links beside it.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ScheduleSelect({ value, myTeamId, teams }: { value: string; myTeamId: string | null; teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const others = teams.filter((t) => t.id !== myTeamId);
  const picked = others.find((t) => t.id === value);
  return (
    <label
      className={cn(
        "relative inline-flex h-10 min-w-0 max-w-full items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors sm:h-9",
        picked ? "bg-brand-600 text-white" : "bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken",
      )}
    >
      <span className="truncate">{picked ? picked.name : "Other team"}</span>
      {pending ? <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden /> : <ChevronDown size={15} className="shrink-0" aria-hidden />}
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={picked ? picked.id : ""}
        aria-label="View another team's schedule"
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          start(() => router.push(`/schedule?team=${v}`));
        }}
      >
        <option value="" disabled>
          Other team…
        </option>
        {others.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
