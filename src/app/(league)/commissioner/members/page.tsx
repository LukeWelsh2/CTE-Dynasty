// Members & invites — "Who runs each team, and is everyone in?". Summary strip (teams · managers · open teams ·
// dues paid) → teams (phones: one row per team, tap for email, division, role and the manage buttons; md+: the
// table) → dues ledger → invite form + league code → invites (phones: rows with their actions; md+: table).
import { ChevronDown } from "lucide-react";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Badge, EmptyState, PageHeader, Panel, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { AddTeamForm, CopyButton, InviteForm, InviteRowActions, LeagueCodeReset, RoleSelect, TeamActions } from "@/components/commissioner/members-tools";
import { hasFullPowers } from "@/lib/commissioner/server";
import { loadLedger } from "@/lib/commissioner/ledger-data";
import { LedgerTable } from "@/components/commissioner/ledger-table";
import { fmtDateTime } from "@/lib/commissioner/time";
import { cn, fmtMoney, timeAgo } from "@/lib/utils";

export const metadata = { title: "Members & Invites" };

const ROLE: Record<string, string> = { COMMISSIONER: "Commissioner", CO_COMMISSIONER: "Co-commish", MANAGER: "Manager" };

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
  const inviteState = (i: (typeof invites)[number]) => {
    const expired = !i.usedAt && !!i.expiresAt && i.expiresAt.getTime() < now;
    const taken = !i.usedAt && !!i.teamId && (memberByTeam.has(i.teamId) || !!teams.find((t) => t.id === i.teamId)?.ownerId);
    const usable = !i.usedAt && !expired && !taken;
    const usedBy = i.usedById ? members.find((m) => m.userId === i.usedById)?.user.name : null;
    const badge = i.usedAt ? (
      <Badge tone="green">Used{usedBy ? ` · ${usedBy}` : ""}</Badge>
    ) : expired ? (
      <Badge tone="neutral">Expired</Badge>
    ) : taken ? (
      <Badge tone="amber" title="This team already has a manager, so the invite can't be used">
        Team taken
      </Badge>
    ) : (
      <Badge tone="brand">Open</Badge>
    );
    return { expired, taken, usable, badge };
  };
  const openInvites = invites.filter((i) => inviteState(i).usable).length;
  const teamInfo = (t: (typeof teams)[number]) => ({ id: t.id, name: t.name, abbrev: t.abbrev, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, division: t.division, motto: t.motto });

  return (
    <div>
      <PageHeader title="Members" subtitle={`${league.name} · invites and dues`} />
      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Teams", value: teams.length, sub: `of ${settings.general.teamCount}`, href: "#teams" },
          { label: "People", value: members.length, sub: teamless.length ? `${teamless.length} no team` : "members" },
          { label: "Open", value: openTeams.length, tone: openTeams.length ? "bad" : undefined, sub: `${openInvites} invite${openInvites === 1 ? "" : "s"}`, href: "#invite" },
          showDues
            ? { label: "Dues", value: `${paid.size}/${teams.length}`, sub: `paid · ${fmtMoney(settings.general.leagueDues)}`, href: "#dues" }
            : { label: "Code", value: league.inviteCode, sub: "league code", href: "#code" },
        ]}
      />

      <Panel
        id="teams"
        title="Teams & managers"
        subtitle={`${teams.length} teams · every change is logged`}
        info={<p>Rename a team, change a manager&apos;s role, give a team to a member without one, replace a manager with a fresh invite, or remove a manager. Every change is written to the action log.</p>}
        noPad
        className="mb-4"
      >
        {/* phones: tap a team for its details and manage buttons */}
        <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
          {teams.map((t) => {
            const m = memberByTeam.get(t.id);
            const stale = m?.user.lastSeenAt ? now - m.user.lastSeenAt.getTime() > inactiveDays * 864e5 : false;
            return (
              <li key={t.id}>
                <details className="group">
                  <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                    <TeamLogo team={t} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold leading-5 text-ink" title={t.name}>
                        {t.name}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-muted">
                        {m ? (
                          <>
                            {m.user.name}
                            {m.role !== "MANAGER" ? ` · ${ROLE[m.role] ?? m.role}` : ""}
                            {" · "}
                            <span className={cn(stale && "font-semibold text-amber-700 dark:text-amber-300")}>{m.user.lastSeenAt ? `${timeAgo(m.user.lastSeenAt)}${stale ? " · inactive" : ""}` : "never seen"}</span>
                          </>
                        ) : (
                          <span className="font-semibold text-amber-700 dark:text-amber-300">No manager</span>
                        )}
                      </span>
                    </span>
                    <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="space-y-3 bg-sunken px-4 py-3">
                    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[14px]">
                      <dt className="eyebrow pt-0.5">Abbrev</dt>
                      <dd className="font-semibold text-ink">{t.abbrev}</dd>
                      <dt className="eyebrow pt-0.5">Division</dt>
                      <dd className="text-ink">{t.division ? divisionName.get(t.division) ?? <span className="text-amber-700 dark:text-amber-300">Unknown division</span> : <span className="text-muted">—</span>}</dd>
                      {m && (
                        <>
                          <dt className="eyebrow pt-0.5">Email</dt>
                          <dd className="break-all text-ink">{m.user.email}</dd>
                          <dt className="eyebrow pt-2">Role</dt>
                          <dd>
                            <RoleSelect memberId={m.id} role={m.role} disabled={!canFull || m.userId === ctx.user.id} />
                          </dd>
                        </>
                      )}
                    </dl>
                    <TeamActions
                      team={teamInfo(t)}
                      member={m ? { id: m.id, name: m.user.name, role: m.role } : null}
                      teamless={teamless.map((x) => ({ id: x.id, name: x.user.name }))}
                      divisions={settings.general.divisions}
                      canFull={canFull}
                      isSelf={m?.userId === ctx.user.id}
                      size="sm"
                      className="justify-start"
                    />
                    <a href={`/teams/${t.id}`} className="link inline-flex min-h-8 items-center text-[14px]">
                      Team page
                    </a>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto border-t border-line/70 md:block">
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th className="tbl-sticky">Team</th>
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
                    <td className="tbl-sticky">
                      <span className="flex items-center gap-2">
                        <TeamLogo team={t} size={28} />
                        <span className="min-w-0">
                          <a href={`/teams/${t.id}`} className="block truncate font-semibold hover:underline">
                            {t.name}
                          </a>
                          <span className="text-[12px] text-muted">{t.abbrev}</span>
                        </span>
                      </span>
                    </td>
                    <td className="text-[13px]">{t.division ? divisionName.get(t.division) ?? <span className="text-amber-700 dark:text-amber-300">Unknown division</span> : <span className="text-muted">—</span>}</td>
                    <td>
                      {m ? (
                        <span className="block min-w-0">
                          <span className="block font-medium">{m.user.name}</span>
                          <span className="block truncate text-[12px] text-muted">{m.user.email}</span>
                        </span>
                      ) : (
                        <Badge tone="amber">Unowned</Badge>
                      )}
                    </td>
                    <td>{m ? <RoleSelect memberId={m.id} role={m.role} disabled={!canFull || m.userId === ctx.user.id} /> : <span className="text-[13px] text-muted">—</span>}</td>
                    <td className="whitespace-nowrap text-[13px]">
                      {m?.user.lastSeenAt ? (
                        <span className={stale ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted"}>
                          {timeAgo(m.user.lastSeenAt)}
                          {stale ? " · inactive" : ""}
                        </span>
                      ) : (
                        <span className="text-muted">{m ? "Never" : "—"}</span>
                      )}
                    </td>
                    <td>
                      <TeamActions
                        team={teamInfo(t)}
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
          <div className="border-t border-line/70 px-4 py-3">
            <div className="eyebrow mb-2">
              {settings.general.teamCount - teams.length} open spot{settings.general.teamCount - teams.length === 1 ? "" : "s"} (league set to {settings.general.teamCount} teams)
            </div>
            <AddTeamForm />
          </div>
        )}
      </Panel>

      {ledger.active && (
        <Panel
          id="dues"
          title="Dues, fines & fees"
          subtitle={`${ctx.season}${settings.general.duesDueDate ? ` · due ${fmtDateTime(settings.general.duesDueDate, tz, { dateOnly: true })}` : ""}`}
          info={<p>Fines and fees are collected with dues. Tap a team&apos;s Paid / Unpaid pill to record a payment.</p>}
          noPad
          className="mb-4"
        >
          <LedgerTable ledger={ledger} settings={settings} editable topRule />
        </Panel>
      )}

      {teamless.length > 0 && (
        <Panel title="Members without a team" info={<p>Use Assign on a team to give one of them a franchise.</p>} className="mb-4" noPad>
          <ul className="divide-y divide-line/70 border-t border-line/70">
            {teamless.map((m) => (
              <li key={m.id} className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm">{m.user.name}</span>
                  <span className="block truncate text-[13px] text-muted">{m.user.email}</span>
                </span>
                <RoleSelect memberId={m.id} role={m.role} disabled={!canFull || m.userId === ctx.user.id} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel id="invite" title="Invite a manager" className="scroll-mt-4 lg:col-span-3" info={<p>A personal invite can be tied to an unclaimed team and a role, expire after a few days, and be emailed. Safer than the league code for replacing a manager.</p>}>
          <InviteForm openTeams={openTeams.map((t) => ({ id: t.id, name: t.name }))} canInviteCo={canFull} />
        </Panel>
        <Panel id="code" title="League code" className="scroll-mt-4 lg:col-span-2" info={<p>Anyone with this code can join and claim the first unclaimed team. Personal invites are safer for replacing a manager.</p>}>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-sunken px-3 py-2 font-mono text-[17px] font-bold tracking-wider">{league.inviteCode}</code>
            <CopyButton text={league.inviteCode} label="Code" />
            <CopyButton text={`${appUrl}/signup?code=${league.inviteCode}`} label="Link" />
            {canFull && <LeagueCodeReset />}
          </div>
        </Panel>
      </div>

      <Panel title="Invites" subtitle={invites.length ? `${openInvites} open · ${invites.length} total` : undefined} noPad className="mt-4">
        {invites.length ? (
          <>
            <div className="md:hidden">
            <ShowMore as="ul" initial={4} className="divide-y divide-line/70 border-t border-line/70">
              {invites.map((i) => {
                const st = inviteState(i);
                return (
                  <li key={i.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[15px] font-bold text-ink">{i.code}</span>
                      {st.badge}
                    </div>
                    <div className="text-[13px] leading-[18px] text-muted">
                      <span className="block truncate">{i.email ?? "Anyone with the link"}</span>
                      <span className="block truncate">
                        {i.teamId ? teamName.get(i.teamId) ?? "Removed team" : "First unclaimed team"} · {i.role === "CO_COMMISSIONER" ? "Co-commish" : "Manager"} · {timeAgo(i.createdAt)}
                        {st.usable ? ` · ${i.expiresAt ? `until ${fmtDateTime(i.expiresAt, tz, { dateOnly: true })}` : "no expiry"}` : ""}
                      </span>
                    </div>
                    <InviteRowActions inviteId={i.id} link={`${appUrl}/signup?code=${i.code}`} hasEmail={!!i.email} usable={st.usable} revocable={!i.usedAt} size="sm" className="justify-start" />
                  </li>
                );
              })}
            </ShowMore>
            </div>
            <div className="hidden overflow-x-auto border-t border-line/70 md:block">
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
                    const st = inviteState(i);
                    return (
                      <tr key={i.id}>
                        <td className="font-mono text-[13px] font-bold">{i.code}</td>
                        <td className="text-[13px]">{i.email ?? <span className="text-muted">Anyone with the link</span>}</td>
                        <td className="text-[13px]">{i.teamId ? teamName.get(i.teamId) ?? "Removed team" : <span className="text-muted">First unclaimed</span>}</td>
                        <td className="text-[13px]">{i.role === "CO_COMMISSIONER" ? "Co-commish" : "Manager"}</td>
                        <td className="whitespace-nowrap text-[13px]">
                          {st.badge}
                          {st.usable && <span className="ml-1 text-muted">{i.expiresAt ? `until ${fmtDateTime(i.expiresAt, tz, { dateOnly: true })}` : "no expiry"}</span>}
                        </td>
                        <td className="whitespace-nowrap text-[13px] text-muted">{timeAgo(i.createdAt)}</td>
                        <td>
                          <InviteRowActions inviteId={i.id} link={`${appUrl}/signup?code=${i.code}`} hasEmail={!!i.email} usable={st.usable} revocable={!i.usedAt} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="px-4 pb-4">
            <EmptyState title="No invites yet">Create one above to bring in a new manager.</EmptyState>
          </div>
        )}
      </Panel>
    </div>
  );
}
