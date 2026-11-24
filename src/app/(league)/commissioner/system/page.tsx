import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { JOBS } from "@/lib/jobs/registry";
import { pushEnabled } from "@/lib/notify";
import { Alert, Badge, EmptyState, PageHeader, Panel } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { AnnouncementForm, EmailPreviewButton, RunJobButton } from "@/components/commissioner/system-tools";
import { deleteAnnouncement, sendTestEmail, sendTestPush, toggleAnnouncementPin } from "@/lib/commissioner/system-actions";
import { auditDetail, auditLabel } from "@/lib/commissioner/dashboard";
import { describeCron } from "@/lib/commissioner/cron";
import { fmtDateTime } from "@/lib/commissioner/time";
import { cn, timeAgo } from "@/lib/utils";

export const metadata = { title: "System" };

const HEAVY = new Set(["sync-players", "sync-stat-corrections", "sync-projections", "playoff-odds", "rookie-rankings", "sync-news", "sync-games"]);
const EMAIL_PAGE = 25;
const AUDIT_PAGE = 30;

function qs(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return `/commissioner/system${s ? `?${s}` : ""}`;
}

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ etype?: string; estatus?: string; epage?: string; apage?: string; ascope?: string }> }) {
  const ctx = await requireCommissioner();
  const { league, settings, season } = ctx;
  const tz = settings.general.timezone;
  const sp = await searchParams;
  const epage = Math.max(1, Number(sp.epage) || 1);
  const apage = Math.max(1, Number(sp.apage) || 1);
  const since = new Date(Date.now() - 24 * 3600_000);
  const emailWhere = {
    leagueId: league.id,
    type: sp.etype && sp.etype !== "PASSWORD_RESET" ? sp.etype : { not: "PASSWORD_RESET" },
    ...(sp.estatus ? { status: sp.estatus } : {}),
  };
  const auditWhere = { leagueId: league.id, ...(sp.ascope ? { action: { startsWith: `${sp.ascope}.` } } : {}) };

  const [runs, errors24, syncKv, nflKv, players, activePlayers, stats, projections, games, news, injuries, emails, emailCount, announcements, auditRows, auditCount, mySubs, auditActions] = await Promise.all([
    db.jobRun.findMany({ where: { startedAt: { gte: new Date(Date.now() - 14 * 864e5) } }, orderBy: { startedAt: "desc" }, take: 600 }),
    db.jobRun.groupBy({ by: ["name"], where: { status: "ERROR", startedAt: { gte: since } }, _count: true }),
    db.keyValue.findUnique({ where: { key: "sync_players" } }),
    db.keyValue.findUnique({ where: { key: "nfl_state" } }),
    db.player.count(),
    db.player.count({ where: { active: true } }),
    db.playerWeekStat.aggregate({ where: { season }, _count: true, _max: { updatedAt: true, week: true } }),
    db.playerWeekProjection.aggregate({ where: { season }, _count: true, _max: { updatedAt: true, week: true } }),
    db.nflGame.aggregate({ where: { season }, _count: true, _max: { updatedAt: true } }),
    db.newsItem.aggregate({ _count: true, _max: { publishedAt: true, createdAt: true } }),
    db.injuryReport.aggregate({ _count: true, _max: { reportedAt: true } }),
    db.emailLog.findMany({ where: emailWhere, orderBy: { createdAt: "desc" }, skip: (epage - 1) * EMAIL_PAGE, take: EMAIL_PAGE, select: { id: true, to: true, subject: true, type: true, status: true, error: true, createdAt: true } }),
    db.emailLog.count({ where: emailWhere }),
    db.leagueAnnouncement.findMany({ where: { leagueId: league.id }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 30, include: { author: { select: { name: true } } } }),
    db.auditLog.findMany({ where: auditWhere, orderBy: { createdAt: "desc" }, skip: (apage - 1) * AUDIT_PAGE, take: AUDIT_PAGE, include: { actor: { select: { name: true } } } }),
    db.auditLog.count({ where: auditWhere }),
    db.pushSubscription.count({ where: { userId: ctx.user.id } }),
    db.auditLog.findMany({ where: { leagueId: league.id }, distinct: ["action"], select: { action: true } }),
  ]);

  const lastRun = new Map<string, (typeof runs)[number]>();
  const lastOk = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    if (!lastRun.has(r.name)) lastRun.set(r.name, r);
    if (r.status === "OK" && !lastOk.has(r.name)) lastOk.set(r.name, r);
  }
  const errCount = new Map(errors24.map((e) => [e.name, e._count]));
  const sync = (syncKv?.value ?? null) as { at?: string; count?: number } | null;
  const nfl = (nflKv?.value ?? null) as { season?: number; week?: number; fetchedAt?: string; seasonType?: string } | null;
  const schedulerOn = process.env.JOBS_ENABLED !== "false";
  const push = pushEnabled();
  const base = { etype: sp.etype, estatus: sp.estatus, epage: sp.epage, apage: sp.apage, ascope: sp.ascope };
  // filter chips for every action family that appears in this league's log (all modules), plus the current one
  const scopes = [...new Set([...auditActions.map((a) => a.action.split(".")[0]), ...(sp.ascope ? [sp.ascope] : [])])].sort();

  const dataRows: { label: string; value: string; sub: string; stale?: boolean }[] = [
    { label: "NFL players", value: players.toLocaleString(), sub: `${activePlayers.toLocaleString()} active · synced ${sync?.at ? timeAgo(sync.at) : "never"}`, stale: !sync?.at || Date.now() - new Date(sync.at).getTime() > 3 * 864e5 },
    { label: `${season} weekly stats`, value: stats._count.toLocaleString(), sub: `through Week ${stats._max.week ?? "—"} · updated ${stats._max.updatedAt ? timeAgo(stats._max.updatedAt) : "never"}` },
    { label: `${season} projections`, value: projections._count.toLocaleString(), sub: `through Week ${projections._max.week ?? "—"} · updated ${projections._max.updatedAt ? timeAgo(projections._max.updatedAt) : "never"}` },
    { label: `${season} NFL games`, value: games._count.toLocaleString(), sub: `scores & odds updated ${games._max.updatedAt ? timeAgo(games._max.updatedAt) : "never"}` },
    { label: "News items", value: news._count.toLocaleString(), sub: `latest ${news._max.publishedAt ? timeAgo(news._max.publishedAt) : "never"}` },
    { label: "Injury reports", value: injuries._count.toLocaleString(), sub: `latest ${injuries._max.reportedAt ? timeAgo(injuries._max.reportedAt) : "never"}` },
  ];

  return (
    <div>
      <PageHeader kicker="Commissioner" title="System" subtitle="Background jobs, data feeds, email delivery, phone alerts, announcements and the commissioner action log." />

      {!schedulerOn && (
        <Alert tone="warn" className="mb-4">
          The background scheduler is turned off on this server (JOBS_ENABLED=false). Jobs only run when you press <b>Run now</b>.
        </Alert>
      )}

      <Panel id="jobs" title="Background jobs" subtitle={`${JOBS.length} jobs · times in Eastern`} noPad className="mb-4">
        <div className="overflow-x-auto">
          <table className="tbl min-w-[900px]">
            <thead>
              <tr>
                <th>Job</th>
                <th>Schedule</th>
                <th>Last run</th>
                <th>Result</th>
                <th className="num">Errors 24h</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {JOBS.map((j) => {
                const r = lastRun.get(j.name);
                const ok = lastOk.get(j.name);
                const dur = r?.finishedAt ? ((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1) : null;
                return (
                  <tr key={j.name}>
                    <td className="max-w-[22rem]">
                      <div className="font-mono text-[13px] font-semibold">{j.name}</div>
                      <div className="text-xs text-muted">{j.description}</div>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {describeCron(j.schedule)}
                      <div className="font-mono text-[10px] text-muted">{j.schedule}</div>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {r ? (
                        <span title={fmtDateTime(r.startedAt, tz)}>
                          {timeAgo(r.startedAt)}
                          {dur && <span className="text-muted"> · {dur}s</span>}
                        </span>
                      ) : j.quiet ? (
                        <span className="text-muted">Not logged (high frequency)</span>
                      ) : (
                        <span className="text-muted">No runs in 14 days</span>
                      )}
                      {r?.status === "ERROR" && ok && <div className="text-[11px] text-muted">last success {timeAgo(ok.startedAt)}</div>}
                    </td>
                    <td className="max-w-[18rem] text-xs">
                      {r ? (
                        <span className="flex items-start gap-1.5">
                          <Badge tone={r.status === "OK" ? "green" : r.status === "ERROR" ? "red" : "amber"}>{r.status}</Badge>
                          <span className="line-clamp-2 break-all text-muted" title={r.message ?? undefined}>
                            {r.message?.split("\n")[0] ?? ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={cn("num", errCount.get(j.name) && "font-bold text-loss")}>{errCount.get(j.name) ?? 0}</td>
                    <td className="text-right">
                      <RunJobButton name={j.name} heavy={HEAVY.has(j.name)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Data feeds" subtitle={nfl ? `NFL ${nfl.season} · Week ${nfl.week} (${nfl.seasonType ?? "regular"}) · checked ${nfl.fetchedAt ? timeAgo(nfl.fetchedAt) : "—"}` : "NFL state not fetched yet"} className="lg:col-span-2" noPad>
          <dl className="grid divide-line sm:grid-cols-2 sm:divide-x">
            {dataRows.map((d, i) => (
              <div key={d.label} className={cn("flex items-baseline justify-between gap-3 border-b border-line px-3 py-2.5", i % 2 === 1 && "sm:border-l-0")}>
                <dt className="text-sm font-semibold">{d.label}</dt>
                <dd className="text-right">
                  <div className={cn("font-display text-lg font-bold tabular-nums", d.stale && "text-amber-600")}>{d.value}</div>
                  <div className="text-[11px] text-muted">{d.sub}</div>
                </dd>
              </div>
            ))}
          </dl>
          <p className="px-3 py-2 text-xs text-muted">Run the matching sync job above to refresh a feed immediately.</p>
        </Panel>

        <Panel title="Delivery tests">
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 font-semibold">Email</div>
              <p className="mb-1.5 text-xs text-muted">{process.env.SMTP_HOST ? `SMTP: ${process.env.SMTP_HOST}` : "No SMTP server configured: emails are saved to the log below as previews."}</p>
              <ActionButton action={sendTestEmail} size="sm">
                Send test email to me
              </ActionButton>
            </div>
            <div>
              <div className="mb-1 font-semibold">Phone push</div>
              <p className="mb-1.5 text-xs text-muted">
                {push ? `Web push is configured · ${mySubs} device${mySubs === 1 ? "" : "s"} subscribed for you.` : "Web push is not configured (VAPID keys missing)."}{" "}
                <Link href="/settings/notifications" className="link">
                  Alert settings
                </Link>
              </p>
              <ActionButton action={sendTestPush} size="sm" disabled={!push}>
                Send test push to me
              </ActionButton>
            </div>
          </div>
        </Panel>
      </div>

      <Panel id="emails" title="Email log" subtitle={`${emailCount} email${emailCount === 1 ? "" : "s"} for this league (password resets are never shown)`} noPad className="mb-4">
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2 text-xs">
          {["", "INVITE", "RECAP", "TRADE", "GENERIC"].map((t) => (
            <Link key={t || "all"} href={qs(base, { etype: t || undefined, epage: undefined })} className={cn("chip", (sp.etype ?? "") === t && "border-brand-600 bg-brand-600 text-white")}>
              {t ? t.toLowerCase() : "All types"}
            </Link>
          ))}
          <span className="mx-1 w-px bg-line" />
          {["", "SENT", "PREVIEW", "FAILED"].map((s) => (
            <Link key={s || "any"} href={qs(base, { estatus: s || undefined, epage: undefined })} className={cn("chip", (sp.estatus ?? "") === s && "border-brand-600 bg-brand-600 text-white")}>
              {s ? s.toLowerCase() : "Any status"}
            </Link>
          ))}
        </div>
        {emails.length ? (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-xs text-muted" title={fmtDateTime(e.createdAt, tz)}>
                      {timeAgo(e.createdAt)}
                    </td>
                    <td className="text-xs">{e.to}</td>
                    <td className="max-w-[22rem] truncate text-sm">{e.subject}</td>
                    <td className="text-xs">{e.type.toLowerCase()}</td>
                    <td>
                      <Badge tone={e.status === "SENT" ? "green" : e.status === "FAILED" ? "red" : "neutral"} title={e.error ?? undefined}>
                        {e.status}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <EmailPreviewButton id={e.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-3">
            <EmptyState title="No emails yet">Invites, weekly recaps, trade alerts and test emails for this league will show up here.</EmptyState>
          </div>
        )}
        {emailCount > EMAIL_PAGE && (
          <div className="flex justify-between border-t border-line px-3 py-2 text-sm">
            {epage > 1 ? <Link className="link" href={qs(base, { epage: String(epage - 1) })}>← Newer</Link> : <span />}
            {epage * EMAIL_PAGE < emailCount && (
              <Link className="link" href={qs(base, { epage: String(epage + 1) })}>
                Older →
              </Link>
            )}
          </div>
        )}
      </Panel>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel id="announce" title="Post an announcement">
          <AnnouncementForm notifyDefault={settings.notifications.announcementsNotify} chatDefault={settings.notifications.announcementsToChat} />
        </Panel>
        <Panel title="Announcements" subtitle="Pinned announcements show at the top of the league home page" noPad>
          {announcements.length ? (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {announcements.map((a) => (
                <li key={a.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold">
                        {a.pinned && <Badge tone="gold">Pinned</Badge>}
                        <span className="truncate">{a.title}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-muted">{a.body}</p>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {a.author?.name ?? "Commissioner"} · {timeAgo(a.createdAt)}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <ActionButton action={toggleAnnouncementPin.bind(null, { id: a.id })} size="xs">
                        {a.pinned ? "Unpin" : "Pin"}
                      </ActionButton>
                      <ActionButton action={deleteAnnouncement.bind(null, { id: a.id })} size="xs" variant="ghost" confirm={`Delete "${a.title}"?`}>
                        Delete
                      </ActionButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-sm text-muted">No announcements yet.</p>
          )}
        </Panel>
      </div>

      <Panel id="audit" title="Commissioner action log" subtitle={`${auditCount} action${auditCount === 1 ? "" : "s"}${settings.commissioner.auditLogVisibleToLeague ? " · recent actions are shown publicly in the rulebook" : ""}`} noPad>
        <div className="scroll-thin flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2 text-xs">
          <Link href={qs(base, { ascope: undefined, apage: undefined })} className={cn("chip shrink-0", !sp.ascope && "border-brand-600 bg-brand-600 text-white")}>
            All
          </Link>
          {scopes.map((s) => (
            <Link key={s} href={qs(base, { ascope: s, apage: undefined })} className={cn("chip shrink-0", sp.ascope === s && "border-brand-600 bg-brand-600 text-white")}>
              {s}
            </Link>
          ))}
        </div>
        {auditRows.length ? (
          <div className="overflow-x-auto">
            <table className="tbl min-w-[680px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(a.createdAt, tz)}</td>
                    <td className="whitespace-nowrap text-xs">{a.actor?.name ?? "System"}</td>
                    <td className="whitespace-nowrap text-sm font-semibold">{auditLabel(a.action)}</td>
                    <td className="text-xs text-muted">{auditDetail(a.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-3 text-sm text-muted">No matching actions.</p>
        )}
        {auditCount > AUDIT_PAGE && (
          <div className="flex justify-between border-t border-line px-3 py-2 text-sm">
            {apage > 1 ? <Link className="link" href={qs(base, { apage: String(apage - 1) })}>← Newer</Link> : <span />}
            {apage * AUDIT_PAGE < auditCount && (
              <Link className="link" href={qs(base, { apage: String(apage + 1) })}>
                Older →
              </Link>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
