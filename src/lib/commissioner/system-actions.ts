"use server";
// Commissioner system tools: run background jobs, email log preview, test email / push, announcements.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { JOBS, runJob } from "@/lib/jobs/registry";
import { emailLayout, sendEmail } from "@/lib/email";
import { leagueUserIds, notify, pushEnabled, sendPushToUser } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { audit, fail, idSchema, requireCommish, type ActionResult } from "@/lib/commissioner/server";

function revalidateSystem() {
  revalidatePath("/commissioner/system");
  revalidatePath("/commissioner");
}

export async function runJobNow(raw: { name: string }): Promise<ActionResult<{ output: string }>> {
  try {
    const ctx = await requireCommish();
    const { name } = z.object({ name: z.string().min(1).max(64) }).parse(raw);
    const job = JOBS.find((j) => j.name === name);
    if (!job) return { ok: false, error: "Unknown job." };
    const started = Date.now();
    const output = await runJob(name);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    await audit(db, ctx, "job.run", { targetType: "job", targetId: name, details: { summary: `${name} (${secs}s): ${output.slice(0, 160)}` } });
    revalidateSystem();
    if (output.startsWith("error:")) return { ok: false, error: `${name} failed after ${secs}s — ${output.slice(7, 300)}` };
    if (output.startsWith("skipped")) return { ok: false, error: `${name} is already running.` };
    return { ok: true, message: `${name} finished in ${secs}s: ${output.slice(0, 200)}`, data: { output } };
  } catch (e) {
    return fail(e);
  }
}

export async function getEmailHtml(raw: { id: string }): Promise<ActionResult<{ html: string; subject: string; to: string }>> {
  try {
    const ctx = await requireCommish();
    const { id } = z.object({ id: idSchema }).parse(raw);
    const e = await db.emailLog.findUnique({ where: { id } });
    if (!e || e.leagueId !== ctx.league.id || e.type === "PASSWORD_RESET") return { ok: false, error: "Email not found." };
    return { ok: true, data: { html: e.html, subject: e.subject, to: e.to } };
  } catch (e) {
    return fail(e);
  }
}

export async function sendTestEmail(): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const now = new Intl.DateTimeFormat("en-US", { timeZone: ctx.settings.general.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
    const r = await sendEmail({
      to: ctx.user.email,
      subject: `${ctx.league.name}: test email`,
      html: emailLayout(
        "Email delivery test",
        `<p style="font-size:15px;line-height:1.5">This is a test email from the ${ctx.league.name} commissioner tools, sent ${now}. If you can read it, league emails (recaps, trade alerts, invites) are being delivered.</p>`,
      ),
      type: "GENERIC",
      leagueId: ctx.league.id,
    });
    await audit(db, ctx, "system.test_email", { details: { summary: `${ctx.user.email}: ${r.ok ? (r.preview ? "saved as preview" : "sent") : `failed (${r.error})`}` } });
    revalidateSystem();
    if (!r.ok) return { ok: false, error: `Email failed: ${r.error}` };
    return { ok: true, message: r.preview ? "No SMTP server is configured, so the email was saved to the email log as a preview." : `Test email sent to ${ctx.user.email}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function sendTestPush(): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    if (!pushEnabled()) return { ok: false, error: "Web push isn't configured on the server (VAPID keys are missing — see README › Phone alerts)." };
    const subs = await db.pushSubscription.count({ where: { userId: ctx.user.id } });
    if (!subs) return { ok: false, error: "This account has no devices subscribed. Turn on phone alerts under Settings › Notifications on your phone first." };
    const sent = await sendPushToUser(ctx.user.id, { title: `${ctx.settings.general.shortName || ctx.league.name} test alert`, body: "Push notifications are working on this device.", url: "/commissioner/system", tag: "test" });
    await audit(db, ctx, "system.test_push", { details: { summary: `${sent}/${subs} device(s)` } });
    revalidateSystem();
    if (!sent) return { ok: false, error: `Push failed for all ${subs} device(s); expired subscriptions were removed. Re-enable alerts on your phone.` };
    return { ok: true, message: `Test push sent to ${sent} of ${subs} device${subs === 1 ? "" : "s"}.` };
  } catch (e) {
    return fail(e);
  }
}

const annSchema = z.object({
  title: z.string().trim().min(3, "Add a title").max(120),
  body: z.string().trim().min(3, "Add a message").max(4000),
  pinned: z.boolean().default(false),
  notify: z.boolean().default(true),
  postToChat: z.boolean().default(true),
});

export async function createAnnouncement(raw: z.input<typeof annSchema>): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const input = annSchema.parse(raw);
    const ann = await db.$transaction(async (tx) => {
      const a = await tx.leagueAnnouncement.create({ data: { leagueId: ctx.league.id, authorId: ctx.user.id, title: input.title, body: input.body, pinned: input.pinned } });
      await audit(tx, ctx, "announcement.create", { targetType: "announcement", targetId: a.id, details: { summary: input.title, pinned: input.pinned } });
      return a;
    });
    const notes: string[] = [];
    if (input.postToChat) {
      await postSystemMessage(ctx.league.id, `Commissioner announcement — ${input.title}\n${input.body}`, { channel: "general", kind: "SYSTEM", data: { announcementId: ann.id } }).catch(() => null);
      notes.push("posted in chat");
    }
    if (input.notify) {
      const ids = (await leagueUserIds(ctx.league.id)).filter((id) => id !== ctx.user.id);
      await notify({ userIds: ids, leagueId: ctx.league.id, type: "COMMISSIONER", title: input.title, body: input.body.slice(0, 500), url: "/", data: { announcementId: ann.id } }).catch(() => {});
      notes.push(`${ids.length} manager${ids.length === 1 ? "" : "s"} notified`);
    }
    revalidateSystem();
    revalidatePath("/");
    return { ok: true, message: `Announcement posted${notes.length ? ` (${notes.join(", ")})` : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleAnnouncementPin(raw: { id: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const { id } = z.object({ id: idSchema }).parse(raw);
    const a = await db.leagueAnnouncement.findUnique({ where: { id } });
    if (!a || a.leagueId !== ctx.league.id) return { ok: false, error: "Announcement not found." };
    await db.$transaction(async (tx) => {
      await tx.leagueAnnouncement.update({ where: { id }, data: { pinned: !a.pinned } });
      await audit(tx, ctx, "announcement.pin", { targetType: "announcement", targetId: id, details: { summary: `${a.title}: ${a.pinned ? "unpinned" : "pinned"}` } });
    });
    revalidateSystem();
    revalidatePath("/");
    return { ok: true, message: a.pinned ? "Unpinned." : "Pinned to the top of the league home page." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAnnouncement(raw: { id: string }): Promise<ActionResult> {
  try {
    const ctx = await requireCommish();
    const { id } = z.object({ id: idSchema }).parse(raw);
    const a = await db.leagueAnnouncement.findUnique({ where: { id } });
    if (!a || a.leagueId !== ctx.league.id) return { ok: false, error: "Announcement not found." };
    await db.$transaction(async (tx) => {
      await tx.leagueAnnouncement.delete({ where: { id } });
      await audit(tx, ctx, "announcement.delete", { targetType: "announcement", targetId: id, details: { summary: a.title } });
    });
    revalidateSystem();
    revalidatePath("/");
    return { ok: true, message: "Announcement deleted." };
  } catch (e) {
    return fail(e);
  }
}
