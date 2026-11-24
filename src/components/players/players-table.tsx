// Players search results table (server component). Sticky header + sticky player column; horizontal scroll on phones.
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { InjuryTag, PlayerHeadshot } from "@/components/ui/core";
import { PlayerActionButton, WatchStar } from "@/components/players/player-actions";
import { PlayerCardButton } from "@/components/players/player-card";
import { GameCell, NewsDot, OwnerTag } from "@/components/players/tags";
import { sortHref, type PlayerFilters } from "@/lib/players/filters";
import { fmtKickoff } from "@/lib/players/format";
import { fmtStat, isProjectionTimeframe } from "@/lib/players/logic";
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

export function PlayersTable({ rows, columns, f, fptsLabel, tz, hasTeam }: { rows: PlayerRow[]; columns: string[]; f: PlayerFilters; fptsLabel: string; tz: string; hasTeam: boolean }) {
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
