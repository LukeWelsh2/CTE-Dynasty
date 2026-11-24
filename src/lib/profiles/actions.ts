"use server";
// Profile, team branding, notification preferences, devices and notification inbox actions.
import { unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertLeagueMember, assertTeamManager } from "@/lib/league";
import { NOTIFICATION_DEFAULTS, pushEnabled, sendPushToUser } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { isUploadUrl } from "@/lib/profiles/images";
import { brandingSchema, notificationPrefsSchema, profileSchema, resolvePrefs, type ProfileInput } from "@/lib/profiles/schema";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
  return { ok: false, error: (e as Error)?.message || "Something went wrong" };
}

/** Delete a replaced / removed uploaded image once nothing references it any more. */
async function removeUnusedUpload(url: string | null | undefined) {
  if (!url || !isUploadUrl(url)) return;
  const [users, covers, teams, leagues] = await Promise.all([
    db.user.count({ where: { avatarUrl: url } }),
    db.managerProfile.count({ where: { coverUrl: url } }),
    db.team.count({ where: { logoUrl: url } }),
    db.league.count({ where: { logoUrl: url } }),
  ]);
  if (users + covers + teams + leagues > 0) return;
  const name = url.split("/").pop()!;
  await unlink(path.join(process.cwd(), "public", "uploads", name)).catch(() => null);
}

function revalidateManager(userId: string) {
  revalidatePath(`/managers/${userId}`);
  revalidatePath("/managers");
  revalidatePath("/settings/profile");
  revalidatePath("/", "layout");
}

export async function updateProfileAction(input: ProfileInput): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = profileSchema.parse(input);
    const profile = {
      displayName: d.displayName,
      bio: d.bio,
      motto: d.motto,
      location: d.location,
      favoriteNflTeam: d.favoriteNflTeam,
      favoritePlayer: d.favoritePlayer,
      yearsPlaying: d.yearsPlaying,
      managerStyle: d.managerStyle,
      socials: d.socials as Prisma.InputJsonValue,
      showEmail: d.showEmail,
      showPhone: d.showPhone,
    };
    await db.$transaction([
      db.user.update({ where: { id: ctx.user.id }, data: { name: d.name, timezone: d.timezone, phone: d.phone } }),
      db.managerProfile.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, ...profile }, update: profile }),
    ]);
    revalidateManager(ctx.user.id);
    return { ok: true, message: "Profile saved" };
  } catch (e) {
    return fail(e);
  }
}

const imageSchema = z.object({
  kind: z.enum(["avatar", "cover"]),
  url: z
    .string()
    .nullable()
    .refine((v) => v === null || isUploadUrl(v), "Upload the image first"),
});

export async function setProfileImageAction(input: z.input<typeof imageSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const { kind, url } = imageSchema.parse(input);
    let previous: string | null | undefined;
    if (kind === "avatar") {
      previous = (await db.user.findUnique({ where: { id: ctx.user.id }, select: { avatarUrl: true } }))?.avatarUrl;
      await db.user.update({ where: { id: ctx.user.id }, data: { avatarUrl: url } });
    } else {
      previous = (await db.managerProfile.findUnique({ where: { userId: ctx.user.id }, select: { coverUrl: true } }))?.coverUrl;
      await db.managerProfile.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, coverUrl: url }, update: { coverUrl: url } });
    }
    if (previous !== url) await removeUnusedUpload(previous);
    revalidateManager(ctx.user.id);
    return { ok: true, message: url ? (kind === "avatar" ? "Profile photo updated" : "Cover image updated") : kind === "avatar" ? "Profile photo removed" : "Cover image removed" };
  } catch (e) {
    return fail(e);
  }
}

export async function updateTeamBrandingAction(input: z.input<typeof brandingSchema>): Promise<ActionResult> {
  try {
    const d = brandingSchema.parse(input);
    const ctx = await assertTeamManager(d.teamId);
    const team = await db.team.findUniqueOrThrow({ where: { id: d.teamId } });
    if (team.leagueId !== ctx.league.id) throw new Error("Team not found");
    const clash = await db.team.findFirst({
      where: { leagueId: ctx.league.id, id: { not: team.id }, OR: [{ name: { equals: d.name, mode: "insensitive" } }, { abbrev: d.abbrev }] },
      select: { name: true, abbrev: true },
    });
    if (clash) throw new Error(clash.abbrev === d.abbrev ? `${clash.name} already uses the abbreviation ${d.abbrev}.` : `Another team is already called ${clash.name}.`);
    await db.team.update({ where: { id: team.id }, data: { name: d.name, abbrev: d.abbrev, motto: d.motto, primaryColor: d.primaryColor, secondaryColor: d.secondaryColor } });
    const own = ctx.myTeam?.id === team.id;
    if (!own) {
      await db.auditLog.create({
        data: {
          leagueId: ctx.league.id,
          actorId: ctx.user.id,
          action: "team.branding",
          targetType: "team",
          targetId: team.id,
          details: { before: { name: team.name, abbrev: team.abbrev, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor }, after: d } as Prisma.InputJsonValue,
        },
      });
    }
    if (team.name !== d.name) {
      await postSystemMessage(ctx.league.id, `${team.name} will now be known as ${d.name} (${d.abbrev}).`, { channel: "general", kind: "SYSTEM", data: { teamId: team.id, url: `/teams/${team.id}` } }).catch(() => null);
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Team branding saved" };
  } catch (e) {
    return fail(e);
  }
}

const logoSchema = z.object({
  teamId: z.string().min(1).max(64),
  url: z
    .string()
    .nullable()
    .refine((v) => v === null || isUploadUrl(v), "Upload the image first"),
});

export async function setTeamLogoAction(input: z.input<typeof logoSchema>): Promise<ActionResult> {
  try {
    const d = logoSchema.parse(input);
    const ctx = await assertTeamManager(d.teamId);
    const team = await db.team.findUniqueOrThrow({ where: { id: d.teamId } });
    if (team.leagueId !== ctx.league.id) throw new Error("Team not found");
    await db.team.update({ where: { id: team.id }, data: { logoUrl: d.url } });
    if (team.logoUrl !== d.url) await removeUnusedUpload(team.logoUrl);
    if (ctx.myTeam?.id !== team.id)
      await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action: "team.logo", targetType: "team", targetId: team.id, details: { from: team.logoUrl, to: d.url } } });
    revalidatePath("/", "layout");
    return { ok: true, message: d.url ? "Team logo updated" : "Team logo removed — the monogram shield is back" };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Notifications ─────────────────────────────

export async function saveNotificationPrefsAction(input: z.input<typeof notificationPrefsSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = notificationPrefsSchema.parse(input);
    // keep only known types, merged over the defaults
    const prefs = resolvePrefs(NOTIFICATION_DEFAULTS, d.prefs);
    await db.$transaction([
      db.notificationPreference.upsert({
        where: { userId: ctx.user.id },
        create: {
          userId: ctx.user.id,
          prefs: prefs as unknown as Prisma.InputJsonValue,
          tdScope: d.tdScope,
          quietStart: d.quietHours ? d.quietStart : null,
          quietEnd: d.quietHours ? d.quietEnd : null,
          weeklyRecapEmail: d.weeklyRecapEmail,
          smsEnabled: d.smsEnabled,
        },
        update: {
          prefs: prefs as unknown as Prisma.InputJsonValue,
          tdScope: d.tdScope,
          quietStart: d.quietHours ? d.quietStart : null,
          quietEnd: d.quietHours ? d.quietEnd : null,
          weeklyRecapEmail: d.weeklyRecapEmail,
          smsEnabled: d.smsEnabled,
        },
      }),
      db.user.update({ where: { id: ctx.user.id }, data: { phone: d.phone } }),
    ]);
    revalidatePath("/settings/notifications");
    return { ok: true, message: "Notification settings saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function removePushDeviceAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const res = await db.pushSubscription.deleteMany({ where: { id: z.string().min(1).max(64).parse(id), userId: ctx.user.id } });
    if (!res.count) throw new Error("That device is already removed.");
    revalidatePath("/settings/notifications");
    return { ok: true, message: "Device removed — it won't get alerts anymore" };
  } catch (e) {
    return fail(e);
  }
}

export async function sendTestNotificationAction(): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    if (!pushEnabled()) throw new Error("Phone alerts aren't configured on this server yet (VAPID keys are missing). Ask the commissioner to set them up.");
    const devices = await db.pushSubscription.count({ where: { userId: ctx.user.id } });
    if (!devices) throw new Error("No devices are set up for alerts. Tap “Enable alerts on this device” first.");
    const sent = await sendPushToUser(ctx.user.id, {
      title: "CTE Dynasty test alert 🏈",
      body: `Touchdown alerts are working on this device, ${ctx.user.name.split(" ")[0]}.`,
      url: "/settings/notifications",
      tag: "TEST",
    });
    if (!sent) throw new Error("We couldn't reach any of your devices. Remove old devices and enable alerts again.");
    revalidatePath("/settings/notifications");
    return { ok: true, message: `Test alert sent to ${sent} device${sent === 1 ? "" : "s"}` };
  } catch (e) {
    return fail(e);
  }
}

const markSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(500).optional(), all: z.boolean().optional(), unread: z.boolean().optional() });

export async function markNotificationsAction(input: z.input<typeof markSchema>): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const d = markSchema.parse(input);
    if (!d.all && !d.ids?.length) return { ok: true };
    if (d.unread) {
      await db.notification.updateMany({ where: { userId: ctx.user.id, id: { in: d.ids ?? [] } }, data: { readAt: null } });
    } else {
      await db.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(d.all ? {} : { id: { in: d.ids ?? [] } }) }, data: { readAt: new Date() } });
    }
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { ok: true, message: d.all ? "All caught up" : undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteReadNotificationsAction(): Promise<ActionResult> {
  try {
    const ctx = await assertLeagueMember();
    const res = await db.notification.deleteMany({ where: { userId: ctx.user.id, readAt: { not: null } } });
    revalidatePath("/notifications");
    return { ok: true, message: res.count ? `Cleared ${res.count} read notification${res.count === 1 ? "" : "s"}` : "Nothing to clear" };
  } catch (e) {
    return fail(e);
  }
}
