// /league — League hub. Main question: "What's going on in the league, and where do I find it?"
// Summary: week · managers · open rule votes · prize pot. Primary: the commissioner's note + announcements (3 + more).
// Secondary: the community pages the tabs don't already cover (with their counts), managers (avatar strip → all
// profiles), league info, dues & payouts, and the invite code for commissioners.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight, KeyRound, ListOrdered, Megaphone, Newspaper, Pin, Scale } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { fmtDateTime } from "@/lib/commissioner/time";
import { playoffEndWeek } from "@/lib/commissioner/settings-validate";
import { Alert, Avatar, Badge, ListRow, Meter, MoreLink, PageHeader, Panel, StatGrid, StatRow, SummaryStrip } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { LeagueTabs } from "@/components/community/bits";
import { RichText } from "@/components/community/rich-text";
import { CopyButton } from "@/components/community/copy-button";
import { fmtMoney, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "League Hub" };
export const dynamic = "force-dynamic";

const PHASE: Record<string, { label: string; tone: "brand" | "green" | "gold" | "neutral" | "purple" }> = {
  PRESEASON: { label: "Preseason", tone: "brand" },
  REGULAR: { label: "Regular season", tone: "green" },
  PLAYOFFS: { label: "Playoffs", tone: "brand" },
  OFFSEASON: { label: "Offseason", tone: "neutral" },
  KEEPER: { label: "Keeper window", tone: "purple" },
};

function IconTile({ children }: { children: React.ReactNode }) {
  return <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600/[0.08] text-brand-600 dark:bg-brand-400/15 dark:text-brand-400">{children}</span>;
}

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
  const inSeason = ctx.league.phase === "REGULAR" || ctx.league.phase === "PLAYOFFS";
  const hasDues = s.general.leagueDues > 0 || s.general.payouts.length > 0;

  const format = `${s.general.leagueType === "DYNASTY" ? "Dynasty" : s.general.leagueType === "KEEPER" ? "Keeper" : "Redraft"} · ${s.salaryCap.enabled ? "salary cap" : "no cap"} · ${
    s.scoring.preset === "HALF_PPR" ? "Half PPR" : s.scoring.preset === "CUSTOM" ? "custom scoring" : s.scoring.preset
  }`;

  return (
    <div>
      <LeagueTabs active="hub" />
      <PageHeader kicker={`League hub · ${ctx.season}`} title={ctx.league.name} />

      <SummaryStrip
        items={[
          inSeason
            ? { label: "Week", value: String(ctx.week), sub: ctx.league.phase === "PLAYOFFS" ? "Playoffs" : "Reg. season", title: `${ctx.season} · ${phase.label}` }
            : { label: "Phase", value: phase.label, sub: String(ctx.season) },
          {
            label: "Votes",
            value: String(votingProposals),
            sub: votingProposals ? "open now" : activeProposals ? `${activeProposals} in talks` : "none open",
            tone: votingProposals ? "brand" : undefined,
            href: "/rules/suggestions",
            title: "Rule votes",
          },
          hasDues
            ? { label: "Pot", value: fmtMoney(pot), sub: s.general.leagueDues > 0 ? `${paidCount}/${teamCount} paid` : undefined, title: "Prize pot · dues paid" }
            : { label: "Trades", value: String(trades), sub: String(ctx.season), href: "/trades/history" },
        ]}
      />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {s.general.commissionerMessage && (
            <Panel title="From the commissioner">
              <p className="max-w-[70ch] whitespace-pre-line text-[15px] leading-relaxed text-ink sm:text-sm">{s.general.commissionerMessage}</p>
            </Panel>
          )}

          <Panel
            title="Announcements"
            noPad
            actions={
              ctx.isCommish ? (
                <MoreLink href="/commissioner/system">
                  <Megaphone size={14} className="mr-0.5" aria-hidden /> Post
                </MoreLink>
              ) : undefined
            }
            info={<p>League-wide messages from the commissioner. Pinned posts stay on top. {ctx.isCommish ? "Post one from Commissioner › Emails & jobs — it can also notify every manager and post in chat." : ""}</p>}
          >
            {announcements.length === 0 ? (
              <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No announcements yet.</p>
            ) : (
              <div className="border-t border-line/70">
                <ShowMore as="ul" initial={3} className="divide-y divide-line/70">
                  {announcements.map((a) => (
                    <li key={a.id} className="px-4 py-3">
                      <h3 className="flex items-start gap-1.5 text-[15px] font-semibold leading-5 text-ink sm:text-sm">
                        {a.pinned && <Pin size={14} className="mt-[3px] shrink-0 text-brand-600 dark:text-brand-400" aria-label="Pinned" />}
                        <span className="min-w-0">{a.title}</span>
                      </h3>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                        {a.author && <Avatar name={a.author.name} src={a.author.avatarUrl} size={18} />}
                        <span className="truncate">{a.author?.name ?? "League office"}</span>
                        <span aria-hidden>·</span>
                        <span className="shrink-0" title={fmtDateTime(a.createdAt, tz, { withYear: true })}>
                          {timeAgo(a.createdAt)}
                        </span>
                      </div>
                      <RichText text={a.body} meId={ctx.user.id} className="mt-1.5 block max-w-[70ch] text-[15px] leading-relaxed sm:text-sm" />
                    </li>
                  ))}
                </ShowMore>
              </div>
            )}
          </Panel>

          <Panel title="Around the league" noPad>
            <ul className="divide-y divide-line/70 border-t border-line/70">
              <ListRow
                href="/rules/suggestions"
                leading={
                  <IconTile>
                    <Scale size={17} />
                  </IconTile>
                }
                title="Rule votes"
                subtitle={activeProposals ? `${activeProposals} active suggestion${activeProposals === 1 ? "" : "s"}` : "Propose & vote on changes"}
                value={String(votingProposals)}
                valueSub="open"
                chevron
              />
              <ListRow
                href="/recaps"
                leading={
                  <IconTile>
                    <Newspaper size={17} />
                  </IconTile>
                }
                title="Weekly recaps"
                subtitle="Awards, blowouts & previews"
                value={String(recaps)}
                valueSub="published"
                chevron
              />
              <ListRow
                href="/trades/history"
                leading={
                  <IconTile>
                    <ArrowLeftRight size={17} />
                  </IconTile>
                }
                title="Trade history"
                subtitle="Every completed trade"
                value={String(trades)}
                valueSub={`in ${ctx.season}`}
                chevron
              />
              <ListRow
                href="/transactions"
                leading={
                  <IconTile>
                    <ListOrdered size={17} />
                  </IconTile>
                }
                title="Transactions"
                subtitle="Adds, drops & claims"
                value={String(txCount)}
                valueSub={`in ${ctx.season}`}
                chevron
              />
            </ul>
          </Panel>

          <Panel title="Managers" noPad>
            <Link href="/managers" className="flex min-h-[60px] items-center gap-3 border-t border-line/70 px-4 py-3 transition-colors hover:bg-sunken/70 active:bg-sunken">
              <span className="flex min-w-0 flex-1 -space-x-1.5 overflow-hidden" aria-hidden>
                {members.slice(0, 7).map((m) => (
                  <Avatar key={m.userId} name={name(m)} src={m.user.avatarUrl} size={34} className="shrink-0 ring-2 ring-panel" />
                ))}
              </span>
              <span className="shrink-0 text-[15px] font-semibold text-brand-600 sm:text-sm dark:text-brand-400">All {members.length}</span>
              <ChevronRight size={16} className="-mr-1 shrink-0 text-faint" aria-hidden />
            </Link>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <Panel title="League info">
            <div className="-mt-1 divide-y divide-line/70">
              <StatRow label="Season" value={`${ctx.season}${inSeason ? ` · Wk ${ctx.week}` : ""}`} />
              <StatRow label="Phase" value={<Badge tone={phase.tone}>{phase.label}</Badge>} />
              <StatRow label="Format" value={<span className="block max-w-[200px] truncate text-right" title={format}>{format}</span>} />
              <StatRow
                label={commishes.length > 1 ? "Commissioners" : "Commissioner"}
                value={
                  <span className="flex flex-wrap justify-end gap-x-2">
                    {commishes.map((m) => (
                      <Link key={m.userId} href={`/managers/${m.userId}`} className="text-brand-600 hover:underline dark:text-brand-400">
                        {name(m)}
                        {m.role === "CO_COMMISSIONER" ? " (co)" : ""}
                      </Link>
                    ))}
                  </span>
                }
              />
              <StatRow label="Teams" value={`${teamCount} of ${s.general.teamCount}`} />
              <StatRow label="Regular season" value={`Wk ${s.general.firstWeek}–${lastReg}`} />
              <StatRow label="Playoffs" value={s.playoffs.teams ? `${s.playoffs.teams} teams · Wk ${s.playoffs.startWeek}–${finalWeek ?? s.playoffs.startWeek}` : "None"} />
              {s.salaryCap.enabled && <StatRow label="Salary cap" value={`${fmtMoney(s.salaryCap.cap)}${s.salaryCap.floor ? ` · floor ${fmtMoney(s.salaryCap.floor)}` : ""}`} />}
              {s.waivers.type === "FAB" && <StatRow label="FAB budget" value={fmtMoney(s.waivers.faabBudget)} />}
              <StatRow label="Trade deadline" value={s.trades.enabled ? (s.trades.deadlineWeek ? `Week ${s.trades.deadlineWeek}` : "None") : "Trading off"} />
            </div>
            <div className="mt-2">
              <MoreLink href="/rules">Full rulebook</MoreLink>
            </div>
          </Panel>

          <Panel title="Dues & payouts">
            {hasDues ? (
              <>
                <StatGrid
                  cols={2}
                  items={[
                    { label: "Dues / team", value: fmtMoney(s.general.leagueDues) },
                    { label: "Total pot", value: fmtMoney(pot) },
                  ]}
                />
                {s.general.leagueDues > 0 && (
                  <Meter
                    className="mt-4"
                    value={paidCount}
                    max={Math.max(1, teamCount)}
                    tone="good"
                    caption={s.general.duesDueDate ? `Paid · due ${fmtDateTime(s.general.duesDueDate, tz, { dateOnly: true, withYear: true })}` : "Paid"}
                    valueText={`${paidCount} of ${teamCount}`}
                  />
                )}
                {s.general.payouts.length > 0 && (
                  <div className="mt-3 divide-y divide-line/70 border-t border-line/70">
                    {s.general.payouts.map((p) => (
                      <StatRow key={p.place} label={p.place} value={fmtMoney(p.amount)} />
                    ))}
                  </div>
                )}
                {pot > 0 && payoutTotal !== pot && s.general.payouts.length > 0 && (
                  <p className="mt-2 text-[13px] text-muted">
                    Payouts total {fmtMoney(payoutTotal)} of {fmtMoney(pot)}
                    {payoutTotal < pot ? ` · ${fmtMoney(pot - payoutTotal)} unassigned` : ""}
                  </p>
                )}
                {s.niche.weeklyHighScorePrize > 0 && <p className="mt-2 text-[13px] text-muted">Weekly high score prize: {fmtMoney(s.niche.weeklyHighScorePrize)}</p>}
              </>
            ) : (
              <p className="text-[15px] text-muted sm:text-sm">This league doesn&apos;t collect dues.</p>
            )}
          </Panel>

          {ctx.isCommish && (
            <Panel title="Invite managers" subtitle="Commissioners only" info={<p>New managers sign up with this code (or the sign-up link) and land on their profile setup page.</p>}>
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="shrink-0 text-muted" aria-hidden />
                <code className="min-w-0 flex-1 truncate rounded-control bg-sunken px-3 py-2 font-mono text-[15px] font-bold tracking-wider">{ctx.league.inviteCode}</code>
                <CopyButton value={ctx.league.inviteCode} label="Code" size="md" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <CopyButton value={`/signup?code=${encodeURIComponent(ctx.league.inviteCode)}`} absolute label="Copy sign-up link" size="md" className="flex-1 sm:flex-none" />
                <MoreLink href="/commissioner/members">Members & invites</MoreLink>
              </div>
            </Panel>
          )}
          {!ctx.myTeam && <Alert tone="info">You don&apos;t manage a team yet — the commissioner can assign you one.</Alert>}
        </aside>
      </div>
    </div>
  );
}
