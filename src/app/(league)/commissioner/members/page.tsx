import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Badge, EmptyState, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
import { AddTeamForm, CopyButton, InviteForm, InviteRowActions, LeagueCodeReset, RoleSelect, TeamActions } from "@/components/commissioner/members-tools";
import { hasFullPowers } from "@/lib/commissioner/server";
import { loadLedger } from "@/lib/commissioner/ledger-data";
import { LedgerTable } from "@/components/commissioner/ledger-table";
import { fmtDateTime } from "@/lib/commissioner/time";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Members & Invites" };

export default async function MembersPage() {
  const ctx = await requireCommissioner();
  const { league, settings } = ctx;
  const tz = settings.general.timezone;
  const [teams, members, invites, ledger] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" } }),
    db.leagueMember.findMany({ where: { leagueId: league.id }, include: { user: { select: { id: true, name: true, email: true, lastSeenAt: true } } }, orderBy: { joinedAt: "asc" } }),
    db.invite.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    loadLedger(league.id, ctx.season, settings),
  ]);
  const canFull = hasFullPowers(ctx);
  const memberByTeam = new Map(members.filter((m) => m.teamId).map((m) => [m.teamId!, m]));
  const teamless = members.filter((m) => !m.teamId);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const divisionName = new Map(settings.general.divisions.map((d) => [d.id, d.name]));
  const openTeams = teams.filter((t) => !t.ownerId && !memberByTeam.has(t.id));
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const paid = new Set(settings.general.duesPaidTeamIds);
  const showDues = settings.general.leagueDues > 0;
  const now = Date.now();
  const inactiveDays = settings.niche.inactiveManagerFlagDays;

  return (
    <div>
      <PageHeader
        kicker="Commissioner"
        title="Members & Invites"
        subtitle={`${teams.length} teams · ${members.length} members · ${openTeams.length} unclaimed${showDues ? ` · dues $${settings.general.leagueDues} (${paid.size}/${teams.length} paid)` : ""}`}
      />

      <Panel id="teams" title="Teams & managers" subtitle="Rename teams, change roles, hand a team to someone new, or remove a manager. Every change is logged." noPad className="mb-4">
        <div className="overflow-x-auto">
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-sunken">Team</th>
                <th>Division</th>
                <th>Manager</th>
                <th>Role</th>
                <th>Last seen</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const m = memberByTeam.get(t.id);
                const stale = m?.user.lastSeenAt ? now - m.user.lastSeenAt.getTime() > inactiveDays * 864e5 : false;
                return (
                  <tr key={t.id}>
                    <td className="sticky left-0 z-[5] bg-panel">
                      <span className="flex items-center gap-2">
                        <TeamLogo team={t} size={28} />
                        <span className="min-w-0">
                          <a href={`/teams/${t.id}`} className="block truncate font-semibold hover:underline">
                            {t.name}
                          </a>
                          <span className="text-[11px] text-muted">{t.abbrev}</span>
                        </span>
                      </span>
                    </td>
                    <td className="text-xs">{t.division ? divisionName.get(t.division) ?? <span className="text-amber-600">Unknown division</span> : <span className="text-muted">—</span>}</td>
                    <td>
                      {m ? (
                        <span className="block min-w-0">
                          <span className="block font-medium">{m.user.name}</span>
                          <span className="block truncate text-[11px] text-muted">{m.user.email}</span>
                        </span>
                      ) : (
                        <Badge tone="amber">Unowned</Badge>
                      )}
                    </td>
                    <td>{m ? <RoleSelect memberId={m.id} role={m.role} disabled={!canFull || m.userId === ctx.user.id} /> : <span className="text-xs text-muted">—</span>}</td>
                    <td className="whitespace-nowrap text-xs">
                      {m?.user.lastSeenAt ? <span className={stale ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted"}>{timeAgo(m.user.lastSeenAt)}{stale ? " · inactive" : ""}</span> : <span className="text-muted">{m ? "Never" : "—"}</span>}
                    </td>
                    <td>
                      <TeamActions
                        team={{ id: t.id, name: t.name, abbrev: t.abbrev, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, division: t.division, motto: t.motto }}
                        member={m ? { id: m.id, name: m.user.name, role: m.role } : null}
                        teamless={teamless.map((x) => ({ id: x.id, name: x.user.name }))}
                        divisions={settings.general.divisions}
                        canFull={canFull}
                        isSelf={m?.userId === ctx.user.id}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {teams.length < settings.general.teamCount && canFull && (
          <div className="border-t border-line px-3 py-3">
            <div className="mb-2 text-xs font-semibold text-muted">
              The league is set to {settings.general.teamCount} teams; {settings.general.teamCount - teams.length} spot{settings.general.teamCount - teams.length === 1 ? "" : "s"} open.
            </div>
            <AddTeamForm />
          </div>
        )}
      </Panel>

      {ledger.active && (
        <Panel
          id="dues"
          title="Dues, fines & fees"
          subtitle={`${ctx.season} season · fines and fees are collected with dues${settings.general.duesDueDate ? ` · dues due ${fmtDateTime(settings.general.duesDueDate, tz, { dateOnly: true })}` : ""}`}
          noPad
          className="mb-4"
        >
          <LedgerTable ledger={ledger} settings={settings} editable />
        </Panel>
      )}

      {teamless.length > 0 && (
        <Panel title="Members without a team" subtitle="Use Assign on a team to give one of them a franchise." className="mb-4" noPad>
          <ul className="divide-y divide-line">
            {teamless.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{m.user.name}</span> <span className="text-xs text-muted">{m.user.email}</span>
                </span>
                <RoleSelect memberId={m.id} role={m.role} disabled={!canFull || m.userId === ctx.user.id} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel id="invite" title="Invite a manager" className="lg:col-span-3">
          <InviteForm openTeams={openTeams.map((t) => ({ id: t.id, name: t.name }))} canInviteCo={canFull} />
        </Panel>
        <Panel title="League invite code" className="lg:col-span-2">
          <p className="mb-2 text-xs text-muted">Anyone with this code can join and claim the first unclaimed team. Personal invites (left) are safer for replacing a manager.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-sunken px-2 py-1 font-mono text-sm font-bold">{league.inviteCode}</code>
            <CopyButton text={league.inviteCode} label="Code" />
            <CopyButton text={`${appUrl}/signup?code=${league.inviteCode}`} label="Link" />
            {canFull && <LeagueCodeReset />}
          </div>
        </Panel>
      </div>

      <Panel title="Invites" subtitle="Personal invites and their status" noPad className="mt-4">
        {invites.length ? (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[760px]">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Email</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const expired = !i.usedAt && !!i.expiresAt && i.expiresAt.getTime() < now;
                  const taken = !i.usedAt && !!i.teamId && (memberByTeam.has(i.teamId) || !!teams.find((t) => t.id === i.teamId)?.ownerId);
                  const usable = !i.usedAt && !expired && !taken;
                  const usedBy = i.usedById ? members.find((m) => m.userId === i.usedById)?.user.name : null;
                  return (
                    <tr key={i.id}>
                      <td className="font-mono text-xs font-bold">{i.code}</td>
                      <td className="text-xs">{i.email ?? <span className="text-muted">Anyone with the link</span>}</td>
                      <td className="text-xs">{i.teamId ? teamName.get(i.teamId) ?? "Removed team" : <span className="text-muted">First unclaimed</span>}</td>
                      <td className="text-xs">{i.role === "CO_COMMISSIONER" ? "Co-commish" : "Manager"}</td>
                      <td className="whitespace-nowrap text-xs">
                        {i.usedAt ? (
                          <Badge tone="green">Used{usedBy ? ` · ${usedBy}` : ""}</Badge>
                        ) : expired ? (
                          <Badge tone="neutral">Expired</Badge>
                        ) : taken ? (
                          <Badge tone="amber" title="This team already has a manager, so the invite can't be used">Team taken</Badge>
                        ) : (
                          <span>
                            <Badge tone="brand">Open</Badge> <span className="text-muted">{i.expiresAt ? `until ${fmtDateTime(i.expiresAt, tz, { dateOnly: true })}` : "no expiry"}</span>
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted">{timeAgo(i.createdAt)}</td>
                      <td>
                        <InviteRowActions inviteId={i.id} link={`${appUrl}/signup?code=${i.code}`} hasEmail={!!i.email} usable={usable} revocable={!i.usedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-3">
            <EmptyState title="No invites yet">Create a personal invite above to bring in a new manager or fill an orphaned team.</EmptyState>
          </div>
        )}
      </Panel>
    </div>
  );
}
