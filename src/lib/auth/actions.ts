"use server";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, hashToken, verifyPassword, getCurrentUser } from "@/lib/auth/session";
import { LEAGUE_COOKIE } from "@/lib/league";
import { sendEmail, emailLayout } from "@/lib/email";

export type FormState = { error?: string; ok?: boolean; message?: string } | undefined;

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email");
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(form.get("email"));
  const password = String(form.get("password") ?? "");
  if (!email.success) return { error: "Enter a valid email" };
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return { error: "Incorrect email or password" };
  await createSession(user.id);
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/** Sign up using a league invite code. Creates the account, joins the league and claims a team. */
export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Enter your name").max(60),
      email: emailSchema,
      password: passwordSchema,
      code: z.string().trim().min(4, "Enter your league invite code"),
      teamName: z.string().trim().max(40).optional(),
    })
    .safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      code: form.get("code"),
      teamName: form.get("teamName") || undefined,
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { name, email, password, code, teamName } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists. Sign in instead." };

  const invite = await db.invite.findUnique({ where: { code } });
  const league = invite ? await db.league.findUnique({ where: { id: invite.leagueId } }) : await db.league.findUnique({ where: { inviteCode: code } });
  if (!league) return { error: "That invite code is not valid." };
  if (invite && (invite.usedAt || (invite.expiresAt && invite.expiresAt < new Date()))) return { error: "That invite has already been used or expired." };
  if (invite?.email && invite.email.toLowerCase() !== email) return { error: "This invite was sent to a different email address." };

  // Find a team to claim: the invite's team, or the first team without an owner
  let teamId = invite?.teamId ?? null;
  if (!teamId) {
    const open = await db.team.findFirst({ where: { leagueId: league.id, ownerId: null }, orderBy: { createdAt: "asc" } });
    teamId = open?.id ?? null;
  }
  if (!teamId) return { error: "The league is full — ask the commissioner for help." };

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
    await tx.managerProfile.create({ data: { userId: u.id, displayName: name } });
    await tx.team.update({ where: { id: teamId! }, data: { ownerId: u.id, ...(teamName ? { name: teamName } : {}) } });
    await tx.leagueMember.create({ data: { leagueId: league.id, userId: u.id, role: invite?.role ?? "MANAGER", teamId } });
    if (invite) await tx.invite.update({ where: { id: invite.id }, data: { usedAt: new Date(), usedById: u.id } });
    return u;
  });
  await createSession(user.id);
  (await cookies()).set(LEAGUE_COOKIE, league.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 864e2 });
  redirect("/settings/profile?welcome=1");
}

/** Join another league with an invite code while signed in */
export async function joinLeagueAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const code = String(form.get("code") ?? "").trim();
  const invite = await db.invite.findUnique({ where: { code } });
  const league = invite ? await db.league.findUnique({ where: { id: invite.leagueId } }) : await db.league.findUnique({ where: { inviteCode: code } });
  if (!league) return { error: "Invalid invite code" };
  const already = await db.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId: user.id } } });
  if (!already) {
    let teamId = invite?.teamId ?? null;
    if (!teamId) teamId = (await db.team.findFirst({ where: { leagueId: league.id, ownerId: null } }))?.id ?? null;
    if (!teamId) return { error: "The league is full" };
    await db.$transaction([
      db.team.update({ where: { id: teamId }, data: { ownerId: user.id } }),
      db.leagueMember.create({ data: { leagueId: league.id, userId: user.id, role: invite?.role ?? "MANAGER", teamId } }),
      ...(invite ? [db.invite.update({ where: { id: invite.id }, data: { usedAt: new Date(), usedById: user.id } })] : []),
    ]);
  }
  (await cookies()).set(LEAGUE_COOKIE, league.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 864e2 });
  redirect("/");
}

export async function switchLeagueAction(form: FormData) {
  const id = String(form.get("leagueId") ?? "");
  (await cookies()).set(LEAGUE_COOKIE, id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 365 * 864e2 });
  redirect("/");
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email" };
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (user) {
    const token = crypto.randomBytes(32).toString("base64url");
    await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) } });
    const url = `${process.env.APP_URL || "http://localhost:3000"}/reset/${token}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your CTE Dynasty password",
      type: "PASSWORD_RESET",
      html: emailLayout(
        "Reset your password",
        `<p>Hi ${user.name},</p><p>Click below to choose a new password. This link expires in 1 hour.</p><p><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Reset password</a></p><p style="color:#64748b;font-size:12px">If you didn't request this you can ignore this email.</p>`,
      ),
    });
  }
  return { ok: true, message: "If that email has an account, a reset link is on its way." };
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const pw = passwordSchema.safeParse(form.get("password"));
  if (!pw.success) return { error: pw.error.issues[0]?.message };
  if (form.get("password") !== form.get("confirm")) return { error: "Passwords don't match" };
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return { error: "This reset link is invalid or expired." };
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(pw.data) } }),
    db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.session.deleteMany({ where: { userId: row.userId } }),
  ]);
  await createSession(row.userId);
  redirect("/");
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  const current = String(form.get("current") ?? "");
  const pw = passwordSchema.safeParse(form.get("password"));
  if (!pw.success) return { error: pw.error.issues[0]?.message };
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(current, u.passwordHash))) return { error: "Current password is incorrect" };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw.data) } });
  return { ok: true, message: "Password updated" };
}
