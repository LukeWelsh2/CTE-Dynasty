// My Team — the canonical "Roster" pattern (docs/DESIGN.md §6.2): round logo + name ▾ + owner + record, five
// quick-action tiles (More opens the team summary + sub-pages), then "Week 12 ▾" with the view picker and Optimize,
// and the roster in grey-bar sections with slot-pill rows (lineup moves, IR / taxi, drop, contracts all kept).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui/core";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { loadTeamPage, resolveManagedTeam } from "@/lib/team/data";
import { clamp } from "@/lib/utils";
import { LineupEditor } from "@/components/team/lineup-editor";
import { RosterHeader } from "@/components/team/roster-header";
import { TeamSwitcher } from "@/components/team/team-switcher";

export const metadata: Metadata = { title: "Roster" };

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
        <PageHeader title="Roster" actions={commishTools ? <TeamSwitcher teams={teams} current={null} myTeamId={null} /> : undefined} />
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

  const allTeams = commishTools ? teams : await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  return (
    <div>
      <RosterHeader
        data={data.header}
        teams={allTeams}
        myTeamId={ctx.myTeam?.id ?? null}
        manageOthers={commishTools}
        commishNote={resolved.commishEdit ? `Commissioner mode: you're editing ${data.header.team.name}'s lineup and roster. Changes are logged.` : undefined}
        links={{ insights: `/team/insights${q}`, contracts: `/team/contracts${q}`, picks: `/team/picks${q}`, keepers: ctx.settings.keepers.enabled ? "/team/keepers" : null }}
      />
      <LineupEditor
        key={`${resolved.teamId}-${week}`}
        data={data.editor}
        deadCap={data.deadCap}
        weekNav={{ basePath: "/team", week, currentWeek: ctx.week, maxWeek, extraQuery: teamQuery }}
      />
    </div>
  );
}
