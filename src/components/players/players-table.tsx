// Players search results (server component). md+: sortable table with a sticky header + sticky player column.
// Phones: a stacked list (name, game, owner, the key numbers and the add / claim / drop button visible without
// sideways scrolling) with a sort picker in place of the column headers.
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { InjuryTag, PlayerHeadshot } from "@/components/ui/core";
import { PlayerActionButton, WatchStar } from "@/components/players/player-actions";
import { PlayerCardButton } from "@/components/players/player-card";
import { NewsFilterSelect } from "@/components/players/news-filters";
import { GameCell, NewsDot, OwnerTag } from "@/components/players/tags";
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
      <Link href={sortHref(f, k)} scroll={false} className={cn("inline-flex items-center gap-0.5 hover:text-ink", active && "text-ink")}>
        {children}
        {active && (f.dir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
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
    <div className="scroll-thin max-h-[78vh] overflow-auto rounded-lg border border-line bg-panel shadow-panel">
      <table className="tbl text-[13px]">
        <thead>
          <tr>
            <SortTh f={f} k="name" num={false} className="left-0 z-20 min-w-[220px] border-r border-line">
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
            <SortTh f={f} k="pts" title={`Fantasy points — ${fptsLabel}`} className="bg-brand-50 dark:bg-brand-950">
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
              <tr key={r.player.id} className={cn(mine && "[&>td:not(:first-child)]:bg-gold-300/10")}>
                <td
                  className={cn(
                    "sticky left-0 z-[5] border-r border-line !bg-panel",
                    mine && "shadow-[inset_3px_0_0_0_theme(colors.gold.500)] [background-image:linear-gradient(rgb(255_214_102/0.14),rgb(255_214_102/0.14))]",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-muted">{r.rank}</span>
                    <WatchStar playerId={r.player.id} watched={r.watched} playerName={r.player.fullName} className="-mx-0.5" />
                    <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                      <PlayerHeadshot player={r.player} size={30} />
                    </PlayerCardButton>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <Link href={`/players/${r.player.id}`} className="max-w-[150px] truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                          {r.player.fullName}
                        </Link>
                        <InjuryTag status={r.injury.status} />
                        <NewsDot playerId={r.player.id} news={r.news} />
                      </div>
                      <div className="text-[11px] leading-tight text-muted">
                        {r.player.position} · {r.player.team ?? "FA"}
                        {r.player.yearsExp === 0 && <span className="ml-1 font-bold text-gold-600 dark:text-gold-400">R</span>}
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
                      <b>${r.contract.salary}</b>
                      <span className="text-muted"> · {r.contract.years}y</span>
                      {r.contract.status !== "ACTIVE" && <span className="ml-1 text-[10px] font-bold text-muted">{r.contract.status}</span>}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="num">{r.player.age ?? "—"}</td>
                <td className="num">{r.bye ?? "—"}</td>
                <td>
                  <GameCell game={r.game} bye={!!r.player.team && !r.game} kickoffLabel={r.game ? fmtKickoff(r.game.startTime, tz) : null} />
                </td>
                <td className="num bg-brand-50/50 font-bold dark:bg-brand-900/20">{r.pts === null ? "—" : fmtPts(r.pts, 1)}</td>
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

/** Phone layout: one stacked row per player + a sort picker (the table's column headers aren't there to tap) */
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
  // the third number on each row: the sorted stat when sorting by one, else this week's projection
  const extra = (r: PlayerRow): { label: string; value: string } => {
    if (f.sort.startsWith("stat:")) {
      const k = f.sort.slice(5);
      const v = r.stats[k];
      return { label: statHeader(k), value: v === null || v === undefined ? "—" : proj || f.tf === "avg" ? fmtProj(v) : fmtStat(v) };
    }
    if (f.sort === "age") return { label: "age", value: r.player.age === null ? "—" : String(r.player.age) };
    if (f.sort === "bye") return { label: "bye", value: r.bye === null ? "—" : String(r.bye) };
    return { label: "proj", value: fmtPts(r.proj, 1) };
  };
  return (
    <div className="md:hidden">
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Sort</span>
        <NewsFilterSelect label="Sort players by" value={f.sort} options={sorts} hrefs={hrefs} />
        <Link
          href={playersHref(f, { dir: f.dir === "asc" ? "desc" : "asc" })}
          scroll={false}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-ink hover:bg-sunken"
          aria-label={f.dir === "asc" ? "Sorted ascending, switch to descending" : "Sorted descending, switch to ascending"}
          title={f.dir === "asc" ? "Ascending" : "Descending"}
        >
          {f.dir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </Link>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
        {rows.map((r) => {
          const mine = r.owner?.isMine;
          const x = extra(r);
          const kickoff = r.game ? (r.game.state === "post" ? (r.game.result ?? "Final") : r.game.state === "in" ? (r.game.statusDetail ?? "Live") : fmtKickoff(r.game.startTime, tz)) : null;
          return (
            <li key={r.player.id} className={cn("flex items-center gap-1.5 py-2 pl-0.5 pr-2", mine && "bg-gold-300/10 shadow-[inset_3px_0_0_0_theme(colors.gold.500)]")}>
              <WatchStar playerId={r.player.id} watched={r.watched} playerName={r.player.fullName} className="h-10 w-8" />
              <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                <PlayerHeadshot player={r.player} size={36} />
              </PlayerCardButton>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <Link href={`/players/${r.player.id}`} title={r.player.fullName} className="truncate text-[15px] font-semibold leading-tight text-brand-700 hover:underline dark:text-brand-300">
                    {r.player.fullName}
                  </Link>
                  <InjuryTag status={r.injury.status} />
                  <NewsDot playerId={r.player.id} news={r.news} className="-my-1.5" />
                </div>
                <div className="truncate text-xs leading-snug text-muted">
                  <b className="font-semibold">{r.player.position}</b> · {r.player.team ?? "FA"}
                  {r.player.yearsExp === 0 && <span className="ml-1 font-bold text-gold-600 dark:text-gold-400">R</span>}
                  {r.game ? (
                    <span className={cn(r.game.state === "in" && "font-semibold text-live")}>
                      {" "}
                      · {r.game.label} {kickoff}
                    </span>
                  ) : r.player.team ? (
                    <span className="font-semibold"> · BYE</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                  <OwnerTag owner={r.owner} waiver={r.waiver} className="min-w-0 shrink" />
                  {r.contract && (
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-muted" title={`$${r.contract.salary} for ${r.contract.years} more season(s)`}>
                      <b className="text-ink">${r.contract.salary}</b> · {r.contract.years}y{r.contract.status !== "ACTIVE" ? ` · ${r.contract.status}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right leading-tight" title={`FPTS: ${fptsLabel}`}>
                <div className="font-display text-base font-bold tabular-nums">{r.pts === null ? "—" : fmtPts(r.pts, 1)}</div>
                <div className="whitespace-nowrap text-[11px] tabular-nums text-muted">{fmtPts(r.avg, 1)} avg</div>
                <div className="whitespace-nowrap text-[11px] tabular-nums text-muted">
                  {x.value} {x.label}
                </div>
              </div>
              {hasTeam && r.action && (
                <PlayerActionButton
                  playerId={r.player.id}
                  playerName={r.player.fullName}
                  action={r.action}
                  blockedReason={r.blockedReason}
                  pendingClaim={r.pendingClaim}
                  ownerTeamId={r.owner?.teamId}
                  size="sm"
                  compact
                  className="shrink-0"
                />
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
