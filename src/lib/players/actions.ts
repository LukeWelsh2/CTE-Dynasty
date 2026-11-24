"use server";
// Free agency server actions: add / claim (with optional drop), cancel claim, drop, watch list.
// Roster-changing actions take a per-team Postgres advisory lock inside their DB transaction so double-submits
// and concurrent moves by the same team are serialized and re-validated against committed state.
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertLeagueMember, assertTeamManager, type LeagueContext } from "@/lib/league";
import { addPlayerToTeam, broadcastTransaction, dropPlayerFromTeam } from "@/lib/roster-ops";
import { postSystemMessage } from "@/lib/chat-system";
import { acquisitionCounts, acquisitionState, dropBlocker, newRosterProblems, teamDeadMoney } from "@/lib/players/acquire";
import { activeRosterLimit } from "@/lib/roster";
import { fmtDateTime } from "@/lib/players/format";
import {
  AUCTION_POOL_REASON,
  acquisitionLimitError,
  auctionPoolDetail,
  claimUsesFab,
  deadMoneyPreview,
  pendingClaimLimitError,
  signingSalary,
  signingYears,
  validateBid,
} from "@/lib/players/logic";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(64);

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** User-facing message for an exception (Prisma internals are never shown verbatim). */
function errorMessage(e: unknown, fallback: string): string {
  const code = (e as { code?: string } | null)?.code;
  if (code === "P2002") return "That player was just picked up by another team. Refresh and try again.";
  if (code === "P2034" || code === "P2028") return "Another roster move was in progress. Please try again.";
  const m = (e as Error | null)?.message ?? "";
  if (!m || m.includes("invocation") || m.length > 300) return fallback;
  return m;
}

/** Serialize roster-changing writes for one team (released when the transaction ends) */
async function lockTeam(tx: Prisma.TransactionClient, teamId: string) {
  await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${"players:team:" + teamId}))) AS l`;
}

function revalidate(playerIds: (string | null | undefined)[]) {
  for (const p of ["/players", "/news", "/injuries", "/team", "/transactions", "/waivers", "/"]) revalidatePath(p);
  for (const pid of playerIds) if (pid) revalidatePath(`/players/${pid}`);
}

async function announce(ctx: LeagueContext, body: string, data: Record<string, unknown>) {
  if (!ctx.settings.notifications.transactionsToChat) return;
  await postSystemMessage(ctx.league.id, body, { channel: "transactions", kind: "TRANSACTION", data }).catch(() => null);
}

// ───────────────────────────── Add / claim ─────────────────────────────

const acquireSchema = z.object({
  playerId: id,
  dropPlayerId: id.nullable().optional(),
  bid: z.number().int("Bid must be a whole number").min(0, "Bid can't be negative").max(1_000_000).optional(),
});

export async function acquirePlayerAction(input: z.input<typeof acquireSchema>): Promise<ActionResult> {
  const parsed = acquireSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request");
  try {
    const ctx = await assertLeagueMember();
    if (!ctx.myTeam) return fail("You don't manage a team in this league.");
    await assertTeamManager(ctx.myTeam.id, false);
    const s = ctx.settings;
    const teamId = ctx.myTeam.id;
    const teamName = ctx.myTeam.name;
    const leagueId = ctx.league.id;
    const { playerId, bid = 0 } = parsed.data;
    const dropPlayerId = parsed.data.dropPlayerId ?? null;
    if (dropPlayerId === playerId) return fail("You can't drop the player you are adding.");

    const st = await acquisitionState(db, ctx, playerId);
    if (!st) return fail("Player not found.");
    const name = st.player.fullName;
    if (st.spot) return fail(`${name} is already on ${st.spot.team.name}.`);
    if (st.mode.kind === "blocked") return fail(st.auctionPool && st.mode.reason === AUCTION_POOL_REASON ? auctionPoolDetail(ctx.season) : st.mode.reason);
    const isClaim = st.mode.kind === "claim";
    const processAt = st.mode.kind === "claim" ? st.mode.processAt : null;
    const usesFab = isClaim && claimUsesFab(s);
    const bidAmount = usesFab ? bid : 0;
    const salary = signingSalary(s, bidAmount);
    const years = signingYears(s);

    const result = await db.$transaction(
      async (tx) => {
        await lockTeam(tx, teamId);
        // everything below reads committed state after any concurrent move by this team
        const counts = await acquisitionCounts(tx, teamId, ctx.season, ctx.week);
        const limitErr = acquisitionLimitError(s, counts.weekUsed, counts.seasonUsed);
        if (limitErr) throw new Error(limitErr);
        if (await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId, playerId } }, select: { id: true } })) throw new Error(`${name} was just added by another team.`);

        const dropSpot = dropPlayerId
          ? await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId, playerId: dropPlayerId } }, include: { player: true } })
          : null;
        if (dropPlayerId) {
          if (!dropSpot || dropSpot.teamId !== teamId) throw new Error("You can only drop players on your own roster.");
          const blocked = await dropBlocker(tx, ctx, dropSpot);
          if (blocked) throw new Error(blocked);
        }
        if (usesFab) {
          const t = await tx.team.findUniqueOrThrow({ where: { id: teamId }, select: { faabBalance: true } });
          const err = validateBid(s, bidAmount, t.faabBalance);
          if (err) throw new Error(err);
        }

        // roster limits + salary cap on the resulting roster: the league-wide rules for this phase
        // (activeRosterLimit — the offseason limit until the cutdown deadline — and capCheck)
        const roster = await tx.rosterSpot.findMany({ where: { teamId }, include: { player: true } });
        const deadBefore = await teamDeadMoney(tx, leagueId, teamId, ctx.season);
        const dropDead = dropSpot ? deadMoneyPreview(dropSpot, s, ctx.season, ctx.week, ctx.league.phase).filter((d) => d.season === ctx.season).reduce((a, d) => a + d.amount, 0) : 0;
        const after = [...roster.filter((r) => r.playerId !== dropPlayerId), { status: "ACTIVE", salary, player: st.player }];
        const activeBefore = roster.filter((r) => r.status === "ACTIVE").length;
        const activeAfter = after.filter((r) => r.status === "ACTIVE").length;
        const maxActive = activeRosterLimit(s, { phase: ctx.league.phase });
        if (activeAfter > maxActive && activeAfter > activeBefore) throw new Error(`Your active roster is full (${maxActive} max). Choose a player to drop.`);
        const problems = newRosterProblems(roster, after, ctx, deadBefore, deadBefore + dropDead);
        if (problems.errors.length) throw new Error(problems.errors.join(" "));
        const warnings = problems.warnings;

        if (isClaim) {
          // one pending claim per team + player: editing replaces it
          const existing = await tx.waiverClaim.findFirst({ where: { teamId, addPlayerId: playerId, status: "PENDING" } });
          if (existing) {
            await tx.waiverClaim.update({ where: { id: existing.id }, data: { bidAmount, dropPlayerId, salary, processAt, season: ctx.season, week: ctx.week } });
            return { kind: "claim" as const, updated: true, warnings };
          }
          const pending = await tx.waiverClaim.findMany({ where: { teamId, status: "PENDING" }, select: { priority: true } });
          const pendingErr = pendingClaimLimitError(s, pending.length);
          if (pendingErr) throw new Error(pendingErr);
          await tx.waiverClaim.create({
            data: {
              leagueId,
              teamId,
              season: ctx.season,
              week: ctx.week,
              addPlayerId: playerId,
              dropPlayerId,
              bidAmount,
              salary,
              priority: pending.reduce((m, c) => Math.max(m, c.priority), 0) + 1,
              status: "PENDING",
              processAt,
            },
          });
          return { kind: "claim" as const, updated: false, warnings };
        }

        const dropped = dropSpot
          ? await dropPlayerFromTeam(tx, { leagueId, teamId, playerId: dropSpot.playerId, season: ctx.season, week: ctx.week, settings: s, phase: ctx.league.phase, actorId: ctx.user.id })
          : null;
        const added = await addPlayerToTeam(tx, {
          leagueId,
          teamId,
          playerId,
          season: ctx.season,
          week: ctx.week,
          salary,
          contractYears: years,
          via: "FREE_AGENT",
          actorId: ctx.user.id,
          txType: "ADD",
          details: { dropPlayerId },
        });
        await tx.waiverClaim.updateMany({ where: { teamId, addPlayerId: playerId, status: "PENDING" }, data: { status: "CANCELLED", resultNote: "Player added as a free agent", processedAt: new Date() } });
        return { kind: "add" as const, added, dropped, warnings };
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    revalidate([playerId, dropPlayerId]);
    // the cap in WARN mode: the move goes through and the manager sees why it's over
    const warn = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
    if (result.kind === "claim") {
      const when = processAt ? ` It processes ${fmtDateTime(processAt, s.general.timezone)}.` : "";
      return { ok: true, message: `Claim ${result.updated ? "updated" : "placed"} for ${name}${usesFab ? ` with a $${bidAmount} bid` : ""}.${when}${warn}` };
    }
    const { added, dropped } = result;
    broadcastTransaction(leagueId, { id: added.transaction.id, description: added.transaction.description, type: "ADD", teamId });
    if (dropped) broadcastTransaction(leagueId, { id: dropped.transaction.id, description: dropped.transaction.description, type: "DROP", teamId });
    await announce(ctx, `${teamName}: ${added.transaction.description}${dropped ? `. ${dropped.transaction.description}` : ""}`, {
      teamId,
      playerId,
      dropPlayerId,
      transactionId: added.transaction.id,
    });
    return { ok: true, message: `${name} added for $${salary}${dropped ? `; ${dropped.spot.player.fullName} dropped` : ""}.${warn}` };
  } catch (e) {
    return fail(errorMessage(e, "Could not complete the move. Please try again."));
  }
}

// ───────────────────────────── Cancel claim ─────────────────────────────

export async function cancelClaimAction(input: { claimId: string }): Promise<ActionResult> {
  const parsed = z.object({ claimId: id }).safeParse(input);
  if (!parsed.success) return fail("Invalid claim.");
  try {
    const ctx = await assertLeagueMember();
    const claim = await db.waiverClaim.findUnique({ where: { id: parsed.data.claimId }, include: { addPlayer: { select: { fullName: true } } } });
    if (!claim || claim.leagueId !== ctx.league.id) return fail("Claim not found.");
    await assertTeamManager(claim.teamId, false);
    const done = await db.$transaction(async (tx) => {
      await lockTeam(tx, claim.teamId);
      const res = await tx.waiverClaim.updateMany({
        where: { id: claim.id, status: "PENDING" },
        data: { status: "CANCELLED", resultNote: "Cancelled by manager", processedAt: new Date() },
      });
      if (!res.count) return false;
      // close the gap in the team's claim order
      const rest = await tx.waiverClaim.findMany({ where: { teamId: claim.teamId, status: "PENDING" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], select: { id: true, priority: true } });
      for (const [i, c] of rest.entries()) if (c.priority !== i + 1) await tx.waiverClaim.update({ where: { id: c.id }, data: { priority: i + 1 } });
      return true;
    });
    if (!done) return fail("This claim has already been processed.");
    revalidate([claim.addPlayerId]);
    return { ok: true, message: `Claim for ${claim.addPlayer.fullName} cancelled.` };
  } catch (e) {
    return fail(errorMessage(e, "Could not cancel the claim."));
  }
}

// ───────────────────────────── Drop ─────────────────────────────

export async function dropPlayerAction(input: { playerId: string }): Promise<ActionResult> {
  const parsed = z.object({ playerId: id }).safeParse(input);
  if (!parsed.success) return fail("Invalid player.");
  try {
    const ctx = await assertLeagueMember();
    if (!ctx.myTeam) return fail("You don't manage a team in this league.");
    const teamId = ctx.myTeam.id;
    const teamName = ctx.myTeam.name;
    await assertTeamManager(teamId, false);
    const res = await db.$transaction(
      async (tx) => {
        await lockTeam(tx, teamId);
        const spot = await tx.rosterSpot.findUnique({
          where: { leagueId_playerId: { leagueId: ctx.league.id, playerId: parsed.data.playerId } },
          include: { player: true },
        });
        if (!spot || spot.teamId !== teamId) throw new Error("You can only drop players on your own roster.");
        const blocked = await dropBlocker(tx, ctx, spot);
        if (blocked) throw new Error(blocked);
        if (spot.status === "ACTIVE" && ctx.settings.roster.minActiveRoster > 0) {
          const active = await tx.rosterSpot.count({ where: { teamId, status: "ACTIVE" } });
          if (active - 1 < ctx.settings.roster.minActiveRoster) throw new Error(`Your active roster must keep at least ${ctx.settings.roster.minActiveRoster} players.`);
        }
        return dropPlayerFromTeam(tx, { leagueId: ctx.league.id, teamId, playerId: spot.playerId, season: ctx.season, week: ctx.week, settings: ctx.settings, phase: ctx.league.phase, actorId: ctx.user.id });
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    broadcastTransaction(ctx.league.id, { id: res.transaction.id, description: res.transaction.description, type: "DROP", teamId });
    await announce(ctx, `${teamName}: ${res.transaction.description}`, { teamId, playerId: res.spot.playerId, transactionId: res.transaction.id });
    revalidate([res.spot.playerId]);
    const dead = res.deadMoney.filter((d) => d.season === ctx.season).reduce((a, d) => a + d.amount, 0);
    return { ok: true, message: `${res.spot.player.fullName} dropped${dead ? ` — $${dead} dead money this season` : ""}.` };
  } catch (e) {
    return fail(errorMessage(e, "Could not drop the player. Please try again."));
  }
}

// ───────────────────────────── Watch list ─────────────────────────────

export async function toggleWatchAction(input: { playerId: string }): Promise<ActionResult & { watched?: boolean }> {
  const parsed = z.object({ playerId: id }).safeParse(input);
  if (!parsed.success) return fail("Invalid player.");
  try {
    const ctx = await assertLeagueMember();
    const player = await db.player.findUnique({ where: { id: parsed.data.playerId }, select: { id: true, fullName: true } });
    if (!player) return fail("Player not found.");
    const where = { userId: ctx.user.id, leagueId: ctx.league.id, playerId: player.id };
    // idempotent under double clicks: delete if present, otherwise insert (duplicates skipped)
    const removed = await db.watchlistEntry.deleteMany({ where });
    if (!removed.count) await db.watchlistEntry.createMany({ data: [where], skipDuplicates: true });
    revalidatePath("/players");
    revalidatePath(`/players/${player.id}`);
    const watched = removed.count === 0;
    return { ok: true, watched, message: watched ? `${player.fullName} added to your watch list.` : `${player.fullName} removed from your watch list.` };
  } catch (e) {
    return fail(errorMessage(e, "Could not update your watch list."));
  }
}
