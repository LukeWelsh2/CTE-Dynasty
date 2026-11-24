"use server";
// Pending-claim management (own team only) and the commissioner's "Process waivers now".
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertCommissioner, assertLeagueMember, assertTeamManager } from "@/lib/league";
import { moveInOrder, waiverMinBid, waiverSigningSalary } from "@/lib/waivers/logic";
import { processLeagueWaivers, processNowThrough } from "@/lib/waivers/process";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const id = z.string().trim().min(1).max(64);

function revalidate() {
  for (const p of ["/waivers", "/transactions", "/players", "/team", "/"]) revalidatePath(p);
}

async function ownPendingClaim(claimId: string) {
  const ctx = await assertLeagueMember();
  const claim = await db.waiverClaim.findUnique({ where: { id: claimId }, include: { addPlayer: { select: { fullName: true } } } });
  if (!claim || claim.leagueId !== ctx.league.id) throw new Error("Claim not found.");
  await assertTeamManager(claim.teamId, false);
  if (claim.status !== "PENDING") throw new Error("This claim has already been processed.");
  return { ctx, claim };
}

const updateSchema = z.object({
  claimId: id,
  bid: z.number().int("Bids are whole dollars.").min(0, "Bids can't be negative.").max(1_000_000).optional(),
  dropPlayerId: id.nullable().optional(),
});

export async function updateClaimAction(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  try {
    const { ctx, claim } = await ownPendingClaim(parsed.data.claimId);
    const s = ctx.settings;
    const data: { bidAmount?: number; salary?: number; dropPlayerId?: string | null } = {};
    const notes: string[] = [];
    if (parsed.data.bid !== undefined) {
      if (s.waivers.type !== "FAB") return { ok: false, error: "This league doesn't use FAB bids." };
      const team = await db.team.findUniqueOrThrow({ where: { id: claim.teamId }, select: { faabBalance: true } });
      const min = waiverMinBid(s);
      if (parsed.data.bid < min) return { ok: false, error: `The minimum bid is $${min}.` };
      if (parsed.data.bid > team.faabBalance) return { ok: false, error: `You only have $${team.faabBalance} of FAB.` };
      const step = Math.max(1, s.waivers.bidIncrement ?? 1);
      if (parsed.data.bid % step !== 0) return { ok: false, error: `Bids go up in $${step} increments.` };
      data.bidAmount = parsed.data.bid;
      data.salary = waiverSigningSalary(s, parsed.data.bid);
      const others = await db.waiverClaim.aggregate({ where: { teamId: claim.teamId, status: "PENDING", id: { not: claim.id } }, _sum: { bidAmount: true } });
      const total = (others._sum.bidAmount ?? 0) + parsed.data.bid;
      if (total > team.faabBalance) notes.push(`Your pending bids total $${total} — more than your $${team.faabBalance}; lower-ranked claims fail if earlier ones win.`);
    }
    if (parsed.data.dropPlayerId !== undefined) {
      const dropId = parsed.data.dropPlayerId;
      if (dropId) {
        if (dropId === claim.addPlayerId) return { ok: false, error: "You can't drop the player you're claiming." };
        const spot = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: ctx.league.id, playerId: dropId } } });
        if (!spot || spot.teamId !== claim.teamId) return { ok: false, error: "You can only drop players on your roster." };
        if ((s.waivers.undroppablePlayerIds ?? []).includes(dropId)) return { ok: false, error: "That player is on the league's undroppable list." };
      } else {
        const active = await db.rosterSpot.count({ where: { teamId: claim.teamId, status: "ACTIVE" } });
        if (active >= s.roster.maxActiveRoster) notes.push(`Your active roster is full (${active}/${s.roster.maxActiveRoster}) — this claim fails without a drop unless an earlier claim frees a spot.`);
      }
      data.dropPlayerId = dropId;
    }
    if (!Object.keys(data).length) return { ok: true, message: "No changes." };
    await db.waiverClaim.update({ where: { id: claim.id }, data });
    revalidate();
    return { ok: true, message: `Claim for ${claim.addPlayer.fullName} updated.${notes.length ? " " + notes.join(" ") : ""}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const moveSchema = z.object({ claimId: id, dir: z.enum(["up", "down"]) });

export async function moveClaimAction(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    const { claim } = await ownPendingClaim(parsed.data.claimId);
    const list = await db.waiverClaim.findMany({ where: { teamId: claim.teamId, status: "PENDING" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], select: { id: true, priority: true } });
    const ids = moveInOrder(
      list.map((c) => c.id),
      claim.id,
      parsed.data.dir,
    );
    const updates = ids.map((cid, i) => ({ id: cid, priority: i + 1 })).filter((u) => list.find((c) => c.id === u.id)?.priority !== u.priority);
    if (updates.length) await db.$transaction(updates.map((u) => db.waiverClaim.update({ where: { id: u.id }, data: { priority: u.priority } })));
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const cancelSchema = z.object({ claimId: id });

export async function cancelWaiverClaimAction(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    const { claim } = await ownPendingClaim(parsed.data.claimId);
    await db.waiverClaim.update({ where: { id: claim.id }, data: { status: "CANCELLED", resultNote: "Cancelled by manager", processedAt: new Date() } });
    // close the gap in the team's ordering
    const rest = await db.waiverClaim.findMany({ where: { teamId: claim.teamId, status: "PENDING" }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], select: { id: true, priority: true } });
    const updates = rest.map((c, i) => ({ id: c.id, priority: i + 1 })).filter((u, i) => rest[i].priority !== u.priority);
    if (updates.length) await db.$transaction(updates.map((u) => db.waiverClaim.update({ where: { id: u.id }, data: { priority: u.priority } })));
    revalidate();
    return { ok: true, message: `Claim for ${claim.addPlayer.fullName} cancelled.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function processWaiversNowAction(): Promise<ActionResult> {
  try {
    const ctx = await assertCommissioner();
    const r = await processLeagueWaivers(ctx.league.id, { through: processNowThrough(ctx.settings), manual: true, actorId: ctx.user.id });
    revalidate();
    if (r.skipped) return { ok: false, error: `Waivers are ${r.skipped}.` };
    if (!r.processed) return { ok: true, message: "No pending claims were due — waiver order updated." };
    return { ok: true, message: `Processed ${r.processed} claim${r.processed === 1 ? "" : "s"}: ${r.awarded} won, ${r.lost} lost, ${r.invalid} invalid.` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
