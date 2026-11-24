// What a team needs to do to accept an offer: roster drops / cap room, plus drop candidates.
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { getLeagueValues, valuePlayer, valuePlayers } from "@/lib/value/context";
import { capLimitLabel } from "@/lib/roster-rules";
import { dropDeadMoney, spotCapHit, type AssetRef, type SpotLite } from "@/lib/trades/rules";
import { validateTrade } from "@/lib/trades/validate";
import type { TradeView } from "@/lib/trades/views";

export interface AcceptDropCandidate {
  id: string;
  fullName: string;
  position: string;
  /** contract salary (shown) */
  salary: number;
  /**
   * what the drop takes off this season's payroll before dead money — spotCapHit, the figure checkTrade counts
   * (an IR player who doesn't count against the cap frees nothing; a taxi player only his taxi cap share)
   */
  capHit: number;
  /** dead money the release adds this season (dropDeadMoney for the league phase) */
  deadMoney: number;
  status: string;
  value: number;
}

export interface AcceptInfo {
  dropsNeeded: number;
  /**
   * dollars the drops must free (TeamImpact.capOverBy: only while the cap blocks; 0 = nothing to clear) — each drop
   * frees capHit − deadMoney. For a team already over the ceiling this is what takes it back to its pre-trade payroll.
   */
  capOverBy: number;
  /** the ceiling capOverBy is measured against (capLimit; null = none) and what it's called ("cap" / "soft-cap limit") */
  capLimit: number | null;
  capLimitLabel: string;
  /** this season's payroll (incl. dead money) before the trade and after it without drops */
  capBefore: number;
  capAfter: number;
  candidates: AcceptDropCandidate[];
  errors: string[];
}

/** One roster spot as an accept-dialog drop candidate (cap figures exactly as checkTrade counts a drop). */
export function acceptDropCandidate(sp: SpotLite, settings: LeagueSettings, week: number, phase: string, value: number): AcceptDropCandidate {
  return {
    id: sp.playerId,
    fullName: sp.player.fullName,
    position: sp.player.position,
    salary: sp.salary,
    capHit: spotCapHit(sp, settings),
    deadMoney: dropDeadMoney(sp, settings, week, phase).current,
    status: sp.status,
    value,
  };
}

export async function acceptInfoFor(
  trade: TradeView,
  teamId: string,
  ctx: { leagueId: string; season: number; phase: string; week: number; settings: LeagueSettings },
): Promise<AcceptInfo> {
  const refs: AssetRef[] = trade.assets.map((a) => ({ type: a.type, playerId: a.player?.id ?? null, pickId: a.pick?.id ?? null, faabAmount: a.faabAmount ?? null, fromTeamId: a.fromTeamId, toTeamId: a.toTeamId, retainPercent: a.retainPercent ?? null }));
  const drops = Object.fromEntries(trade.teams.map((t) => [t.teamId, t.teamId === teamId ? [] : t.drops.map((d) => d.id)]));
  const res = await validateTrade(db, ctx, { teamIds: trade.teams.map((t) => t.teamId), assets: refs, drops }, { checkWindow: true, strictTeams: new Set() });
  const imp = res.impacts.find((i) => i.teamId === teamId);
  const s = ctx.settings;
  // the trade rules' own answer (TeamImpact.capOverBy): only while the cap blocks (capEnforcement BLOCK +
  // trades.requireCapCompliance), measured against the capLimit ceiling, and for a team already over it only down to
  // its pre-trade payroll — a WARN-mode overage or a soft-cap team under its limit needs no drops
  const capOverBy = imp?.capOverBy ?? 0;
  const dropsNeeded = imp?.dropsNeeded ?? 0;
  let candidates: AcceptDropCandidate[] = [];
  if (dropsNeeded > 0 || capOverBy > 0) {
    const outgoing = new Set(refs.filter((r) => r.type === "PLAYER" && r.fromTeamId === teamId).map((r) => r.playerId));
    const spots = res.snapshot.spots.filter((sp) => sp.teamId === teamId && !outgoing.has(sp.playerId));
    const values = await getLeagueValues(ctx.leagueId);
    const valued = await valuePlayers(values, spots.map((sp) => sp.playerId));
    candidates = spots
      .map((sp) => {
        const vp = valued.get(sp.playerId);
        return acceptDropCandidate(sp, s, ctx.week, ctx.phase, vp ? Math.round(valuePlayer(values, vp, "balanced").value * 10) / 10 : 0);
      })
      .sort((a, b) => a.value - b.value);
  }
  // errors other than this team's own roster/cap problems (those are fixed with drops)
  const errors = res.errors;
  return { dropsNeeded, capOverBy, capLimit: imp?.capLimit ?? null, capLimitLabel: capLimitLabel(s), capBefore: imp?.capBefore ?? 0, capAfter: imp?.capAfter ?? 0, candidates, errors };
}
