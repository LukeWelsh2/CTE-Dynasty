// Shared server-side helpers for commissioner actions: authorization, results, audit log.
import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner, type LeagueContext } from "@/lib/league";
import { notify, teamUserIds } from "@/lib/notify";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

type Tx = Prisma.TransactionClient | PrismaClient;

export function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
  const msg = (e as Error)?.message || "Something went wrong";
  if (/Unique constraint/i.test(msg)) return { ok: false, error: "That would create a duplicate record." };
  return { ok: false, error: msg };
}

/** True for the league commissioner (or a site admin); co-commissioners only with full powers. */
export function hasFullPowers(ctx: LeagueContext): boolean {
  if (ctx.user.isSiteAdmin || ctx.member.role === "COMMISSIONER") return true;
  return ctx.member.role === "CO_COMMISSIONER" && ctx.settings.commissioner.coCommissionerFullPowers;
}

/** Commissioner (or co-commissioner) of the active league */
export async function requireCommish(): Promise<LeagueContext> {
  return assertCommissioner();
}

/** Settings changes, roles and member removal need full commissioner powers */
export async function requireFullPowers(): Promise<LeagueContext> {
  const ctx = await assertCommissioner();
  if (!hasFullPowers(ctx)) throw new Error("Only the commissioner can do this (co-commissioners need full powers — see Settings › Commissioner).");
  return ctx;
}

/** Enforce settings.commissioner.ownTeamActionsRequireCoCommish for overrides on the actor's own team */
export function assertNotOwnTeam(ctx: LeagueContext, teamId: string | null | undefined) {
  if (!teamId || !ctx.settings.commissioner.ownTeamActionsRequireCoCommish) return;
  if (ctx.myTeam?.id === teamId && ctx.member.role !== "CO_COMMISSIONER" && !ctx.user.isSiteAdmin)
    throw new Error("League rules require a co-commissioner to make commissioner changes to your own team.");
}

export async function audit(
  tx: Tx,
  ctx: Pick<LeagueContext, "league" | "user">,
  action: string,
  opts: { targetType?: string; targetId?: string | null; details?: Record<string, unknown> } = {},
) {
  return tx.auditLog.create({
    data: {
      leagueId: ctx.league.id,
      actorId: ctx.user.id,
      action,
      targetType: opts.targetType ?? null,
      targetId: opts.targetId ?? null,
      details: (opts.details ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/** Tell a team's manager(s) about a commissioner change (honors settings.commissioner.notifyAffectedOwners). */
export async function notifyTeam(ctx: LeagueContext, teamId: string | null | undefined, title: string, body: string, url = "/team") {
  if (!teamId || !ctx.settings.commissioner.notifyAffectedOwners) return;
  const ids = (await teamUserIds(teamId)).filter((id) => id !== ctx.user.id);
  if (!ids.length) return;
  await notify({ userIds: ids, leagueId: ctx.league.id, type: "COMMISSIONER", title, body, url }).catch(() => {});
}

export const idSchema = z.string().trim().min(1).max(64);

/** Make sure a team belongs to the commissioner's league */
export async function leagueTeam(ctx: LeagueContext, teamId: string, tx: Tx = db) {
  const team = await tx.team.findUnique({ where: { id: teamId } });
  if (!team || team.leagueId !== ctx.league.id) throw new Error("Team not found in this league.");
  return team;
}
