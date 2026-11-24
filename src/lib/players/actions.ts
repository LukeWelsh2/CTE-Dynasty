"use server";
// Free agency server actions: add / claim (with optional drop), cancel claim, drop, watch list.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertLeagueMember, assertTeamManager, type LeagueContext } from "@/lib/league";
import { getTeamRoster } from "@/lib/roster";
import { addPlayerToTeam, broadcastTransaction, dropPlayerFromTeam } from "@/lib/roster-ops";
import { postSystemMessage } from "@/lib/chat-system";
import { acquisitionCounts, acquisitionState, dropBlocker, newRosterErrors, teamDeadMoney } from "@/lib/players/acquire";
import { fmtDateTime } from "@/lib/players/format";
import { acquisitionLimitError, claimUsesFab, deadMoneyPreview, signingSalary, signingYears, validateBid } from "@/lib/players/logic";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(64);

function fail(error: string): ActionResult {
  return { ok: false, error };
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
    const leagueId = ctx.league.id;
    const { playerId, bid = 0 } = parsed.data;
    const dropPlayerId = parsed.data.dropPlayerId ?? null;
    if (dropPlayerId === playerId) return fail("You can't drop the player you are adding.");

    const st = await acquisitionState(db, ctx, playerId);
    if (!st) return fail("Player not found.");
    const name = st.player.fullName;
    if (st.spot) return fail(`${name} is already on ${st.spot.team.name}.`);
    if (st.mode.kind === "blocked") return fail(st.mode.reason);

    const counts = await acquisitionCounts(db, teamId, ctx.season, ctx.week);
    const limitErr = acquisitionLimitError(s, counts.weekUsed, counts.seasonUsed);
    if (limitErr) return fail(limitErr);

    const dropSpot = dropPlayerId
      ? await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId, playerId: dropPlayerId } }, include: { player: true } })
      : null;
    if (dropPlayerId) {
      if (!dropSpot || dropSpot.teamId !== teamId) return fail("You can only drop players on your own roster.");
      const blocked = await dropBlocker(db, ctx, dropSpot);
      if (blocked) return fail(blocked);
    }

    const isClaim = st.mode.kind === "claim";
    const usesFab = isClaim && claimUsesFab(s);
    const bidAmount = usesFab ? bid : 0;
    if (usesFab) {
      const t = await db.team.findUniqueOrThrow({ where: { id: teamId }, select: { faabBalance: true } });
      const err = validateBid(s, bidAmount, t.faabBalance);
      if (err) return fail(err);
    }
    const salary = signingSalary(s, bidAmount);
    const years = signingYears(s);

    // roster limits + salary cap on the resulting roster
    const roster = await getTeamRoster(teamId);
    const deadBefore = await teamDeadMoney(db, leagueId, teamId, ctx.season);
    const dropDead = dropSpot ? deadMoneyPreview(dropSpot, s, ctx.season, ctx.week).filter((d) => d.season === ctx.season).reduce((a, d) => a + d.amount, 0) : 0;
    const after = [...roster.filter((r) => r.playerId !== dropPlayerId), { status: "ACTIVE", salary, player: st.player }];
    const activeAfter = after.filter((r) => r.status === "ACTIVE").length;
    if (activeAfter > s.roster.maxActiveRoster && activeAfter > roster.filter((r) => r.status === "ACTIVE").length)
      return fail(`Your active roster is full (${s.roster.maxActiveRoster} max). Choose a player to drop.`);
    const errors = newRosterErrors(roster, after, ctx, deadBefore, deadBefore + dropDead);
    if (errors.length) return fail(errors.join(" "));

    if (isClaim) {
      const processAt = st.mode.kind === "claim" ? st.mode.processAt : null;
      const existing = await db.waiverClaim.findFirst({ where: { teamId, addPlayerId: playerId, status: "PENDING" } });
      if (existing) {
        await db.waiverClaim.update({
          where: { id: existing.id },
          data: { bidAmount, dropPlayerId, salary, processAt, season: ctx.season, week: ctx.week },
        });
      } else {
        const max = await db.waiverClaim.aggregate({ where: { teamId, status: "PENDING" }, _max: { priority: true } });
        await db.waiverClaim.create({
          data: {
            leagueId,
            teamId,
            season: ctx.season,
            week: ctx.week,
            addPlayerId: playerId,
            dropPlayerId,
            bidAmount,
            salary,
            priority: (max._max.priority ?? 0) + 1,
            status: "PENDING",
            processAt,
          },
        });
      }
      revalidate([playerId, dropPlayerId]);
      const when = processAt ? ` It processes ${fmtDateTime(processAt, s.general.timezone)}.` : "";
      return { ok: true, message: `Claim ${existing ? "updated" : "placed"} for ${name}${usesFab ? ` with a $${bidAmount} bid` : ""}.${when}` };
    }

    const result = await db.$transaction(async (tx) => {
      const dropped = dropSpot
        ? await dropPlayerFromTeam(tx, { leagueId, teamId, playerId: dropSpot.playerId, season: ctx.season, week: ctx.week, settings: s, actorId: ctx.user.id })
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
      // re-check against the committed state (guards against concurrent moves)
      const nowRoster = await tx.rosterSpot.findMany({ where: { teamId }, include: { player: true } });
      const deadNow = await teamDeadMoney(tx, leagueId, teamId, ctx.season);
      const errs = newRosterErrors(roster, nowRoster, ctx, deadBefore, deadNow);
      if (errs.length) throw new Error(errs.join(" "));
      await tx.waiverClaim.updateMany({ where: { teamId, addPlayerId: playerId, status: "PENDING" }, data: { status: "CANCELLED", resultNote: "Player added as a free agent" } });
      return { added, dropped };
    });

    broadcastTransaction(leagueId, { id: result.added.transaction.id, description: result.added.transaction.description, type: "ADD", teamId });
    if (result.dropped)
      broadcastTransaction(leagueId, { id: result.dropped.transaction.id, description: result.dropped.transaction.description, type: "DROP", teamId });
    await announce(
      ctx,
      `${ctx.myTeam.name}: ${result.added.transaction.description}${result.dropped ? `. ${result.dropped.transaction.description}` : ""}`,
      { teamId, playerId, dropPlayerId, transactionId: result.added.transaction.id },
    );
    revalidate([playerId, dropPlayerId]);
    return { ok: true, message: `${name} added for $${salary}${result.dropped ? `; ${result.dropped.spot.player.fullName} dropped` : ""}.` };
  } catch (e) {
    return fail((e as Error).message || "Could not complete the move.");
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
    if (claim.status !== "PENDING") return fail("Only pending claims can be cancelled.");
    await db.waiverClaim.update({ where: { id: claim.id }, data: { status: "CANCELLED", resultNote: "Cancelled by manager", processedAt: new Date() } });
    revalidate([claim.addPlayerId]);
    return { ok: true, message: `Claim for ${claim.addPlayer.fullName} cancelled.` };
  } catch (e) {
    return fail((e as Error).message);
  }
}

// ───────────────────────────── Drop ─────────────────────────────

export async function dropPlayerAction(input: { playerId: string }): Promise<ActionResult> {
  const parsed = z.object({ playerId: id }).safeParse(input);
  if (!parsed.success) return fail("Invalid player.");
  try {
    const ctx = await assertLeagueMember();
    const spot = await db.rosterSpot.findUnique({
      where: { leagueId_playerId: { leagueId: ctx.league.id, playerId: parsed.data.playerId } },
      include: { player: true },
    });
    if (!spot || !ctx.myTeam || spot.teamId !== ctx.myTeam.id) return fail("You can only drop players on your own roster.");
    await assertTeamManager(spot.teamId, false);
    const blocked = await dropBlocker(db, ctx, spot);
    if (blocked) return fail(blocked);
    if (spot.status === "ACTIVE" && ctx.settings.roster.minActiveRoster > 0) {
      const active = await db.rosterSpot.count({ where: { teamId: spot.teamId, status: "ACTIVE" } });
      if (active - 1 < ctx.settings.roster.minActiveRoster) return fail(`Your active roster must keep at least ${ctx.settings.roster.minActiveRoster} players.`);
    }
    const res = await db.$transaction((tx) =>
      dropPlayerFromTeam(tx, {
        leagueId: ctx.league.id,
        teamId: spot.teamId,
        playerId: spot.playerId,
        season: ctx.season,
        week: ctx.week,
        settings: ctx.settings,
        actorId: ctx.user.id,
      }),
    );
    broadcastTransaction(ctx.league.id, { id: res.transaction.id, description: res.transaction.description, type: "DROP", teamId: spot.teamId });
    await announce(ctx, `${ctx.myTeam.name}: ${res.transaction.description}`, { teamId: spot.teamId, playerId: spot.playerId, transactionId: res.transaction.id });
    revalidate([spot.playerId]);
    const dead = res.deadMoney.filter((d) => d.season === ctx.season).reduce((a, d) => a + d.amount, 0);
    return { ok: true, message: `${spot.player.fullName} dropped${dead ? ` — $${dead} dead money this season` : ""}.` };
  } catch (e) {
    return fail((e as Error).message);
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
    const key = { userId_leagueId_playerId: { userId: ctx.user.id, leagueId: ctx.league.id, playerId: player.id } };
    const existing = await db.watchlistEntry.findUnique({ where: key });
    if (existing) await db.watchlistEntry.delete({ where: { id: existing.id } });
    else await db.watchlistEntry.create({ data: { userId: ctx.user.id, leagueId: ctx.league.id, playerId: player.id } });
    revalidatePath("/players");
    revalidatePath(`/players/${player.id}`);
    return { ok: true, watched: !existing, message: existing ? `${player.fullName} removed from your watch list.` : `${player.fullName} added to your watch list.` };
  } catch (e) {
    return fail((e as Error).message);
  }
}
