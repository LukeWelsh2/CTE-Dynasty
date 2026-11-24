// /rules/suggestions/[id] — one rule proposal: the case for it, the league vote, the settings change it
// would make, the discussion thread and the commissioner workflow.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2, Gavel, Trash2, Wand2 } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { fmtDateTime } from "@/lib/commissioner/time";
import { hasFullPowers } from "@/lib/commissioner/server";
import { allowedTransitions, patchPaths, tallyVotes, voteOutcome, votingEnded, votingOpen, type ProposalStatus } from "@/lib/proposals/logic";
import { appliedPatches, previewPatch } from "@/lib/proposals/server";
import { deleteCommentAction } from "@/lib/proposals/actions";
import { Alert, Avatar, Badge, Panel, TeamLogo } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { LeagueTabs } from "@/components/community/bits";
import { RichText } from "@/components/community/rich-text";
import { CategoryBadge, StatusBadge, VoteBar } from "@/components/community/proposal-bits";
import { CommentForm, ProposalEditorButton, ProposalLiveRefresh, ProposalWorkflow, VoteButtons } from "@/components/community/proposals";
import { cn, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getLeagueContext();
  const p = await db.ruleProposal.findUnique({ where: { id }, select: { title: true, leagueId: true } });
  return { title: p && p.leagueId === ctx.league.id ? `${p.title} · Rule Suggestions` : "Rule Suggestion" };
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLeagueContext();
  const p = await db.ruleProposal.findUnique({
    where: { id },
    include: {
      votes: { select: { userId: true, value: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      comments: { orderBy: { createdAt: "asc" }, select: { id: true, userId: true, body: true, createdAt: true } },
    },
  });
  if (!p || p.leagueId !== ctx.league.id) notFound();

  const now = new Date();
  const tz = ctx.settings.general.timezone;
  const threshold = ctx.settings.commissioner.voteThresholdPercent;
  const members = await db.leagueMember.findMany({
    where: { leagueId: ctx.league.id },
    select: { userId: true, role: true, user: { select: { name: true, avatarUrl: true, profile: { select: { displayName: true } } } }, team: { select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } } },
  });
  // authors / commenters / voters who have since left the league
  const known = new Set(members.map((m) => m.userId));
  const missing = [...new Set([p.authorId, ...p.comments.map((c) => c.userId), ...p.votes.map((v) => v.userId)])].filter((u) => !known.has(u));
  const former = missing.length ? await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, avatarUrl: true, profile: { select: { displayName: true } } } }) : [];
  const person = new Map<string, { name: string; avatarUrl: string | null; team: (typeof members)[number]["team"]; member: boolean; commish: boolean }>();
  for (const m of members) person.set(m.userId, { name: m.user.profile?.displayName?.trim() || m.user.name, avatarUrl: m.user.avatarUrl, team: m.team, member: true, commish: m.role !== "MANAGER" });
  for (const u of former) person.set(u.id, { name: u.profile?.displayName?.trim() || u.name, avatarUrl: u.avatarUrl, team: null, member: false, commish: false });
  const who = (uid: string) => person.get(uid) ?? { name: "Former manager", avatarUrl: null, team: null, member: false, commish: false };

  const tally = tallyVotes(p.votes.map((v) => v.value), members.length);
  const outcome = voteOutcome(tally, threshold);
  const myVote = p.votes.find((v) => v.userId === ctx.user.id)?.value ?? null;
  const open = votingOpen(p, now);
  const ended = votingEnded(p, now);
  const status = p.status as ProposalStatus;
  const author = who(p.authorId);
  const isAuthor = p.authorId === ctx.user.id;

  const patch = p.settingsPatch && typeof p.settingsPatch === "object" && !Array.isArray(p.settingsPatch) ? (p.settingsPatch as Record<string, unknown>) : null;
  const applied = patch ? (await appliedPatches(ctx.league.id, [p.id])).get(p.id) ?? null : null;
  const preview = patch && !applied ? await previewPatch(ctx, patch) : null;
  const canApply = hasFullPowers(ctx);
  const patchBlockedReason = !patch
    ? null
    : preview && !preview.ok
      ? `The settings patch no longer validates: ${preview.errors[0]}`
      : preview && !preview.changes.length
        ? "The league settings already match this proposal."
        : preview?.locked.length
          ? `${preview.locked.join(", ")} settings are locked during the season — apply this after the season.`
          : p.effectiveSeason && p.effectiveSeason > ctx.season
            ? `Takes effect in ${p.effectiveSeason} — apply it once the league rolls over to that season.`
            : null;
  const allowed = allowedTransitions(p, { userId: ctx.user.id, isCommish: ctx.isCommish });
  const othersEngaged = p.votes.some((v) => v.userId !== ctx.user.id) || p.comments.length > 0;
  const canDelete = !applied && (ctx.isCommish || (isAuthor && !othersEngaged));
  const canEdit = (isAuthor || ctx.isCommish) && (status === "OPEN" || (ctx.isCommish && status === "TABLED"));

  const voters = (value: number) => p.votes.filter((v) => (value > 0 ? v.value > 0 : value < 0 ? v.value < 0 : v.value === 0)).map((v) => ({ ...who(v.userId), userId: v.userId, at: v.createdAt }));
  const voted = new Set(p.votes.map((v) => v.userId));
  const notVoted = members.filter((m) => !voted.has(m.userId)).map((m) => ({ ...who(m.userId), userId: m.userId }));
  const appliedBy = applied?.actorId ? who(applied.actorId).name : null;

  const statusLine =
    status === "VOTING"
      ? open
        ? `League vote open until ${fmtDateTime(p.votingEndsAt, tz)}`
        : p.votingEndsAt
          ? `Voting closed ${fmtDateTime(p.votingEndsAt, tz)} — awaiting the commissioner's decision`
          : "League vote open"
      : status === "OPEN"
        ? "In discussion · early support votes"
        : `${status === "ADOPTED" ? "Adopted" : status === "REJECTED" ? "Rejected" : status === "TABLED" ? "Tabled" : "Withdrawn"}${p.resolvedAt ? ` ${fmtDateTime(p.resolvedAt, tz, { withYear: true })}` : ""} · votes are final`;

  return (
    <div>
      <ProposalLiveRefresh leagueId={ctx.league.id} id={p.id} />
      <LeagueTabs active="suggestions" />
      <Link href="/rules/suggestions" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
        <ArrowLeft size={14} /> All rule suggestions
      </Link>

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={p.status} ended={ended} />
          <CategoryBadge category={p.category} />
          {patch && (
            <Badge tone="purple">
              <Wand2 size={10} /> Settings change
            </Badge>
          )}
          {p.effectiveSeason && <Badge tone="neutral">Effective {p.effectiveSeason}</Badge>}
        </div>
        <h1 className="mt-1.5 font-display text-2xl font-extrabold leading-tight tracking-wide sm:text-3xl">{p.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Link href={`/managers/${p.authorId}`} className="inline-flex items-center gap-2 hover:text-ink">
            <Avatar name={author.name} src={author.avatarUrl} size={24} />
            <span className="font-semibold text-ink">{author.name}</span>
            {author.team && (
              <span className="inline-flex items-center gap-1">
                <TeamLogo team={author.team} size={14} className="rounded-[3px]" /> {author.team.name}
              </span>
            )}
          </Link>
          <span title={fmtDateTime(p.createdAt, tz, { withYear: true })}>Proposed {timeAgo(p.createdAt)}</span>
          {p.updatedAt.getTime() - p.createdAt.getTime() > 60_000 && status === "OPEN" && <span>· edited {timeAgo(p.updatedAt)}</span>}
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          {p.resolutionNote && (status === "ADOPTED" || status === "REJECTED" || status === "TABLED" || status === "WITHDRAWN") && (
            <Alert tone={status === "ADOPTED" ? "success" : status === "REJECTED" ? "error" : "warn"}>
              <span className="font-semibold">{status === "ADOPTED" ? "Adopted" : status === "REJECTED" ? "Rejected" : status === "TABLED" ? "Tabled" : "Withdrawn"}:</span> {p.resolutionNote}
            </Alert>
          )}

          <Panel title="The proposal" actions={canEdit ? <ProposalEditorButton isCommish={ctx.isCommish} season={ctx.season} variant="secondary" size="xs" draft={{ id: p.id, title: p.title, body: p.body, category: p.category, settingsPatch: patch ? JSON.stringify(patch, null, 2) : "", effectiveSeason: p.effectiveSeason }} /> : undefined}>
            <RichText text={p.body} meId={ctx.user.id} className="block text-[15px] leading-relaxed" />
          </Panel>

          {patch && (
            <Panel title="Settings change" subtitle={applied ? `Applied${appliedBy ? ` by ${appliedBy}` : ""} ${fmtDateTime(applied.at, tz, { withYear: true })}${applied.version ? ` · settings version ${applied.version}` : ""}` : "What adopting this proposal would change in the league settings"} noPad>
              {applied ? (
                <div className="flex items-start gap-2 p-3 text-sm">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-win" />
                  <div>
                    This change is now part of the league settings.{" "}
                    <Link href="/rules" className="link">
                      See the rulebook
                    </Link>
                    {ctx.isCommish && (
                      <>
                        {" "}or the{" "}
                        <Link href="/commissioner/settings" className="link">
                          settings history
                        </Link>
                      </>
                    )}
                    .
                    <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted">
                      {patchPaths(patch).map((x) => (
                        <li key={x.path}>
                          {x.path} = {JSON.stringify(x.value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : preview ? (
                <div>
                  {(preview.errors.length > 0 || preview.locked.length > 0 || preview.warnings.length > 0) && (
                    <div className="space-y-1 border-b border-line p-3 text-xs">
                      {preview.errors.map((e) => (
                        <div key={e} className="text-loss">
                          {e}
                        </div>
                      ))}
                      {preview.locked.length > 0 && <div className="text-amber-700 dark:text-amber-300">{preview.locked.join(", ")} settings are locked in season.</div>}
                      {preview.warnings.map((w) => (
                        <div key={w} className="text-amber-700 dark:text-amber-300">
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                  {preview.changes.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="tbl w-full">
                        <thead>
                          <tr>
                            <th className="text-left">Setting</th>
                            <th className="text-left">Current</th>
                            <th className="text-left">If adopted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.changes.map((c) => (
                            <tr key={c.path}>
                              <td className="font-semibold">{c.label}</td>
                              <td className="text-muted">{c.from}</td>
                              <td className="font-semibold text-win">{c.to}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </Panel>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-14 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Panel title="League vote" subtitle={statusLine}>
            <VoteButtons id={p.id} myVote={myVote} support={tally.support} oppose={tally.oppose} abstain={tally.abstain} open={open} layout="row" allowAbstain={status === "VOTING"} />
            {!open && myVote !== null && <p className="mt-1 text-xs text-muted">You voted {myVote > 0 ? "to support" : myVote < 0 ? "to oppose" : "to abstain"}.</p>}
            <VoteBar tally={tally} thresholdPercent={threshold} className="mt-3" />
            <div className={cn("mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs", outcome.passes ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200" : "bg-sunken text-muted")}>
              <Gavel size={13} className="mt-px shrink-0" />
              <span>
                Needs <b>{outcome.needed}</b> of {tally.managers} managers ({threshold}%) to pass.{" "}
                {outcome.passes ? (
                  <b>{status === "ADOPTED" ? "Passed" : "Currently has the votes to pass."}</b>
                ) : status === "OPEN" || status === "VOTING" ? (
                  <>
                    {outcome.short} more support vote{outcome.short === 1 ? "" : "s"} needed.
                  </>
                ) : null}
              </span>
            </div>
            {status === "VOTING" && p.votingEndsAt && open && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-gold-600 dark:text-gold-400">
                <CalendarClock size={13} /> Closes {fmtDateTime(p.votingEndsAt, tz)}
              </p>
            )}

            <div className="mt-3 space-y-2.5 border-t border-line pt-3">
              {[
                { key: "support", label: "Support", list: voters(1), tone: "text-win" },
                { key: "oppose", label: "Oppose", list: voters(-1), tone: "text-loss" },
                { key: "abstain", label: "Abstain", list: voters(0), tone: "text-muted" },
              ]
                .filter((g) => g.list.length || g.key !== "abstain")
                .map((g) => (
                  <div key={g.key}>
                    <div className={cn("mb-1 text-[11px] font-bold uppercase tracking-wide", g.tone)}>
                      {g.label} · {g.list.length}
                    </div>
                    {g.list.length ? (
                      <div className="flex flex-wrap gap-1">
                        {g.list.map((v) => (
                          <Link key={v.userId} href={`/managers/${v.userId}`} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel py-0.5 pl-0.5 pr-2 text-xs hover:bg-sunken" title={`${v.name} · ${timeAgo(v.at)}`}>
                            <Avatar name={v.name} src={v.avatarUrl} size={18} />
                            <span className="max-w-[110px] truncate">{v.name}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted">Nobody yet.</p>
                    )}
                  </div>
                ))}
              {notVoted.length > 0 && (status === "OPEN" || status === "VOTING") && (
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Not voted · {notVoted.length}</div>
                  <div className="flex flex-wrap gap-1">
                    {notVoted.map((v) => (
                      <Link key={v.userId} href={`/managers/${v.userId}`} title={v.name} className="rounded-full opacity-70 hover:opacity-100">
                        <Avatar name={v.name} src={v.avatarUrl} size={22} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {(allowed.length > 0 || canDelete || (ctx.isCommish && status === "ADOPTED" && patch && !applied)) && (
            <Panel title={ctx.isCommish ? "Commissioner actions" : "Your proposal"}>
              <ProposalWorkflow
                id={p.id}
                status={status}
                allowed={allowed}
                isCommish={ctx.isCommish}
                canApply={canApply}
                hasPatch={!!patch}
                patchApplied={!!applied}
                patchBlockedReason={patchBlockedReason}
                effectiveSeason={p.effectiveSeason}
                season={ctx.season}
                tz={tz}
                canDelete={canDelete}
                passing={outcome.passes}
              />
              {ctx.isCommish && <p className="mt-2 text-[11px] text-muted">Status changes notify the league, post in #general and are recorded in the commissioner audit log.</p>}
            </Panel>
          )}
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <Panel id="comments" title={`Discussion (${p.comments.length})`}>
            {p.comments.length === 0 ? (
              <p className="mb-3 text-sm text-muted">No comments yet — start the debate.</p>
            ) : (
              <ul className="mb-4 space-y-3">
                {p.comments.map((c) => {
                  const u = who(c.userId);
                  const mine = c.userId === ctx.user.id;
                  return (
                    <li key={c.id} className="flex gap-2.5">
                      <Link href={`/managers/${c.userId}`} className="shrink-0">
                        <Avatar name={u.name} src={u.avatarUrl} size={32} />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-xs">
                          <Link href={`/managers/${c.userId}`} className="text-sm font-semibold hover:underline">
                            {u.name}
                          </Link>
                          {u.team && <span className="text-muted">{u.team.name}</span>}
                          {c.userId === p.authorId && <Badge tone="brand">Author</Badge>}
                          {u.commish && <Badge tone="gold">Commish</Badge>}
                          <span className="text-muted" title={fmtDateTime(c.createdAt, tz, { withYear: true })}>
                            {timeAgo(c.createdAt)}
                          </span>
                          {(mine || ctx.isCommish) && (
                            <ActionButton action={deleteCommentAction.bind(null, c.id)} confirm="Delete this comment?" variant="ghost" size="xs" className="ml-auto text-muted hover:text-loss" title="Delete comment">
                              <Trash2 size={12} />
                              <span className="sr-only">Delete comment</span>
                            </ActionButton>
                          )}
                        </div>
                        <div className="mt-0.5 rounded-lg rounded-tl-none border border-line bg-sunken/50 px-3 py-2 text-sm">
                          <RichText text={c.body} meId={ctx.user.id} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <CommentForm id={p.id} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
