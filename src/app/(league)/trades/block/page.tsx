// Trade block — "Who is shopping what, and what does every team need?"
// Summary strip (on the block · needs · teams), my block editor (collapsed once it has entries), position chips, then
// one card per team: the players / picks it is shopping (Roster-style rows with value + Offer) and what it needs.
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, ButtonLink, Chip, Collapsible, EmptyState, PageHeader, PosBadge, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { PickIcon } from "@/components/trades/trade-card";
import { TradesNav } from "@/components/trades/trade-nav";
import { BlockEditor, RemoveBlockEntry } from "@/components/trades/block-editor";
import { loadTradeAssets } from "@/lib/trades/assets";
import { OUTLOOK_LABEL, fmtValue } from "@/lib/value/model";
import { fmtMoney, timeAgo } from "@/lib/utils";

export const metadata = { title: "Trade block" };

export default async function TradeBlockPage({ searchParams }: { searchParams: Promise<{ pos?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam } = ctx;
  const header = (
    <>
      <PageHeader title="Trade block" />
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

  const offeringCount = live.filter((e) => e.kind === "OFFERING").length;
  const seekingCount = live.filter((e) => e.kind === "SEEKING").length;
  const chipHref = (p: string) => (p ? `/trades/block?pos=${encodeURIComponent(p)}` : "/trades/block");

  return (
    <div>
      {header}
      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Listed", value: offeringCount, sub: "players & picks" },
          { label: "Needs", value: seekingCount, sub: "listed" },
          { label: "Teams", value: teams.length - quiet.length, sub: `of ${teams.length} active` },
        ]}
      />
      {me && (
        <section className="card mb-4 px-4">
          <Collapsible
            summary="Your trade block"
            meta={`${myEntries.filter((e) => e.kind === "OFFERING").length} listed · ${myEntries.filter((e) => e.kind === "SEEKING").length} need${myEntries.filter((e) => e.kind === "SEEKING").length === 1 ? "" : "s"}`}
            defaultOpen={!myEntries.some((e) => e.kind === "OFFERING") || !myEntries.some((e) => e.kind === "SEEKING")}
          >
            <BlockEditor
              players={me.players.map((p) => ({ id: p.id, label: p.fullName, sub: `${p.position} · $${p.salary} × ${p.contractYears}y`, value: p.value }))}
              picks={me.picks.map((p) => ({ id: p.id, label: p.shortLabel, sub: p.pickInRound ? `Pick ${p.slotLabel}` : `Proj. ${p.slotLabel}`, value: p.value }))}
              positions={[...positions, ...(settings.trades.allowDraftPickTrading ? ["PICKS"] : [])]}
              allowPicks={settings.trades.allowDraftPickTrading}
            />
          </Collapsible>
        </section>
      )}

      <ScrollRow className="-mx-3 mb-3 gap-2 px-3 scroll-px-3 sm:mx-0 sm:px-0 sm:scroll-px-0" aria-label="Filter by position">
        <Chip href={chipHref("")} active={!posFilter} scroll={false}>
          All
        </Chip>
        {positions.map((p) => (
          <Chip key={p} href={chipHref(p)} active={posFilter === p} scroll={false}>
            {p}
          </Chip>
        ))}
        {settings.trades.allowDraftPickTrading && (
          <Chip href={chipHref("PICKS")} active={posFilter === "PICKS"} scroll={false}>
            Picks
          </Chip>
        )}
      </ScrollRow>

      {byTeam.length ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {byTeam.map(({ team: t, offering, seeking }) => {
            const isMe = t.id === myTeam?.id;
            const offers = offersBy.get(t.id) ?? 0;
            return (
              <section key={t.id} className="card overflow-hidden">
                <header className="flex items-center gap-3 px-4 pb-2 pt-3">
                  <TeamLogo team={t} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/teams/${t.id}`} title={t.name} className={`block truncate text-[15px] font-semibold leading-5 hover:underline ${isMe ? "text-brand-600 dark:text-brand-400" : "text-ink"}`}>
                      {t.name}
                    </Link>
                    <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                      <span className="numeral shrink-0">{t.record}</span>
                      <Badge tone={t.outlook === "contender" ? "green" : t.outlook === "rebuild" ? "purple" : "neutral"}>{OUTLOOK_LABEL[t.outlook]}</Badge>
                      <span className="truncate">
                        {settings.salaryCap.enabled ? `${fmtMoney(t.cap.space)} room` : ""}
                        {offers > 0 ? `${settings.salaryCap.enabled ? " · " : ""}${offers} open offer${offers === 1 ? "" : "s"}` : ""}
                      </span>
                    </div>
                  </div>
                  {!isMe && myTeam && (
                    <ButtonLink href={`/trades/new?team=${t.id}`} variant="tinted" aria-label={`Make an offer to ${t.name}`}>
                      <ArrowLeftRight size={15} /> Offer
                    </ButtonLink>
                  )}
                </header>
                {offering.length > 0 && (
                  <ul className="divide-y divide-line/70 border-t border-line/70">
                    {offering.map((e) => {
                      const pl = e.playerId ? playerBy.get(e.playerId)?.p : undefined;
                      const pk = e.pickId ? pickBy.get(e.pickId)?.p : undefined;
                      const href = `/trades/new?team=${t.id}&${pl ? `player=${pl.id}` : `pick=${pk?.id}`}`;
                      const label = pl?.fullName ?? pk?.label ?? "entry";
                      return (
                        <li key={e.id} className="flex min-h-[68px] items-center gap-3 px-4 py-2.5">
                          {pl ? <HeadshotBadge player={{ id: pl.id, fullName: pl.fullName, position: pl.position }} nflTeam={pl.nflTeam} size={40} /> : <PickIcon round={pk?.round} />}
                          <div className="min-w-0 flex-1">
                            {pl ? (
                              <>
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <Link href={`/players/${pl.id}`} title={pl.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
                                    {pl.fullName}
                                  </Link>
                                  <InjuryLetter status={pl.injuryStatus} className="text-[13px]" />
                                </div>
                                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                                  <PosPill pos={pl.position} />
                                  <span className="min-w-0 truncate">
                                    {pl.nflTeam ?? "FA"} · <span className="numeral font-medium text-ink">${pl.salary} · {pl.contractYears} yr{pl.contractYears === 1 ? "" : "s"}</span>
                                    {pl.age ? ` · ${pl.age}y` : ""} · {pl.seasonPoints.toFixed(1)} pts
                                  </span>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="truncate text-[15px] font-semibold leading-5 text-ink" title={pk?.label}>
                                  {pk?.label}
                                </div>
                                <div className="text-[13px] leading-[18px] text-muted">{pk?.pickInRound ? `Pick ${pk.slotLabel}` : `Projected ${pk?.slotLabel}`}</div>
                              </>
                            )}
                            <div className="mt-0.5 truncate text-[12px] leading-4 text-muted" title={e.note ?? undefined}>
                              {e.note ? <span className="italic text-ink">“{e.note}” · </span> : null}
                              listed {timeAgo(e.createdAt)}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="numeral text-[15px] font-semibold leading-5 text-ink">{fmtValue(pl?.value ?? pk?.value ?? 0)}</div>
                            <div className="text-[12px] leading-4 text-muted">value</div>
                          </div>
                          {isMe ? (
                            <RemoveBlockEntry id={e.id} label={label} />
                          ) : (
                            myTeam && (
                              <ButtonLink href={href} variant="secondary" size="sm" aria-label={`Make an offer for ${label}`} className="px-2.5">
                                Offer
                              </ButtonLink>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {seeking.length > 0 && (
                  <div className="border-t border-line/70 px-4 py-3">
                    <div className="eyebrow mb-2">Looking for</div>
                    <ul className="flex flex-wrap gap-2">
                      {seeking.map((e) => (
                        <li key={e.id} className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-sunken py-1 pl-1.5 pr-2.5 text-[13px]">
                          {e.position === "PICKS" ? <Badge tone="brand">Picks</Badge> : <PosBadge pos={e.position} />}
                          {e.note && (
                            <span className="min-w-0 truncate text-ink" title={e.note}>
                              {e.note}
                            </span>
                          )}
                          {isMe && <RemoveBlockEntry id={e.id} label={`${e.position} need`} className="-my-1 -mr-1.5" />}
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
          {posFilter ? "Try another position." : me ? "List a player or pick you'd move, or the positions you need." : "Listed players and needs show up here."}
        </EmptyState>
      )}

      {quiet.length > 0 && byTeam.length > 0 && !posFilter && (
        <p className="mt-4 px-1 text-[13px] text-muted">
          Nothing listed: {quiet.map((t) => t.name).join(", ")}.{" "}
          <Link href="/trades/new" className="link">
            Send an offer
          </Link>
        </p>
      )}
    </div>
  );
}
