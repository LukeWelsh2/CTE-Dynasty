import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, CalendarDays, CheckCircle2, DollarSign, Megaphone, PlayCircle, Settings2, ShieldAlert, Sigma, UserPlus, Users, Wrench, XCircle } from "lucide-react";
import { requireCommissioner } from "@/lib/league";
import { Badge, PageHeader, Panel, StatTile } from "@/components/ui/core";
import { auditDetail, auditLabel, loadDashboard } from "@/lib/commissioner/dashboard";
import { fmtDateTime } from "@/lib/commissioner/time";
import { cn, timeAgo } from "@/lib/utils";

export const metadata = { title: "Commissioner" };

const PHASE_LABEL: Record<string, string> = { PRESEASON: "Preseason", REGULAR: "Regular season", PLAYOFFS: "Playoffs", OFFSEASON: "Offseason", KEEPER: "Keeper window" };

function AlertItem({ tone, icon, title, children, href, cta }: { tone: "red" | "amber" | "blue"; icon: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; href: string; cta: string }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span className={cn("mt-0.5 shrink-0", tone === "red" ? "text-loss" : tone === "amber" ? "text-amber-500" : "text-brand-600 dark:text-brand-300")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {children && <div className="mt-0.5 text-xs text-muted">{children}</div>}
      </div>
      <Link href={href} className="shrink-0 whitespace-nowrap text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
        {cta} →
      </Link>
    </li>
  );
}

const QUICK = [
  { href: "/commissioner/settings", label: "League settings", icon: Settings2 },
  { href: "/commissioner/settings/scoring", label: "Scoring rules", icon: Sigma },
  { href: "/commissioner/members#invite", label: "Invite a manager", icon: UserPlus },
  { href: "/commissioner/rosters", label: "Add / drop for a team", icon: Users },
  { href: "/commissioner/trades", label: "Review trades", icon: ArrowLeftRight },
  { href: "/commissioner/schedule#adjust", label: "Score adjustment", icon: CalendarDays },
  { href: "/commissioner/system#announce", label: "Post announcement", icon: Megaphone },
  { href: "/commissioner/system#jobs", label: "Run a job", icon: PlayCircle },
];

export default async function CommissionerHomePage() {
  const ctx = await requireCommissioner();
  const { league, settings, season, week } = ctx;
  const tz = settings.general.timezone;
  const d = await loadDashboard(ctx);
  const alertCount =
    (d.tradesAwaiting ? 1 : 0) + d.teamAlerts.length + d.underFloor.length + (d.unclaimedTeams.length ? 1 : 0) + d.failedJobs.length + (d.unpaidDues.length ? 1 : 0) + (d.lineupAlerts.some((l) => l.empty) ? 1 : 0);

  return (
    <div>
      <PageHeader
        kicker="Commissioner"
        title="Commissioner Home"
        subtitle={`${league.name} · ${season} ${PHASE_LABEL[league.phase] ?? league.phase} · Week ${week}${league.weekOverride ? " (set by commissioner)" : ""}`}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Season phase" value={PHASE_LABEL[league.phase] ?? league.phase} sub={<Link href="/commissioner/season" className="link">Season controls</Link>} />
        <StatTile label="Current week" value={`Week ${week}`} sub={league.weekOverride ? "Pinned by the commissioner" : "Following the NFL calendar"} />
        <StatTile label="Teams · managers" value={`${d.teamCount} · ${d.memberCount}`} sub={d.unclaimedTeams.length ? `${d.unclaimedTeams.length} unclaimed · ${d.openInvites} open invite${d.openInvites === 1 ? "" : "s"}` : `${d.openInvites} open invite${d.openInvites === 1 ? "" : "s"}`} />
        <StatTile
          label="Settings version"
          value={`v${league.settingsVersion}`}
          sub={d.latestSettings ? `Changed ${timeAgo(d.latestSettings.createdAt)}${d.latestSettings.by ? ` by ${d.latestSettings.by}` : ""}` : "Original settings"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Needs attention" subtitle={alertCount ? `${alertCount} item${alertCount === 1 ? "" : "s"}` : "Nothing waiting on you"} noPad>
            {alertCount === 0 && d.lineupAlerts.length === 0 ? (
              <div className="flex items-center gap-3 px-3 py-6 text-sm text-muted">
                <CheckCircle2 className="text-win" size={22} /> All clear: no trades to review, every roster is legal and under the cap, and background jobs are healthy.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {d.tradesAwaiting > 0 && (
                  <AlertItem tone="red" icon={<ArrowLeftRight size={18} />} title={`${d.tradesAwaiting} trade${d.tradesAwaiting === 1 ? "" : "s"} awaiting your review`} href="/commissioner/trades" cta="Review">
                    Accepted by every team; they process once you approve.
                  </AlertItem>
                )}
                {d.tradesVoting > 0 && (
                  <AlertItem tone="blue" icon={<ArrowLeftRight size={18} />} title={`${d.tradesVoting} trade${d.tradesVoting === 1 ? "" : "s"} in the league vote`} href="/commissioner/trades" cta="View" />
                )}
                {d.teamAlerts.map((t) => (
                  <AlertItem key={t.teamId} tone="red" icon={<ShieldAlert size={18} />} title={`${t.team}: illegal roster`} href={`/commissioner/rosters?team=${t.teamId}`} cta="Fix roster">
                    {t.problems.join(" ")} {settings.salaryCap.enabled && <span className="whitespace-nowrap">Cap: ${t.committed} committed (${t.space} space).</span>}
                  </AlertItem>
                ))}
                {d.underFloor.map((t) => (
                  <AlertItem key={t.abbrev} tone="amber" icon={<DollarSign size={18} />} title={`${t.team} is under the $${settings.salaryCap.floor} salary floor`} href="/commissioner/rosters" cta="Rosters">
                    ${t.committed} committed.
                  </AlertItem>
                ))}
                {d.lineupAlerts.some((l) => l.empty) && (
                  <AlertItem tone="amber" icon={<AlertTriangle size={18} />} title={`Empty starting slots in Week ${week}`} href="#lineups" cta="Details">
                    {d.lineupAlerts.filter((l) => l.empty).map((l) => `${l.abbrev} (${l.empty})`).join(", ")}
                  </AlertItem>
                )}
                {d.unclaimedTeams.length > 0 && (
                  <AlertItem tone="amber" icon={<UserPlus size={18} />} title={`${d.unclaimedTeams.length} team${d.unclaimedTeams.length === 1 ? " has" : "s have"} no manager`} href="/commissioner/members" cta="Invite">
                    {d.unclaimedTeams.map((t) => t.name).join(", ")} · {d.openInvites} open invite{d.openInvites === 1 ? "" : "s"}
                  </AlertItem>
                )}
                {d.failedJobs.map((j) => (
                  <AlertItem key={j.name} tone="red" icon={<XCircle size={18} />} title={`Job “${j.name}” failed ${j.count}× in the last 24h`} href="/commissioner/system#jobs" cta="System">
                    Last failure {timeAgo(j.lastAt)}
                    {j.message ? `: ${j.message.slice(0, 160)}` : ""}
                  </AlertItem>
                ))}
                {d.unpaidDues.length > 0 && (
                  <AlertItem tone="blue" icon={<DollarSign size={18} />} title={`${d.unpaidDues.length} team${d.unpaidDues.length === 1 ? "" : "s"} haven't paid $${settings.general.leagueDues} dues`} href="/commissioner/members#dues" cta="Dues tracker">
                    {settings.general.duesDueDate ? `Due ${fmtDateTime(settings.general.duesDueDate, tz, { dateOnly: true })} · ` : ""}
                    {d.unpaidDues.map((t) => t.name).join(", ")}
                  </AlertItem>
                )}
              </ul>
            )}
          </Panel>

          {(league.phase === "REGULAR" || league.phase === "PLAYOFFS") && (
            <Panel id="lineups" title={`Week ${week} lineups`} subtitle="Empty slots, starters ruled out, and starters on bye" noPad>
              {d.lineupAlerts.length ? (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th className="num">Empty</th>
                        <th>Injured starters</th>
                        <th>Bye-week starters</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lineupAlerts.map((l) => (
                        <tr key={l.teamId}>
                          <td className="whitespace-nowrap font-semibold">
                            <Link href={`/teams/${l.teamId}`} className="hover:underline">
                              {l.team}
                            </Link>
                          </td>
                          <td className={cn("num", l.empty && "font-bold text-loss")}>{l.empty}</td>
                          <td className="text-xs">{l.out.join(", ") || <span className="text-muted">—</span>}</td>
                          <td className="text-xs">{l.bye.join(", ") || <span className="text-muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-3 py-4 text-sm text-muted">Every team has a full, healthy lineup for Week {week}.</p>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Quick actions">
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map((q) => {
                const Icon = q.icon;
                return (
                  <Link key={q.href} href={q.href} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-xs font-semibold text-ink hover:border-brand-400 hover:bg-sunken">
                    <Icon size={15} className="shrink-0 text-brand-600 dark:text-brand-300" /> {q.label}
                  </Link>
                );
              })}
            </div>
            {d.pendingClaims > 0 && (
              <p className="mt-2 text-xs text-muted">
                {d.pendingClaims} pending waiver claim{d.pendingClaims === 1 ? "" : "s"} ·{" "}
                <Link href="/waivers" className="link">
                  Waivers
                </Link>
              </p>
            )}
          </Panel>

          <Panel title="Recent commissioner activity" actions={<Badge tone="neutral">{settings.commissioner.auditLogVisibleToLeague ? "Public" : "Private"}</Badge>} noPad>
            {d.audit.length ? (
              <ul className="divide-y divide-line">
                {d.audit.map((a) => (
                  <li key={a.id} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-ink">{auditLabel(a.action)}</span>
                      <span className="shrink-0 text-[11px] text-muted" title={fmtDateTime(a.createdAt, tz)}>
                        {timeAgo(a.createdAt)}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {a.actor ?? "System"}
                      {auditDetail(a.details) ? ` · ${auditDetail(a.details)}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-sm text-muted">No commissioner actions yet. Every override you make is logged here.</p>
            )}
            <div className="border-t border-line px-3 py-2 text-xs">
              <Link href="/commissioner/system#audit" className="link">
                <Wrench size={12} className="mr-1 inline" />
                Full action log
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
