// League-year rollover: previewRollover() (dry run for the commissioner) and rolloverSeason().
// Order of operations (core steps in one database transaction, guarded so it can only happen once):
//  1. TeamSeason history rows for the finished season (only the ones missing)
//  2. keepers / contracts: designated expiring players re-sign at their keeper salary, undesignated expiring
//     players are released (Transaction type KEEPER), everyone else loses a contract year (+ annual raise);
//     taxi players who are no longer taxi-eligible are promoted; franchise tags expire
//  3. FAB reset (SEASON_START ledger rows; unused FAB carries over when faabRollover is on)
//  4. waiver priority reset to reverse standings, pending claims cancelled, expired dead money cleared
//  5. League.season + 1, phase PRESEASON, week override cleared; keeper window dates cleared and the cap grows
//     by settings.salaryCap.annualCapIncrease (settings history row)
// Then (idempotent, re-runnable): draft picks so every team holds the new draft + futurePickYears more,
// and the new regular-season schedule.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { computeStandings, type StandingRow } from "@/lib/standings";
import { ensureDraftPicks } from "@/lib/picks";
import { generateSchedule } from "@/lib/schedule";
import { dropPlayerFromTeam, broadcastTransaction } from "@/lib/roster-ops";
import { notify, leagueUserIds } from "@/lib/notify";
import { postSystemMessage } from "@/lib/chat-system";
import { publish, topics } from "@/lib/realtime/bus";
import { reverseStandingsOrder } from "@/lib/waivers/logic";
import { patchLeagueSettings } from "@/lib/season/settings";
import {
  capAfterRollover,
  faabForNewSeason,
  pickSeasonsAfterRollover,
  planRollover,
  pruneDeadCap,
  rolloverPhaseProblem,
  type DeadCapEntry,
  type RolloverPlan,
  type RolloverSpot,
} from "@/lib/season/logic";

export const ROLLOVER_KEY = (leagueId: string, fromSeason: number) => `season:rollover:${leagueId}:${fromSeason}`;

interface RolloverState {
  status: "core-done" | "complete";
  at: string;
  toSeason: number;
}

async function rolloverState(leagueId: string, fromSeason: number): Promise<RolloverState | null> {
  const row = await db.keyValue.findUnique({ where: { key: ROLLOVER_KEY(leagueId, fromSeason) } });
  return (row?.value as unknown as RolloverState) ?? null;
}

export interface RolloverTeamPreview {
  team: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
  record: string;
  kept: { name: string; salary: number }[];
  released: { name: string; salary: number }[];
  rolled: number;
  promoted: string[];
  payrollNext: number;
  deadNext: number;
  faabNow: number;
  faabNext: { budget: number; carry: number; total: number };
  priorityNow: number;
  priorityNext: number;
}

export interface RolloverPreview {
  leagueId: string;
  fromSeason: number;
  toSeason: number;
  phase: string;
  phaseProblem: string | null;
  /** an earlier rollover finished the core steps but not picks/schedule */
  resumable: boolean;
  capNow: number;
  capNext: number;
  teams: RolloverTeamPreview[];
  totals: { kept: number; released: number; rolled: number; promoted: number };
  pickSeasons: number[];
  picksToCreate: number;
  scheduleExists: boolean;
  scheduleWeeks: number;
  pendingClaims: number;
  expiredDeadMoney: number;
  missingTeamSeasons: number;
  /** designations that will not apply (player changed teams) */
  voidDesignations: number;
}

async function loadInputs(leagueId: string) {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const from = league.season;
  const [teams, spots, designations, states, standings, playoffs, existingSeasons, pendingClaims] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } }),
    db.rosterSpot.findMany({ where: { leagueId }, include: { player: { select: { fullName: true, yearsExp: true, rookieYear: true } } } }),
    db.keeperDesignation.findMany({ where: { leagueId, season: from + 1 } }),
    db.leaguePlayerState.findMany({ where: { leagueId }, select: { id: true, deadCap: true } }),
    computeStandings(leagueId, from, settings),
    db.matchup.findMany({ where: { leagueId, season: from, isPlayoff: true } }),
    db.teamSeason.findMany({ where: { leagueId, season: from }, select: { teamId: true } }),
    db.waiverClaim.count({ where: { leagueId, status: "PENDING" } }),
  ]);
  const rspots: RolloverSpot[] = spots.map((s) => ({
    id: s.id,
    teamId: s.teamId,
    playerId: s.playerId,
    name: s.player.fullName,
    status: s.status,
    salary: s.salary,
    contractYears: s.contractYears,
    keeperCount: s.keeperCount,
    isRookieContract: s.isRookieContract,
    isFranchiseTagged: s.isFranchiseTagged,
    yearsExp: s.player.yearsExp,
    rookieYear: s.player.rookieYear,
  }));
  const plan = planRollover({ settings, fromSeason: from, spots: rspots, designations });
  return { league, settings, from, teams, spots, designations, states, standings, playoffs, existingSeasons, pendingClaims, plan };
}

function deadNextByTeam(states: { deadCap: unknown }[], season: number) {
  const m = new Map<string, number>();
  for (const s of states) for (const d of (s.deadCap as unknown as DeadCapEntry[]) ?? []) if (d.season === season) m.set(d.teamId, (m.get(d.teamId) ?? 0) + d.amount);
  return m;
}

export async function previewRollover(leagueId: string): Promise<RolloverPreview> {
  const inp = await loadInputs(leagueId);
  const { league, settings, from, teams, plan, standings, states } = inp;
  const to = from + 1;
  const prior = await rolloverState(leagueId, from - 1);
  const order = reverseStandingsOrder(standings.map((r) => r.team.id), teams.map((t) => t.id));
  const deadNext = deadNextByTeam(states, to);
  const rec = new Map(standings.map((r) => [r.team.id, r]));
  const pickSeasons = pickSeasonsAfterRollover(to, settings);
  const [existingPicks, scheduleCount] = await Promise.all([
    db.draftPick.count({ where: { leagueId, season: { in: pickSeasons } } }),
    db.matchup.count({ where: { leagueId, season: to, isPlayoff: false } }),
  ]);
  let expired = 0;
  for (const s of states) for (const d of (s.deadCap as unknown as DeadCapEntry[]) ?? []) if (d.season < to) expired += d.amount;
  const teamPreviews: RolloverTeamPreview[] = teams.map((t) => {
    const acts = plan.actions.filter((a) => a.spot.teamId === t.id);
    const sum = plan.byTeam.get(t.id);
    const r = rec.get(t.id);
    return {
      team: { id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor },
      record: r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : "0-0",
      kept: acts.filter((a) => a.kind === "KEEP").map((a) => ({ name: a.spot.name, salary: a.kind === "KEEP" ? a.salary : 0 })),
      released: acts.filter((a) => a.kind === "RELEASE").map((a) => ({ name: a.spot.name, salary: a.spot.salary })).sort((a, b) => b.salary - a.salary),
      rolled: sum?.rolled ?? 0,
      promoted: acts.filter((a) => a.kind !== "RELEASE" && a.promoted).map((a) => a.spot.name),
      payrollNext: (sum?.payrollNext ?? 0) + (deadNext.get(t.id) ?? 0),
      deadNext: deadNext.get(t.id) ?? 0,
      faabNow: t.faabBalance,
      faabNext: faabForNewSeason(t.faabBalance, settings),
      priorityNow: t.waiverPriority,
      priorityNext: order.indexOf(t.id) + 1,
    };
  });
  const totals = { kept: 0, released: 0, rolled: 0, promoted: 0 };
  for (const s of plan.byTeam.values()) {
    totals.kept += s.kept;
    totals.released += s.released;
    totals.rolled += s.rolled;
    totals.promoted += s.promoted;
  }
  return {
    leagueId,
    fromSeason: from,
    toSeason: to,
    phase: league.phase,
    phaseProblem: rolloverPhaseProblem(league.phase, false),
    resumable: prior?.status === "core-done",
    capNow: settings.salaryCap.cap,
    capNext: capAfterRollover(settings),
    teams: teamPreviews,
    totals,
    pickSeasons,
    picksToCreate: Math.max(0, pickSeasons.length * settings.draft.rookie.rounds * teams.length - existingPicks),
    scheduleExists: scheduleCount > 0,
    scheduleWeeks: settings.general.regularSeasonWeeks,
    pendingClaims: inp.pendingClaims,
    expiredDeadMoney: expired,
    missingTeamSeasons: teams.length - inp.existingSeasons.length,
    voidDesignations: inp.designations.filter((d) => !plan.actions.some((a) => a.kind === "KEEP" && a.spot.playerId === d.playerId)).length,
  };
}

function teamSeasonRows(leagueId: string, season: number, teams: { id: string; name: string; ownerId: string | null }[], standings: StandingRow[], playoffs: { homeTeamId: string | null; awayTeamId: string | null; homeScore: number; awayScore: number; isChampionship: boolean; isConsolation: boolean; status: string; label: string | null; winnerTeamId: string | null; homeSeed: number | null; awaySeed: number | null }[]) {
  const rec = new Map(standings.map((r) => [r.team.id, r]));
  const inPlayoffs = new Set<string>();
  for (const m of playoffs) {
    if (m.isConsolation) continue;
    if (m.homeTeamId) inPlayoffs.add(m.homeTeamId);
    if (m.awayTeamId) inPlayoffs.add(m.awayTeamId);
  }
  // championship: total points across FINAL championship games (handles multi-week finals)
  const champTotals = new Map<string, number>();
  for (const m of playoffs.filter((x) => x.isChampionship && !x.isConsolation && x.status === "FINAL")) {
    if (m.homeTeamId) champTotals.set(m.homeTeamId, (champTotals.get(m.homeTeamId) ?? 0) + m.homeScore);
    if (m.awayTeamId) champTotals.set(m.awayTeamId, (champTotals.get(m.awayTeamId) ?? 0) + m.awayScore);
  }
  const finalists = [...champTotals.entries()].sort((a, b) => b[1] - a[1]);
  const champion = finalists[0]?.[0] ?? null;
  const runnerUp = finalists[1]?.[0] ?? null;
  const third = playoffs.find((m) => !m.isConsolation && m.status === "FINAL" && /3rd|third/i.test(m.label ?? ""));
  const thirdWinner = third ? (third.winnerTeamId ?? (third.homeScore >= third.awayScore ? third.homeTeamId : third.awayTeamId)) : null;
  const thirdLoser = third ? (thirdWinner === third.homeTeamId ? third.awayTeamId : third.homeTeamId) : null;
  return teams.map((t) => {
    const r = rec.get(t.id);
    const finalRank = t.id === champion ? 1 : t.id === runnerUp ? 2 : t.id === thirdWinner ? 3 : t.id === thirdLoser ? 4 : null;
    return {
      leagueId,
      teamId: t.id,
      ownerId: t.ownerId,
      season,
      teamName: t.name,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      ties: r?.ties ?? 0,
      pointsFor: r?.pointsFor ?? 0,
      pointsAgainst: r?.pointsAgainst ?? 0,
      regularSeasonRank: r?.rank ?? null,
      finalRank,
      madePlayoffs: inPlayoffs.has(t.id),
      champion: t.id === champion,
      runnerUp: t.id === runnerUp,
    };
  });
}

export interface RolloverResult {
  ok: boolean;
  error?: string;
  fromSeason?: number;
  toSeason?: number;
  summary?: { kept: number; released: number; rolled: number; promoted: number; picksCreated: number; matchups: number };
}

/** Run the rollover. `force` skips the phase check (commissioner only). */
export async function rolloverSeason(leagueId: string, opts: { actorId?: string | null; force?: boolean } = {}): Promise<RolloverResult> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const prior = await rolloverState(leagueId, league.season - 1);
  if (prior?.status === "core-done") {
    // the league already moved to the new season; finish the remaining steps
    const post = await postSteps(leagueId, league.season);
    await markState(leagueId, league.season - 1, { status: "complete", at: new Date().toISOString(), toSeason: league.season });
    return { ok: true, fromSeason: league.season - 1, toSeason: league.season, summary: { kept: 0, released: 0, rolled: 0, promoted: 0, ...post } };
  }
  const done = await rolloverState(leagueId, league.season);
  if (done) return { ok: false, error: `The ${league.season} season was already rolled over.` };
  const problem = rolloverPhaseProblem(league.phase, !!opts.force);
  if (problem) return { ok: false, error: problem };

  const inp = await loadInputs(leagueId);
  const { settings, from, teams, plan, standings, states, playoffs, existingSeasons } = inp;
  const to = from + 1;
  const order = reverseStandingsOrder(standings.map((r) => r.team.id), teams.map((t) => t.id));
  const existing = new Set(existingSeasons.map((x) => x.teamId));
  const createdTx: { id: string; description: string; type: string; teamId: string | null }[] = [];
  const designationByPlayer = new Map(inp.designations.map((d) => [d.playerId, d]));

  try {
    await db.$transaction(
      async (tx) => {
        const moved = await tx.league.updateMany({ where: { id: leagueId, season: from }, data: { season: to, phase: "PRESEASON", weekOverride: null } });
        if (moved.count !== 1) throw new Error("The league season changed while the rollover was running.");

        // 1. history
        const rows = teamSeasonRows(leagueId, from, teams, standings, playoffs).filter((r) => !existing.has(r.teamId));
        if (rows.length) await tx.teamSeason.createMany({ data: rows, skipDuplicates: true });

        // 2. contracts & keepers
        await applyPlan(tx, plan, settings, leagueId, to, opts.actorId ?? null, designationByPlayer, createdTx);

        // 3. FAB
        for (const t of teams) {
          const f = faabForNewSeason(t.faabBalance, settings);
          await tx.faabLedger.create({ data: { leagueId, teamId: t.id, season: to, amount: f.budget, reason: "SEASON_START", refType: "season", refId: String(to) } });
          if (f.carry > 0) await tx.faabLedger.create({ data: { leagueId, teamId: t.id, season: to, amount: f.carry, reason: "SEASON_START", refType: "carryover", refId: String(from) } });
          await tx.team.update({ where: { id: t.id }, data: { faabBalance: f.total, waiverPriority: order.indexOf(t.id) + 1 } });
        }

        // 4. waivers + dead money
        await tx.waiverClaim.updateMany({ where: { leagueId, status: "PENDING" }, data: { status: "CANCELLED", resultNote: `Season rolled over to ${to}`, processedAt: new Date() } });
        for (const s of states) {
          const entries = (s.deadCap as unknown as DeadCapEntry[]) ?? [];
          const kept = pruneDeadCap(entries, to);
          if (kept.length !== entries.length) await tx.leaguePlayerState.update({ where: { id: s.id }, data: { deadCap: kept as unknown as Prisma.InputJsonValue } });
        }
        // designations of players who changed teams never applied
        await tx.keeperDesignation.updateMany({
          where: { leagueId, season: to, playerId: { notIn: plan.actions.filter((a) => a.kind === "KEEP").map((a) => a.spot.playerId) } },
          data: { status: "RELEASED" },
        });

        // 5. settings for the new league year
        const patch: Record<string, unknown> = { keepers: { windowOpens: null, deadline: null } };
        if (settings.salaryCap.annualCapIncrease) patch.salaryCap = { cap: capAfterRollover(settings) };
        await patchLeagueSettings(leagueId, patch, { actorId: opts.actorId ?? null, note: `Season rollover ${from} → ${to}`, tx });

        const totals = summarize(plan);
        await tx.auditLog.create({
          data: { leagueId, actorId: opts.actorId ?? null, action: "season.rollover", targetType: "league", targetId: leagueId, details: { from, to, force: !!opts.force, ...totals } as Prisma.InputJsonValue },
        });
        await tx.keyValue.upsert({
          where: { key: ROLLOVER_KEY(leagueId, from) },
          create: { key: ROLLOVER_KEY(leagueId, from), value: { status: "core-done", at: new Date().toISOString(), toSeason: to } },
          update: { value: { status: "core-done", at: new Date().toISOString(), toSeason: to } },
        });
      },
      { timeout: 180_000, maxWait: 15_000 },
    );
  } catch (e) {
    console.error("[season] rollover failed", e);
    return { ok: false, error: (e as Error).message || "The rollover failed; nothing was changed." };
  }

  const post = await postSteps(leagueId, to);
  await markState(leagueId, from, { status: "complete", at: new Date().toISOString(), toSeason: to });
  for (const t of createdTx) broadcastTransaction(leagueId, t);
  const totals = summarize(plan);
  const body = `The ${to} league year has begun: ${totals.kept} keepers kept, ${totals.released} expiring contracts released, FAB reset to $${settings.waivers.faabBudget}${settings.waivers.faabRollover ? " plus unused FAB" : ""}.`;
  await notify({ userIds: await leagueUserIds(leagueId), leagueId, type: "COMMISSIONER", title: `Welcome to the ${to} season`, body, url: "/transactions?type=keepers" }).catch((e) => console.error("[season] notify failed", e));
  await postSystemMessage(leagueId, body, { channel: "general", kind: "SYSTEM", data: { kind: "rollover", season: to } }).catch(() => null);
  publish(topics.league(leagueId), "season.rollover", { from, to });
  return { ok: true, fromSeason: from, toSeason: to, summary: { ...totals, ...post } };
}

function summarize(plan: RolloverPlan) {
  const totals = { kept: 0, released: 0, rolled: 0, promoted: 0 };
  for (const s of plan.byTeam.values()) {
    totals.kept += s.kept;
    totals.released += s.released;
    totals.rolled += s.rolled;
    totals.promoted += s.promoted;
  }
  return totals;
}

async function applyPlan(
  tx: Prisma.TransactionClient,
  plan: RolloverPlan,
  settings: LeagueSettings,
  leagueId: string,
  to: number,
  actorId: string | null,
  designations: Map<string, { status: string }>,
  createdTx: { id: string; description: string; type: string; teamId: string | null }[],
) {
  const releasedTo = settings.keepers.releasedPlayersReturnTo === "AUCTION_POOL" ? "returns to the auction pool" : "becomes a free agent";
  for (const a of plan.actions) {
    const sp = a.spot;
    if (a.kind === "RELEASE") {
      const res = await dropPlayerFromTeam(tx, {
        leagueId,
        teamId: sp.teamId,
        playerId: sp.playerId,
        season: to,
        week: 0,
        settings,
        actorId,
        noPenalty: true,
        toWaivers: false,
        txType: "KEEPER",
        description: `Released ${sp.name} (contract expired) — ${releasedTo}`,
      });
      createdTx.push(res.transaction);
      continue;
    }
    await tx.rosterSpot.update({
      where: { id: sp.id },
      data:
        a.kind === "KEEP"
          ? { salary: a.salary, contractYears: a.contractYears, contractStart: to, keeperCount: { increment: 1 }, isRookieContract: false, isFranchiseTagged: false, status: a.status }
          : { salary: a.salary, contractYears: a.contractYears, isFranchiseTagged: false, status: a.status },
    });
    if (a.kind === "KEEP" && designations.get(sp.playerId)?.status !== "LOCKED") {
      // keepers locked at the deadline already have a KEEPER transaction
      createdTx.push(
        await tx.transaction.create({
          data: {
            leagueId,
            season: to,
            week: 0,
            type: "KEEPER",
            teamId: sp.teamId,
            playerId: sp.playerId,
            salary: a.salary,
            description: `Kept ${sp.name} for ${to} — $${a.salary}, ${a.contractYears} yr${a.contractYears === 1 ? "" : "s"} (was $${sp.salary})`,
            details: { rollover: true, previousSalary: sp.salary } as Prisma.InputJsonValue,
            createdById: actorId,
          },
        }),
      );
    }
    if (a.promoted) {
      createdTx.push(
        await tx.transaction.create({
          data: {
            leagueId,
            season: to,
            week: 0,
            type: "ACTIVATE",
            teamId: sp.teamId,
            playerId: sp.playerId,
            salary: a.salary,
            description: `Promoted ${sp.name} from the taxi squad (no longer taxi-eligible)`,
            details: { rollover: true } as Prisma.InputJsonValue,
            createdById: actorId,
          },
        }),
      );
    }
  }
}

async function postSteps(leagueId: string, season: number) {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const a = await ensureDraftPicks(leagueId, season, settings);
  const b = await ensureDraftPicks(leagueId, season + 1, settings);
  const existing = await db.matchup.count({ where: { leagueId, season, isPlayoff: false } });
  const matchups = existing ? existing : await generateSchedule(leagueId, season, settings);
  return { picksCreated: a + b, matchups };
}

async function markState(leagueId: string, fromSeason: number, value: RolloverState) {
  const key = ROLLOVER_KEY(leagueId, fromSeason);
  await db.keyValue.upsert({ where: { key }, create: { key, value: value as unknown as Prisma.InputJsonValue }, update: { value: value as unknown as Prisma.InputJsonValue } });
}
