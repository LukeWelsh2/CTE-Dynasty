import Link from "next/link";
import { ArrowLeftRight, Search, Ticket } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, ButtonLink, EmptyState, InjuryTag, PageHeader, Panel, PlayerHeadshot, PosBadge, TeamLogo } from "@/components/ui/core";
import { TradesNav } from "@/components/trades/trade-nav";
import { BlockEditor, RemoveBlockEntry } from "@/components/trades/block-editor";
import { FilterSelect } from "@/components/trades/filter-select";
import { loadTradeAssets } from "@/lib/trades/assets";
import { OUTLOOK_LABEL, fmtValue } from "@/lib/value/model";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Trade Block" };

export default async function TradeBlockPage({ searchParams }: { searchParams: Promise<{ pos?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam } = ctx;
  const header = (
    <>
      <PageHeader kicker="Trades" title="Trade Block" subtitle="Who's shopping what, and what every team is looking for. Make an offer straight from the block." />
      <TradesNav active="block" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />
    </>
  );
  if (!settings.trades.showTradeBlock)
    return (
      <div>
        {header}
        <EmptyState title="The trade block is turned off">The commissioner has disabled the trade block for this league.</EmptyState>
      </div>
    );

  const [teams, entries, openOffers] = await Promise.all([
    loadTradeAssets(league.id),
    db.tradeBlockEntry.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" } }),
    db.tradeTeam.groupBy({ by: ["teamId"], where: { trade: { leagueId: league.id, status: "PROPOSED" } }, _count: true }),
  ]);
  const offersBy = new Map(openOffers.map((o) => [o.teamId, o._count]));
  const playerBy = new Map(teams.flatMap((t) => t.players.map((p) => [p.id, { p, teamId: t.id }] as const)));
  const pickBy = new Map(teams.flatMap((t) => t.picks.map((p) => [p.id, { p, teamId: t.id }] as const)));
  const positions = [...new Set(settings.roster.slots.flatMap((s) => s.eligible))];
  const posFilter = positions.includes(sp.pos ?? "") || sp.pos === "PICKS" ? sp.pos! : "";

  // only entries whose asset is still on that team
  const live = entries.filter((e) => {
    if (e.kind === "SEEKING") return true;
    if (e.playerId) return playerBy.get(e.playerId)?.teamId === e.teamId;
    if (e.pickId) return pickBy.get(e.pickId)?.teamId === e.teamId;
    return false;
  });
  const byTeam = teams
    .map((t) => {
      const mine = live.filter((e) => e.teamId === t.id);
      const offering = mine.filter((e) => e.kind === "OFFERING");
      const seeking = mine.filter((e) => e.kind === "SEEKING");
      const matches = !posFilter
        ? true
        : posFilter === "PICKS"
          ? offering.some((e) => e.pickId) || seeking.some((e) => e.position === "PICKS")
          : offering.some((e) => e.playerId && playerBy.get(e.playerId)?.p.position === posFilter) || seeking.some((e) => e.position === posFilter);
      return { team: t, offering, seeking, matches, latest: mine[0]?.createdAt ?? null };
    })
    .filter((x) => (x.offering.length || x.seeking.length) && x.matches)
    .sort((a, b) => (a.team.id === myTeam?.id ? -1 : b.team.id === myTeam?.id ? 1 : (b.latest?.getTime() ?? 0) - (a.latest?.getTime() ?? 0)));
  const quiet = teams.filter((t) => !live.some((e) => e.teamId === t.id));
  const me = myTeam ? teams.find((t) => t.id === myTeam.id) : null;
  const myEntries = me ? live.filter((e) => e.teamId === me.id) : [];

  return (
    <div>
      {header}
      {me && (
        <Panel title="Your trade block" subtitle={`${myEntries.filter((e) => e.kind === "OFFERING").length} on the block · ${myEntries.filter((e) => e.kind === "SEEKING").length} needs listed`} className="mb-4">
          <BlockEditor
            players={me.players.map((p) => ({ id: p.id, label: p.fullName, sub: `${p.position} · $${p.salary} × ${p.contractYears}y`, value: p.value }))}
            picks={me.picks.map((p) => ({ id: p.id, label: p.shortLabel, sub: p.pickInRound ? `Pick ${p.slotLabel}` : `Proj. ${p.slotLabel}`, value: p.value }))}
            positions={[...positions, ...(settings.trades.allowDraftPickTrading ? ["PICKS"] : [])]}
            allowPicks={settings.trades.allowDraftPickTrading}
          />
        </Panel>
      )}

      <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
        <FilterSelect
          name="pos"
          label="Position"
          value={posFilter}
          className="w-44"
          options={[{ value: "", label: "All positions" }, ...positions.map((p) => ({ value: p, label: p })), ...(settings.trades.allowDraftPickTrading ? [{ value: "PICKS", label: "Draft picks" }] : [])]}
        />
        <p className="pb-2 text-xs text-muted">
          <Search size={12} className="mr-1 inline" />
          {byTeam.length} team{byTeam.length === 1 ? "" : "s"} with block activity
        </p>
      </form>

      {byTeam.length ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {byTeam.map(({ team: t, offering, seeking }) => {
            const isMe = t.id === myTeam?.id;
            return (
              <section key={t.id} className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
                <header className="flex items-center gap-2 border-b border-line bg-sunken/70 px-3 py-2">
                  <TeamLogo team={t} size={30} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/teams/${t.id}`} className="block truncate text-sm font-bold text-ink hover:underline">
                      {t.name}
                      {isMe && <span className="ml-1 text-[11px] font-semibold text-gold-600 dark:text-gold-400">(you)</span>}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      {t.record} · <Badge tone={t.outlook === "contender" ? "green" : t.outlook === "rebuild" ? "purple" : "neutral"}>{OUTLOOK_LABEL[t.outlook]}</Badge>
                      {settings.salaryCap.enabled && <span>· ${t.cap.space} cap room</span>}
                      {(offersBy.get(t.id) ?? 0) > 0 && <span>· {offersBy.get(t.id)} open offer{offersBy.get(t.id) === 1 ? "" : "s"}</span>}
                    </div>
                  </div>
                  {!isMe && myTeam && (
                    <ButtonLink href={`/trades/new?team=${t.id}`} size="xs" variant="secondary">
                      <ArrowLeftRight size={12} /> Offer
                    </ButtonLink>
                  )}
                </header>
                {offering.length > 0 && (
                  <ul className="divide-y divide-line/60">
                    {offering.map((e) => {
                      const pl = e.playerId ? playerBy.get(e.playerId)?.p : undefined;
                      const pk = e.pickId ? pickBy.get(e.pickId)?.p : undefined;
                      const href = `/trades/new?team=${t.id}&${pl ? `player=${pl.id}` : `pick=${pk?.id}`}`;
                      return (
                        <li key={e.id} className="flex items-center gap-2.5 px-3 py-2">
                          {pl ? (
                            <PlayerHeadshot player={{ id: pl.id, fullName: pl.fullName, position: pl.position }} size={34} />
                          ) : (
                            <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-brand-900 text-gold-400">
                              <Ticket size={16} />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            {pl ? (
                              <>
                                <div className="flex items-center gap-1.5">
                                  <Link href={`/players/${pl.id}`} className="truncate text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                    {pl.fullName}
                                  </Link>
                                  <InjuryTag status={pl.injuryStatus} />
                                </div>
                                <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                                  <PosBadge pos={pl.position} className="h-4 min-w-[26px] text-[9px]" /> {pl.nflTeam ?? "FA"} · {pl.age ? `${pl.age}y · ` : ""}
                                  <b className="text-ink">
                                    ${pl.salary} · {pl.contractYears} yr{pl.contractYears === 1 ? "" : "s"}
                                  </b>{" "}
                                  · {pl.seasonPoints.toFixed(1)} pts
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="truncate text-sm font-semibold text-ink">{pk?.label}</div>
                                <div className="text-[11px] text-muted">{pk?.pickInRound ? `Pick ${pk.slotLabel}` : `Projected ${pk?.slotLabel}`}</div>
                              </>
                            )}
                            {e.note && <div className="mt-0.5 text-xs italic text-ink">“{e.note}”</div>}
                            <div className="text-[10px] text-muted">listed {timeAgo(e.createdAt)}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-bold tabular-nums">{fmtValue(pl?.value ?? pk?.value ?? 0)}</div>
                            <div className="text-[10px] uppercase text-muted">value</div>
                          </div>
                          {isMe ? (
                            <RemoveBlockEntry id={e.id} label={pl?.fullName ?? pk?.label ?? "entry"} />
                          ) : (
                            myTeam && (
                              <ButtonLink href={href} size="xs">
                                Make offer
                              </ButtonLink>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {seeking.length > 0 && (
                  <div className="border-t border-line px-3 py-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Looking for</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {seeking.map((e) => (
                        <li key={e.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken py-0.5 pl-1 pr-2 text-xs">
                          {e.position === "PICKS" ? <Badge tone="brand">Picks</Badge> : <PosBadge pos={e.position} className="h-4 min-w-[26px] text-[9px]" />}
                          {e.note && <span className="text-ink">{e.note}</span>}
                          {isMe && <RemoveBlockEntry id={e.id} label={`${e.position} need`} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState title={posFilter ? "Nobody is shopping or seeking that position" : "The trade block is empty"}>
          {posFilter ? "Try another position." : me ? "Be the first — list a player or pick you'd move, or the positions you need." : "When managers list players or needs they'll show up here."}
        </EmptyState>
      )}

      {quiet.length > 0 && byTeam.length > 0 && !posFilter && (
        <p className="mt-4 text-xs text-muted">
          Nothing listed yet: {quiet.map((t) => t.name).join(", ")}. You can still{" "}
          <Link href="/trades/new" className="link">
            send them an offer
          </Link>
          .
        </p>
      )}
    </div>
  );
}
