// Display models for trades: teams, assets with player / pick details, votes, and the valuation
// (live for open trades, the stored snapshot for completed ones). Batched for lists.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { getLeagueValues } from "@/lib/value/context";
import type { ValueComponent } from "@/lib/value/model";
import { buildEvalPreload, evaluateTradeInput, type TradeAssetDetail, type TradePreview, type ValuationSnapshot } from "@/lib/trades/evaluate";
import { assetKey, voteTally, type AssetRef } from "@/lib/trades/rules";
import { tradeTerms } from "@/lib/trades/execute";
import { record } from "@/lib/utils";
import { computeStandings } from "@/lib/standings";

export const tradeViewInclude = {
  teams: { include: { team: { select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true, owner: { select: { name: true } } } } } },
  assets: true,
  votes: { include: { team: { select: { name: true } } } },
  counters: { select: { id: true, status: true, createdAt: true } },
} satisfies Prisma.TradeInclude;

export type TradeRow = Prisma.TradeGetPayload<{ include: typeof tradeViewInclude }>;

export interface TradeTeamView {
  teamId: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  managerName: string | null;
  record: string | null;
  accepted: boolean;
  respondedAt: Date | null;
  drops: { id: string; fullName: string; position: string; team: string | null }[];
}

export interface TradeAssetView extends TradeAssetDetail {
  id: string;
}

export interface TradeView {
  id: string;
  status: TradeRow["status"];
  season: number;
  week: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  reviewEndsAt: Date | null;
  completedAt: Date | null;
  message: string | null;
  proposerTeamId: string;
  parentTradeId: string | null;
  counters: { id: string; status: string; createdAt: Date }[];
  resolutionNote: string | null;
  resolvedById: string | null;
  teams: TradeTeamView[];
  assets: TradeAssetView[];
  votes: { approve: number; veto: number; required: number; mine: string | null; list: { teamId: string; teamName: string; vote: string }[] };
  evaluation: TradePreview | null;
  evaluationSource: "live" | "snapshot" | null;
}

export async function loadTradeViews(
  leagueId: string,
  rows: TradeRow[],
  opts: { settings: LeagueSettings; season: number; viewerTeamId?: string | null; withEvaluation?: boolean },
): Promise<TradeView[]> {
  if (!rows.length) return [];
  const values = await getLeagueValues(leagueId);
  const pickIds = rows.flatMap((r) => r.assets.filter((a) => a.pickId).map((a) => a.pickId!));
  const dropIds = [...new Set(rows.flatMap((r) => r.teams.flatMap((t) => t.dropPlayerIds)))];
  const [pre, dropPlayers, standings] = await Promise.all([
    buildEvalPreload(leagueId, values.season, pickIds),
    dropIds.length ? db.player.findMany({ where: { id: { in: dropIds } }, select: { id: true, fullName: true, position: true, team: true } }) : Promise.resolve([]),
    computeStandings(leagueId, opts.season, opts.settings),
  ]);
  const dropBy = new Map(dropPlayers.map((p) => [p.id, p]));
  const recBy = new Map(standings.map((s) => [s.team.id, record(s.wins, s.losses, s.ties)]));

  const views: TradeView[] = [];
  for (const r of rows) {
    const retention = tradeTerms(r.valuation).retention ?? {};
    const refs = r.assets.map((a) => ({
      type: a.type as AssetRef["type"],
      playerId: a.playerId,
      pickId: a.pickId,
      faabAmount: a.faabAmount,
      fromTeamId: a.fromTeamId,
      toTeamId: a.toTeamId,
      salary: a.salary,
      contractYears: a.contractYears,
      label: a.label,
      retainPercent: a.playerId ? retention[a.playerId] ?? null : null,
    }));
    const settled = r.status === "COMPLETED" || r.status === "REVERSED";
    const snap = (r.valuation ?? null) as (ValuationSnapshot & { teams?: ValuationSnapshot["teams"] }) | null;
    let evaluation: TradePreview | null = null;
    let source: TradeView["evaluationSource"] = null;
    if (opts.withEvaluation !== false) {
      evaluation = await evaluateTradeInput(
        leagueId,
        { teamIds: r.teams.map((t) => t.teamId), assets: refs, drops: Object.fromEntries(r.teams.map((t) => [t.teamId, t.dropPlayerIds])), mode: "auto", useSnapshots: settled || r.status === "VETOED", withImpact: !settled },
        values,
        pre,
      );
      source = "live";
      if (settled && snap?.teams?.length) {
        const byKey = new Map(snap.assets.map((a) => [a.key, a]));
        for (const a of evaluation.assets) {
          const s = byKey.get(a.key);
          if (s) {
            a.value = s.value;
            a.components = s.components.map((c) => ({ key: c.key, label: c.label, value: c.value, note: c.note ?? undefined }) as ValueComponent);
          }
        }
        evaluation.teams = snap.teams.map((t) => ({ teamId: t.teamId, name: t.name, outlook: t.outlook, received: t.received, receivedRaw: t.receivedRaw, sent: t.sent, net: t.net, consolidation: t.consolidation, cap: t.cap ?? undefined, roster: t.roster ?? undefined }));
        evaluation.fairness = snap.fairness;
        evaluation.verdict = snap.verdict;
        evaluation.verdictTone = snap.verdictTone;
        evaluation.favoredTeamId = snap.favoredTeamId;
        evaluation.warnings = [];
        source = "snapshot";
      } else if (settled) evaluation.warnings = [];
      // closed offers: rule warnings (deadline, cap) no longer apply
      if (!["PROPOSED", "ACCEPTED"].includes(r.status)) evaluation.warnings = [];
    }
    const assetByKey = new Map((evaluation?.assets ?? []).map((a) => [a.key, a]));
    const assets: TradeAssetView[] = r.assets.map((a) => {
      const key = a.type === "FAAB" ? `F:${a.fromTeamId}>${a.toTeamId}` : assetKey({ type: a.type as AssetRef["type"], playerId: a.playerId, pickId: a.pickId, fromTeamId: a.fromTeamId });
      const d = assetByKey.get(key);
      return {
        id: a.id,
        key,
        type: a.type as AssetRef["type"],
        label: a.label ?? d?.label ?? "Asset",
        fromTeamId: a.fromTeamId,
        toTeamId: a.toTeamId,
        value: d?.value ?? 0,
        components: d?.components ?? [],
        notes: d?.notes ?? [],
        salary: a.salary ?? d?.salary ?? null,
        contractYears: a.contractYears ?? d?.contractYears ?? null,
        capHit: d?.capHit,
        player: d?.player,
        seasonPoints: d?.seasonPoints,
        ppg: d?.ppg,
        rosPoints: d?.rosPoints,
        isRookieContract: d?.isRookieContract,
        pick: d?.pick,
        faabAmount: a.faabAmount ?? undefined,
        retainPercent: a.playerId ? retention[a.playerId] || undefined : undefined,
      };
    });
    const tally = voteTally(r.votes, opts.settings.trades.vetoVotesRequired);
    views.push({
      id: r.id,
      status: r.status,
      season: r.season,
      week: r.week,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
      reviewEndsAt: r.reviewEndsAt,
      completedAt: r.completedAt,
      message: r.message,
      proposerTeamId: r.proposerTeamId,
      parentTradeId: r.parentTradeId,
      counters: r.counters,
      resolutionNote: r.resolutionNote,
      resolvedById: r.resolvedById,
      teams: [...r.teams]
        .sort((a, b) => (a.teamId === r.proposerTeamId ? -1 : b.teamId === r.proposerTeamId ? 1 : 0))
        .map((t) => ({
          teamId: t.teamId,
          name: t.team.name,
          abbrev: t.team.abbrev,
          logoUrl: t.team.logoUrl,
          primaryColor: t.team.primaryColor,
          secondaryColor: t.team.secondaryColor,
          managerName: t.team.owner?.name ?? null,
          record: recBy.get(t.teamId) ?? null,
          accepted: t.accepted,
          respondedAt: t.respondedAt,
          drops: t.dropPlayerIds.map((id) => dropBy.get(id)).filter((p): p is NonNullable<typeof p> => !!p),
        })),
      assets,
      votes: {
        approve: tally.approve,
        veto: tally.veto,
        required: tally.required,
        mine: opts.viewerTeamId ? r.votes.find((v) => v.teamId === opts.viewerTeamId)?.vote ?? null : null,
        list: r.votes.map((v) => ({ teamId: v.teamId, teamName: v.team.name, vote: v.vote })),
      },
      evaluation,
      evaluationSource: source,
    });
  }
  return views;
}

/** Can this viewer see the trade? Private offers are visible to the teams involved and commissioners. */
export function canViewTrade(t: { status: string; teams: { teamId: string }[] }, viewer: { teamId: string | null; isCommish: boolean }): boolean {
  if (viewer.isCommish) return true;
  if (viewer.teamId && t.teams.some((x) => x.teamId === viewer.teamId)) return true;
  return ["ACCEPTED", "COMPLETED", "VETOED", "REVERSED"].includes(t.status);
}
