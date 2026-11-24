// Players search results (server component). md+: sortable table with a sticky header + sticky player column.
// Phones: the Roster pattern's rows (docs/DESIGN.md §6.2) — headshot with NFL badge (opens the quick card) · name +
// news icon + red injury letter / position pill + NFL team + fantasy owner / opponent line · two right-aligned stat
// columns (FPTS + projection, or the sorted stat) · the add / claim / drop button — with a sort picker in place of the
// column headers.
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { InjuryTag, PlayerHeadshot } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, OppLine, PosPill, RosterStat } from "@/components/ui/fantasy";
import { PlayerActionButton, WatchStar } from "@/components/players/player-actions";
import { PlayerCardButton } from "@/components/players/player-card";
import { NewsFilterSelect } from "@/components/players/news-filters";
import { GameCell, NewsDot, OwnerTag, shortKickoff } from "@/components/players/tags";
import { playersHref, sortHref, type PlayerFilters } from "@/lib/players/filters";
import { fmtKickoff } from "@/lib/players/format";
import { defaultSortDir, fmtStat, isProjectionTimeframe } from "@/lib/players/logic";
import type { PlayerRow } from "@/lib/players/search";
import { STAT_BY_KEY } from "@/lib/settings/stat-catalog";
import { cn, fmtPts } from "@/lib/utils";

function SortTh({ f, k, children, title, className, num = true }: { f: PlayerFilters; k: string; children: React.ReactNode; title?: string; className?: string; num?: boolean }) {
  const active = f.sort === k;
  return (
    <th className={cn(num && "num", "sticky top-0 z-10", className)} aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : "none"} title={title}>
      <Link href={sortHref(f, k)} scroll={false} className={cn("-my-1 inline-flex min-h-7 items-center gap-0.5 hover:text-ink", active && "text-brand-600 dark:text-brand-400")}>
        {children}
        {active && (f.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </Link>
    </th>
  );
}

type TableProps = { rows: PlayerRow[]; columns: string[]; f: PlayerFilters; fptsLabel: string; tz: string; hasTeam: boolean };

export function PlayersTable(props: TableProps) {
  return (
    <>
      <PlayersList {...props} />
      <div className="hidden md:block">
        <PlayersGrid {...props} />
      </div>
    </>
  );
}

function PlayersGrid({ rows, columns, f, fptsLabel, tz, hasTeam }: TableProps) {
  const proj = isProjectionTimeframe(f.tf);
  return (
    <div className="card scroll-thin max-h-[78vh] overflow-auto">
      <table className="tbl text-[13px]">
        <thead>
          <tr>
            <SortTh f={f} k="name" num={false} className="tbl-sticky left-0 !z-20 min-w-[230px]">
              Player
            </SortTh>
            {hasTeam && <th className="sticky top-0 z-10">Action</th>}
            <SortTh f={f} k="owner" num={false} title="Fantasy owner">
              Owner
            </SortTh>
            <SortTh f={f} k="salary" title="Salary · contract years remaining">
              Contract
            </SortTh>
            <SortTh f={f} k="age">Age</SortTh>
            <SortTh f={f} k="bye">Bye</SortTh>
            <SortTh f={f} k="opp" num={false} title="This week's opponent (sort by kickoff)">
              Opp
            </SortTh>
            <SortTh f={f} k="pts" title={`Fantasy points — ${fptsLabel}`}>
              FPTS
            </SortTh>
            <SortTh f={f} k="avg" title="Average fantasy points per game played">
              Avg
            </SortTh>
            <SortTh f={f} k="proj" title="This week's projected fantasy points">
              Proj
            </SortTh>
            {columns.map((c) => (
              <SortTh key={c} f={f} k={`stat:${c}`} title={STAT_BY_KEY[c]?.label ?? c}>
                {statHeader(c)}
              </SortTh>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mine = r.owner?.isMine;
            return (
              <tr key={r.player.id} className={cn(mine && "row-mine")}>
                <td className="tbl-sticky">
                  <div className="flex items-center gap-1.5">
                    <span className="numeral w-6 shrink-0 text-right text-[12px] text-muted">{r.rank}</span>
                    <WatchStar playerId={r.player.id} watched={r.watched} playerName={r.player.fullName} className="-mx-0.5" />
                    <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                      <PlayerHeadshot player={r.player} size={30} />
                    </PlayerCardButton>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <Link href={`/players/${r.player.id}`} title={r.player.fullName} className="max-w-[150px] truncate font-semibold text-ink hover:underline">
                          {r.player.fullName}
                        </Link>
                        <InjuryTag status={r.injury.status} />
                        <NewsDot playerId={r.player.id} news={r.news} />
                      </div>
                      <div className="flex items-center gap-1 text-[12px] leading-tight text-muted">
                        <PosPill pos={r.player.position} className="h-4 min-w-[24px] text-[11px]" /> {r.player.team ?? "FA"}
                        {r.player.yearsExp === 0 && <span className="font-semibold text-brand-600 dark:text-brand-400">R</span>}
                      </div>
                    </div>
                  </div>
                </td>
                {hasTeam && (
                  <td>
                    <PlayerActionButton
                      playerId={r.player.id}
                      playerName={r.player.fullName}
                      action={r.action}
                      blockedReason={r.blockedReason}
                      pendingClaim={r.pendingClaim}
                      ownerTeamId={r.owner?.teamId}
                    />
                  </td>
                )}
                <td>
                  <OwnerTag owner={r.owner} waiver={r.waiver} />
                </td>
                <td className="num whitespace-nowrap">
                  {r.contract ? (
                    <span title={`$${r.contract.salary} for ${r.contract.years} more season(s)`}>
                      <b className="font-semibold">${r.contract.salary}</b>
                      <span className="text-muted"> · {r.contract.years}y</span>
                      {r.contract.status !== "ACTIVE" && <span className="ml-1 text-[11px] font-bold text-muted">{r.contract.status}</span>}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td className="num">{r.player.age ?? "—"}</td>
                <td className="num">{r.bye ?? "—"}</td>
                <td>
                  <GameCell game={r.game} bye={!!r.player.team && !r.game} kickoffLabel={r.game ? fmtKickoff(r.game.startTime, tz) : null} />
                </td>
                <td className="num font-semibold text-ink">{r.pts === null ? "—" : fmtPts(r.pts, 1)}</td>
                <td className="num">{fmtPts(r.avg, 1)}</td>
                <td className="num">{fmtPts(r.proj, 1)}</td>
                {columns.map((c) => (
                  <td key={c} className="num text-muted">
                    {r.stats[c] === null ? "—" : proj || f.tf === "avg" ? fmtProj(r.stats[c]) : fmtStat(r.stats[c])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function shortName(name: string) {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
}

/** Phone layout: Roster-pattern rows + a sort picker (the table's column headers aren't there to tap) */
function PlayersList({ rows, columns, f, fptsLabel, tz, hasTeam }: TableProps) {
  const proj = isProjectionTimeframe(f.tf);
  const sorts: { value: string; label: string }[] = [
    { value: "pts", label: `FPTS (${fptsLabel})` },
    { value: "avg", label: "Avg per game" },
    { value: "proj", label: "This week's projection" },
    { value: "name", label: "Name" },
    { value: "owner", label: "Fantasy owner" },
    { value: "salary", label: "Contract salary" },
    { value: "age", label: "Age" },
    { value: "bye", label: "Bye week" },
    { value: "opp", label: "Kickoff" },
    ...columns.map((c) => ({ value: `stat:${c}`, label: STAT_BY_KEY[c]?.label ?? statHeader(c) })),
  ];
  if (!sorts.some((o) => o.value === f.sort)) sorts.push({ value: f.sort, label: f.sort.startsWith("stat:") ? (STAT_BY_KEY[f.sort.slice(5)]?.label ?? f.sort) : f.sort === "rank" ? "Rank" : f.sort });
  const hrefs = Object.fromEntries(sorts.map((o) => [o.value, playersHref(f, { sort: o.value, dir: o.value === f.sort ? f.dir : defaultSortDir(o.value) })]));
  // the second number on each row: the sorted stat when sorting by one, else this week's projection
  const extra = (r: PlayerRow): { label: string; value: string } => {
    if (f.sort.startsWith("stat:")) {
      const k = f.sort.slice(5);
      const v = r.stats[k];
      return { label: statHeader(k), value: v === null || v === undefined ? "—" : proj || f.tf === "avg" ? fmtProj(v) : fmtStat(v) };
    }
    if (f.sort === "avg") return { label: "Avg", value: fmtPts(r.avg, 1) };
    if (f.sort === "age") return { label: "Age", value: r.player.age === null ? "—" : String(r.player.age) };
    if (f.sort === "bye") return { label: "Bye", value: r.bye === null ? "—" : String(r.bye) };
    if (f.sort === "salary") return { label: "Sal", value: r.contract ? `$${r.contract.salary}` : "—" };
    return { label: "Proj", value: fmtPts(r.proj, 1) };
  };
  return (
    <div className="md:hidden">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow shrink-0">Sort</span>
        <NewsFilterSelect label="Sort players by" value={f.sort} options={sorts} hrefs={hrefs} />
        <Link
          href={playersHref(f, { dir: f.dir === "asc" ? "desc" : "asc" })}
          scroll={false}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken"
          aria-label={f.dir === "asc" ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}
          title={f.dir === "asc" ? "Ascending" : "Descending"}
        >
          {f.dir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </Link>
      </div>
      {/* one white sheet, edge to edge, hairline rows (the Roster pattern) */}
      <ul className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card">
        {rows.map((r) => {
          const mine = r.owner?.isMine;
          const x = extra(r);
          const g = r.game;
          const when = g ? (g.state === "post" ? (g.result ?? "Final") : g.state === "in" ? (g.statusDetail ?? "Live") : shortKickoff(fmtKickoff(g.startTime, tz))) : null;
          return (
            <li key={r.player.id} className={cn("flex min-h-[76px] items-center gap-2 border-b border-line/70 py-2.5 last:border-b-0", mine && "-mx-3 bg-brand-600/[0.04] px-3 shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}>
              <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                <HeadshotBadge player={r.player} nflTeam={r.player.team} size={44} />
              </PlayerCardButton>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Link href={`/players/${r.player.id}`} title={r.player.fullName} className="truncate text-[15px] font-bold leading-5 text-ink hover:underline">
                    {r.player.position === "DEF" ? r.player.fullName : shortName(r.player.fullName)}
                  </Link>
                  <NewsDot playerId={r.player.id} news={r.news} />
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-ink">
                  <PosPill pos={r.player.position} />
                  {r.player.position !== "DEF" && <span className="shrink-0 font-medium">{r.player.team ?? "FA"}</span>}
                  <InjuryLetter status={r.injury.status} />
                  {r.player.yearsExp === 0 && <span className="shrink-0 font-semibold text-brand-600 dark:text-brand-400" title="Rookie">R</span>}
                  <span className="min-w-0 truncate text-muted">
                    <OwnerTag owner={r.owner} waiver={r.waiver} className="align-middle" />
                  </span>
                </div>
                <div className="mt-1 flex min-w-0 text-[13px] leading-4">
                  {g ? (
                    <OppLine opp={g.label} when={<span className={cn(g.state === "in" && "font-semibold text-live")}>{when}</span>} className="min-w-0" />
                  ) : r.player.team ? (
                    <OppLine opp="BYE" />
                  ) : (
                    <span className="text-muted">No NFL team</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1" title={`FPTS: ${fptsLabel}`}>
                <RosterStat label="FPTS" value={r.pts === null ? "—" : fmtPts(r.pts, 1)} className="w-[52px]" />
                <RosterStat label={x.label} value={x.value} className="w-11" />
              </div>
              {hasTeam && (
                <span className="flex w-10 shrink-0 justify-end">
                  {r.action && (
                    <PlayerActionButton
                      playerId={r.player.id}
                      playerName={r.player.fullName}
                      action={r.action}
                      blockedReason={r.blockedReason}
                      pendingClaim={r.pendingClaim}
                      ownerTeamId={r.owner?.teamId}
                      size="sm"
                      compact
                    />
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function fmtProj(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v === 0 ? "0" : v.toFixed(1);
}

const GROUP_PREFIX: Record<string, string> = { Passing: "Pa", Rushing: "Ru", Receiving: "Re" };
function statHeader(key: string): string {
  const d = STAT_BY_KEY[key];
  if (!d) return key;
  const pre = GROUP_PREFIX[d.group];
  if (pre && !["Tgt", "Rec"].includes(d.short)) return `${pre}${d.short}`;
  return d.short;
}
