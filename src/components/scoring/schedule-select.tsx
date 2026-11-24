"use client";
// Schedule view picker: My team · All weeks · any team.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

export function ScheduleSelect({ value, myTeamId, teams }: { value: string; myTeamId: string | null; teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">View</span>
      <select
        className="input w-auto min-w-[200px] py-1.5"
        value={value}
        aria-label="Schedule view"
        onChange={(e) => {
          const v = e.target.value;
          const href = v === "league" ? "/schedule?view=league" : v === myTeamId ? "/schedule" : `/schedule?team=${v}`;
          start(() => router.push(href));
        }}
      >
        {myTeamId && <option value={myTeamId}>My team</option>}
        <option value="league">All weeks (league)</option>
        <optgroup label="Teams">
          {teams
            .filter((t) => t.id !== myTeamId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </optgroup>
      </select>
      {pending && <Loader2 size={14} className="animate-spin text-muted" aria-label="Loading" />}
    </label>
  );
}
