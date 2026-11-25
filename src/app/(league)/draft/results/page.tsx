// Draft results — "Who went where, and for how much?"
// Title = the draft (other drafts as tabs), one grey line (type · status · date), the 4-number summary, a view switch,
// then the picks / sales as phone rows (numbers right-aligned, my team marked) or the dense table from md. By team:
// one card per team, top 5 + show more. Spending by position: a stacked bar per team on phones (tap for the dollars),
// the full table from md. The "imported from the transaction log" note lives in an ⓘ.
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, EmptyState, InfoButton, PageHeader, Panel, SegmentedLinks, SummaryStrip, TabLinks, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { PosPill } from "@/components/ui/fantasy";
import { auctionResults, POSITION_ORDER, rookieResults, spendingByPosition, type AuctionResultRow, type RookieResultRow } from "@/lib/draft/results";
import { roundPickLabel } from "@/lib/draft/logic";
import { auctionRules } from "@/lib/draft/data";
import { fmtDateTime } from "@/lib/draft/time";
import { cn } from "@/lib/utils";
import { PlayerCell, StatusBadge, moneyShort, typeLabel } from "@/components/draft/bits";

export const metadata: Metadata = { title: "Draft Results" };

// position colours for the spending bars (same hues as PosPill, written out for Tailwind's JIT)
const POS_BAR: Record<string, string> = {
  QB: "bg-pink-700",
  RB: "bg-emerald-700",
  WR: "bg-sky-700",
  TE: "bg-violet-600",
  K: "bg-amber-800",
  DEF: "bg-slate-600",
  DL: "bg-stone-600",
  LB: "bg-stone-500",
  DB: "bg-stone-400",
};

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
        <PageHeader kicker="Draft history" title="Draft results" />
        <EmptyState title="No draft results yet">Results appear as soon as the first pick is made or an auction lot is sold.</EmptyState>
      </div>
    );
  }
  const base = `/draft/results?id=${draft.id}`;
  const kind = draft.type === "AUCTION" ? auctionRules(draft, ctx.settings).kind : undefined;
  const when = draft.completedAt ? fmtDateTime(draft.completedAt, tz, { withZone: false }) : null;
  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Draft results"
        title={draft.name}
        className="!mb-0"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
            <StatusBadge status={draft.status} />
            <span>
              {typeLabel(draft.type, kind)}
              {when ? ` · ${when}` : ""}
            </span>
          </span>
        }
      />
      {drafts.length > 1 && <TabLinks className="!mb-0" active={draft.id} tabs={drafts.map((d) => ({ key: d.id, label: d.name, href: `/draft/results?id=${d.id}` }))} />}
      {draft.type === "AUCTION" ? (
        <AuctionResults rows={await auctionResults(draft, ctx.league.season)} view={view ?? "price"} base={base} myTeamId={ctx.myTeam?.id ?? null} />
      ) : (
        <RookieResults rows={await rookieResults(draft)} view={view ?? "round"} base={base} myTeamId={ctx.myTeam?.id ?? null} />
      )}
    </div>
  );
}

const mineRow = (mine: boolean) => cn(mine && "-mx-3 bg-brand-600/[0.04] px-3 shadow-[inset_3px_0_0_rgb(var(--c-accent))] sm:mx-0 dark:bg-brand-400/[0.07]");

function RookieResults({ rows, view, base, myTeamId }: { rows: RookieResultRow[]; view: string; base: string; myTeamId: string | null }) {
  if (!rows.length) return <EmptyState title="No picks yet">Picks show up here live as they&apos;re made.</EmptyState>;
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  const teams = [...new Map(rows.map((r) => [r.team.id, r.team])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const salary = rows.reduce((a, r) => a + r.salary, 0);
  const active = view === "team" ? "team" : "round";
  return (
    <>
      <SummaryStrip
        items={[
          { label: "Picks", value: rows.length, sub: `${rounds.length} round${rounds.length === 1 ? "" : "s"}` },
          { label: "Salary", value: `$${salary}`, sub: "committed" },
          { label: "Auto", value: rows.filter((r) => r.isAutopick).length, sub: "autopicks" },
          { label: "Traded", value: rows.filter((r) => r.via).length, sub: "picks used", title: "Traded picks used" },
        ]}
      />
      <SegmentedLinks
        full
        active={active}
        ariaLabel="Results view"
        options={[
          { key: "round", label: "By round", href: `${base}&view=round` },
          { key: "team", label: "By team", href: `${base}&view=team` },
        ]}
        className="sm:w-fit"
      />
      {active === "team" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const mine = rows.filter((r) => r.team.id === t.id);
            return (
              <Panel
                key={t.id}
                title={
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <TeamLogo team={t} size={22} /> <span className={cn("truncate", t.id === myTeamId && "text-brand-600 dark:text-brand-400")}>{t.name}</span>
                  </span>
                }
                subtitle={`${mine.length} pick${mine.length === 1 ? "" : "s"} · $${mine.reduce((a, r) => a + r.salary, 0)}`}
                noPad
              >
                <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
                  {mine.map((r) => (
                    <li key={r.overall} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                      <span className="numeral w-10 shrink-0 text-[15px] font-semibold text-ink">{roundPickLabel(r.round, r.pickInRound)}</span>
                      <span className="min-w-0 flex-1">
                        <PlayerCell player={r.player} size={32} short />
                      </span>
                      <span className="numeral shrink-0 text-[15px] font-semibold text-ink">
                        ${r.salary}
                        <span className="text-[13px] font-normal text-muted"> ×{r.contractYears}</span>
                      </span>
                    </li>
                  ))}
                </ShowMore>
              </Panel>
            );
          })}
        </div>
      ) : (
        <>
          {/* phones: a section per round, roster-style rows */}
          <div className="space-y-4 md:hidden">
            {rounds.map((round) => (
              <section key={round}>
                <h2 className="eyebrow mb-1.5 px-1">Round {round}</h2>
                <ul className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card">
                  {rows
                    .filter((r) => r.round === round)
                    .map((r) => {
                      const mine = r.team.id === myTeamId;
                      return (
                        <li key={r.overall} className={cn("flex min-h-[68px] items-center gap-2.5 border-b border-line/70 py-2 last:border-b-0", mineRow(mine))}>
                          <span className="w-9 shrink-0 leading-tight">
                            <span className="numeral block text-[15px] font-semibold text-ink">{roundPickLabel(r.round, r.pickInRound)}</span>
                            <span className="block text-[12px] text-muted">#{r.overall}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <PlayerCell player={r.player} size={40} short sub={r.isAutopick ? <Badge>Auto</Badge> : null} />
                          </span>
                          <span className="w-[64px] shrink-0 text-right leading-tight">
                            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink" title={r.team.name}>
                              <TeamLogo team={r.team} size={18} /> {r.team.abbrev}
                            </span>
                            <span className="numeral block text-[13px] text-muted">
                              ${r.salary} ×{r.contractYears}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
          {/* md+: the table */}
          <div className="card hidden md:block">
            <div className="scroll-thin max-h-[75vh] overflow-auto">
              <table className="tbl">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-14">Pick</th>
                    <th className="num w-10">#</th>
                    <th>Team</th>
                    <th>Player</th>
                    <th className="hidden lg:table-cell">College</th>
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
          </div>
        </>
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
        <tr key={r.overall} className={cn(r.team.id === myTeamId && "row-mine")}>
          <td className="numeral font-semibold">{roundPickLabel(r.round, r.pickInRound)}</td>
          <td className="num text-muted">{r.overall}</td>
          <td className="max-w-[220px]">
            <span className="flex min-w-0 items-center gap-2">
              <TeamLogo team={r.team} size={22} />
              <span className="min-w-0">
                <span className="block truncate font-semibold" title={r.team.name}>
                  {r.team.name}
                </span>
                {r.via && <span className="block text-[12px] text-muted">via {r.via.name}</span>}
              </span>
            </span>
          </td>
          <td className="max-w-[260px]">
            <PlayerCell player={r.player} size={30} sub={r.isAutopick ? <Badge>Auto</Badge> : null} />
          </td>
          <td className="hidden text-muted lg:table-cell">{r.player.college ?? "—"}</td>
          <td className="num font-semibold">${r.salary}</td>
          <td className="num">{r.contractYears}</td>
          <td className="hidden lg:table-cell">{r.nowWith ? r.nowWith.id === r.team.id ? <span className="text-muted">Same team</span> : r.nowWith.name : <span className="text-muted">Released</span>}</td>
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
    ...(source === "LOTS" ? [{ key: "nomination", label: "Order", href: `${base}&view=nomination`, title: "In nomination order" }] : []),
    { key: "spending", label: "Positions", href: `${base}&view=spending`, title: "Spending by position" },
  ];
  const active = tabs.some((t) => t.key === view) ? view : "price";
  return (
    <>
      <SummaryStrip
        items={[
          { label: "Sold", value: rows.length, sub: passed ? `${passed} passed` : "players" },
          { label: "Spent", value: moneyShort(total), sub: `$${(total / rows.length).toFixed(1)} avg`, title: `$${total.toLocaleString()} spent` },
          { label: "Top sale", value: `$${top.price}`, sub: top.player.fullName, title: `${top.player.fullName} · ${top.team.name}` },
          { label: "Spender", value: spend[0] ? `$${spend[0].total}` : "—", sub: spend[0]?.team.abbrev, title: spend[0]?.team.name },
        ]}
      />
      <div className="flex items-center gap-2">
        <SegmentedLinks full active={active} ariaLabel="Results view" options={tabs} className="min-w-0 flex-1 sm:w-fit sm:flex-none" />
        {source === "TRANSACTIONS" && (
          <InfoButton title="Imported auction">
            <p>This auction was recorded before the live auction room existed: prices come from the league&apos;s transaction log and contract years from current contracts. Nomination order and bid history aren&apos;t available.</p>
          </InfoButton>
        )}
      </div>
      {active === "team" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {spend.map((s) => {
            const mine = rows.filter((r) => r.team.id === s.team.id).sort((a, b) => b.price - a.price);
            return (
              <Panel
                key={s.team.id}
                title={
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <TeamLogo team={s.team} size={22} /> <span className={cn("truncate", s.team.id === myTeamId && "text-brand-600 dark:text-brand-400")}>{s.team.name}</span>
                  </span>
                }
                subtitle={`${s.count} players · $${s.total}`}
                noPad
              >
                <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
                  {mine.map((r) => (
                    <li key={r.key} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1">
                        <PlayerCell player={{ ...r.player, position: r.position }} size={32} short />
                      </span>
                      <span className="w-14 shrink-0 text-right leading-tight">
                        <span className="numeral block text-[15px] font-semibold text-ink">${r.price}</span>
                        <span className="block text-[12px] text-muted">{r.years ? `${r.years} yr` : "—"}</span>
                      </span>
                    </li>
                  ))}
                </ShowMore>
              </Panel>
            );
          })}
        </div>
      ) : active === "spending" ? (
        <SpendingView spend={spend} rows={rows} positions={positions} total={total} myTeamId={myTeamId} />
      ) : (
        <SalesList
          rows={active === "nomination" ? [...rows].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)) : [...rows].sort((a, b) => b.price - a.price || a.player.fullName.localeCompare(b.player.fullName))}
          byNomination={active === "nomination"}
          myTeamId={myTeamId}
        />
      )}
    </>
  );
}

function SalesList({ rows, byNomination, myTeamId }: { rows: AuctionResultRow[]; byNomination: boolean; myTeamId: string | null }) {
  return (
    <>
      {/* phones: rows — # · player · team · price */}
      <ShowMore as="ul" initial={30} moreLabel={`Show all ${rows.length}`} className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card md:hidden" buttonClassName="-mx-3 w-[calc(100%+1.5rem)] bg-panel sm:mx-0 sm:w-full sm:rounded-b-card md:hidden">
        {rows.map((r, i) => {
          const mine = r.team.id === myTeamId;
          return (
            <li key={r.key} className={cn("flex min-h-[64px] items-center gap-2.5 border-b border-line/70 py-2 last:border-b-0", mineRow(mine))}>
              <span className="numeral w-7 shrink-0 text-center text-[13px] font-semibold text-muted">{byNomination ? r.sequence : i + 1}</span>
              <span className="min-w-0 flex-1">
                <PlayerCell player={{ ...r.player, position: r.position }} size={40} short />
              </span>
              <span className="inline-flex w-[58px] shrink-0 items-center gap-1 text-[13px] font-semibold text-ink" title={r.team.name}>
                <TeamLogo team={r.team} size={18} /> <span className="truncate">{r.team.abbrev}</span>
              </span>
              <span className="w-11 shrink-0 text-right leading-tight">
                <span className="numeral block text-[17px] font-semibold text-ink">${r.price}</span>
                <span className="block text-[12px] text-muted">{r.years ? `${r.years} yr` : "—"}</span>
              </span>
            </li>
          );
        })}
      </ShowMore>
      {/* md+: the table */}
      <div className="card hidden md:block">
        <div className="scroll-thin max-h-[75vh] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="num w-10">#</th>
                <th>Player</th>
                <th>Team</th>
                {byNomination && <th className="hidden lg:table-cell">Nominated by</th>}
                <th className="num">Price</th>
                <th className="num">Yrs</th>
                {byNomination && <th>Bids</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={cn(r.team.id === myTeamId && "row-mine")}>
                  <td className="num text-muted">{byNomination ? r.sequence : i + 1}</td>
                  <td className="max-w-[260px]">
                    <PlayerCell player={{ ...r.player, position: r.position }} size={30} />
                  </td>
                  <td className="max-w-[200px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamLogo team={r.team} size={22} />
                      <span className="truncate font-semibold" title={r.team.name}>
                        {r.team.name}
                      </span>
                    </span>
                  </td>
                  {byNomination && <td className="hidden lg:table-cell">{r.nominatedBy?.name ?? "—"}</td>}
                  <td className="num font-semibold">${r.price}</td>
                  <td className="num">{r.years ?? "—"}</td>
                  {byNomination && (
                    <td>
                      {r.bids.length ? (
                        <details>
                          <summary className="inline-flex min-h-8 cursor-pointer items-center text-brand-600 dark:text-brand-400">{r.bids.length} bids</summary>
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
      </div>
    </>
  );
}

function SpendingView({ spend, rows, positions, total, myTeamId }: { spend: ReturnType<typeof spendingByPosition>; rows: AuctionResultRow[]; positions: string[]; total: number; myTeamId: string | null }) {
  const top = Math.max(1, ...spend.map((s) => s.total));
  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted" aria-hidden>
      {positions.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-sm", POS_BAR[p] ?? "bg-zinc-500")} /> {p}
        </span>
      ))}
    </div>
  );
  return (
    <Panel title="Spending by position" subtitle="Dollars won at each position" noPad>
      <div className="px-4 pb-3">{legend}</div>
      {/* phones: one stacked bar per team, tap for the dollars */}
      <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
        {spend.map((s) => {
          const mine = s.team.id === myTeamId;
          return (
            <li key={s.team.id}>
              <details className={cn("group", mine && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]")}>
                <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                  <TeamLogo team={s.team} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-[15px] font-semibold", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")} title={s.team.name}>
                        {s.team.name}
                      </span>
                      <span className="numeral shrink-0 text-[15px] font-semibold text-ink">${s.total}</span>
                    </span>
                    <span className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-ink/[0.06] dark:bg-white/[0.08]" style={{ width: `${Math.max(8, (s.total / top) * 100)}%` }} role="img" aria-label={positions.map((p) => `${p} $${s.byPos[p]?.amount ?? 0}`).join(", ")}>
                      {positions.map((p) =>
                        s.byPos[p] ? <span key={p} className={cn("h-full border-r border-panel last:border-r-0", POS_BAR[p] ?? "bg-zinc-500")} style={{ width: `${(s.byPos[p].amount / s.total) * 100}%` }} /> : null,
                      )}
                    </span>
                  </span>
                </summary>
                <div className="grid grid-cols-3 gap-3 border-t border-line/70 bg-sunken px-4 py-3">
                  {positions.map((p) => (
                    <div key={p} className="min-w-0">
                      <PosPill pos={p} />
                      <div className="numeral mt-1 text-[15px] font-semibold text-ink">{s.byPos[p] ? `$${s.byPos[p].amount}` : "—"}</div>
                      <div className="text-[12px] text-muted">{s.byPos[p] ? `${s.byPos[p].count} player${s.byPos[p].count === 1 ? "" : "s"}` : "none"}</div>
                    </div>
                  ))}
                  <div className="min-w-0">
                    <span className="eyebrow">Total</span>
                    <div className="numeral mt-1 text-[15px] font-semibold text-ink">${s.total}</div>
                    <div className="text-[12px] text-muted">{s.count} players</div>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {/* md+: the table */}
      <div className="scroll-thin hidden overflow-x-auto border-t border-line/70 md:block">
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
              <tr key={s.team.id} className={cn(s.team.id === myTeamId && "row-mine")}>
                <td>
                  <span className="flex items-center gap-2">
                    <TeamLogo team={s.team} size={22} /> <span className="font-semibold">{s.team.name}</span>
                  </span>
                </td>
                {positions.map((p) => (
                  <td key={p} className="num">
                    {s.byPos[p] ? (
                      <>
                        ${s.byPos[p].amount}
                        <span className="text-[12px] text-muted"> ({s.byPos[p].count})</span>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
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
                    <span className="text-[12px] text-muted"> ({v.length})</span>
                  </td>
                );
              })}
              <td className="num">${total}</td>
              <td className="num">{rows.length}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted md:hidden">
        League:{" "}
        {positions
          .map((p) => {
            const v = rows.filter((r) => r.position === p);
            return `${p} $${v.reduce((a, r) => a + r.price, 0)}`;
          })
          .join(" · ")}
      </p>
    </Panel>
  );
}
