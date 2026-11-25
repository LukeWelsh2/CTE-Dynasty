// Trade calculator — "Is this deal fair for both teams?"
// Valuation mode + free mode, then one side at a time on phones (A sends · B sends · Result) with a floating verdict
// bar; side by side with a sticky result on desktop. How values are built: collapsed "About values" rows.
import { getLeagueContext } from "@/lib/league";
import { Collapsible, PageHeader, Panel } from "@/components/ui/core";
import { TradesNav } from "@/components/trades/trade-nav";
import { TradeCalculator } from "@/components/trades/trade-calculator";
import { loadTradeAssets, rulesSummary, tradeLocksFor, withViewerLocks } from "@/lib/trades/assets";
import { getLeagueValues } from "@/lib/value/context";
import { CONSOLIDATION_POWER, PEAK_AGES, fmtValue, isSuperflex, pickValue } from "@/lib/value/model";

export const metadata = { title: "Trade calculator" };

export default async function TradeCalculatorPage() {
  const ctx = await getLeagueContext();
  const { league, settings, myTeam } = ctx;
  const [teams, values] = await Promise.all([loadTradeAssets(league.id), getLeagueValues(league.id)]);
  // the viewer's league-state locks (out of the playoffs, pick seasons whose rookie draft is under way); the calculator
  // still values every pick — it's for planning
  const rules = withViewerLocks(rulesSummary(settings, league.phase, ctx.week, ctx.season), await tradeLocksFor({ id: league.id, season: ctx.season, phase: league.phase }, settings, myTeam?.id ?? null, teams));
  const repl = values.env.replacement;
  const sf = isSuperflex(settings);
  const top = pickValue({ season: values.env.nextDraftSeason, round: 1, originalTeamId: "", pickInRound: 1 }, values.env, "balanced").value;
  const lastFirst = pickValue({ season: values.env.nextDraftSeason, round: 1, originalTeamId: "", pickInRound: values.env.teams }, values.env, "balanced").value;
  return (
    <div className="pb-6">
      <PageHeader title="Trade calculator" />
      <TradesNav active="calculator" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />
      <TradeCalculator teams={teams} myTeamId={myTeam?.id ?? null} rules={rules} />
      <Panel
        title="About values"
        className="mt-4"
        noPad
        info={<p>Dynasty values are built from this league&apos;s scoring, roster slots, salaries, picks and injuries — adjusted for contenders and rebuilders. The top player is worth 100.</p>}
      >
        <div className="divide-y divide-line/70 border-t border-line/70 px-4 text-[14px] text-ink/85">
          <Collapsible summary="Production" meta="pts over replacement">
            Points per game (projections blended with this season&apos;s results) above replacement at the position. Replacement levels from your {settings.general.teamCount}-team lineup
            {sf ? " with a superflex" : ""}:{" "}
            {Object.entries(repl)
              .filter(([p]) => ["QB", "RB", "WR", "TE"].includes(p))
              .map(([p, v]) => `${p} ${v.toFixed(1)}`)
              .join(" · ")}{" "}
            PPG.
          </Collapsible>
          <Collapsible summary="Age curve" meta="peak ages">
            Future seasons follow position aging:{" "}
            {Object.entries(PEAK_AGES)
              .filter(([p]) => ["QB", "RB", "WR", "TE"].includes(p))
              .map(([p, a]) => `${p} peak ${a}`)
              .join(", ")}
            . Rookies and second-year players get an upside bump{sf ? "; QBs carry a superflex premium" : ""}.
          </Collapsible>
          <Collapsible summary="Contract surplus" meta={settings.salaryCap.enabled ? `$${values.env.dollarsPerPoint.toFixed(2)} / pt` : "no cap"}>
            {settings.salaryCap.enabled ? (
              <>
                Market salary ≈ ${values.env.dollarsPerPoint.toFixed(2)} per point over replacement (from the ${settings.salaryCap.cap} cap × {settings.general.teamCount} teams). Cheap long deals add value; overpaid short ones
                subtract. Rookie picks include rookie-scale savings.
              </>
            ) : (
              <>This league has no salary cap, so contracts don&apos;t change values.</>
            )}
          </Collapsible>
          <Collapsible summary="Picks, FAB & consolidation" meta={`1.01 ≈ ${fmtValue(top)}`}>
            Next year&apos;s picks use projected slots from the standings; later years assume mid-round. A {values.env.nextDraftSeason} 1.01 is worth about {fmtValue(top)} and the last 1st about {fmtValue(lastFirst)} (top player = 100). FAB is worth a
            little per dollar. Side totals use a power of {CONSOLIDATION_POWER} so one stud beats two mid pieces.
          </Collapsible>
        </div>
      </Panel>
    </div>
  );
}
