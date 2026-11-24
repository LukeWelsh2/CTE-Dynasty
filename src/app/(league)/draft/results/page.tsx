import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, EmptyState, PageHeader, Panel, PosBadge, StatTile, TabLinks, TeamLogo } from "@/components/ui/core";
import { auctionResults, POSITION_ORDER, rookieResults, spendingByPosition, type AuctionResultRow, type RookieResultRow } from "@/lib/draft/results";
import { roundPickLabel } from "@/lib/draft/logic";
import { auctionRules } from "@/lib/draft/data";
import { fmtDateTime } from "@/lib/draft/time";
import { cn } from "@/lib/utils";
import { PlayerCell, StatusBadge, TypeBadge } from "@/components/draft/bits";

export const metadata: Metadata = { title: "Draft Results" };

export default async function DraftResultsPage({ searchParams }: { searchParams: Promise<{ id?: string; view?: string }> }) {
  const ctx = await getLeagueContext();
  const { id, view } = await searchParams;
  const tz = ctx.settings.general.timezone;
  const drafts = await db.draft.findMany({
    where: { leagueId: ctx.league.id, OR: [{ status: "COMPLETE" }, { selections: { some: {} } }, { lots: { some: { status: "SOLD" } } }] },
    orderBy: [{ season: "desc" }, { createdAt: "desc" }],
  });
  const draft = drafts.find((d) => d.id === id) ?? drafts[0];
  if (!draft) {
    return (
      <div>
        <PageHeader kicker="Draft" title="Draft Results" />
        <EmptyState title="No draft results yet">Results appear here as soon as the first pick is made or an auction lot is sold.</EmptyState>
      </div>
    );
  }
  const base = `/draft/results?id=${draft.id}`;
  return (
    <div className="space-y-3">
      <PageHeader
        kicker="Draft history"
        title="Draft Results"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {draft.name} <TypeBadge type={draft.type} kind={draft.type === "AUCTION" ? auctionRules(draft, ctx.settings).kind : undefined} /> <StatusBadge status={draft.status} />
            {draft.completedAt && <span className="text-xs">Completed {fmtDateTime(draft.completedAt, tz)}</span>}
          </span>
        }
      />
      {drafts.length > 1 && <TabLinks active={draft.id} tabs={drafts.map((d) => ({ key: d.id, label: d.name, href: `/draft/results?id=${d.id}` }))} />}
      {draft.type === "AUCTION" ? (
        <AuctionResults rows={(await auctionResults(draft, ctx.league.season))} view={view ?? "price"} base={base} myTeamId={ctx.myTeam?.id ?? null} />
      ) : (
        <RookieResults rows={await rookieResults(draft)} view={view ?? "round"} base={base} myTeamId={ctx.myTeam?.id ?? null} />
      )}
    </div>
  );
}

function RookieResults({ rows, view, base, myTeamId }: { rows: RookieResultRow[]; view: string; base: string; myTeamId: string | null }) {
  if (!rows.length) return <EmptyState title="No picks yet">Picks show up here live as they're made.</EmptyState>;
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  const teams = [...new Map(rows.map((r) => [r.team.id, r.team])).values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Picks made" value={rows.length} />
        <StatTile label="Rookie salary" value={`$${rows.reduce((a, r) => a + r.salary, 0)}`} sub="total committed" />
        <StatTile label="Autopicks" value={rows.filter((r) => r.isAutopick).length} />
        <StatTile label="Traded picks used" value={rows.filter((r) => r.via).length} />
      </div>
      <TabLinks
        active={view === "team" ? "team" : "round"}
        tabs={[
          { key: "round", label: "By round", href: `${base}&view=round` },
          { key: "team", label: "By team", href: `${base}&view=team` },
        ]}
      />
      {view === "team" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const mine = rows.filter((r) => r.team.id === t.id);
            return (
              <Panel key={t.id} title={<span className="inline-flex items-center gap-2"><TeamLogo team={t} size={20} /> {t.name}</span>} subtitle={`${mine.length} pick${mine.length === 1 ? "" : "s"} · $${mine.reduce((a, r) => a + r.salary, 0)}`} noPad>
                <table className="tbl tbl-compact">
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.overall}>
                        <td className="w-12 font-display font-bold">{roundPickLabel(r.round, r.pickInRound)}</td>
                        <td>
                          <PlayerCell player={r.player} size={24} />
                        </td>
                        <td className="num text-xs">
                          ${r.salary} × {r.contractYears}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })}
        </div>
      ) : (
        <Panel noPad>
          <div className="scroll-thin max-h-[75vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-14">Pick</th>
                  <th className="num w-10">#</th>
                  <th>Team</th>
                  <th>Player</th>
                  <th className="hidden md:table-cell">College</th>
                  <th className="num">Salary</th>
                  <th className="num">Yrs</th>
                  <th className="hidden lg:table-cell">Now with</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((round) => (
                  <RoundRows key={round} round={round} rows={rows.filter((r) => r.round === round)} myTeamId={myTeamId} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

function RoundRows({ round, rows, myTeamId }: { round: number; rows: RookieResultRow[]; myTeamId: string | null }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={8}>Round {round}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.overall} className={cn(r.team.id === myTeamId && "bg-gold-300/10")}>
          <td className="font-display font-bold">{roundPickLabel(r.round, r.pickInRound)}</td>
          <td className="num text-xs text-muted">{r.overall}</td>
          <td className="max-w-[200px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <TeamLogo team={r.team} size={20} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.team.name}</span>
                {r.via && <span className="block text-[10px] text-muted">via {r.via.name}</span>}
              </span>
            </span>
          </td>
          <td className="max-w-[220px]">
            <PlayerCell player={r.player} size={26} sub={r.isAutopick ? <Badge className="ml-1">Auto</Badge> : null} />
          </td>
          <td className="hidden text-xs text-muted md:table-cell">{r.player.college ?? "—"}</td>
          <td className="num">${r.salary}</td>
          <td className="num">{r.contractYears}</td>
          <td className="hidden text-xs lg:table-cell">{r.nowWith ? (r.nowWith.id === r.team.id ? <span className="text-muted">Same team</span> : r.nowWith.name) : <span className="text-muted">Released</span>}</td>
        </tr>
      ))}
    </>
  );
}

function AuctionResults({ rows: data, view, base, myTeamId }: { rows: Awaited<ReturnType<typeof auctionResults>>; view: string; base: string; myTeamId: string | null }) {
  const { rows, source, passed } = data;
  if (!rows.length) return <EmptyState title="No sales yet">Sold players show up here live during the auction.</EmptyState>;
  const total = rows.reduce((a, r) => a + r.price, 0);
  const top = [...rows].sort((a, b) => b.price - a.price)[0];
  const spend = spendingByPosition(rows);
  const positions = POSITION_ORDER.filter((p) => rows.some((r) => r.position === p));
  const tabs = [
    { key: "price", label: "By price", href: `${base}&view=price` },
    { key: "team", label: "By team", href: `${base}&view=team` },
    ...(source === "LOTS" ? [{ key: "nomination", label: "By nomination", href: `${base}&view=nomination` }] : []),
    { key: "spending", label: "Spending by position", href: `${base}&view=spending` },
  ];
  const active = tabs.some((t) => t.key === view) ? view : "price";
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Players sold" value={rows.length} sub={passed ? `${passed} passed` : undefined} />
        <StatTile label="Total spent" value={`$${total.toLocaleString()}`} />
        <StatTile label="Top sale" value={`$${top.price}`} sub={`${top.player.fullName} · ${top.team.abbrev}`} />
        <StatTile label="Average price" value={`$${(total / rows.length).toFixed(1)}`} />
      </div>
      {source === "TRANSACTIONS" && <p className="text-xs text-muted">This auction was recorded before the live auction room existed; prices come from the league's transaction log and contract years from current contracts.</p>}
      <TabLinks active={active} tabs={tabs} />
      {active === "team" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {spend.map((s) => {
            const mine = rows.filter((r) => r.team.id === s.team.id).sort((a, b) => b.price - a.price);
            return (
              <Panel key={s.team.id} title={<span className="inline-flex items-center gap-2"><TeamLogo team={s.team} size={20} /> {s.team.name}</span>} subtitle={`${s.count} players · $${s.total}`} noPad>
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Player</th>
                      <th className="num">Salary</th>
                      <th className="num">Yrs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.key}>
                        <td>
                          <PosBadge pos={r.position} />
                        </td>
                        <td>
                          <Link href={`/players/${r.player.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                            {r.player.fullName}
                          </Link>{" "}
                          <span className="text-[11px] text-muted">{r.player.team ?? "FA"}</span>
                        </td>
                        <td className="num font-semibold">${r.price}</td>
                        <td className="num">{r.years ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            );
          })}
        </div>
      ) : active === "spending" ? (
        <Panel noPad title="Spending by position" subtitle="Dollars (players) won at each position">
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Team</th>
                  {positions.map((p) => (
                    <th key={p} className="num">
                      {p}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Players</th>
                </tr>
              </thead>
              <tbody>
                {spend.map((s) => (
                  <tr key={s.team.id} className={cn(s.team.id === myTeamId && "bg-gold-300/10")}>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <TeamLogo team={s.team} size={20} /> <span className="font-semibold">{s.team.name}</span>
                      </span>
                    </td>
                    {positions.map((p) => (
                      <td key={p} className="num">
                        {s.byPos[p] ? (
                          <>
                            ${s.byPos[p].amount}
                            <span className="text-[10px] text-muted"> ({s.byPos[p].count})</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    ))}
                    <td className="num font-bold">${s.total}</td>
                    <td className="num">{s.count}</td>
                  </tr>
                ))}
                <tr className="bg-sunken font-semibold">
                  <td>League</td>
                  {positions.map((p) => {
                    const v = rows.filter((r) => r.position === p);
                    return (
                      <td key={p} className="num">
                        ${v.reduce((a, r) => a + r.price, 0)}
                        <span className="text-[10px] text-muted"> ({v.length})</span>
                      </td>
                    );
                  })}
                  <td className="num">${total}</td>
                  <td className="num">{rows.length}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <SalesTable rows={active === "nomination" ? [...rows].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)) : [...rows].sort((a, b) => b.price - a.price || a.player.fullName.localeCompare(b.player.fullName))} byNomination={active === "nomination"} myTeamId={myTeamId} />
      )}
    </>
  );
}

function SalesTable({ rows, byNomination, myTeamId }: { rows: AuctionResultRow[]; byNomination: boolean; myTeamId: string | null }) {
  return (
    <Panel noPad>
      <div className="scroll-thin max-h-[75vh] overflow-auto">
        <table className="tbl">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="num w-10">#</th>
              <th>Player</th>
              <th>Team</th>
              {byNomination && <th className="hidden md:table-cell">Nominated by</th>}
              <th className="num">Price</th>
              <th className="num">Yrs</th>
              {byNomination && <th className="hidden sm:table-cell">Bids</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className={cn(r.team.id === myTeamId && "bg-gold-300/10")}>
                <td className="num text-xs text-muted">{byNomination ? r.sequence : i + 1}</td>
                <td className="max-w-[240px]">
                  <PlayerCell player={{ ...r.player, position: r.position }} size={26} />
                </td>
                <td className="max-w-[180px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TeamLogo team={r.team} size={20} />
                    <span className="truncate font-semibold">{r.team.name}</span>
                  </span>
                </td>
                {byNomination && <td className="hidden text-xs md:table-cell">{r.nominatedBy?.name ?? "—"}</td>}
                <td className="num font-bold">${r.price}</td>
                <td className="num">{r.years ?? "—"}</td>
                {byNomination && (
                  <td className="hidden text-xs sm:table-cell">
                    {r.bids.length ? (
                      <details>
                        <summary className="cursor-pointer text-brand-700 dark:text-brand-300">{r.bids.length} bids</summary>
                        <ol className="mt-1 space-y-0.5">
                          {r.bids.map((b, j) => (
                            <li key={j} className="tabular-nums">
                              {b.team} ${b.amount}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
