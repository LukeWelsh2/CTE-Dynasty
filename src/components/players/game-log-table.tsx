"use client";
// Weekly game log with an expandable league-scoring breakdown per game. Fantasy points lead (visible on phones
// without scrolling); position stat columns follow.
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GameLogRow } from "@/lib/players/profile";
import { STAT_BY_KEY } from "@/lib/settings/stat-catalog";
import { fmtStat, statLabel } from "@/lib/players/logic";
import { cn, fmtPts } from "@/lib/utils";

export function GameLogTable({ rows, columns, totals, games }: { rows: GameLogRow[]; columns: string[]; totals: Record<string, number>; games: number }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (w: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(w)) n.delete(w);
      else n.add(w);
      return n;
    });
  const totalPts = rows.reduce((a, r) => a + (r.pts ?? 0), 0);
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="tbl text-[13px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10">Wk</th>
            <th>Opp</th>
            <th>Result</th>
            <th className="num">FPTS</th>
            <th className="num">Proj</th>
            {columns.map((c) => (
              <th key={c} className="num" title={STAT_BY_KEY[c]?.label}>
                {statLabel(c, STAT_BY_KEY[c])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.week);
            const canExpand = r.breakdown.length > 0;
            const status = r.result ?? (r.bye ? "" : r.state === "in" ? "Live" : r.state === "pre" ? "Upcoming" : r.stats && !r.played ? "Inactive" : r.played ? "" : "—");
            return (
              <Fragment key={r.week}>
                <tr className={cn(!r.played && "text-muted")}>
                  <td className="sticky left-0 z-[5] !bg-panel font-semibold">{r.week}</td>
                  <td className="whitespace-nowrap">{r.bye ? <span className="font-semibold">BYE</span> : (r.opp ?? "—")}</td>
                  <td className={cn("whitespace-nowrap", r.result?.startsWith("W") && "text-win", r.result?.startsWith("L") && "text-loss", r.state === "in" && "font-bold text-live")}>{status}</td>
                  <td className="num">
                    {canExpand ? (
                      <button
                        type="button"
                        onClick={() => toggle(r.week)}
                        aria-expanded={isOpen}
                        aria-label={`Scoring breakdown for week ${r.week}`}
                        className="inline-flex items-center gap-0.5 font-bold text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {fmtPts(r.pts, 2)}
                      </button>
                    ) : (
                      <b>{r.pts === null ? "—" : fmtPts(r.pts, 2)}</b>
                    )}
                  </td>
                  <td className="num text-muted">{fmtPts(r.proj, 1)}</td>
                  {columns.map((c) => (
                    <td key={c} className="num">
                      {r.stats && r.played ? fmtStat(Number(r.stats[c] ?? 0)) : "—"}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={columns.length + 5} className="!bg-sunken/60">
                      <ul className="sticky left-2 grid max-w-[calc(100vw-3rem)] gap-x-6 gap-y-0.5 py-1 text-xs sm:max-w-none sm:grid-cols-2 lg:grid-cols-3">
                        {r.breakdown.map((b) => (
                          <li key={b.key} className="flex justify-between gap-3">
                            <span className="text-muted">
                              {b.label} <span className="tabular-nums">({fmtStat(b.value)})</span>
                            </span>
                            <span className={cn("font-semibold tabular-nums", b.points < 0 && "text-loss")}>
                              {b.points > 0 ? "+" : ""}
                              {b.points.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <td className="sticky left-0 z-[5] bg-panel px-2 py-1.5">Tot</td>
            <td className="px-2 py-1.5 text-xs text-muted" colSpan={2}>
              {games} game{games === 1 ? "" : "s"}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmtPts(totalPts, 2)}</td>
            <td />
            {columns.map((c) => (
              <td key={c} className="num px-2 py-1.5 text-right tabular-nums">
                {fmtStat(totals[c] ?? 0)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
