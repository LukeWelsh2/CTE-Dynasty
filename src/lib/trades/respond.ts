// What a team needs to do to accept an offer: roster drops / cap room, plus drop candidates.
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { getLeagueValues, valuePlayer, valuePlayers } from "@/lib/value/context";
import { dropDeadMoney, type AssetRef } from "@/lib/trades/rules";
import { validateTrade } from "@/lib/trades/validate";
import type { TradeView } from "@/lib/trades/views";

export interface AcceptInfo {
  dropsNeeded: number;
  capOverBy: number;
  candidates: { id: string; fullName: string; position: string; salary: number; deadMoney: number; status: string; value: number }[];
  errors: string[];
}

export async function acceptInfoFor(
  trade: TradeView,
  teamId: string,
  ctx: { leagueId: string; season: number; phase: string; week: number; settings: LeagueSettings },
): Promise<AcceptInfo> {
  const refs: AssetRef[] = trade.assets.map((a) => ({ type: a.type, playerId: a.player?.id ?? null, pickId: a.pick?.id ?? null, faabAmount: a.faabAmount ?? null, fromTeamId: a.fromTeamId, toTeamId: a.toTeamId }));
  const drops = Object.fromEntries(trade.teams.map((t) => [t.teamId, t.teamId === teamId ? [] : t.drops.map((d) => d.id)]));
  const res = await validateTrade(db, ctx, { teamIds: trade.teams.map((t) => t.teamId), assets: refs, drops }, { checkWindow: true, strictTeams: new Set() });
  const imp = res.impacts.find((i) => i.teamId === teamId);
  const s = ctx.settings;
  const capOverBy = imp && s.salaryCap.enabled && s.trades.requireCapCompliance && imp.capAfter > s.salaryCap.cap && imp.capAfter > imp.capBefore ? imp.capAfter - s.salaryCap.cap : 0;
  const dropsNeeded = imp?.dropsNeeded ?? 0;
  let candidates: AcceptInfo["candidates"] = [];
  if (dropsNeeded > 0 || capOverBy > 0) {
    const outgoing = new Set(refs.filter((r) => r.type === "PLAYER" && r.fromTeamId === teamId).map((r) => r.playerId));
    const spots = res.snapshot.spots.filter((sp) => sp.teamId === teamId && !outgoing.has(sp.playerId));
    const values = await getLeagueValues(ctx.leagueId);
    const valued = await valuePlayers(values, spots.map((sp) => sp.playerId));
    candidates = spots
      .map((sp) => {
        const vp = valued.get(sp.playerId);
        return {
          id: sp.playerId,
          fullName: sp.player.fullName,
          position: sp.player.position,
          salary: sp.salary,
          deadMoney: dropDeadMoney(sp, s, ctx.week).current,
          status: sp.status,
          value: vp ? Math.round(valuePlayer(values, vp, "balanced").value * 10) / 10 : 0,
        };
      })
      .sort((a, b) => a.value - b.value);
  }
  // errors other than this team's own roster/cap problems (those are fixed with drops)
  const errors = res.errors;
  return { dropsNeeded, capOverBy, candidates, errors };
}
