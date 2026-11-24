// /league — League hub: league info (phase, commissioner, dues & payouts, invite code for commissioners),
// commissioner message, announcements and quick links into every community page.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, BookOpen, History, KeyRound, ListOrdered, Megaphone, MessageCircle, Newspaper, Pin, Scale, Users } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { fmtDateTime } from "@/lib/commissioner/time";
import { playoffEndWeek } from "@/lib/commissioner/settings-validate";
import { Alert, Avatar, Badge, ButtonLink, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
import { LeagueTabs } from "@/components/community/bits";
import { RichText } from "@/components/community/rich-text";
import { CopyButton } from "@/components/community/copy-button";
import { cn, fmtMoney, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "League Hub" };
export const dynamic = "force-dynamic";

const PHASE: Record<string, { label: string; tone: "brand" | "green" | "gold" | "neutral" | "purple" }> = {
  PRESEASON: { label: "Preseason", tone: "brand" },
  REGULAR: { label: "Regular season", tone: "green" },
  PLAYOFFS: { label: "Playoffs", tone: "gold" },
  OFFSEASON: { label: "Offseason", tone: "neutral" },
  KEEPER: { label: "Keeper window", tone: "purple" },
};

export default async function LeagueHubPage() {
  const ctx = await getLeagueContext();
  const s = ctx.settings;
  const tz = s.general.timezone;
  const [members, announcements, activeProposals, votingProposals, recaps, trades, txCount] = await Promise.all([
    db.leagueMember.findMany({
      where: { leagueId: ctx.league.id },
      orderBy: { joinedAt: "asc" },
      select: { userId: true, role: true, user: { select: { name: true, avatarUrl: true, profile: { select: { displayName: true } } } }, team: { select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } } },
    }),
    db.leagueAnnouncement.findMany({ where: { leagueId: ctx.league.id }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 8, include: { author: { select: { id: true, name: true, avatarUrl: true } } } }),
    db.ruleProposal.count({ where: { leagueId: ctx.league.id, status: { in: ["OPEN", "VOTING"] } } }),
    db.ruleProposal.count({ where: { leagueId: ctx.league.id, status: "VOTING", OR: [{ votingEndsAt: null }, { votingEndsAt: { gt: new Date() } }] } }),
    db.weeklyRecap.count({ where: { leagueId: ctx.league.id } }),
    db.trade.count({ where: { leagueId: ctx.league.id, season: ctx.season, status: "COMPLETED" } }),
    db.transaction.count({ where: { leagueId: ctx.league.id, season: ctx.season } }),
  ]);
  const teamIds = (await db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true } })).map((t) => t.id);
  const teamCount = teamIds.length;
  const commishes = members.filter((m) => m.role !== "MANAGER");
  const name = (m: (typeof members)[number]) => m.user.profile?.displayName?.trim() || m.user.name;
  const phase = PHASE[ctx.league.phase] ?? { label: ctx.league.phase, tone: "neutral" as const };
  const lastReg = s.general.firstWeek + s.general.regularSeasonWeeks - 1;
  const finalWeek = playoffEndWeek(s.playoffs);
  const paid = new Set(s.general.duesPaidTeamIds);
  const paidCount = teamIds.filter((id) => paid.has(id)).length;
  const payoutTotal = s.general.payouts.reduce((a, p) => a + p.amount, 0);
  const pot = s.general.leagueDues * teamCount;

  const links = [
    { href: "/chat", label: "League Chat", desc: "Live chat, trash talk & DMs", icon: MessageCircle },
    { href: "/managers", label: "Managers", desc: `${members.length} profiles & in-depth stats`, icon: Users },
    { href: "/rules", label: "Rulebook", desc: "Every league rule & setting", icon: BookOpen },
    { href: "/rules/suggestions", label: "Rule Suggestions", desc: votingProposals ? `${votingProposals} vote${votingProposals === 1 ? "" : "s"} open now` : activeProposals ? `${activeProposals} in discussion` : "Propose & vote on changes", icon: Scale, hot: votingProposals > 0 },
    { href: "/recaps", label: "Weekly Recaps", desc: recaps ? `${recaps} recap${recaps === 1 ? "" : "s"} published` : "Awards, blowouts & previews", icon: Newspaper },
    { href: "/history", label: "History & Records", desc: "Champions, records, trophy case", icon: History },
    { href: "/trades/history", label: "Trade History", desc: `${trades} trade${trades === 1 ? "" : "s"} in ${ctx.season}`, icon: ArrowLeftRight },
    { href: "/transactions", label: "Transactions", desc: `${txCount} move${txCount === 1 ? "" : "s"} in ${ctx.season}`, icon: ListOrdered },
  ];

  const info: [string, React.ReactNode][] = [
    ["Season", `${ctx.season}${ctx.league.phase === "REGULAR" || ctx.league.phase === "PLAYOFFS" ? ` · Week ${ctx.week}` : ""}`],
    ["Phase", <Badge key="p" tone={phase.tone}>{phase.label}</Badge>],
    ["Format", `${s.general.leagueType === "DYNASTY" ? "Dynasty" : s.general.leagueType === "KEEPER" ? "Keeper" : "Redraft"} · ${s.salaryCap.enabled ? "salary cap" : "no cap"} · ${s.scoring.preset === "HALF_PPR" ? "Half PPR" : s.scoring.preset === "CUSTOM" ? "custom scoring" : s.scoring.preset}`],
    [
      commishes.length > 1 ? "Commissioners" : "Commissioner",
      <span key="c" className="flex flex-wrap justify-end gap-x-2">
        {commishes.map((m) => (
          <Link key={m.userId} href={`/managers/${m.userId}`} className="link">
            {name(m)}
            {m.role === "CO_COMMISSIONER" ? " (co)" : ""}
          </Link>
        ))}
      </span>,
    ],
    ["Managers", `${members.length} managers · ${teamCount} of ${s.general.teamCount} teams`],
    ["Regular season", `Weeks ${s.general.firstWeek}–${lastReg}`],
    ["Playoffs", s.playoffs.teams ? `${s.playoffs.teams} teams · Weeks ${s.playoffs.startWeek}–${finalWeek ?? s.playoffs.startWeek}` : "None"],
    ...(s.salaryCap.enabled ? ([["Salary cap", `${fmtMoney(s.salaryCap.cap)}${s.salaryCap.floor ? ` (floor ${fmtMoney(s.salaryCap.floor)})` : ""}`]] as [string, React.ReactNode][]) : []),
    ...(s.waivers.type === "FAB" ? ([["FAB budget", fmtMoney(s.waivers.faabBudget)]] as [string, React.ReactNode][]) : []),
    ["Trade deadline", s.trades.enabled ? (s.trades.deadlineWeek ? `Week ${s.trades.deadlineWeek}` : "None") : "Trading disabled"],
  ];

  return (
    <div>
      <LeagueTabs active="hub" />
      <PageHeader
        kicker="League hub"
        title={ctx.league.name}
        subtitle={`${ctx.season} season · ${phase.label} · ${members.length} managers`}
        actions={
          <>
            <ButtonLink href="/chat" variant="secondary" size="sm">
              <MessageCircle size={14} /> Chat
            </ButtonLink>
            <ButtonLink href="/rules" size="sm">
              <BookOpen size={14} /> Rulebook
            </ButtonLink>
          </>
        }
      />

      {s.general.commissionerMessage && (
        <div className="mb-4 rounded-lg border-l-4 border-gold-500 bg-gold-300/15 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gold-700 dark:text-gold-300">From the commissioner</div>
          <p className="mt-0.5 whitespace-pre-line text-[15px] italic">{s.general.commissionerMessage}</p>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <nav aria-label="League pages" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn("group flex flex-col gap-1 rounded-lg border bg-panel p-3 shadow-panel transition-colors hover:border-brand-400 hover:bg-sunken/50", l.hot ? "border-gold-400" : "border-line")}
              >
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-md text-white", l.hot ? "bg-gold-500" : "bg-brand-700 dark:bg-brand-600")}>
                  <l.icon size={16} />
                </span>
                <span className="font-semibold leading-tight group-hover:underline">{l.label}</span>
                <span className="text-xs leading-snug text-muted">{l.desc}</span>
              </Link>
            ))}
          </nav>

          <Panel
            title="Announcements"
            subtitle="From the league office"
            noPad
            actions={
              ctx.isCommish ? (
                <ButtonLink href="/commissioner/system" variant="secondary" size="xs">
                  <Megaphone size={12} /> Post / manage
                </ButtonLink>
              ) : undefined
            }
          >
            {announcements.length === 0 ? (
              <p className="p-4 text-sm text-muted">No announcements yet.{ctx.isCommish ? " Post one from Commissioner › Emails & Jobs — it can also notify every manager and post in chat." : " The commissioner's league-wide messages will appear here."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {announcements.map((a) => (
                  <li key={a.id} className={cn("px-3 py-3", a.pinned && "bg-gold-300/10")}>
                    <div className="flex items-start gap-2">
                      {a.pinned && <Pin size={14} className="mt-1 shrink-0 text-gold-600" aria-label="Pinned" />}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display text-base font-bold leading-snug">{a.title}</h3>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                          {a.author && <Avatar name={a.author.name} src={a.author.avatarUrl} size={16} />}
                          <span>{a.author?.name ?? "League office"}</span>·<span title={fmtDateTime(a.createdAt, tz, { withYear: true })}>{timeAgo(a.createdAt)}</span>
                        </div>
                        <RichText text={a.body} meId={ctx.user.id} className="mt-1.5 block text-sm leading-relaxed" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Managers" noPad actions={<Link href="/managers" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">All profiles →</Link>}>
            <ul className="-mb-px grid grid-cols-1 sm:grid-cols-2">
              {members.map((m) => (
                <li key={m.userId} className="border-b border-line sm:odd:border-r">
                  <Link href={`/managers/${m.userId}`} className="flex items-center gap-2.5 px-3 py-2 hover:bg-sunken">
                    <Avatar name={name(m)} src={m.user.avatarUrl} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {name(m)}
                        {m.role !== "MANAGER" && <Badge tone="gold">{m.role === "COMMISSIONER" ? "Commish" : "Co"}</Badge>}
                      </span>
                      <span className="block truncate text-[11px] text-muted">{m.team?.name ?? "No team"}</span>
                    </span>
                    {m.team && <TeamLogo team={m.team} size={24} />}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-14">
          <Panel title="League info">
            <dl className="space-y-1.5 text-sm">
              {info.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-muted">{k}</dt>
                  <dd className="text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Dues & payouts">
            {s.general.leagueDues > 0 || s.general.payouts.length > 0 ? (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Dues per team</div>
                    <div className="font-display text-2xl font-bold">{fmtMoney(s.general.leagueDues)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Total pot</div>
                    <div className="font-display text-2xl font-bold">{fmtMoney(pot)}</div>
                  </div>
                </div>
                {s.general.leagueDues > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-muted">
                      <span>
                        {paidCount} of {teamCount} teams paid
                      </span>
                      {s.general.duesDueDate && <span>Due {fmtDateTime(s.general.duesDueDate, tz, { dateOnly: true, withYear: true })}</span>}
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line">
                      <div className="h-full bg-win" style={{ width: `${teamCount ? Math.round((paidCount / teamCount) * 100) : 0}%` }} />
                    </div>
                  </div>
                )}
                {s.general.payouts.length > 0 && (
                  <table className="tbl mt-3 w-full">
                    <thead>
                      <tr>
                        <th className="text-left">Place</th>
                        <th className="num">Payout</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.general.payouts.map((p) => (
                        <tr key={p.place}>
                          <td className="font-semibold">{p.place}</td>
                          <td className="text-right tabular-nums">{fmtMoney(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {pot > 0 && payoutTotal !== pot && s.general.payouts.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted">
                    Payouts total {fmtMoney(payoutTotal)} of the {fmtMoney(pot)} pot{payoutTotal < pot ? ` · ${fmtMoney(pot - payoutTotal)} unassigned` : ""}.
                  </p>
                )}
                {s.niche.weeklyHighScorePrize > 0 && <p className="mt-2 text-xs text-muted">Weekly high score prize: {fmtMoney(s.niche.weeklyHighScorePrize)}</p>}
              </>
            ) : (
              <p className="text-sm text-muted">This league doesn&apos;t collect dues.</p>
            )}
          </Panel>

          {ctx.isCommish && (
            <Panel title="Invite managers" subtitle="Visible to commissioners only">
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="shrink-0 text-gold-600" />
                <code className="flex-1 truncate rounded bg-sunken px-2 py-1 font-mono text-sm font-bold tracking-wider ring-1 ring-line">{ctx.league.inviteCode}</code>
                <CopyButton value={ctx.league.inviteCode} label="Code" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyButton value={`/signup?code=${encodeURIComponent(ctx.league.inviteCode)}`} absolute label="Copy sign-up link" />
                <ButtonLink href="/commissioner/members" variant="ghost" size="xs">
                  Members & invites →
                </ButtonLink>
              </div>
              <p className="mt-2 text-[11px] text-muted">New managers sign up with this code and land on their profile setup page.</p>
            </Panel>
          )}
          {!ctx.myTeam && <Alert tone="info">You don&apos;t manage a team yet — the commissioner can assign you one.</Alert>}
        </aside>
      </div>
    </div>
  );
}
