"use server";
// Commissioner tools for teams & managers: invites, roles, owner reassignment / replacement,
// member removal, team identity edits, expansion teams. Every action writes an AuditLog row.
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendEmail, emailLayout } from "@/lib/email";
import { adjustFaab } from "@/lib/roster-ops";
import { ensureDraftPicks, firstOpenDraftSeason } from "@/lib/picks";
import { audit, fail, idSchema, leagueTeam, requireCommish, requireFullPowers, type ActionResult } from "@/lib/commissioner/server";
import type { LeagueContext } from "@/lib/league";

function revalidateMembers() {
  revalidatePath("/commissioner/members");
  revalidatePath("/commissioner");
  revalidatePath("/", "layout");
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const inviteLink = (code: string) => `${appUrl()}/signup?code=${encodeURIComponent(code)}`;
const newCode = () => `CTE-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function emailInvite(ctx: LeagueContext, to: string, code: string, teamName: string | null, expiresAt: Date | null) {
  const link = inviteLink(code);
  const body = `<p style="font-size:15px;line-height:1.55">${escapeHtml(ctx.user.name)} invited you to join <b>${escapeHtml(ctx.league.name)}</b>, a dynasty salary-cap fantasy football league${
    teamName ? ` as the manager of <b>${escapeHtml(teamName)}</b>` : ""
  }.</p>
<p><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600">Accept the invite</a></p>
<p style="font-size:13px;color:#64748b">Or sign up at ${escapeHtml(appUrl())}/signup with invite code <b style="font-family:monospace">${escapeHtml(code)}</b>${
    expiresAt ? `. The invite expires ${expiresAt.toUTCString().replace(/:\d\d GMT/, " UTC")}` : ""
  }.</p>`;
  return sendEmail({ to, subject: `You're invited to ${ctx.league.name}`, html: emailLayout(`Join ${escapeHtml(ctx.league.name)}`, body, "You received this because a league commissioner invited you."), type: "INVITE", leagueId: ctx.league.id });
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200).optional().or(z.literal("").transform(() => undefined)),
  teamId: idSchema.optional().or(z.literal("").transform(() => undefined)),
  role: z.enum(["MANAGER", "CO_COMMISSIONER"]).default("MANAGER"),
  expiresDays: z.number().int().min(0).max(365).default(14),
  sendEmail: z.boolean().default(true),
});

export async function createInvite(raw: z.input<typeof inviteSchema>): Promise<ActionResult<{ code: string; link: string }>> {
  try {
    const input = inviteSchema.parse(raw);
    const ctx = input.role === "CO_COMMISSIONER" ? await requireFullPowers() : await requireCommish();
    let teamName: string | null = null;
    if (input.teamId) {
      const team = await leagueTeam(ctx, input.teamId);
      const member = await db.leagueMember.findUnique({ where: { teamId: team.id } });
      if (member || team.ownerId) throw new Error(`${team.name} already has a manager. Use "Replace manager" to invite a successor.`);
      const pending = await db.invite.findFirst({ where: { leagueId: ctx.league.id, teamId: team.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
      if (pending) throw new Error(`${team.name} already has an open invite (${pending.code}). Revoke it first.`);
      teamName = team.name;
    }
    if (input.email) {
      const existing = await db.user.findUnique({ where: { email: input.email }, include: { memberships: { where: { leagueId: ctx.league.id } } } });
      if (existing?.memberships.length) throw new Error(`${input.email} is already in the league.`);
    }
    const expiresAt = input.expiresDays ? new Date(Date.now() + input.expiresDays * 864e5) : null;
    const invite = await db.$transaction(async (tx) => {
      const inv = await tx.invite.create({ data: { leagueId: ctx.league.id, code: newCode(), email: input.email ?? null, teamId: input.teamId ?? null, role: input.role, expiresAt, createdById: ctx.user.id } });
      await audit(tx, ctx, "member.invite", { targetType: "invite", targetId: inv.id, details: { summary: `${input.email ?? "Open invite"}${teamName ? ` for ${teamName}` : ""}`, role: input.role, code: inv.code } });
      return inv;
    });
    let emailNote = "";
    if (input.email && input.sendEmail) {
      const r = await emailInvite(ctx, input.email, invite.code, teamName, expiresAt);
      emailNote = r.ok ? (r.preview ? " Email saved to the email log (no SMTP configured)." : ` Email sent to ${input.email}.`) : ` Email failed: ${r.error}`;
    }
    revalidateMembers();
    return { ok: true, message: `Invite ${invite.code} created.${emailNote}`, data: { code: invite.code, link: inviteLink(invite.code) } };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInvite(raw: { inviteId: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const { inviteId } = z.object({ inviteId: idSchema }).parse(raw);
    const inv = await db.invite.findUnique({ where: { id: inviteId } });
    if (!inv || inv.leagueId !== ctx.league.id) return { ok: false, error: "Invite not found." };
    if (inv.usedAt) return { ok: false, error: "That invite was already used." };
    await db.$transaction(async (tx) => {
      await tx.invite.delete({ where: { id: inv.id } });
      await audit(tx, ctx, "member.invite_revoke", { targetType: "invite", targetId: inv.id, details: { summary: `${inv.email ?? "Open invite"} (${inv.code})` } });
    });
    revalidateMembers();
    return { ok: true, message: `Invite ${inv.code} revoked.` };
  } catch (e) {
    return fail(e);
  }
}

export async function resendInvite(raw: { inviteId: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const { inviteId } = z.object({ inviteId: idSchema }).parse(raw);
    const inv = await db.invite.findUnique({ where: { id: inviteId } });
    if (!inv || inv.leagueId !== ctx.league.id) return { ok: false, error: "Invite not found." };
    if (!inv.email) return { ok: false, error: "This invite has no email address. Copy the link instead." };
    if (inv.usedAt) return { ok: false, error: "That invite was already used." };
    const team = inv.teamId ? await db.team.findUnique({ where: { id: inv.teamId }, select: { name: true } }) : null;
    const r = await emailInvite(ctx, inv.email, inv.code, team?.name ?? null, inv.expiresAt);
    await audit(db, ctx, "member.invite_resend", { targetType: "invite", targetId: inv.id, details: { summary: inv.email } });
    revalidateMembers();
    if (!r.ok) return { ok: false, error: `Email failed: ${r.error}` };
    return { ok: true, message: r.preview ? "Invite saved to the email log (no SMTP configured)." : `Invite re-sent to ${inv.email}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function resetLeagueInviteCode(): Promise<ActionResult<{ code: string }>> {
  try {
    const ctx = await requireFullPowers();
    const code = newCode();
    await db.$transaction(async (tx) => {
      await tx.league.update({ where: { id: ctx.league.id }, data: { inviteCode: code } });
      await audit(tx, ctx, "league.invite_code", { targetType: "league", targetId: ctx.league.id, details: { summary: "Old league code no longer works" } });
    });
    revalidateMembers();
    return { ok: true, message: `New league code: ${code}`, data: { code } };
  } catch (e) {
    return fail(e);
  }
}

async function loadMember(ctx: LeagueContext, memberId: string) {
  const m = await db.leagueMember.findUnique({ where: { id: memberId }, include: { user: { select: { id: true, name: true, email: true } }, team: { select: { id: true, name: true, ownerId: true } } } });
  if (!m || m.leagueId !== ctx.league.id) throw new Error("Member not found.");
  return m;
}

export async function changeMemberRole(raw: { memberId: string; role: "MANAGER" | "CO_COMMISSIONER" }): Promise<ActionResult> {
  try {
    const ctx = await requireFullPowers();
    const input = z.object({ memberId: idSchema, role: z.enum(["MANAGER", "CO_COMMISSIONER"]) }).parse(raw);
    const m = await loadMember(ctx, input.memberId);
    if (m.role === "COMMISSIONER") return { ok: false, error: "The commissioner's role can't be changed here." };
    if (m.userId === ctx.user.id) return { ok: false, error: "You can't change your own role." };
    if (m.role === input.role) return { ok: true, message: "No change." };
    await db.$transaction(async (tx) => {
      await tx.leagueMember.update({ where: { id: m.id }, data: { role: input.role } });
      await audit(tx, ctx, "member.role", { targetType: "member", targetId: m.id, details: { summary: `${m.user.name}: ${m.role} → ${input.role}` } });
    });
    revalidateMembers();
    return { ok: true, message: `${m.user.name} is now ${input.role === "CO_COMMISSIONER" ? "a co-commissioner" : "a manager"}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMember(raw: { memberId: string }): Promise<ActionResult> {
  try {
    const ctx = await requireFullPowers();
    const { memberId } = z.object({ memberId: idSchema }).parse(raw);
    const m = await loadMember(ctx, memberId);
    if (m.role === "COMMISSIONER") return { ok: false, error: "The commissioner can't be removed." };
    if (m.userId === ctx.user.id) return { ok: false, error: "You can't remove yourself." };
    await db.$transaction(async (tx) => {
      if (m.team && m.team.ownerId === m.userId) await tx.team.update({ where: { id: m.team.id }, data: { ownerId: null } });
      await tx.leagueMember.delete({ where: { id: m.id } });
      await audit(tx, ctx, "member.remove", { targetType: "member", targetId: m.id, details: { summary: `${m.user.name}${m.team ? ` (${m.team.name} is now unowned)` : ""}`, userId: m.userId, teamId: m.team?.id ?? null } });
    });
    revalidateMembers();
    return { ok: true, message: `${m.user.name} removed.${m.team ? ` ${m.team.name} is now unowned — invite a replacement.` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function assignTeamOwner(raw: { teamId: string; memberId: string }): Promise<ActionResult> {
  try {
    const ctx = await requireFullPowers();
    const input = z.object({ teamId: idSchema, memberId: idSchema }).parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    const m = await loadMember(ctx, input.memberId);
    if (m.teamId === team.id) return { ok: true, message: "Already the manager." };
    if (m.teamId) return { ok: false, error: `${m.user.name} already manages ${m.team?.name}. Remove them from that team first.` };
    const current = await db.leagueMember.findUnique({ where: { teamId: team.id }, include: { user: { select: { name: true } } } });
    await db.$transaction(async (tx) => {
      if (current) await tx.leagueMember.update({ where: { id: current.id }, data: { teamId: null } });
      await tx.leagueMember.update({ where: { id: m.id }, data: { teamId: team.id } });
      await tx.team.update({ where: { id: team.id }, data: { ownerId: m.userId } });
      await audit(tx, ctx, "member.assign", { targetType: "team", targetId: team.id, details: { summary: `${team.name} → ${m.user.name}${current ? ` (replacing ${current.user.name})` : ""}` } });
    });
    revalidateMembers();
    return { ok: true, message: `${m.user.name} now manages ${team.name}.${current ? ` ${current.user.name} no longer has a team.` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

const replaceSchema = z.object({
  teamId: idSchema,
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200).optional().or(z.literal("").transform(() => undefined)),
  removeFromLeague: z.boolean().default(true),
  sendEmail: z.boolean().default(true),
});

/** Orphan a team (current manager leaves) and create an invite pre-assigned to it. */
export async function replaceManager(raw: z.input<typeof replaceSchema>): Promise<ActionResult<{ code: string; link: string }>> {
  try {
    const ctx = await requireFullPowers();
    const input = replaceSchema.parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    const current = await db.leagueMember.findUnique({ where: { teamId: team.id }, include: { user: { select: { id: true, name: true } } } });
    if (current?.role === "COMMISSIONER") return { ok: false, error: "The commissioner's team can't be handed off here." };
    if (current?.userId === ctx.user.id) return { ok: false, error: "You can't replace yourself." };
    await db.invite.deleteMany({ where: { leagueId: ctx.league.id, teamId: team.id, usedAt: null } });
    const expiresAt = new Date(Date.now() + 14 * 864e5);
    const invite = await db.$transaction(async (tx) => {
      if (current) {
        if (input.removeFromLeague) await tx.leagueMember.delete({ where: { id: current.id } });
        else await tx.leagueMember.update({ where: { id: current.id }, data: { teamId: null } });
      }
      await tx.team.update({ where: { id: team.id }, data: { ownerId: null } });
      const inv = await tx.invite.create({ data: { leagueId: ctx.league.id, code: newCode(), email: input.email ?? null, teamId: team.id, role: "MANAGER", expiresAt, createdById: ctx.user.id } });
      await audit(tx, ctx, "member.replace", {
        targetType: "team",
        targetId: team.id,
        details: { summary: `${team.name}: ${current ? `${current.user.name} ${input.removeFromLeague ? "removed" : "unassigned"}` : "unowned"}; invite ${inv.code}${input.email ? ` to ${input.email}` : ""}` },
      });
      return inv;
    });
    let emailNote = "";
    if (input.email && input.sendEmail) {
      const r = await emailInvite(ctx, input.email, invite.code, team.name, expiresAt);
      emailNote = r.ok ? (r.preview ? " Invite saved to the email log." : ` Invite emailed to ${input.email}.`) : ` Email failed: ${r.error}`;
    }
    revalidateMembers();
    return { ok: true, message: `${team.name} is ready for a new manager (invite ${invite.code}).${emailNote}`, data: { code: invite.code, link: inviteLink(invite.code) } };
  } catch (e) {
    return fail(e);
  }
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors must be hex like #1d4ed8");
const teamSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(2, "Team names need at least 2 characters").max(40),
  abbrev: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,4}$/, "Abbreviations are 2-4 letters or digits"),
  primaryColor: hex,
  secondaryColor: hex,
  division: z.string().trim().max(64).nullable(),
  motto: z.string().trim().max(120).nullable().optional(),
});

export async function updateTeam(raw: z.input<typeof teamSchema>): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = teamSchema.parse(raw);
    const team = await leagueTeam(ctx, input.teamId);
    if (input.division && !ctx.settings.general.divisions.some((d) => d.id === input.division)) return { ok: false, error: "Unknown division." };
    const clash = await db.team.findFirst({ where: { leagueId: ctx.league.id, id: { not: team.id }, OR: [{ abbrev: input.abbrev }, { name: { equals: input.name, mode: "insensitive" } }] } });
    if (clash) return { ok: false, error: clash.abbrev === input.abbrev ? `${clash.name} already uses ${input.abbrev}.` : "Another team already has that name." };
    const changes: string[] = [];
    if (team.name !== input.name) changes.push(`name “${team.name}” → “${input.name}”`);
    if (team.abbrev !== input.abbrev) changes.push(`abbrev ${team.abbrev} → ${input.abbrev}`);
    if ((team.division ?? null) !== input.division) changes.push("division");
    if (team.primaryColor !== input.primaryColor || team.secondaryColor !== input.secondaryColor) changes.push("colors");
    if (input.motto !== undefined && (team.motto ?? null) !== (input.motto || null)) changes.push("motto");
    if (!changes.length) return { ok: true, message: "No changes." };
    await db.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: team.id },
        data: { name: input.name, abbrev: input.abbrev, primaryColor: input.primaryColor, secondaryColor: input.secondaryColor, division: input.division, ...(input.motto !== undefined ? { motto: input.motto || null } : {}) },
      });
      await audit(tx, ctx, "team.update", { targetType: "team", targetId: team.id, details: { summary: `${team.name}: ${changes.join(", ")}` } });
    });
    revalidateMembers();
    return { ok: true, message: `${input.name} updated.` };
  } catch (e) {
    return fail(e);
  }
}

export async function addExpansionTeam(raw: { name: string; abbrev: string }): Promise<ActionResult> {
  try {
    const ctx = await requireFullPowers();
    const input = teamSchema.pick({ name: true, abbrev: true }).parse(raw);
    const count = await db.team.count({ where: { leagueId: ctx.league.id } });
    if (count >= ctx.settings.general.teamCount) return { ok: false, error: `The league is set to ${ctx.settings.general.teamCount} teams. Raise "Number of teams" in Settings › General first.` };
    const clash = await db.team.findFirst({ where: { leagueId: ctx.league.id, OR: [{ abbrev: input.abbrev }, { name: { equals: input.name, mode: "insensitive" } }] } });
    if (clash) return { ok: false, error: "A team with that name or abbreviation already exists." };
    const budget = ctx.settings.waivers.faabBudget;
    const team = await db.$transaction(async (tx) => {
      const t = await tx.team.create({ data: { leagueId: ctx.league.id, name: input.name, abbrev: input.abbrev, waiverPriority: count + 1, faabBalance: 0 } });
      if (budget) await adjustFaab(tx, { leagueId: ctx.league.id, teamId: t.id, season: ctx.season, amount: budget, reason: "SEASON_START" });
      await audit(tx, ctx, "team.create", { targetType: "team", targetId: t.id, details: { summary: `${t.name} (${t.abbrev})` } });
      return t;
    });
    await ensureDraftPicks(ctx.league.id, firstOpenDraftSeason(ctx.season, ctx.league.phase), ctx.settings);
    revalidateMembers();
    return { ok: true, message: `${team.name} added with $${budget} FAB and a full set of draft picks. Invite a manager and regenerate the schedule.` };
  } catch (e) {
    return fail(e);
  }
}
