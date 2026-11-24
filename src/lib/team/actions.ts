"use server";
// My Team server actions: lineup saves, IR / taxi moves, drops and contract actions.
// Every action authorizes with assertTeamManager, validates with zod and writes a Transaction row.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertTeamManager, type LeagueContext } from "@/lib/league";
import { getLineup, saveLineup, validateLineup, weekGamesByTeam } from "@/lib/lineup";
import { broadcastTransaction, dropPlayerFromTeam } from "@/lib/roster-ops";
import { capHit, capSummary, getTeamRoster } from "@/lib/roster";
import { expandSlots } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { postSystemMessage } from "@/lib/chat-system";
import {
  capEnforced,
  extensionEligibility,
  extensionSalary,
  franchiseTagEligibility,
  franchiseTagSalary,
  isInSeasonPhase,
  maxExtensionYears,
  rookieOptionEligibility,
  rookieOptionSalary,
} from "@/lib/team/contracts";
import { taxiDeadlineKickedOff, waiverHoursFor } from "@/lib/team/data";
import { slotId } from "@/lib/team/lineup-model";
import { refreshTeamMatchup } from "@/lib/team/matchup";
import { lineupWeekState, rosterMoveCheck, type RosterMoveKind, type RuleSpot } from "@/lib/team/roster-rules";
import { isLocked } from "@/lib/lineup";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });

async function authorize(teamId: string): Promise<{ ctx: LeagueContext; own: boolean }> {
  const ctx = await assertTeamManager(teamId);
  const own = ctx.myTeam?.id === teamId;
  if (!own && !ctx.settings.commissioner.canEditLineups) throw new Error("Commissioner edits of other teams are turned off in league settings.");
  return { ctx, own };
}

async function audit(ctx: LeagueContext, own: boolean, action: string, teamId: string, details: Record<string, unknown>) {
  if (own) return;
  await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action, targetType: "team", targetId: teamId, details: details as Prisma.InputJsonValue } });
}

function revalidateTeam(teamId?: string) {
  revalidatePath("/team");
  revalidatePath("/team/insights");
  revalidatePath("/team/contracts");
  revalidatePath("/teams");
  if (teamId) revalidatePath(`/teams/${teamId}`);
}

// ───────────────────────────── Lineup ─────────────────────────────

const lineupSchema = z.object({
  teamId: z.string().min(1),
  week: z.number().int().min(1).max(18),
  lineup: z
    .array(z.object({ slot: z.string().min(1).max(20), slotIndex: z.number().int().min(0).max(20), playerId: z.string().min(1).nullable() }))
    .min(1)
    .max(60),
});

export async function saveLineupAction(input: z.input<typeof lineupSchema>): Promise<ActionResult> {
  try {
    const parsed = lineupSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid lineup." };
    const { teamId, week, lineup } = parsed.data;
    const { ctx, own } = await authorize(teamId);
    const { league, settings, season } = ctx;
    const state = lineupWeekState(settings, league.phase, ctx.week, week);
    if (!state.editable) return { ok: false, error: state.reason ?? "This lineup can't be edited." };

    const slots = expandSlots(settings);
    const known = new Set(slots.map((s) => slotId(s.key, s.index)));
    const incoming = new Map<string, string | null>();
    for (const a of lineup) {
      const id = slotId(a.slot, a.slotIndex);
      if (!known.has(id)) return { ok: false, error: `Unknown lineup slot ${a.slot}.` };
      incoming.set(id, a.playerId);
    }
    const [current, roster, games] = await Promise.all([
      getLineup(teamId, league.id, season, week, settings),
      db.rosterSpot.findMany({ where: { teamId }, include: { player: true } }),
      weekGamesByTeam(season, week),
    ]);
    const proposed = slots.map((s) => {
      const id = slotId(s.key, s.index);
      const cur = current.find((c) => c.slot === s.key && c.slotIndex === s.index)?.playerId ?? null;
      return { slot: s.key, slotIndex: s.index, playerId: incoming.has(id) ? incoming.get(id)! : cur };
    });
    const errors = validateLineup(proposed, current, roster, games, settings);
    if (errors.length) return { ok: false, error: errors.join(" ") };
    const changed = proposed.filter((p) => (current.find((c) => c.slot === p.slot && c.slotIndex === p.slotIndex)?.playerId ?? null) !== p.playerId).length;
    if (!changed) return { ok: true, message: "Lineup is already saved." };
    await saveLineup(teamId, league.id, season, week, proposed);
    await audit(ctx, own, "lineup.edit", teamId, { week, changes: changed });
    await refreshTeamMatchup(league.id, season, week, teamId, settings).catch(() => null);
    revalidateTeam(teamId);
    revalidatePath("/scoring", "layout");
    return { ok: true, message: `Week ${week} lineup saved · ${changed} slot${changed === 1 ? "" : "s"} changed.` };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Roster moves ─────────────────────────────

const moveSchema = z.object({ teamId: z.string().min(1), playerId: z.string().min(1) });

async function loadMove(input: unknown, kind: RosterMoveKind) {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid request.");
  const { teamId, playerId } = parsed.data;
  const { ctx, own } = await authorize(teamId);
  const { league, settings, season } = ctx;
  const [roster, games, lineup, kicked] = await Promise.all([
    getTeamRoster(teamId),
    weekGamesByTeam(season, ctx.week),
    getLineup(teamId, league.id, season, ctx.week, settings),
    taxiDeadlineKickedOff(settings, season),
  ]);
  const spot = roster.find((r) => r.playerId === playerId);
  if (!spot) throw new Error("That player isn't on this roster.");
  const cap = await capSummary(league.id, teamId, season, settings, roster);
  const starters = new Set(lineup.map((l) => l.playerId).filter(Boolean));
  const game = spot.player.team ? games.get(spot.player.team) : undefined;
  const ruleRoster: RuleSpot[] = roster.map((r) => ({ playerId: r.playerId, status: r.status, salary: r.salary, player: r.player }));
  const check = rosterMoveCheck(kind, ruleRoster.find((r) => r.playerId === playerId)!, ruleRoster, {
    settings,
    phase: league.phase,
    week: ctx.week,
    lockedStarter: starters.has(playerId) && isLocked(spot.player.team, games, settings),
    gameLive: game?.state === "in",
    taxiDeadlineKickedOff: kicked,
    deadMoney: cap.deadMoney,
  });
  if (!check.ok) throw new Error(check.reason);
  return { ctx, own, teamId, spot, label: `${spot.player.fullName} (${spot.player.position}${spot.player.team ? " " + spot.player.team : ""})` };
}

async function statusMove(input: unknown, kind: "IR" | "ACTIVATE" | "TAXI" | "PROMOTE"): Promise<ActionResult> {
  try {
    const { ctx, own, teamId, spot, label } = await loadMove(input, kind);
    const { league, season } = ctx;
    const to = kind === "IR" ? "IR" : kind === "TAXI" ? "TAXI" : "ACTIVE";
    const txType = kind === "IR" ? "IR" : kind === "TAXI" ? "TAXI" : "ACTIVATE";
    const description =
      kind === "IR" ? `Moved ${label} to IR` : kind === "TAXI" ? `Moved ${label} to the taxi squad` : kind === "ACTIVATE" ? `Activated ${label} from IR` : `Promoted ${label} from the taxi squad`;
    const tx = await db.$transaction(async (t) => {
      await t.rosterSpot.update({ where: { id: spot.id }, data: { status: to } });
      if (to !== "ACTIVE") {
        await t.lineupSlot.updateMany({ where: { teamId, playerId: spot.playerId, season, week: { gte: ctx.week } }, data: { playerId: null } });
      }
      return t.transaction.create({
        data: {
          leagueId: league.id,
          season,
          week: ctx.week,
          type: txType,
          teamId,
          playerId: spot.playerId,
          salary: spot.salary,
          description,
          details: { from: spot.status, to } as Prisma.InputJsonValue,
          createdById: ctx.user.id,
        },
      });
    });
    broadcastTransaction(league.id, { id: tx.id, description: tx.description, type: tx.type, teamId });
    await audit(ctx, own, `roster.${kind.toLowerCase()}`, teamId, { playerId: spot.playerId });
    if (isInSeasonPhase(league.phase)) await refreshTeamMatchup(league.id, season, ctx.week, teamId, ctx.settings).catch(() => null);
    revalidateTeam(teamId);
    return { ok: true, message: description + "." };
  } catch (e) {
    return fail(e);
  }
}

export async function moveToIrAction(input: { teamId: string; playerId: string }) {
  return statusMove(input, "IR");
}
export async function activateFromIrAction(input: { teamId: string; playerId: string }) {
  return statusMove(input, "ACTIVATE");
}
export async function moveToTaxiAction(input: { teamId: string; playerId: string }) {
  return statusMove(input, "TAXI");
}
export async function promoteFromTaxiAction(input: { teamId: string; playerId: string }) {
  return statusMove(input, "PROMOTE");
}

export async function dropPlayerAction(input: { teamId: string; playerId: string }): Promise<ActionResult> {
  try {
    const { ctx, own, teamId, spot, label } = await loadMove(input, "DROP");
    const { league, settings, season } = ctx;
    const hours = waiverHoursFor(settings, league.phase);
    const res = await db.$transaction((t) =>
      dropPlayerFromTeam(t, { leagueId: league.id, teamId, playerId: spot.playerId, season, week: ctx.week, settings, actorId: ctx.user.id, toWaivers: hours !== null }),
    );
    broadcastTransaction(league.id, { id: res.transaction.id, description: res.transaction.description, type: res.transaction.type, teamId });
    const team = await db.team.findUnique({ where: { id: teamId }, select: { name: true } });
    if (settings.notifications.transactionsToChat) {
      await postSystemMessage(league.id, `${team?.name ?? "A team"} dropped ${label}${res.deadMoney.length ? ` — $${res.deadMoney.filter((d) => d.season === season).reduce((a, d) => a + d.amount, 0)} dead money` : ""}.`, {
        channel: "transactions",
        kind: "TRANSACTION",
        data: { transactionId: res.transaction.id, playerId: spot.playerId, teamId },
      }).catch(() => null);
    }
    await audit(ctx, own, "roster.drop", teamId, { playerId: spot.playerId, deadMoney: res.deadMoney });
    if (isInSeasonPhase(league.phase)) await refreshTeamMatchup(league.id, season, ctx.week, teamId, settings).catch(() => null);
    revalidateTeam(teamId);
    revalidatePath("/players");
    revalidatePath("/transactions");
    return { ok: true, message: `${res.transaction.description}${hours !== null ? ` · on waivers for ${hours}h` : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Contracts ─────────────────────────────

const extendSchema = z.object({ teamId: z.string().min(1), playerId: z.string().min(1), years: z.number().int().min(1).max(10) });

async function loadContract(teamId: string, playerId: string) {
  const { ctx, own } = await authorize(teamId);
  if (!ctx.settings.contracts.enabled) throw new Error("Contracts are disabled in this league.");
  const roster = await getTeamRoster(teamId);
  const spot = roster.find((r) => r.playerId === playerId);
  if (!spot) throw new Error("That player isn't on this roster.");
  const cap = await capSummary(ctx.league.id, teamId, ctx.season, ctx.settings, roster);
  const assertCap = (newSalary: number) => {
    const after = cap.space + capHit(spot, ctx.settings) - capHit({ salary: newSalary, status: spot.status }, ctx.settings);
    if (capEnforced(ctx.settings) && after < 0) throw new Error(`That would put you $${-after} over the $${ctx.settings.salaryCap.cap} cap.`);
    return after;
  };
  return { ctx, own, spot, assertCap };
}

async function contractTxCount(leagueId: string, where: { teamId?: string; playerId?: string; season?: number }, kind: string) {
  return db.transaction.count({ where: { leagueId, type: "CONTRACT", ...where, details: { path: ["kind"], equals: kind } } });
}

async function writeContract(
  ctx: LeagueContext,
  own: boolean,
  teamId: string,
  spot: { id: string; playerId: string; salary: number; contractYears: number; player: { fullName: string } },
  data: { salary: number; contractYears: number; isFranchiseTagged?: boolean },
  kind: "EXTENSION" | "FRANCHISE_TAG" | "ROOKIE_OPTION",
  description: string,
) {
  const tx = await db.$transaction(async (t) => {
    await t.rosterSpot.update({ where: { id: spot.id }, data });
    return t.transaction.create({
      data: {
        leagueId: ctx.league.id,
        season: ctx.season,
        week: ctx.week,
        type: "CONTRACT",
        teamId,
        playerId: spot.playerId,
        salary: data.salary,
        description,
        details: { kind, before: { salary: spot.salary, years: spot.contractYears }, after: { salary: data.salary, years: data.contractYears } } as Prisma.InputJsonValue,
        createdById: ctx.user.id,
      },
    });
  });
  broadcastTransaction(ctx.league.id, { id: tx.id, description: tx.description, type: tx.type, teamId });
  if (ctx.settings.notifications.transactionsToChat) {
    const team = await db.team.findUnique({ where: { id: teamId }, select: { name: true } });
    await postSystemMessage(ctx.league.id, `${team?.name ?? "A team"}: ${description}.`, { channel: "transactions", kind: "TRANSACTION", data: { transactionId: tx.id, playerId: spot.playerId, teamId } }).catch(() => null);
  }
  await audit(ctx, own, `contract.${kind.toLowerCase()}`, teamId, { playerId: spot.playerId, salary: data.salary, years: data.contractYears });
  revalidateTeam(teamId);
}

export async function extendContractAction(input: z.input<typeof extendSchema>): Promise<ActionResult> {
  try {
    const parsed = extendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
    const { teamId, playerId, years } = parsed.data;
    const { ctx, own, spot, assertCap } = await loadContract(teamId, playerId);
    const extended = await contractTxCount(ctx.league.id, { teamId, playerId, season: ctx.season }, "EXTENSION");
    const el = extensionEligibility(spot, ctx.settings, { extendedThisSeason: extended > 0 });
    if (!el.ok) return { ok: false, error: el.reason };
    if (years > maxExtensionYears(spot, ctx.settings)) return { ok: false, error: `You can add at most ${maxExtensionYears(spot, ctx.settings)} year(s).` };
    const salary = extensionSalary(spot.salary, years, ctx.settings);
    assertCap(salary);
    const total = spot.contractYears + years;
    const description = `Extended ${spot.player.fullName} ${years} year${years === 1 ? "" : "s"} — $${salary}/yr through ${ctx.season + total - 1}`;
    await writeContract(ctx, own, teamId, spot, { salary, contractYears: total }, "EXTENSION", description);
    return { ok: true, message: description + "." };
  } catch (e) {
    return fail(e);
  }
}

export async function franchiseTagAction(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  try {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };
    const { teamId, playerId } = parsed.data;
    const { ctx, own, spot, assertCap } = await loadContract(teamId, playerId);
    const used = await contractTxCount(ctx.league.id, { teamId, season: ctx.season }, "FRANCHISE_TAG");
    const el = franchiseTagEligibility(spot, ctx.settings, { tagsUsedThisSeason: used });
    if (!el.ok) return { ok: false, error: el.reason };
    const pos = normalizePosition(spot.player.position);
    const all = await db.rosterSpot.findMany({ where: { leagueId: ctx.league.id }, select: { salary: true, player: { select: { position: true } } } });
    const salary = franchiseTagSalary(spot.salary, all.filter((s) => normalizePosition(s.player.position) === pos).map((s) => s.salary), ctx.settings);
    assertCap(salary);
    const description = `Franchise-tagged ${spot.player.fullName} — $${salary} for ${ctx.season + spot.contractYears}`;
    await writeContract(ctx, own, teamId, spot, { salary, contractYears: spot.contractYears + 1, isFranchiseTagged: true }, "FRANCHISE_TAG", description);
    return { ok: true, message: description + "." };
  } catch (e) {
    return fail(e);
  }
}

export async function exerciseRookieOptionAction(input: z.input<typeof moveSchema>): Promise<ActionResult> {
  try {
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };
    const { teamId, playerId } = parsed.data;
    const { ctx, own, spot, assertCap } = await loadContract(teamId, playerId);
    const used = await contractTxCount(ctx.league.id, { playerId }, "ROOKIE_OPTION");
    const el = rookieOptionEligibility(spot, ctx.settings, { optionUsed: used > 0 });
    if (!el.ok) return { ok: false, error: el.reason };
    const salary = rookieOptionSalary(spot.salary, ctx.settings);
    assertCap(salary);
    const description = `Exercised ${spot.player.fullName}'s rookie option — $${salary} through ${ctx.season + spot.contractYears}`;
    await writeContract(ctx, own, teamId, spot, { salary, contractYears: spot.contractYears + 1 }, "ROOKIE_OPTION", description);
    return { ok: true, message: description + "." };
  } catch (e) {
    return fail(e);
  }
}
