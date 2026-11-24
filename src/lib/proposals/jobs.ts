// Background work for the rule suggestion board: when a formal league vote's deadline passes, announce
// the result in #general, tell the league and remind the commissioner to make it official.
// Idempotent: each closed vote (proposal + deadline) is marked with one "proposal.vote_closed" AuditLog row,
// so re-running is a no-op and a re-opened vote with a new deadline gets its own notice.
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { notify } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import { closedVoteNotice, tallyVotes, voteOutcome } from "@/lib/proposals/logic";

export async function processProposalDeadlines(now: Date = new Date()): Promise<string> {
  const due = await db.ruleProposal.findMany({
    where: { status: "VOTING", votingEndsAt: { lte: now } },
    select: { id: true, leagueId: true, title: true, votingEndsAt: true, votes: { select: { value: true } } },
  });
  if (!due.length) return "no closed votes";

  const markers = await db.auditLog.findMany({
    where: { action: "proposal.vote_closed", targetType: "rule_proposal", targetId: { in: due.map((p) => p.id) } },
    select: { targetId: true, details: true },
  });
  const seen = new Set(markers.map((m) => `${m.targetId}:${(m.details as Record<string, unknown> | null)?.votingEndsAt ?? ""}`));
  const todo = due.filter((p) => !seen.has(`${p.id}:${p.votingEndsAt!.toISOString()}`));
  if (!todo.length) return `no new closed votes (${due.length} awaiting a decision)`;

  const leagueIds = [...new Set(todo.map((p) => p.leagueId))];
  const [leagues, members] = await Promise.all([
    db.league.findMany({ where: { id: { in: leagueIds } }, select: { id: true, settings: true } }),
    db.leagueMember.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, userId: true, role: true } }),
  ]);
  const settingsBy = new Map(leagues.map((l) => [l.id, resolveSettings(l.settings)]));

  let sent = 0;
  for (const p of todo) {
    const settings = settingsBy.get(p.leagueId);
    if (!settings) continue;
    const leagueMembers = members.filter((m) => m.leagueId === p.leagueId);
    const tally = tallyVotes(
      p.votes.map((v) => v.value),
      leagueMembers.length,
    );
    const outcome = voteOutcome(tally, settings.commissioner.voteThresholdPercent);
    const endsIso = p.votingEndsAt!.toISOString();

    // claim the notice first so a crash mid-way never double-posts
    await db.auditLog.create({
      data: {
        leagueId: p.leagueId,
        actorId: null,
        action: "proposal.vote_closed",
        targetType: "rule_proposal",
        targetId: p.id,
        details: { title: p.title, votingEndsAt: endsIso, support: tally.support, oppose: tally.oppose, abstain: tally.abstain, needed: outcome.needed, passes: outcome.passes },
      },
    });

    const notice = closedVoteNotice(p.title, tally, outcome);
    const url = `/rules/suggestions/${p.id}`;
    const commishIds = leagueMembers.filter((m) => m.role === "COMMISSIONER" || m.role === "CO_COMMISSIONER").map((m) => m.userId);
    const others = leagueMembers.map((m) => m.userId).filter((id) => !commishIds.includes(id));
    await postSystemMessage(p.leagueId, notice.chat, { channel: "general", kind: "SYSTEM", data: { proposalId: p.id, url } }).catch(() => null);
    if (commishIds.length)
      await notify({ userIds: commishIds, leagueId: p.leagueId, type: "RULE_PROPOSAL", title: notice.commishTitle, body: notice.commishBody, url }).catch(() => null);
    if (others.length) await notify({ userIds: others, leagueId: p.leagueId, type: "RULE_PROPOSAL", title: notice.title, body: notice.body, url }).catch(() => null);
    publish(topics.league(p.leagueId), "proposal.update", { id: p.id, kind: "status" });
    sent++;
  }
  return `closed votes announced: ${sent}`;
}
