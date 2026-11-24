"use server";
// My Team server actions: lineup saves, IR / taxi moves, drops and contract actions.
// Every action authorizes with assertTeamManager, validates with zod and writes a Transaction row. Commissioner edits
// of another team (settings.commissioner.canEditLineups) are written to the AuditLog and notify the team's managers.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertTeamManager, type LeagueContext } from "@/lib/league";
import { getLineup, isLocked, isOnBye, saveLineup, validateLineup, weekGamesByTeam } from "@/lib/lineup";
import { notify } from "@/lib/notify";
import { broadcastTransaction, dropPlayerFromTeam } from "@/lib/roster-ops";
import { getTeamRoster } from "@/lib/roster";
import { expandSlots } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { postSystemMessage } from "@/lib/chat-system";
import { isInSeasonPhase } from "@/lib/team/contracts";
import { loadContractContext, loadMoveEnv, offersFor, toRuleSpot, waiverHoursFor } from "@/lib/team/data";
import { fillableEmptySlots, slotId, toAssignment, type LineupPlayerInfo } from "@/lib/team/lineup-model";
import { refreshTeamMatchup } from "@/lib/team/matchup";
import { canStartStatus, effectiveRosterSettings, lineupWeekState, lockClock, rosterMoveCheck, type RosterMoveKind } from "@/lib/team/roster-rules";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong." });

const idSchema = z.string().trim().min(1).max(64);

async function authorize(teamId: string): Promise<{ ctx: LeagueContext; own: boolean }> {
  const ctx = await assertTeamManager(teamId);
  const own = ctx.myTeam?.id === teamId;
  if (!own && !ctx.settings.commissioner.canEditLineups) throw new Error("Commissioner edits of other teams are turned off in league settings.");
  return { ctx, own };
}

/** Commissioner acting on someone else's team: AuditLog row + (settings.commissioner.notifyAffectedOwners) a notice. */
async function audit(ctx: LeagueContext, own: boolean, action: string, teamId: string, details: Record<string, unknown>, summary?: string) {
  if (own) return;
  await db.auditLog.create({ data: { leagueId: ctx.league.id, actorId: ctx.user.id, action, targetType: "team", targetId: teamId, details: details as Prisma.InputJsonValue } });
  if (!summary || !ctx.settings.commissioner.notifyAffectedOwners) return;
  const [team, members] = await Promise.all([
    db.team.findUnique({ where: { id: teamId }, select: { ownerId: true } }),
    db.leagueMember.findMany({ where: { leagueId: ctx.league.id, teamId }, select: { userId: true } }),
  ]);
  const userIds = [...new Set([team?.ownerId, ...members.map((m) => m.userId)].filter((x): x is string => !!x && x !== ctx.user.id))];
  if (!userIds.length) return;
  await notify({ userIds, leagueId: ctx.league.id, type: "COMMISSIONER", title: "The commissioner updated your team", body: summary, url: "/team" }).catch(() => null);
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
  teamId: idSchema,
  week: z.number().int().min(1).max(25),
  lineup: z
    .array(z.object({ slot: z.string().min(1).max(20), slotIndex: z.number().int().min(0).max(20), playerId: idSchema.nullable() }))
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

    const slots = expandSlots(settings);
    const known = new Set(slots.map((s) => slotId(s.key, s.index)));
    const incoming = new Map<string, string | null>();
    for (const a of lineup) {
      const id = slotId(a.slot, a.slotIndex);
      if (!known.has(id)) return { ok: false, error: `Unknown lineup slot ${a.slot}.` };
      incoming.set(id, a.playerId);
    }
    const [current, roster, games, matchup] = await Promise.all([
      getLineup(teamId, league.id, season, week, settings),
      db.rosterSpot.findMany({ where: { teamId }, include: { player: true } }),
      weekGamesByTeam(season, week),
      db.matchup.findFirst({ where: { leagueId: league.id, season, week, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] }, select: { id: true } }),
    ]);
    const state = lineupWeekState(settings, league.phase, ctx.week, week, { hasMatchup: !!matchup });
    if (!state.editable) return { ok: false, error: state.reason ?? "This lineup can't be edited." };

    const proposed = slots.map((s) => {
      const id = slotId(s.key, s.index);
      const cur = current.find((c) => c.slot === s.key && c.slotIndex === s.index)?.playerId ?? null;
      return { slot: s.key, slotIndex: s.index, playerId: incoming.has(id) ? incoming.get(id)! : cur };
    });
    // the foundation validator only lets ACTIVE players start; taxi players may start when the league allows it
    const startRoster = roster.map((r) => (canStartStatus(r.status, settings) ? { ...r, status: "ACTIVE" } : r));
    const clock = lockClock(settings);
    const errors = validateLineup(proposed, current, startRoster, games, settings, clock);
    if (errors.length) return { ok: false, error: errors.join(" ") };

    if (!settings.roster.allowEmptyStarterSlots) {
      const info = new Map<string, LineupPlayerInfo>(
        roster.map((r) => [
          r.playerId,
          {
            id: r.playerId,
            name: r.player.fullName,
            pos: normalizePosition(r.player.position),
            rosterStatus: r.status,
            startable: canStartStatus(r.status, settings),
            locked: isLocked(r.player.team, games, settings, clock),
            onBye: isOnBye(r.player.team, games),
            injuryStatus: r.player.injuryStatus,
            projected: 0,
          },
        ]),
      );
      const open = fillableEmptySlots(toAssignment(proposed, slots), slots, info);
      if (open.length) return { ok: false, error: `League rules don't allow empty starter slots — fill your ${open.map((s) => s.label).join(", ")} slot${open.length === 1 ? "" : "s"}.` };
    }

    const changed = proposed.filter((p) => (current.find((c) => c.slot === p.slot && c.slotIndex === p.slotIndex)?.playerId ?? null) !== p.playerId).length;
    if (!changed) return { ok: true, message: "Lineup is already saved." };
    await saveLineup(teamId, league.id, season, week, proposed);
    const team = own ? null : await db.team.findUnique({ where: { id: teamId }, select: { name: true } });
    await audit(ctx, own, "lineup.edit", teamId, { week, changes: changed }, `Your Week ${week} lineup was changed by the commissioner (${changed} slot${changed === 1 ? "" : "s"}${team ? ` on ${team.name}` : ""}).`);
    await refreshTeamMatchup(league.id, season, week, teamId, settings).catch(() => null);
    revalidateTeam(teamId);
    revalidatePath("/scoring", "layout");
    return { ok: true, message: `Week ${week} lineup saved · ${changed} slot${changed === 1 ? "" : "s"} changed.` };
  } catch (e) {
    return fail(e);
  }
}

// ───────────────────────────── Roster moves ─────────────────────────────

const moveSchema = z.object({ teamId: idSchema, playerId: idSchema });

async function loadMove(input: unknown, kind: RosterMoveKind) {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid request.");
  const { teamId, playerId } = parsed.data;
  const { ctx, own } = await authorize(teamId);
  const roster = await getTeamRoster(teamId);
  const spot = roster.find((r) => r.playerId === playerId);
  if (!spot) throw new Error("That player isn't on this roster.");
  const envFor = await loadMoveEnv(ctx, teamId, roster);
  const check = rosterMoveCheck(kind, toRuleSpot(spot), roster.map(toRuleSpot), envFor(spot));
  if (!check.ok) throw new Error(check.reason);
  return { ctx, own, teamId, spot, label: `${spot.player.fullName} (${spot.player.position}${spot.player.team ? " " + spot.player.team : ""})` };
}

async function statusMove(input: unknown, kind: "IR" | "ACTIVATE" | "TAXI" | "PROMOTE"): Promise<ActionResult> {
  try {
    const { ctx, own, teamId, spot, label } = await loadMove(input, kind);
    const { league, season, settings } = ctx;
    const to = kind === "IR" ? "IR" : kind === "TAXI" ? "TAXI" : "ACTIVE";
    const txType = kind === "IR" ? "IR" : kind === "TAXI" ? "TAXI" : "ACTIVATE";
    const description =
      kind === "IR" ? `Moved ${label} to IR` : kind === "TAXI" ? `Moved ${label} to the taxi squad` : kind === "ACTIVATE" ? `Activated ${label} from IR` : `Promoted ${label} from the taxi squad`;
    const limits = effectiveRosterSettings(settings, league.phase).roster;
    const tx = await db.$transaction(async (t) => {
      // conditional update: a double-submit or a concurrent move of the same player applies once
      const res = await t.rosterSpot.updateMany({ where: { id: spot.id, teamId, status: spot.status }, data: { status: to } });
      if (res.count !== 1) throw new Error(`${spot.player.fullName} was just moved — refresh and try again.`);
      // re-check the destination's capacity inside the transaction (two different players moved at once)
      const count = await t.rosterSpot.count({ where: { teamId, status: to } });
      const max = to === "IR" ? limits.irSlots : to === "TAXI" ? limits.taxiSlots : limits.maxActiveRoster;
      if (count > max) throw new Error(`${to === "ACTIVE" ? "Active roster" : to === "IR" ? "IR" : "Taxi squad"} is full (${max}).`);
      // a player leaving the active roster can't stay in any lineup; taxi starters stay only if the league lets them start
      if (!canStartStatus(to, settings)) {
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
    await audit(ctx, own, `roster.${kind.toLowerCase()}`, teamId, { playerId: spot.playerId }, `${description}.`);
    if (isInSeasonPhase(league.phase)) await refreshTeamMatchup(league.id, season, ctx.week, teamId, settings).catch(() => null);
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
      dropPlayerFromTeam(t, { leagueId: league.id, teamId, playerId: spot.playerId, season, week: ctx.week, settings, phase: league.phase, actorId: ctx.user.id, toWaivers: hours !== null }),
    );
    broadcastTransaction(league.id, { id: res.transaction.id, description: res.transaction.description, type: res.transaction.type, teamId });
    const deadNow = res.deadMoney.filter((d) => d.season === season).reduce((a, d) => a + d.amount, 0);
    if (settings.notifications.transactionsToChat) {
      const team = await db.team.findUnique({ where: { id: teamId }, select: { name: true } });
      await postSystemMessage(league.id, `${team?.name ?? "A team"} dropped ${label}${deadNow ? ` — $${deadNow} dead money` : ""}.`, {
        channel: "transactions",
        kind: "TRANSACTION",
        data: { transactionId: res.transaction.id, playerId: spot.playerId, teamId },
      }).catch(() => null);
    }
    await audit(ctx, own, "roster.drop", teamId, { playerId: spot.playerId, deadMoney: res.deadMoney }, `${res.transaction.description}.`);
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

const extendSchema = z.object({ teamId: idSchema, playerId: idSchema, years: z.number().int().min(1).max(10) });

async function loadContract(teamId: string, playerId: string) {
  const { ctx, own } = await authorize(teamId);
  if (!ctx.settings.contracts.enabled) throw new Error("Contracts are disabled in this league.");
  const cc = await loadContractContext(ctx, teamId);
  const spot = cc.roster.find((r) => r.playerId === playerId);
  if (!spot) throw new Error("That player isn't on this roster.");
  return { ctx, own, spot, offers: offersFor(ctx, cc, spot) };
}

async function writeContract(
  ctx: LeagueContext,
  own: boolean,
  teamId: string,
  spot: { id: string; playerId: string; salary: number; contractYears: number; isFranchiseTagged: boolean; player: { fullName: string } },
  data: { salary: number; contractYears: number; isFranchiseTagged?: boolean },
  kind: "EXTENSION" | "FRANCHISE_TAG" | "ROOKIE_OPTION",
  description: string,
) {
  const tx = await db.$transaction(async (t) => {
    // optimistic check: a double-submit (or a concurrent trade / commissioner edit) must not apply twice
    const res = await t.rosterSpot.updateMany({
      where: { id: spot.id, teamId, salary: spot.salary, contractYears: spot.contractYears, isFranchiseTagged: spot.isFranchiseTagged },
      data,
    });
    if (res.count !== 1) throw new Error("This contract just changed — refresh and try again.");
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
        details: { kind, phase: ctx.league.phase, before: { salary: spot.salary, years: spot.contractYears }, after: { salary: data.salary, years: data.contractYears } } as Prisma.InputJsonValue,
        createdById: ctx.user.id,
      },
    });
  });
  broadcastTransaction(ctx.league.id, { id: tx.id, description: tx.description, type: tx.type, teamId });
  if (ctx.settings.notifications.transactionsToChat) {
    const team = await db.team.findUnique({ where: { id: teamId }, select: { name: true } });
    await postSystemMessage(ctx.league.id, `${team?.name ?? "A team"}: ${description}.`, { channel: "transactions", kind: "TRANSACTION", data: { transactionId: tx.id, playerId: spot.playerId, teamId } }).catch(() => null);
  }
  await audit(ctx, own, `contract.${kind.toLowerCase()}`, teamId, { playerId: spot.playerId, salary: data.salary, years: data.contractYears }, `${description}.`);
  revalidateTeam(teamId);
}

/** Last season of a contract with `years` left (contractYears counts the current league season). */
function lastSeason(ctx: LeagueContext, years: number) {
  return ctx.season + years - 1;
}

export async function extendContractAction(input: z.input<typeof extendSchema>): Promise<ActionResult> {
  try {
    const parsed = extendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
    const { teamId, playerId, years } = parsed.data;
    const { ctx, own, spot, offers } = await loadContract(teamId, playerId);
    const ext = offers.extension;
    if (!ext) return { ok: false, error: "Extensions are not allowed in this league." };
    const choice = ext.options.find((o) => o.years === years);
    if (!choice) return { ok: false, error: ext.ok ? `You can add at most ${ext.options.length} year${ext.options.length === 1 ? "" : "s"}.` : ext.reason ?? "This contract can't be extended." };
    if (choice.blocked) return { ok: false, error: choice.blocked };
    if (!ext.ok) return { ok: false, error: ext.reason ?? "This contract can't be extended." };
    const description = `Extended ${spot.player.fullName} ${years} year${years === 1 ? "" : "s"} — $${choice.salary}/yr through ${lastSeason(ctx, choice.contractYears)}`;
    await writeContract(ctx, own, teamId, spot, { salary: choice.salary, contractYears: choice.contractYears }, "EXTENSION", description);
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
    const { ctx, own, spot, offers } = await loadContract(teamId, playerId);
    const tag = offers.tag;
    if (!tag) return { ok: false, error: "Franchise tags are disabled." };
    if (!tag.ok) return { ok: false, error: tag.reason ?? "This player can't be tagged." };
    const first = ctx.season + 1;
    const last = lastSeason(ctx, tag.contractYears);
    const description = `Franchise-tagged ${spot.player.fullName} — $${tag.salary} for ${first === last ? first : `${first}–${last}`}`;
    await writeContract(ctx, own, teamId, spot, { salary: tag.salary, contractYears: tag.contractYears, isFranchiseTagged: true }, "FRANCHISE_TAG", description);
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
    const { ctx, own, spot, offers } = await loadContract(teamId, playerId);
    const opt = offers.option;
    if (!opt) return { ok: false, error: "Rookie options are disabled or this isn't a rookie contract." };
    if (!opt.ok) return { ok: false, error: opt.reason ?? "The option can't be exercised." };
    const description = `Exercised ${spot.player.fullName}'s rookie option — $${opt.salary} for ${lastSeason(ctx, opt.contractYears)}`;
    await writeContract(ctx, own, teamId, spot, { salary: opt.salary, contractYears: opt.contractYears }, "ROOKIE_OPTION", description);
    return { ok: true, message: description + "." };
  } catch (e) {
    return fail(e);
  }
}
