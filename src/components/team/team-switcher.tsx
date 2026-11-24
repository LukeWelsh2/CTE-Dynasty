"use client";
// Commissioner-only: jump to managing another team's lineup/roster (/team?team=<id>).
import { usePathname, useRouter } from "next/navigation";
import { Shield } from "lucide-react";

export function TeamSwitcher({ teams, current, myTeamId }: { teams: { id: string; name: string }[]; current: string | null; myTeamId: string | null }) {
  const router = useRouter();
  const path = usePathname() ?? "/team";
  return (
    <label className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs font-semibold text-muted">
      <Shield size={14} className="text-gold-600" />
      <span className="hidden sm:inline">Manage</span>
      <select
        aria-label="Commissioner: manage team"
        className="h-10 min-w-0 max-w-[240px] rounded-md border border-line bg-panel px-2 text-xs font-semibold text-ink focus:border-brand-500 focus:outline-none sm:h-8"
        value={current ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id && id !== myTeamId ? `${path}?team=${encodeURIComponent(id)}` : path);
        }}
      >
        {!myTeamId && <option value="">Choose a team…</option>}
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.id === myTeamId ? " (mine)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
