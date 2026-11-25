import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { JOBS } from "@/lib/jobs/registry";
import { pushEnabled } from "@/lib/notify";
import { ChevronDown } from "lucide-react";
import { Alert, Badge, chipClass, EmptyState, PageHeader, Panel, SummaryStrip } from "@/components/ui/core";
import { ActionButton, ShowMore } from "@/components/ui/client";
import { ScrollRow } from "@/components/ui/scroll-row";
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

  const jobsOk = JOBS.filter((j) => lastRun.get(j.name)?.status !== "ERROR").length;
  const errorsDay = errors24Total(errCount);
  const chip = (active: boolean) => chipClass(active, "sm");

  return (
    <div>
      <PageHeader title="System" subtitle="Jobs, data feeds, email and the action log" />
      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Jobs", value: `${jobsOk}/${JOBS.length}`, tone: jobsOk < JOBS.length ? "bad" : "good", sub: "healthy", href: "#jobs" },
          { label: "Errors", value: errorsDay, tone: errorsDay ? "bad" : undefined, sub: "last 24h", href: "#jobs" },
          { label: "Emails", value: emailCount, sub: "logged", href: "#emails" },
          { label: "Push", value: push ? "On" : "Off", tone: push ? undefined : "muted", sub: `${mySubs} device${mySubs === 1 ? "" : "s"}` },
        ]}
      />

      {!schedulerOn && (
        <Alert tone="warn" icon className="mb-4">
          The background scheduler is off on this server (JOBS_ENABLED=false). Jobs only run when you press <b>Run now</b>.
        </Alert>
      )}

      <Panel id="jobs" title="Background jobs" subtitle={`${JOBS.length} jobs · times in Eastern`} info={<p>Each job runs on its schedule. Tap a job for its description, schedule, last result and a Run now button. Data feed jobs call external providers and can take a minute.</p>} noPad className="mb-4 scroll-mt-4">
        {/* phones: one row per job, tap for the details and Run now */}
        <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
          {JOBS.map((j) => {
            const r = lastRun.get(j.name);
            const ok = lastOk.get(j.name);
            const dur = r?.finishedAt ? ((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1) : null;
            const errs = errCount.get(j.name) ?? 0;
            return (
              <li key={j.name}>
                <details className="group">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[14px] font-semibold leading-5 text-ink">{j.name}</span>
                      <span className="block truncate text-[13px] leading-[18px] text-muted">
                        {r ? `${timeAgo(r.startedAt)}${dur ? ` · ${dur}s` : ""}` : j.quiet ? "Not logged" : "No runs in 14 days"}
                        {errs ? <span className="font-semibold text-loss"> · {errs} error{errs === 1 ? "" : "s"}</span> : null}
                      </span>
                    </span>
                    {r && <Badge tone={r.status === "OK" ? "green" : r.status === "ERROR" ? "red" : "amber"}>{r.status}</Badge>}
                    <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="space-y-2 bg-sunken px-4 py-3 text-[14px]">
                    <p className="text-ink">{j.description}</p>
                    <p>
                      <span className="eyebrow mr-1.5">Schedule</span>
                      {describeCron(j.schedule)} <span className="font-mono text-[12px] text-muted">{j.schedule}</span>
                    </p>
                    {r?.status === "ERROR" && ok && (
                      <p>
                        <span className="eyebrow mr-1.5">Last success</span>
                        {timeAgo(ok.startedAt)}
                      </p>
                    )}
                    {r?.message && <p className="whitespace-pre-wrap break-words rounded-lg bg-panel px-3 py-2 font-mono text-[12px] leading-relaxed text-muted">{r.message}</p>}
                    <RunJobButton name={j.name} heavy={HEAVY.has(j.name)} size="sm" />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <div className="hidden overflow-x-auto border-t border-line/70 md:block">
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
                      <div className="text-[12px] text-muted">{j.description}</div>
                    </td>
                    <td className="whitespace-nowrap text-[13px]">
                      {describeCron(j.schedule)}
                      <div className="font-mono text-[12px] text-muted">{j.schedule}</div>
                    </td>
                    <td className="whitespace-nowrap text-[13px]">
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
                      {r?.status === "ERROR" && ok && <div className="text-[12px] text-muted">last success {timeAgo(ok.startedAt)}</div>}
                    </td>
                    <td className="max-w-[18rem] text-[13px]">
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
        <Panel
          title="Data feeds"
          subtitle={nfl ? `NFL ${nfl.season} · Week ${nfl.week} · checked ${nfl.fetchedAt ? timeAgo(nfl.fetchedAt) : "—"}` : "NFL state not fetched yet"}
          info={<p>Run the matching sync job above to refresh a feed immediately. A feed shown in amber hasn&apos;t synced for more than 3 days.</p>}
          className="lg:col-span-2"
          noPad
        >
          <dl className="grid border-t border-line/70 sm:grid-cols-2">
            {dataRows.map((d) => (
              <div key={d.label} className="flex min-h-[56px] items-center justify-between gap-3 border-b border-line/70 px-4 py-2 sm:odd:border-r">
                <dt className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink sm:text-sm">{d.label}</span>
                  <span className="block truncate text-[13px] text-muted">{d.sub}</span>
                </dt>
                <dd className={cn("numeral shrink-0 text-[17px] font-semibold", d.stale ? "text-amber-700 dark:text-amber-300" : "text-ink")}>{d.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="Delivery tests" info={<p>Send yourself a test to check email and phone alerts. {process.env.SMTP_HOST ? `SMTP: ${process.env.SMTP_HOST}.` : "No SMTP server is configured: emails are saved to the log as previews."}</p>}>
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-[15px] font-semibold text-ink sm:text-sm">Email</div>
              <p className="mb-2 text-[13px] text-muted">{process.env.SMTP_HOST ? `SMTP: ${process.env.SMTP_HOST}` : "No SMTP: saved to the log as previews."}</p>
              <ActionButton action={sendTestEmail} size="md">
                Send test email
              </ActionButton>
            </div>
            <div>
              <div className="mb-1 text-[15px] font-semibold text-ink sm:text-sm">Phone push</div>
              <p className="mb-2 text-[13px] text-muted">
                {push ? `${mySubs} device${mySubs === 1 ? "" : "s"} subscribed for you · ` : "Not configured (VAPID keys missing) · "}
                <Link href="/settings/notifications" className="link">
                  Alert settings
                </Link>
              </p>
              <ActionButton action={sendTestPush} size="md" disabled={!push}>
                Send test push
              </ActionButton>
            </div>
          </div>
        </Panel>
      </div>

      <Panel id="emails" title="Email log" subtitle={`${emailCount} email${emailCount === 1 ? "" : "s"}`} info={<p>Every email sent for this league. Password resets are never shown.</p>} noPad className="mb-4 scroll-mt-4">
        <ScrollRow className="gap-2 border-t border-line/70 px-4 py-2.5" aria-label="Email filters">
          {["", "INVITE", "RECAP", "TRADE", "GENERIC"].map((t) => (
            <Link key={t || "all"} href={qs(base, { etype: t || undefined, epage: undefined })} scroll={false} aria-current={(sp.etype ?? "") === t ? "page" : undefined} className={chip((sp.etype ?? "") === t)}>
              {t ? t.charAt(0) + t.slice(1).toLowerCase() : "All types"}
            </Link>
          ))}
          <span className="mx-0.5 w-px shrink-0 self-stretch bg-line" aria-hidden />
          {["", "SENT", "PREVIEW", "FAILED"].map((x) => (
            <Link key={x || "any"} href={qs(base, { estatus: x || undefined, epage: undefined })} scroll={false} className={chip((sp.estatus ?? "") === x)}>
              {x ? x.charAt(0) + x.slice(1).toLowerCase() : "Any status"}
            </Link>
          ))}
        </ScrollRow>
        {emails.length ? (
          <>
            <div className="md:hidden">
              <ShowMore as="ul" initial={8} className="divide-y divide-line/70 border-t border-line/70">
                {emails.map((e) => (
                  <li key={e.id} className="flex min-h-[60px] items-center gap-2 py-2 pl-4 pr-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold leading-5 text-ink" title={e.subject}>
                        {e.subject}
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-muted" title={e.error ?? undefined}>
                        <span className={cn("font-semibold", e.status === "SENT" ? "text-win" : e.status === "FAILED" ? "text-loss" : "text-muted")}>{e.status.charAt(0) + e.status.slice(1).toLowerCase()}</span> · {timeAgo(e.createdAt)} · {e.to}
                      </span>
                    </span>
                    <EmailPreviewButton id={e.id} iconOnly />
                  </li>
                ))}
              </ShowMore>
            </div>
            <div className="hidden overflow-x-auto border-t border-line/70 md:block">
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
                      <td className="whitespace-nowrap text-[13px] text-muted" title={fmtDateTime(e.createdAt, tz)}>
                        {timeAgo(e.createdAt)}
                      </td>
                      <td className="text-[13px]">{e.to}</td>
                      <td className="max-w-[22rem] truncate text-sm">{e.subject}</td>
                      <td className="text-[13px]">{e.type.toLowerCase()}</td>
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
          </>
        ) : (
          <div className="px-4 pb-4">
            <EmptyState title="No emails yet">Invites, recaps, trade alerts and test emails show up here.</EmptyState>
          </div>
        )}
        {emailCount > EMAIL_PAGE && (
          <div className="flex justify-between border-t border-line/70 px-4 text-[15px] sm:text-sm">
            {epage > 1 ? (
              <Link className="link inline-flex min-h-11 items-center" href={qs(base, { epage: String(epage - 1) })}>
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            {epage * EMAIL_PAGE < emailCount && (
              <Link className="link inline-flex min-h-11 items-center" href={qs(base, { epage: String(epage + 1) })}>
                Older →
              </Link>
            )}
          </div>
        )}
      </Panel>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel id="announce" title="Post an announcement" className="scroll-mt-4">
          <AnnouncementForm notifyDefault={settings.notifications.announcementsNotify} chatDefault={settings.notifications.announcementsToChat} />
        </Panel>
        <Panel title="Announcements" subtitle={`${announcements.length} · pinned show on League Home`} noPad>
          {announcements.length ? (
            <ShowMore as="ul" initial={4} className="divide-y divide-line/70 border-t border-line/70">
              {announcements.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {a.pinned && <Badge tone="brand">Pinned</Badge>}
                    <span className="truncate text-[15px] font-semibold text-ink sm:text-sm" title={a.title}>
                      {a.title}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-[13px] text-muted">{a.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] text-muted">
                      {a.author?.name ?? "Commissioner"} · {timeAgo(a.createdAt)}
                    </span>
                    <span className="flex gap-1.5">
                      <ActionButton action={toggleAnnouncementPin.bind(null, { id: a.id })} size="sm">
                        {a.pinned ? "Unpin" : "Pin"}
                      </ActionButton>
                      <ActionButton action={deleteAnnouncement.bind(null, { id: a.id })} size="sm" variant="ghost" confirm={`Delete "${a.title}"?`}>
                        Delete
                      </ActionButton>
                    </span>
                  </div>
                </li>
              ))}
            </ShowMore>
          ) : (
            <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">No announcements yet.</p>
          )}
        </Panel>
      </div>

      <Panel
        id="audit"
        title="Action log"
        subtitle={`${auditCount} action${auditCount === 1 ? "" : "s"}`}
        info={<p>Every commissioner action.{settings.commissioner.auditLogVisibleToLeague ? " Recent actions are also shown publicly in the rulebook." : ""}</p>}
        noPad
        className="scroll-mt-4"
      >
        <ScrollRow className="gap-2 border-t border-line/70 px-4 py-2.5" aria-label="Action filters">
          <Link href={qs(base, { ascope: undefined, apage: undefined })} scroll={false} aria-current={!sp.ascope ? "page" : undefined} className={chip(!sp.ascope)}>
            All
          </Link>
          {scopes.map((x) => (
            <Link key={x} href={qs(base, { ascope: x, apage: undefined })} scroll={false} aria-current={sp.ascope === x ? "page" : undefined} className={chip(sp.ascope === x)}>
              {x}
            </Link>
          ))}
        </ScrollRow>
        {auditRows.length ? (
          <>
            <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
              {auditRows.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{auditLabel(a.action)}</span>
                    <span className="shrink-0 text-[12px] text-muted" title={fmtDateTime(a.createdAt, tz)}>
                      {timeAgo(a.createdAt)}
                    </span>
                  </div>
                  <div className="break-words text-[13px] leading-snug text-muted">
                    {a.actor?.name ?? "System"}
                    {auditDetail(a.details) ? ` · ${auditDetail(a.details)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto border-t border-line/70 md:block">
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
                      <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(a.createdAt, tz)}</td>
                      <td className="whitespace-nowrap text-[13px]">{a.actor?.name ?? "System"}</td>
                      <td className="whitespace-nowrap text-sm font-semibold">{auditLabel(a.action)}</td>
                      <td className="break-words text-[13px] text-muted">{auditDetail(a.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">No matching actions.</p>
        )}
        {auditCount > AUDIT_PAGE && (
          <div className="flex justify-between border-t border-line/70 px-4 text-[15px] sm:text-sm">
            {apage > 1 ? (
              <Link className="link inline-flex min-h-11 items-center" href={qs(base, { apage: String(apage - 1) })}>
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            {apage * AUDIT_PAGE < auditCount && (
              <Link className="link inline-flex min-h-11 items-center" href={qs(base, { apage: String(apage + 1) })}>
                Older →
              </Link>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function errors24Total(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}
