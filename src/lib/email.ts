// Email delivery (SMTP via nodemailer). With no SMTP_HOST configured, emails are saved to ./.emails
// and logged as PREVIEW in EmailLog so they can be viewed at /commissioner/emails.
import nodemailer from "nodemailer";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  type?: "RECAP" | "PASSWORD_RESET" | "INVITE" | "TRADE" | "GENERIC";
  leagueId?: string | null;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; preview?: boolean; error?: string }> {
  const t = getTransporter();
  const type = input.type ?? "GENERIC";
  if (!t) {
    try {
      const dir = path.join(process.cwd(), ".emails");
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${input.to.replace(/[^a-z0-9@.]/gi, "_")}.html`);
      await fs.writeFile(file, input.html);
    } catch {}
    await db.emailLog.create({ data: { to: input.to, subject: input.subject, html: input.html, type, status: "PREVIEW", leagueId: input.leagueId ?? null } });
    return { ok: true, preview: true };
  }
  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || "CTE Dynasty <no-reply@localhost>",
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    await db.emailLog.create({ data: { to: input.to, subject: input.subject, html: input.html, type, status: "SENT", leagueId: input.leagueId ?? null } });
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message;
    await db.emailLog.create({ data: { to: input.to, subject: input.subject, html: input.html, type, status: "FAILED", error, leagueId: input.leagueId ?? null } });
    return { ok: false, error };
  }
}

/** Minimal branded email wrapper (inline styles for email clients) */
export function emailLayout(title: string, bodyHtml: string, footer = "You are receiving this because you are a manager in CTE Dynasty.") {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  return `<!doctype html><html><body style="margin:0;background:#eef1f6;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 0"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #dbe1ea">
<tr><td style="background:#0b1f3a;padding:18px 24px;color:#fff"><div style="font-size:12px;letter-spacing:2px;color:#f5b301;font-weight:700">CTE DYNASTY</div><div style="font-size:22px;font-weight:700;margin-top:4px">${title}</div></td></tr>
<tr><td style="padding:24px">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px">${footer}<br/><a href="${appUrl}" style="color:#1d4ed8">Open CTE Dynasty</a></td></tr>
</table></td></tr></table></body></html>`;
}
