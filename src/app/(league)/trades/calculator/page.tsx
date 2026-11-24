import { getLeagueContext } from "@/lib/league";
import { PageHeader, Panel } from "@/components/ui/core";
import { TradesNav } from "@/components/trades/trade-nav";
import { TradeCalculator } from "@/components/trades/trade-calculator";
import { loadTradeAssets, rulesSummary } from "@/lib/trades/assets";
import { getLeagueValues } from "@/lib/value/context";
import { CONSOLIDATION_POWER, PEAK_AGES, fmtValue, isSuperflex, pickValue } from "@/lib/value/model";

export const metadata = { title: "Trade Calculator" };

export default async function TradeCalculatorPage() {
  const ctx = await getLeagueContext();
  const { league, settings, myTeam } = ctx;
  const [teams, values] = await Promise.all([loadTradeAssets(league.id), getLeagueValues(league.id)]);
  const rules = rulesSummary(settings, league.phase, ctx.week, ctx.season);
  const repl = values.env.replacement;
  const sf = isSuperflex(settings);
  const top = pickValue({ season: values.env.nextDraftSeason, round: 1, originalTeamId: "", pickInRound: 1 }, values.env, "balanced").value;
  const lastFirst = pickValue({ season: values.env.nextDraftSeason, round: 1, originalTeamId: "", pickInRound: values.env.teams }, values.env, "balanced").value;
  return (
    <div className="pb-6">
      <PageHeader
        kicker="Trades"
        title="Trade Calculator"
        subtitle="Dynasty values built from this league's scoring, roster slots, salaries, picks and injuries — adjusted for contenders and rebuilders."
      />
      <TradesNav active="calculator" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />
      <TradeCalculator teams={teams} myTeamId={myTeam?.id ?? null} rules={rules} />
      <Panel title="How values work" className="mt-4" bodyClassName="grid gap-3 text-xs text-muted sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <div className="mb-1 font-semibold text-ink">Production</div>
          Points per game (projections blended with this season's results) above replacement at the position. Replacement levels from your {settings.general.teamCount}-team lineup
          {sf ? " with a superflex" : ""}:{" "}
          {Object.entries(repl)
            .filter(([p]) => ["QB", "RB", "WR", "TE"].includes(p))
            .map(([p, v]) => `${p} ${v.toFixed(1)}`)
            .join(" · ")}{" "}
          PPG.
        </div>
        <div>
          <div className="mb-1 font-semibold text-ink">Age curve</div>
          Future seasons follow position aging: {Object.entries(PEAK_AGES)
            .filter(([p]) => ["QB", "RB", "WR", "TE"].includes(p))
            .map(([p, a]) => `${p} peak ${a}`)
            .join(", ")}
          . Rookies and second-year players get an upside bump{sf ? "; QBs carry a superflex premium" : ""}.
        </div>
        <div>
          <div className="mb-1 font-semibold text-ink">Contract surplus</div>
          {settings.salaryCap.enabled ? (
            <>
              Market salary ≈ ${values.env.dollarsPerPoint.toFixed(2)} per point over replacement (from the ${settings.salaryCap.cap} cap × {settings.general.teamCount} teams). Cheap long deals add value; overpaid short
              ones subtract. Rookie picks include rookie-scale savings.
            </>
          ) : (
            <>This league has no salary cap, so contracts don't change values.</>
          )}
        </div>
        <div>
          <div className="mb-1 font-semibold text-ink">Picks, FAB & consolidation</div>
          Next year's picks use projected slots from the standings; later years assume mid-round. A {values.env.nextDraftSeason} 1.01 is worth about {fmtValue(top)} and the last 1st about {fmtValue(lastFirst)} (top player = 100). FAB is worth a little per dollar.
          Side totals use a power of {CONSOLIDATION_POWER} so one stud beats two mid pieces.
        </div>
      </Panel>
    </div>
  );
}
