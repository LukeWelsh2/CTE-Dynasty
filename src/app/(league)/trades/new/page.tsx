import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, ButtonLink, EmptyState, PageHeader } from "@/components/ui/core";
import { TradesNav, TradeRulesStrip } from "@/components/trades/trade-nav";
import { TradeBuilder, type BuilderInitial } from "@/components/trades/trade-builder";
import { loadTradeAssets, rulesSummary, tradeLocksFor, withViewerLocks } from "@/lib/trades/assets";
import { tradeTerms } from "@/lib/trades/execute";

export const metadata = { title: "Propose a Trade" };

type SP = { team?: string; player?: string; pick?: string; counter?: string; faabSend?: string; faabGet?: string };

const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);

export default async function NewTradePage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam } = ctx;
  const baseRules = rulesSummary(settings, league.phase, ctx.week, ctx.season);

  const header = (
    <>
      <PageHeader kicker="Trades" title={sp.counter ? "Counter Offer" : "Propose a Trade"} subtitle="Pick a partner, choose what each side sends, and check the value, cap and roster impact before you send it." />
      <TradesNav active="new" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />
    </>
  );
  if (!settings.trades.enabled)
    return (
      <div>
        {header}
        <EmptyState title="Trading is disabled">The commissioner has turned off trades for this league.</EmptyState>
      </div>
    );
  if (!myTeam)
    return (
      <div>
        {header}
        <EmptyState title="You don't manage a team">Only managers with a team can propose trades.</EmptyState>
      </div>
    );

  const teams = await loadTradeAssets(league.id);
  // league-state locks validateTrade() enforces, shown up front: my team knocked out of the playoffs
  // (playoffs.eliminatedTeamsCanTransact) closes the builder; picks of a rookie draft that is under way
  // (draft.rookie.tradingDuringDraft) stay listed but disabled (TeamAssetsPanel lockedPickSeasons)
  const locks = await tradeLocksFor({ id: league.id, season: ctx.season, phase: league.phase }, settings, myTeam.id, teams);
  const rules = withViewerLocks(baseRules, locks);
  const lockedSeasons = new Set(locks.lockedPicks.map((l) => l.season));
  const blockedPartners = rules.windowOpen ? teams.filter((t) => locks.blockedTeams.has(t.id)) : [];
  const teamOfPlayer = new Map<string, string>();
  // only selectable picks: a locked-season pick from the URL or a countered offer doesn't start out selected
  const teamOfPick = new Map<string, string>();
  for (const t of teams) {
    for (const p of t.players) teamOfPlayer.set(p.id, t.id);
    for (const p of t.picks) if (!lockedSeasons.has(p.season)) teamOfPick.set(p.id, t.id);
  }

  let initial: BuilderInitial = { partners: [], assets: [], faab: [] };
  let counterOf: string | null = null;
  let counterError: string | null = null;
  if (sp.counter) {
    const trade = await db.trade.findUnique({ where: { id: sp.counter }, include: { teams: true, assets: true } });
    if (!trade || trade.leagueId !== league.id) counterError = "That trade no longer exists.";
    else if (trade.status !== "PROPOSED") counterError = `That offer is ${trade.status.toLowerCase()} and can't be countered.`;
    else if (!trade.teams.some((t) => t.teamId === myTeam.id) || trade.proposerTeamId === myTeam.id) counterError = "Only a team receiving an offer can counter it.";
    else {
      counterOf = trade.id;
      initial = {
        partners: trade.teams.map((t) => t.teamId).filter((t) => t !== myTeam.id),
        assets: trade.assets
          .filter((a) => (a.type === "PLAYER" && a.playerId && teamOfPlayer.get(a.playerId) === a.fromTeamId) || (a.type === "PICK" && a.pickId && teamOfPick.get(a.pickId) === a.fromTeamId))
          .map((a) => ({ type: a.type as "PLAYER" | "PICK", id: (a.playerId ?? a.pickId)!, fromTeamId: a.fromTeamId, toTeamId: a.toTeamId })),
        faab: trade.assets.filter((a) => a.type === "FAAB" && a.faabAmount).map((a) => ({ fromTeamId: a.fromTeamId, toTeamId: a.toTeamId, amount: a.faabAmount! })),
        retention: tradeTerms(trade.valuation).retention ?? {},
      };
    }
  } else {
    let partner = sp.team && sp.team !== myTeam.id && teams.some((t) => t.id === sp.team) ? sp.team : null;
    const players = list(sp.player).filter((id) => teamOfPlayer.has(id));
    const picks = list(sp.pick).filter((id) => teamOfPick.has(id));
    if (!partner) partner = [...players.map((p) => teamOfPlayer.get(p)!), ...picks.map((p) => teamOfPick.get(p)!)].find((t) => t !== myTeam.id) ?? null;
    if (partner) {
      const assetFor = (type: "PLAYER" | "PICK", id: string, owner: string) => (owner === myTeam.id ? { type, id, fromTeamId: myTeam.id, toTeamId: partner! } : owner === partner ? { type, id, fromTeamId: partner!, toTeamId: myTeam.id } : null);
      const faab: BuilderInitial["faab"] = [];
      const send = Math.floor(Number(sp.faabSend) || 0);
      const get = Math.floor(Number(sp.faabGet) || 0);
      if (send > 0) faab.push({ fromTeamId: myTeam.id, toTeamId: partner, amount: send });
      if (get > 0) faab.push({ fromTeamId: partner, toTeamId: myTeam.id, amount: get });
      initial = {
        partners: [partner],
        assets: [...players.map((p) => assetFor("PLAYER", p, teamOfPlayer.get(p)!)), ...picks.map((p) => assetFor("PICK", p, teamOfPick.get(p)!))].filter((x): x is NonNullable<typeof x> => !!x),
        faab,
      };
    }
  }

  return (
    <div className="pb-20 lg:pb-0">
      {header}
      <TradeRulesStrip rules={rules} />
      {!rules.windowOpen && (
        <Alert tone="warn" className="mb-3">
          {rules.windowReason} You can still plan a deal here or in the{" "}
          <a className="link" href="/trades/calculator">
            calculator
          </a>
          , but offers can't be sent right now.
        </Alert>
      )}
      {locks.lockedPicks.map((l) => (
        <Alert key={l.season} tone="info" className="mb-3">
          {l.reason} They&apos;re shown but can&apos;t be selected until the draft is over.
        </Alert>
      ))}
      {blockedPartners.length > 0 && (
        <Alert tone="info" className="mb-3">
          Teams knocked out of the playoffs can&apos;t make trades in this league: {blockedPartners.map((t) => t.name).join(", ")}.
        </Alert>
      )}
      {counterError && (
        <Alert tone="error" className="mb-3">
          {counterError}{" "}
          <ButtonLink href="/trades" size="xs" variant="secondary">
            Back to Trade Center
          </ButtonLink>
        </Alert>
      )}
      {counterOf && <Alert tone="info" className="mb-3">Adjust the offer and send it back. The original offer is replaced by your counter.</Alert>}
      {!counterError && <TradeBuilder myTeamId={myTeam.id} teams={teams} rules={rules} initial={initial} counterOf={counterOf} lockPartners={!!counterOf} />}
    </div>
  );
}
