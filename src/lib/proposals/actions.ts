"use server";
// Rule suggestion board server actions: propose, edit, vote, comment, withdraw, commissioner workflow
// (open voting → adopt / reject / table) and "Adopt & apply settings patch".
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCommissioner, assertLeagueMember, type LeagueContext } from "@/lib/league";
import { leagueUserIds, notify } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import { hasFullPowers } from "@/lib/commissioner/server";
import { CATEGORY_VALUES, STATUS_META, allowedTransitions, categoryLabel, parsePatchText, votingOpen, type ProposalStatus } from "@/lib/proposals/logic";
import { applyProposalPatch, appliedPatches, previewPatch } from "@/lib/proposals/server";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
  return { ok: false, error: (e as Error)?.message || "Something went wrong" };
}

const idSchema = z.string().trim().min(1).max(64);
const MAX_BODY = 5000;
const MAX_COMMENT = 2000;

function revalidate(id?: string) {
  revalidatePath("/rules/suggestions");
  if (id) revalidatePath(`/rules/suggestions/${id}`);
}

function live(ctx: LeagueContext, id: string, kind: string) {
  publish(topics.league(ctx.league.id), "proposal.update", { id, kind });
}

async function loadOwned(ctx: LeagueContext, id: string) {
  const p = await db.ruleProposal.findUnique({ where: { id } });
  if (!p || p.leagueId !== ctx.league.id) throw new Error("That proposal was not found.");
  return p;
}

const effectiveSeasonSchema = z
  .number()
  .int()
  .nullable()
  .optional();

function checkEffectiveSeason(ctx: LeagueContext, v: number | null | undefined) {
  if (v === null || v === undefined) return null;
  if (v < ctx.season || v > ctx.season + 3) throw new Error(`Effective season must be between ${ctx.season} and ${ctx.season + 3}.`);
  return v;
}

// ───────────────────────────── Propose / edit ─────────────────────────────

const proposalSchema = z.object({
  title: z.string().trim().min(5, "Give your proposal a title of at least 5 characters").max(120, "Titles are limited to 120 characters"),
  body: z.string().trim().min(10, "Explain the rule change in a sentence or two").max(MAX_BODY, `Descriptions are limited to ${MAX_BODY} characters`),
  category: z.enum(CATEGORY_VALUES, { message: "Choose a category" }),
  settingsPatch: z.string().max(20_000).optional(),
  effectiveSeason: effectiveSeasonSchema,
});

async function patchFromText(ctx: LeagueContext, text: string | undefined): Promise<Prisma.InputJsonValue | null> {
  const parsed = parsePatchText(text);
  if (!parsed.ok) throw new Error(parsed.error);
  if (!parsed.patch) return null;
  if (!ctx.isCommish) throw new Error("Only commissioners can attach a machine-readable settings patch.");
  const preview = await previewPatch(ctx, parsed.patch);
  if (!preview.ok) throw new Error(preview.errors[0] ?? "The settings patch is invalid.");
  return parsed.patch as Prisma.InputJsonValue;
}

export async function createProposalAction(input: z.input<typeof proposalSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await assertLeagueMember();
    const d = proposalSchema.parse(input);
    const recent = await db.ruleProposal.count({ where: { leagueId: ctx.league.id, authorId: ctx.user.id, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
    if (recent >= 5) throw new Error("You've posted 5 proposals in the last hour — give the league a chance to catch up.");
    const settingsPatch = await patchFromText(ctx, d.settingsPatch);
    const p = await db.ruleProposal.create({
      data: {
        leagueId: ctx.league.id,
        authorId: ctx.user.id,
        title: d.title,
        body: d.body,
        category: d.category,
        settingsPatch: settingsPatch ?? undefined,
        effectiveSeason: checkEffectiveSeason(ctx, d.effectiveSeason),
      },
    });
    // the author backs their own idea
    await db.ruleProposalVote.create({ data: { proposalId: p.id, userId: ctx.user.id, value: 1 } });
    const who = ctx.myTeam?.name ?? ctx.user.name;
    const others = (await leagueUserIds(ctx.league.id)).filter((u) => u !== ctx.user.id);
    await notify({ userIds: others, leagueId: ctx.league.id, type: "RULE_PROPOSAL", title: `New rule suggestion: ${d.title}`, body: `${who} proposed a ${categoryLabel(d.category).toLowerCase()} change. Weigh in and vote.`, url: `/rules/suggestions/${p.id}` }).catch(() => null);
    await postSystemMessage(ctx.league.id, `📜 ${who} suggested a rule change: “${d.title}”. Vote and comment on the suggestion board.`, { channel: "general", kind: "SYSTEM", data: { proposalId: p.id, url: `/rules/suggestions/${p.id}` } }).catch(() => null);
    live(ctx, p.id, "created");
    revalidate(p.id);
    return { ok: true, message: "Proposal posted — the league has been notified", data: { id: p.id } };
  } catch (e) {
    return fail(e);
  }
}

const editSchema = proposalSchema.extend({ id: idSchema });

export async function updateProposalAction(input: z.input<typeof editSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = editSchema.parse(input);
    const p = await loadOwned(ctx, d.id);
    const author = p.authorId === ctx.user.id;
    if (!author && !ctx.isCommish) throw new Error("Only the author or the commissioner can edit this proposal.");
    if (p.status !== "OPEN" && !(ctx.isCommish && p.status === "TABLED")) throw new Error("Proposals can only be edited while they're in discussion.");
    // keep an existing patch when a non-commissioner author edits (they can't see or change it)
    const settingsPatch = ctx.isCommish ? await patchFromText(ctx, d.settingsPatch) : (p.settingsPatch as Prisma.InputJsonValue | null);
    await db.ruleProposal.update({
      where: { id: p.id },
      data: {
        title: d.title,
        body: d.body,
        category: d.category,
        settingsPatch: settingsPatch ?? (null as unknown as Prisma.InputJsonValue),
        effectiveSeason: checkEffectiveSeason(ctx, d.effectiveSeason),
      },
    });
    if (!author) await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "proposal.edit", targetType: "rule_proposal", targetId: p.id, details: { title: d.title } } });
    live(ctx, p.id, "edited");
    revalidate(p.id);
    return { ok: true, message: "Proposal updated" };
  } catch (e) {
    return fail(e);
  }
}

export async function previewPatchAction(input: { text: string }): Promise<ActionResult<{ changes: { label: string; from: string; to: string }[]; warnings: string[]; locked: string[]; errors: string[] }>> {
  try {
    const ctx = await assertCommissioner();
    const parsed = parsePatchText(z.string().max(20_000).parse(input?.text ?? ""));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (!parsed.patch) return { ok: true, data: { changes: [], warnings: [], locked: [], errors: [] } };
    const p = await previewPatch(ctx, parsed.patch);
    return { ok: true, data: { changes: p.changes.map(({ label, from, to }) => ({ label, from, to })), warnings: p.warnings, locked: p.locked, errors: p.errors } };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Votes & comments ─────────────────────────────

const voteSchema = z.object({ id: idSchema, value: z.union([z.literal(1), z.literal(-1), z.literal(0), z.null()]) });

export async function voteProposalAction(input: z.input<typeof voteSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = voteSchema.parse(input);
    const p = await loadOwned(ctx, d.id);
    if (!votingOpen(p)) throw new Error(p.status === "VOTING" ? "Voting on this proposal has closed." : `This proposal is ${STATUS_META[p.status as ProposalStatus]?.label.toLowerCase() ?? "closed"} — votes are locked.`);
    if (d.value === null) await db.ruleProposalVote.deleteMany({ where: { proposalId: p.id, userId: ctx.user.id } });
    else
      await db.ruleProposalVote.upsert({
        where: { proposalId_userId: { proposalId: p.id, userId: ctx.user.id } },
        create: { proposalId: p.id, userId: ctx.user.id, value: d.value },
        update: { value: d.value, createdAt: new Date() },
      });
    live(ctx, p.id, "vote");
    revalidate(p.id);
    return { ok: true, message: d.value === null ? "Vote cleared" : d.value > 0 ? "You support this" : d.value < 0 ? "You oppose this" : "Marked as abstain" };
  } catch (e) {
    return fail(e);
  }
}

const commentSchema = z.object({ id: idSchema, body: z.string().trim().min(1, "Write a comment first").max(MAX_COMMENT, `Comments are limited to ${MAX_COMMENT} characters`) });

export async function commentProposalAction(input: z.input<typeof commentSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = commentSchema.parse(input);
    const p = await loadOwned(ctx, d.id);
    const last = await db.ruleProposalComment.findFirst({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && Date.now() - last.createdAt.getTime() < 3000) throw new Error("Slow down a little — wait a few seconds between comments.");
    await db.ruleProposalComment.create({ data: { proposalId: p.id, userId: ctx.user.id, body: d.body } });
    if (p.authorId !== ctx.user.id)
      await notify({
        userIds: [p.authorId],
        leagueId: ctx.league.id,
        type: "RULE_PROPOSAL",
        title: `New comment on “${p.title}”`,
        body: `${ctx.user.name}: ${d.body.length > 140 ? d.body.slice(0, 137) + "…" : d.body}`,
        url: `/rules/suggestions/${p.id}#comments`,
      }).catch(() => null);
    live(ctx, p.id, "comment");
    revalidate(p.id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCommentAction(commentId: string): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const c = await db.ruleProposalComment.findUnique({ where: { id: idSchema.parse(commentId) }, include: { proposal: { select: { id: true, leagueId: true } } } });
    if (!c || c.proposal.leagueId !== ctx.league.id) throw new Error("That comment was already removed.");
    const own = c.userId === ctx.user.id;
    if (!own && !ctx.isCommish) throw new Error("You can only delete your own comments.");
    await db.ruleProposalComment.delete({ where: { id: c.id } });
    if (!own) await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "proposal.comment_delete", targetType: "rule_proposal", targetId: c.proposal.id, details: { commentId: c.id, authorId: c.userId, body: c.body.slice(0, 500) } } });
    live(ctx, c.proposal.id, "comment");
    revalidate(c.proposal.id);
    return { ok: true, message: "Comment deleted" };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Status workflow ─────────────────────────────

const statusSchema = z.object({
  id: idSchema,
  status: z.enum(["OPEN", "VOTING", "ADOPTED", "REJECTED", "TABLED", "WITHDRAWN"]),
  votingEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
  effectiveSeason: effectiveSeasonSchema,
  note: z.string().trim().max(1000, "Notes are limited to 1000 characters").optional(),
  applyPatch: z.boolean().optional(),
});

export async function setProposalStatusAction(input: z.input<typeof statusSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = statusSchema.parse(input);
    const p = await loadOwned(ctx, d.id);
    const allowed = allowedTransitions(p, { userId: ctx.user.id, isCommish: ctx.isCommish });
    if (!allowed.includes(d.status)) throw new Error(ctx.isCommish || p.authorId === ctx.user.id ? `Can't move a ${STATUS_META[p.status as ProposalStatus]?.label.toLowerCase() ?? p.status} proposal to ${STATUS_META[d.status].label.toLowerCase()}.` : "Only the commissioner can change a proposal's status.");
    const byCommish = ctx.isCommish && !(p.authorId === ctx.user.id && (d.status === "WITHDRAWN" || (p.status === "WITHDRAWN" && d.status === "OPEN")));

    let votingEndsAt: Date | null = p.votingEndsAt;
    if (d.status === "VOTING") {
      if (!d.votingEndsAt) throw new Error("Pick when voting closes.");
      votingEndsAt = new Date(d.votingEndsAt);
      const ms = votingEndsAt.getTime() - Date.now();
      if (ms < 10 * 60_000) throw new Error("Voting must stay open for at least 10 minutes.");
      if (ms > 60 * 86_400_000) throw new Error("Voting can stay open for at most 60 days.");
    }
    const resolved = ["ADOPTED", "REJECTED", "TABLED", "WITHDRAWN"].includes(d.status);
    const effectiveSeason = d.effectiveSeason !== undefined ? checkEffectiveSeason(ctx, d.effectiveSeason) : p.effectiveSeason;

    // apply the settings patch first so a validation failure leaves the proposal untouched
    let applied: { version: number; changes: number; summary: string[] } | null = null;
    if (d.status === "ADOPTED" && d.applyPatch) {
      if (!hasFullPowers(ctx)) throw new Error("Only the commissioner (or a co-commissioner with full powers) can change league settings.");
      applied = await applyProposalPatch(ctx, { id: p.id, title: p.title, settingsPatch: p.settingsPatch, effectiveSeason });
    }

    await db.ruleProposal.update({
      where: { id: p.id },
      data: {
        status: d.status,
        votingEndsAt: d.status === "VOTING" ? votingEndsAt : d.status === "OPEN" ? null : p.votingEndsAt,
        effectiveSeason,
        resolutionNote: d.note ? d.note : resolved ? p.resolutionNote : null,
        resolvedAt: resolved ? new Date() : null,
      },
    });
    if (byCommish)
      await db.auditLog.create({
        data: {
          leagueId: ctx.league.id,
          actorId: ctx.user.id,
          action: "proposal.status",
          targetType: "rule_proposal",
          targetId: p.id,
          details: { title: p.title, from: p.status, to: d.status, note: d.note ?? null, votingEndsAt: d.status === "VOTING" ? votingEndsAt?.toISOString() : null, effectiveSeason, settingsVersion: applied?.version ?? null },
        },
      });

    // tell the league
    const tz = ctx.settings.general.timezone;
    const url = `/rules/suggestions/${p.id}`;
    const ends = votingEndsAt?.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
    const notice: Partial<Record<ProposalStatus, { title: string; body: string; chat: string }>> = {
      VOTING: { title: `Vote now: ${p.title}`, body: `Voting is open until ${ends}. Support or oppose this rule change.`, chat: `🗳️ Voting is open on “${p.title}” until ${ends}.` },
      ADOPTED: {
        title: `Rule adopted: ${p.title}`,
        body: `${applied ? `League settings updated (version ${applied.version}). ` : ""}${effectiveSeason ? `Takes effect in ${effectiveSeason}. ` : ""}${d.note ?? ""}`.trim() || "The league adopted this rule change.",
        chat: `✅ Rule adopted: “${p.title}”${effectiveSeason ? ` (effective ${effectiveSeason})` : ""}${applied ? " — league settings updated" : ""}.`,
      },
      REJECTED: { title: `Rule rejected: ${p.title}`, body: d.note || "The proposal did not pass.", chat: `❌ Rule proposal rejected: “${p.title}”.` },
      TABLED: { title: `Rule tabled: ${p.title}`, body: d.note || "The commissioner set this proposal aside for later.", chat: `⏸️ Rule proposal tabled: “${p.title}”.` },
    };
    const n = notice[d.status];
    if (n) {
      const ids = (await leagueUserIds(ctx.league.id)).filter((u) => u !== ctx.user.id);
      await notify({ userIds: ids, leagueId: ctx.league.id, type: "RULE_PROPOSAL", title: n.title, body: n.body, url }).catch(() => null);
      await postSystemMessage(ctx.league.id, n.chat, { channel: "general", kind: "SYSTEM", data: { proposalId: p.id, url } }).catch(() => null);
    } else if (d.status === "OPEN" && p.authorId !== ctx.user.id) {
      await notify({ userIds: [p.authorId], leagueId: ctx.league.id, type: "RULE_PROPOSAL", title: `Back in discussion: ${p.title}`, body: d.note || "Your proposal was reopened for discussion.", url }).catch(() => null);
    } else if (d.status === "WITHDRAWN" && p.authorId !== ctx.user.id) {
      await notify({ userIds: [p.authorId], leagueId: ctx.league.id, type: "RULE_PROPOSAL", title: `Withdrawn: ${p.title}`, body: d.note || "Your proposal was withdrawn.", url }).catch(() => null);
    }

    live(ctx, p.id, "status");
    revalidate(p.id);
    if (applied) {
      revalidatePath("/", "layout");
      return { ok: true, message: `Adopted and applied — league settings are now version ${applied.version} (${applied.changes} change${applied.changes === 1 ? "" : "s"}).` };
    }
    return { ok: true, message: `${STATUS_META[d.status].label}${d.status === "VOTING" ? " opened" : ""} — ${d.status === "WITHDRAWN" ? "proposal withdrawn" : "the league has been notified"}` };
  } catch (e) {
    return fail(e);
  }
}

/** Apply the settings patch of an already adopted proposal (e.g. when its effective season arrives). */
export async function applyProposalPatchAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    if (!hasFullPowers(ctx)) throw new Error("Only the commissioner (or a co-commissioner with full powers) can change league settings.");
    const p = await loadOwned(ctx, idSchema.parse(id));
    if (p.status !== "ADOPTED") throw new Error("Only adopted proposals can be applied to the league settings.");
    if ((await appliedPatches(ctx.league.id, [p.id])).has(p.id)) throw new Error("This proposal's settings change was already applied.");
    const res = await applyProposalPatch(ctx, p);
    await notify({ userIds: (await leagueUserIds(ctx.league.id)).filter((u) => u !== ctx.user.id), leagueId: ctx.league.id, type: "RULE_PROPOSAL", title: `Now in effect: ${p.title}`, body: res.summary.join("\n") || "League settings were updated.", url: `/rules/suggestions/${p.id}` }).catch(() => null);
    live(ctx, p.id, "status");
    revalidate(p.id);
    revalidatePath("/", "layout");
    return { ok: true, message: `Applied — league settings are now version ${res.version} (${res.changes} change${res.changes === 1 ? "" : "s"}).` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteProposalAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const p = await loadOwned(ctx, idSchema.parse(id));
    const author = p.authorId === ctx.user.id;
    if (!ctx.isCommish) {
      if (!author) throw new Error("Only the commissioner can delete someone else's proposal.");
      const [votes, comments] = await Promise.all([db.ruleProposalVote.count({ where: { proposalId: p.id, userId: { not: ctx.user.id } } }), db.ruleProposalComment.count({ where: { proposalId: p.id } })]);
      if (votes || comments) throw new Error("Others have already voted or commented — withdraw the proposal instead.");
    }
    if (p.status === "ADOPTED" && (await appliedPatches(ctx.league.id, [p.id])).has(p.id)) throw new Error("This proposal changed the league settings, so it stays on the record.");
    await db.ruleProposal.delete({ where: { id: p.id } });
    if (ctx.isCommish && !author)
      await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "proposal.delete", targetType: "rule_proposal", targetId: p.id, details: { title: p.title, authorId: p.authorId, status: p.status } } });
    live(ctx, p.id, "deleted");
    revalidate();
    return { ok: true, message: "Proposal deleted" };
  } catch (e) {
    return fail(e);
  }
}
