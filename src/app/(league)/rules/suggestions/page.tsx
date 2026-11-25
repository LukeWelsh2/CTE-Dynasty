// /rules/suggestions — the league's rule suggestion board: propose, discuss, vote, adopt.
// Main question: "What's up for a vote, and have I voted?" Summary: voting · in discussion · adopted · votes to pass.
// Controls: status chips (with counts) + category / sort. Primary: proposals as rows (vote buttons, status, title,
// 2-line excerpt, support bar, meta). Secondary: recently adopted; "How it works" collapsed.
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CalendarClock, CheckCircle2, ChevronRight, MessageSquare, Scale, Wand2 } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { plainText } from "@/lib/chat/format";
import { fmtDateTime } from "@/lib/commissioner/time";
import {
  PROPOSAL_CATEGORIES,
  STATUS_META,
  matchesStatus,
  sortProposals,
  tallyVotes,
  voteOutcome,
  votingEnded,
  votingOpen,
  type ProposalSort,
  type ProposalStatus,
  type StatusFilter,
} from "@/lib/proposals/logic";
import { Avatar, Badge, ButtonLink, Chip, Collapsible, EmptyState, ListRow, PageHeader, Panel, SummaryStrip } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { LeagueTabs } from "@/components/community/bits";
import { CategoryBadge, StatusBadge, VoteBar } from "@/components/community/proposal-bits";
import { ProposalEditorButton, ProposalLiveRefresh, UrlSelect, VoteButtons } from "@/components/community/proposals";
import { cn, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Rule Suggestions" };
export const dynamic = "force-dynamic";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "VOTING", label: "Voting" },
  { key: "OPEN", label: "Discussion" },
  { key: "ADOPTED", label: "Adopted" },
  { key: "REJECTED", label: "Rejected" },
  { key: "TABLED", label: "Tabled" },
  { key: "WITHDRAWN", label: "Withdrawn" },
  { key: "all", label: "All" },
];
const SORTS: { value: ProposalSort; label: string }[] = [
  { value: "ending", label: "Ending soon" },
  { value: "top", label: "Top votes" },
  { value: "newest", label: "Newest" },
];

function countdown(to: Date, now: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return "closed";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string; sort?: string }> }) {
  const sp = await searchParams;
  const ctx = await getLeagueContext();
  const now = new Date();
  const tz = ctx.settings.general.timezone;
  const threshold = ctx.settings.commissioner.voteThresholdPercent;

  const [rows, members] = await Promise.all([
    db.ruleProposal.findMany({
      where: { leagueId: ctx.league.id },
      include: { votes: { select: { userId: true, value: true } }, _count: { select: { comments: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.leagueMember.findMany({ where: { leagueId: ctx.league.id }, select: { userId: true, team: { select: { name: true } } } }),
  ]);
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const authors = await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, avatarUrl: true, profile: { select: { displayName: true } } } });
  const authorBy = new Map(authors.map((a) => [a.id, a]));
  const teamBy = new Map(members.map((m) => [m.userId, m.team?.name ?? null]));
  const managers = members.length;

  const list = rows.map((r) => {
    const tally = tallyVotes(r.votes.map((v) => v.value), managers);
    return { ...r, tally, support: tally.support, oppose: tally.oppose, myVote: r.votes.find((v) => v.userId === ctx.user.id)?.value ?? null, outcome: voteOutcome(tally, threshold) };
  });

  const status = (FILTERS.some((f) => f.key === sp.status) ? sp.status : "active") as StatusFilter;
  const category = PROPOSAL_CATEGORIES.some((c) => c.value === sp.category) ? sp.category! : "";
  const sort = (SORTS.some((s) => s.value === sp.sort) ? sp.sort : "ending") as ProposalSort;
  const counts = new Map(FILTERS.map((f) => [f.key, list.filter((p) => matchesStatus(p.status, f.key) && (!category || p.category === category)).length]));
  const shown = sortProposals(
    list.filter((p) => matchesStatus(p.status, status) && (!category || p.category === category)),
    sort,
    now,
  );
  const recentAdopted = list.filter((p) => p.status === "ADOPTED").sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0)).slice(0, 5);
  const needVotes = list.filter((p) => p.status === "VOTING" && votingOpen(p, now) && p.myVote === null).length;
  const needed = voteOutcome(tallyVotes([], managers), threshold).needed;
  const votingNow = list.filter((p) => p.status === "VOTING" && votingOpen(p, now)).length;
  const filterHref = (key: StatusFilter) => {
    const q = new URLSearchParams();
    if (key !== "active") q.set("status", key);
    if (category) q.set("category", category);
    if (sort !== "ending") q.set("sort", sort);
    const s = q.toString();
    return s ? `/rules/suggestions?${s}` : "/rules/suggestions";
  };

  return (
    <div>
      <ProposalLiveRefresh leagueId={ctx.league.id} />
      <LeagueTabs active="suggestions" />
      <PageHeader
        kicker="League rules"
        title="Rule votes"
        subtitle={`${needed} of ${managers} managers (${threshold}%) must support a rule to pass`}
        actions={
          <>
            <ButtonLink href="/rules" variant="secondary" size="md">
              <BookOpen size={15} /> Rulebook
            </ButtonLink>
            <ProposalEditorButton isCommish={ctx.isCommish} season={ctx.season} size="md" />
          </>
        }
      />

      <SummaryStrip
        items={[
          { label: "Voting", value: String(votingNow), sub: needVotes ? `${needVotes} need you` : "open now", tone: needVotes ? "brand" : undefined, href: "/rules/suggestions?status=VOTING" },
          { label: "Talks", value: String(counts.get("OPEN") ?? 0), sub: "open", title: "In discussion", href: "/rules/suggestions?status=OPEN" },
          { label: "Adopted", value: String(list.filter((p) => p.status === "ADOPTED").length), sub: "all time", href: "/rules/suggestions?status=ADOPTED" },
          { label: "To pass", value: `${needed}/${managers}`, sub: `${threshold}%` },
        ]}
      />

      {needVotes > 0 && (
        <Link
          href="/rules/suggestions?status=VOTING"
          className="mt-3 flex min-h-12 items-center gap-3 rounded-card bg-brand-600/[0.08] px-4 py-2 text-[15px] font-semibold text-ink transition-colors hover:bg-brand-600/[0.12] sm:text-sm dark:bg-brand-400/15"
        >
          <Scale size={18} className="shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
          <span className="min-w-0 flex-1">{needVotes === 1 ? "1 rule needs your vote" : `${needVotes} rules need your vote`}</span>
          <span className="inline-flex shrink-0 items-center text-brand-600 dark:text-brand-400">
            Vote <ChevronRight size={16} aria-hidden />
          </span>
        </Link>
      )}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="mb-3 space-y-2">
            <ScrollRow as="nav" aria-label="Filter by status" snap={false} className="-mx-3 gap-2 px-3 sm:mx-0 sm:px-0">
              {FILTERS.map((f) => {
                const n = counts.get(f.key) ?? 0;
                return (
                  <Chip key={f.key} href={filterHref(f.key)} active={f.key === status} count={n} scroll={false}>
                    {f.label}
                  </Chip>
                );
              })}
            </ScrollRow>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <UrlSelect param="category" label="Category" value={category} options={[{ value: "", label: "All" }, ...PROPOSAL_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]} />
              <UrlSelect param="sort" label="Sort" value={sort} options={SORTS} />
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState title={list.length ? "No proposals match these filters" : "No rule suggestions yet"} icon={<Scale size={28} />}>
              {list.length ? (
                <>
                  Try another status or category.{" "}
                  <Link href="/rules/suggestions?status=all" className="link">
                    Show every proposal
                  </Link>
                </>
              ) : (
                "Think the taxi squad is too small or the TE premium too big? Post the first proposal — the league gets notified and can vote right away."
              )}
              <div className="mt-3 flex justify-center">
                <ProposalEditorButton isCommish={ctx.isCommish} season={ctx.season} />
              </div>
            </EmptyState>
          ) : (
            <ul className="card divide-y divide-line/70 overflow-hidden">
              {shown.map((p) => {
                const a = authorBy.get(p.authorId);
                const name = a?.profile?.displayName?.trim() || a?.name || "Former manager";
                const open = votingOpen(p, now);
                const ended = votingEnded(p, now);
                return (
                  <li key={p.id} className="flex gap-3 px-4 py-3.5">
                    <div className="shrink-0 pt-0.5">
                      <VoteButtons id={p.id} myVote={p.myVote} support={p.support} oppose={p.oppose} open={open} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={p.status} ended={ended} />
                        <CategoryBadge category={p.category} />
                        {p.settingsPatch ? (
                          <Badge tone="purple" title="Includes a machine-readable settings change">
                            <Wand2 size={11} /> Settings
                          </Badge>
                        ) : null}
                        {p.effectiveSeason ? <Badge tone="neutral">From {p.effectiveSeason}</Badge> : null}
                      </div>
                      <Link href={`/rules/suggestions/${p.id}`} className="mt-1.5 block text-[17px] font-bold leading-snug tracking-[-0.01em] hover:underline">
                        {p.title}
                      </Link>
                      {p.status === "VOTING" && p.votingEndsAt && (
                        <div className={cn("mt-0.5 inline-flex items-center gap-1 text-[13px] font-semibold", open ? "text-brand-600 dark:text-brand-400" : "text-muted")} title={fmtDateTime(p.votingEndsAt, tz)}>
                          <CalendarClock size={13} aria-hidden /> {open ? countdown(p.votingEndsAt, now) : "Awaiting decision"}
                        </div>
                      )}
                      <p className="mt-0.5 line-clamp-2 max-w-[70ch] text-[15px] text-muted sm:text-sm">{plainText(p.body, 260)}</p>
                      <VoteBar tally={p.tally} thresholdPercent={threshold} className="mt-2 max-w-md" />
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">
                        <Link href={`/managers/${p.authorId}`} className="inline-flex min-h-8 min-w-0 items-center gap-1.5 hover:text-ink">
                          <Avatar name={name} src={a?.avatarUrl} size={20} />
                          <span className="truncate font-semibold text-ink">{name}</span>
                          {teamBy.get(p.authorId) && <span className="hidden sm:inline">· {teamBy.get(p.authorId)}</span>}
                        </Link>
                        <span title={fmtDateTime(p.createdAt, tz)}>{timeAgo(p.createdAt)}</span>
                        <Link href={`/rules/suggestions/${p.id}#comments`} className="inline-flex min-h-8 items-center gap-1 hover:text-ink">
                          <MessageSquare size={13} aria-hidden /> {p._count.comments}
                          <span className="sr-only"> comment{p._count.comments === 1 ? "" : "s"}</span>
                        </Link>
                        {isOpenAndPassing(p) && (
                          <span className="inline-flex items-center gap-1 font-semibold text-win">
                            <CheckCircle2 size={13} aria-hidden /> Has the votes
                          </span>
                        )}
                        {p.resolvedAt && !["OPEN", "VOTING"].includes(p.status) && (
                          <span>
                            {STATUS_META[p.status as ProposalStatus]?.label ?? p.status} {timeAgo(p.resolvedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <Panel title="Recently adopted" noPad>
            {recentAdopted.length ? (
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {recentAdopted.map((p) => (
                  <ListRow
                    key={p.id}
                    href={`/rules/suggestions/${p.id}`}
                    title={p.title}
                    subtitle={`${p.support}–${p.oppose}${p.resolvedAt ? ` · ${fmtDateTime(p.resolvedAt, tz, { dateOnly: true, withYear: true })}` : ""}${p.effectiveSeason ? ` · from ${p.effectiveSeason}` : ""}`}
                    chevron
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No adopted proposals yet.</p>
            )}
          </Panel>
          <section className="card px-4">
            <Collapsible summary="How it works" meta="4 steps">
              <ol className="space-y-2.5 text-[15px] sm:text-sm">
                {[
                  ["Propose", "Anyone can post an idea. You automatically support your own proposal."],
                  ["Discuss", "Comment and show early support or opposition with the thumbs."],
                  ["Vote", `The commissioner opens a formal vote with a deadline. ${threshold}% of the league must support it.`],
                  ["Decide", "Adopted rules go into the rulebook; settings changes can be applied in one click."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="numeral flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600/[0.08] text-[13px] font-bold text-brand-700 dark:bg-brand-400/15 dark:text-brand-300">{i + 1}</span>
                    <span>
                      <b>{t}.</b> <span className="text-muted">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Collapsible>
          </section>
        </aside>
      </div>
    </div>
  );
}

function isOpenAndPassing(p: { status: string; outcome: { passes: boolean } }) {
  return (p.status === "OPEN" || p.status === "VOTING") && p.outcome.passes;
}
