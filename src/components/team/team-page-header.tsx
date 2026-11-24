"use client";
// Any team's page header — the Roster pattern's identity block (docs/DESIGN.md §6.2) without my-team quick actions:
// round logo, team name with ▾ (a native select to jump to another team), owner (link) and the record line, then the
// page's actions (propose a trade, manager, commissioner "Manage") as one row of buttons.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { TeamLogo } from "@/components/ui/core";
import { ordinal } from "@/lib/utils";
import type { TeamHeaderData } from "@/lib/team/data";

export function TeamPageHeader({
  data,
  teams,
  myTeamId,
  actions,
}: {
  data: TeamHeaderData;
  teams: { id: string; name: string }[];
  myTeamId: string | null;
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const { team, owner } = data;
  return (
    <header className="mb-4">
      <div className="flex items-center gap-4">
        <TeamLogo team={team} size={64} round />
        <div className="min-w-0 flex-1">
          <label className="relative flex min-w-0 max-w-full items-center gap-1">
            <h1 className="truncate text-[22px] font-bold leading-7 tracking-[-0.02em] text-ink sm:text-[26px] sm:leading-8" title={team.name}>
              {team.name}
            </h1>
            <ChevronDown size={20} className="shrink-0 text-ink" aria-hidden />
            <select
              aria-label="Switch team"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={team.id}
              onChange={(e) => router.push(e.target.value === myTeamId ? "/team" : `/teams/${e.target.value}`)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === myTeamId ? " (my team)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-0.5 truncate text-[15px] text-muted">
            {owner ? (
              <Link href={`/managers/${owner.id}`} className="hover:text-ink hover:underline">
                {owner.name}
              </Link>
            ) : (
              "No manager"
            )}
            {data.divisionName && <span> · {data.divisionName}</span>}
          </div>
          <div className="numeral mt-0.5 truncate text-[15px] text-muted">
            {data.record}
            {data.rank !== null && ` · ${ordinal(data.rank)} of ${data.teamCount}`}
            {data.streak && ` · ${data.streak}`}
          </div>
        </div>
      </div>
      {team.motto && <p className="mt-2 truncate text-[13px] italic text-muted">“{team.motto}”</p>}
      {/* phones: the buttons share the row equally (no orphan on a second line) */}
      {actions && <div className="mt-3 flex gap-2 [&>*]:min-w-0 [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </header>
  );
}
