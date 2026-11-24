// My Team: header (record, cap, roster counts, matchup) + roster table with easy lineup setup and roster actions.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Lightbulb, Repeat } from "lucide-react";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui/core";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { loadTeamPage, resolveManagedTeam } from "@/lib/team/data";
import { clamp } from "@/lib/utils";
import { LineupEditor } from "@/components/team/lineup-editor";
import { TeamHeader } from "@/components/team/team-header";
import { TeamSwitcher } from "@/components/team/team-switcher";
import { TeamTabs } from "@/components/team/team-tabs";
import { WeekPicker } from "@/components/team/week-picker";

export const metadata: Metadata = { title: "My Team" };

export default async function MyTeamPage({ searchParams }: { searchParams: Promise<{ week?: string; team?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const resolved = await resolveManagedTeam(ctx, sp.team);
  if (resolved.kind === "redirect") redirect(resolved.to);
  const commishTools = ctx.isCommish && ctx.settings.commissioner.canEditLineups;
  const teams = commishTools ? await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];

  if (resolved.kind === "none") {
    return (
      <div>
        <PageHeader title="My Team" actions={commishTools ? <TeamSwitcher teams={teams} current={null} myTeamId={null} /> : undefined} />
        <EmptyState title="You don't manage a team in this league">
          {commishTools ? "As commissioner you can pick any team above to manage its lineup and roster." : "Ask the commissioner for an invite to an open team, or browse every roster."}
          <div className="mt-3">
            <ButtonLink href="/teams" variant="secondary" size="sm">
              View all teams
            </ButtonLink>
          </div>
        </EmptyState>
      </div>
    );
  }

  const maxWeek = lastFantasyWeek(ctx.settings);
  const requested = Number.parseInt(sp.week ?? "", 10);
  const week = clamp(Number.isFinite(requested) ? requested : ctx.week, 1, maxWeek);
  const data = await loadTeamPage(ctx, resolved.teamId, week, { manage: true, commishEdit: resolved.commishEdit });
  const teamQuery: Record<string, string> = resolved.commishEdit ? { team: resolved.teamId } : {};
  const q = resolved.commishEdit ? `?team=${resolved.teamId}` : "";

  return (
    <div>
      <TeamTabs active="roster" teamId={resolved.commishEdit ? resolved.teamId : null} keepers={ctx.settings.keepers.enabled} />
      <TeamHeader
        data={data.header}
        commishNote={resolved.commishEdit ? `Commissioner mode — you're editing ${data.header.team.name}'s lineup and roster. Changes are logged.` : undefined}
        actions={
          <>
            <ButtonLink href={`/team/insights${q}`} variant="secondary" size="sm">
              <Lightbulb size={14} /> Lineup insights
            </ButtonLink>
            <ButtonLink href="/trades/new" variant="secondary" size="sm">
              <Repeat size={14} /> Trade
            </ButtonLink>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <WeekPicker basePath="/team" week={week} currentWeek={ctx.week} maxWeek={maxWeek} extraQuery={teamQuery} />
        {commishTools && <TeamSwitcher teams={teams} current={resolved.teamId} myTeamId={ctx.myTeam?.id ?? null} />}
      </div>
      <LineupEditor key={`${resolved.teamId}-${week}`} data={data.editor} deadCap={data.deadCap} />
    </div>
  );
}
