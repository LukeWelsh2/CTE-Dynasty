// /rules/suggestions — the league's rule suggestion board: propose, discuss, vote, adopt.
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CalendarClock, CheckCircle2, MessageSquare, Scale, Wand2 } from "lucide-react";
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
import { Avatar, Badge, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/core";
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
        title="Rule Suggestions"
        subtitle={`Propose changes, debate them and vote · ${threshold}% of the league (${voteOutcome(tallyVotes([], managers), threshold).needed} of ${managers}) must support a rule for it to pass`}
        actions={
          <>
            <ButtonLink href="/rules" variant="secondary" size="sm">
              <BookOpen size={14} /> Rulebook
            </ButtonLink>
            <ProposalEditorButton isCommish={ctx.isCommish} season={ctx.season} />
          </>
        }
      />

      {needVotes > 0 && (
        <Link href="/rules/suggestions?status=VOTING" className="mb-3 flex items-center gap-2 rounded-lg border border-gold-400/60 bg-gold-300/20 px-3 py-2 text-sm font-semibold hover:bg-gold-300/30">
          <Scale size={16} className="shrink-0 text-gold-600" />
          {needVotes === 1 ? "1 rule is up for a league vote and you haven't voted yet." : `${needVotes} rules are up for a league vote and you haven't voted yet.`}
          <span className="ml-auto text-xs text-brand-700 dark:text-brand-300">Vote now →</span>
        </Link>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="mb-3 space-y-2">
            <nav aria-label="Filter by status" className="scroll-thin -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {FILTERS.map((f) => {
                const active = f.key === status;
                const n = counts.get(f.key) ?? 0;
                return (
                  <Link
                    key={f.key}
                    href={filterHref(f.key)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
                      active ? "border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-600" : "border-line bg-panel hover:bg-sunken",
                      !n && !active && "opacity-60",
                    )}
                  >
                    {f.label}
                    <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-white/25" : "bg-sunken text-muted")}>{n}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="flex flex-wrap gap-2">
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
            <ul className="space-y-2.5">
              {shown.map((p) => {
                const a = authorBy.get(p.authorId);
                const name = a?.profile?.displayName?.trim() || a?.name || "Former manager";
                const open = votingOpen(p, now);
                const ended = votingEnded(p, now);
                return (
                  <li key={p.id} className={cn("flex gap-3 rounded-lg border bg-panel p-3 shadow-panel", p.status === "VOTING" && open ? "border-gold-400/70" : "border-line")}>
                    <div className="shrink-0 pt-0.5">
                      <VoteButtons id={p.id} myVote={p.myVote} support={p.support} oppose={p.oppose} open={open} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={p.status} ended={ended} />
                        <CategoryBadge category={p.category} />
                        {p.settingsPatch ? (
                          <Badge tone="purple" title="Includes a machine-readable settings change">
                            <Wand2 size={10} /> Settings change
                          </Badge>
                        ) : null}
                        {p.effectiveSeason ? <Badge tone="neutral">Effective {p.effectiveSeason}</Badge> : null}
                        {p.status === "VOTING" && p.votingEndsAt && (
                          <span className={cn("ml-auto inline-flex items-center gap-1 text-[11px] font-semibold", open ? "text-gold-600 dark:text-gold-400" : "text-muted")} title={fmtDateTime(p.votingEndsAt, tz)}>
                            <CalendarClock size={12} /> {open ? countdown(p.votingEndsAt, now) : "awaiting decision"}
                          </span>
                        )}
                      </div>
                      <Link href={`/rules/suggestions/${p.id}`} className="mt-1 block font-display text-lg font-bold leading-snug hover:underline">
                        {p.title}
                      </Link>
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{plainText(p.body, 260)}</p>
                      <VoteBar tally={p.tally} thresholdPercent={threshold} className="mt-2 max-w-md" />
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <Link href={`/managers/${p.authorId}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                          <Avatar name={name} src={a?.avatarUrl} size={18} />
                          <span className="font-semibold text-ink">{name}</span>
                          {teamBy.get(p.authorId) && <span className="hidden sm:inline">· {teamBy.get(p.authorId)}</span>}
                        </Link>
                        <span title={fmtDateTime(p.createdAt, tz)}>{timeAgo(p.createdAt)}</span>
                        <Link href={`/rules/suggestions/${p.id}#comments`} className="inline-flex items-center gap-1 hover:text-ink">
                          <MessageSquare size={12} /> {p._count.comments} comment{p._count.comments === 1 ? "" : "s"}
                        </Link>
                        {isOpenAndPassing(p) && (
                          <span className="inline-flex items-center gap-1 font-semibold text-win">
                            <CheckCircle2 size={12} /> Has the votes to pass
                          </span>
                        )}
                        {p.resolvedAt && !["OPEN", "VOTING"].includes(p.status) && <span>{STATUS_META[p.status as ProposalStatus]?.label ?? p.status} {timeAgo(p.resolvedAt)}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-14">
          <Panel title="How it works">
            <ol className="space-y-2 text-sm">
              {[
                ["Propose", "Anyone can post an idea. You automatically support your own proposal."],
                ["Discuss", "Comment and show early support or opposition with the thumbs."],
                ["Vote", `The commissioner opens a formal vote with a deadline. ${threshold}% of the league must support it.`],
                ["Decide", "Adopted rules go into the rulebook; settings changes can be applied in one click."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[11px] font-bold text-white">{i + 1}</span>
                  <span>
                    <b>{t}.</b> <span className="text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel title="Recently adopted" noPad>
            {recentAdopted.length ? (
              <ul className="divide-y divide-line">
                {recentAdopted.map((p) => (
                  <li key={p.id}>
                    <Link href={`/rules/suggestions/${p.id}`} className="block px-3 py-2 hover:bg-sunken">
                      <div className="line-clamp-2 text-sm font-semibold">{p.title}</div>
                      <div className="text-[11px] text-muted">
                        {p.support}–{p.oppose} · {p.resolvedAt ? fmtDateTime(p.resolvedAt, tz, { dateOnly: true, withYear: true }) : ""}
                        {p.effectiveSeason ? ` · effective ${p.effectiveSeason}` : ""}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted">No adopted proposals yet.</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function isOpenAndPassing(p: { status: string; outcome: { passes: boolean } }) {
  return (p.status === "OPEN" || p.status === "VOTING") && p.outcome.passes;
}
