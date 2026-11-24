// Playoff odds table + seed-distribution heat map (server components).
import type { SnapshotTeamOdds } from "@/lib/sim/playoff-odds";
import type { ClinchStatus } from "@/lib/sim/clinch";
import type { TeamLite } from "@/lib/playoffs/view";
import { cn, fmtPts, record } from "@/lib/utils";
import { fmtProb, OddsCell, TeamCell } from "./bits";

export interface OddsRow {
  team: TeamLite;
  owner: string | null;
  odds: SnapshotTeamOdds;
  prev: SnapshotTeamOdds | null;
  clinch: ClinchStatus | null;
}

const stickyTd = "sticky left-0 z-[1] bg-panel group-hover:bg-[#f1f5ff] dark:group-hover:bg-[#13213a]";
const mineTd = "bg-[#fff9e6] dark:bg-[#1d1b12]";

export function OddsTable({
  rows,
  myTeamId,
  showDivision,
  hasRemaining,
  leverageWeek,
}: {
  rows: OddsRow[];
  myTeamId: string | null;
  showDivision: boolean;
  hasRemaining: boolean;
  leverageWeek: number | null;
}) {
  const sorted = [...rows].sort((a, b) => b.odds.playoffPct - a.odds.playoffPct || b.odds.champPct - a.odds.champPct || (a.odds.avgSeed ?? 99) - (b.odds.avgSeed ?? 99));
  return (
    <div className="scroll-thin relative overflow-x-auto">
      <table className="tbl min-w-[880px] [&_td]:whitespace-nowrap">
        <caption className="sr-only">Playoff odds by team</caption>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[200px]">Team</th>
            <th className="num">Record</th>
            {hasRemaining && <th className="num" title="Average final record across simulations">Proj. record</th>}
            <th className="num" title="Average final regular-season points for">Proj. PF</th>
            <th className="num">Playoffs</th>
            <th className="num" title="First-round bye">Bye</th>
            {showDivision && <th className="num" title="Win the division">Division</th>}
            <th className="num" title="Reach the championship">Finals</th>
            <th className="num" title="Win the championship">Title</th>
            <th className="num" title="Average seed when making the playoffs">Avg seed</th>
            {hasRemaining && leverageWeek !== null && (
              <th className="num" title={`Playoff odds if they win in Week ${leverageWeek} minus if they lose`}>
                Wk {leverageWeek} swing
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ team, owner, odds: o, prev, clinch }) => {
            const mine = team.id === myTeamId;
            const td = (extra?: string) => cn("num", mine && mineTd, extra);
            return (
              <tr key={team.id} className="group">
                <td className={cn(stickyTd, mine && mineTd)}>
                  <TeamCell team={team} owner={owner} myTeamId={myTeamId} marker={o.marker} />
                </td>
                <td className={td("font-semibold")}>{record(o.wins, o.losses, o.ties)}</td>
                {hasRemaining && (
                  <td className={td()}>
                    {o.projWins.toFixed(1)}-{o.projLosses.toFixed(1)}
                    {o.projTies >= 0.05 ? `-${o.projTies.toFixed(1)}` : ""}
                  </td>
                )}
                <td className={td()}>{fmtPts(o.projPF, 1)}</td>
                <td className={td()}>
                  <OddsCell p={o.playoffPct} decided={clinch?.playoffs} delta={prev ? o.playoffPct - prev.playoffPct : null} />
                </td>
                <td className={td()}>
                  <OddsCell p={o.byePct} decided={clinch?.bye} showBar={false} />
                </td>
                {showDivision && (
                  <td className={td()}>
                    <OddsCell p={o.divisionPct} decided={clinch?.division} showBar={false} />
                  </td>
                )}
                <td className={td()}>{fmtProb(o.finalsPct, clinch?.playoffs === "eliminated" ? "eliminated" : null)}</td>
                <td className={td("font-semibold")}>
                  <OddsCell p={o.champPct} decided={clinch?.playoffs === "eliminated" ? "eliminated" : null} delta={prev ? o.champPct - prev.champPct : null} showBar={false} />
                </td>
                <td className={td()}>{o.avgSeed === null ? "—" : o.avgSeed.toFixed(1)}</td>
                {hasRemaining && leverageWeek !== null && (
                  <td className={td()}>
                    {o.leverage === null || clinch?.playoffs ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={cn("font-semibold", o.leverage >= 0.2 ? "text-ink" : "text-muted")}>±{Math.round(Math.abs(o.leverage) * 100)}</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Sequential blue ramp (validated reference palette), stepped separately for light and dark surfaces.
const LIGHT = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab"];
const DARK = ["#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef"];

function heat(p: number) {
  const bin = Math.min(9, Math.floor(Math.sqrt(Math.max(0, p)) * 10));
  return {
    "--hl": LIGHT[bin],
    "--hd": DARK[bin],
    "--tl": bin >= 6 ? "#ffffff" : "#0b0b0b",
    "--td": bin >= 7 ? "#0b0b0b" : "#ffffff",
  } as React.CSSProperties;
}

export function SeedHeatmap({ rows, playoffTeams, byes, myTeamId, simulations }: { rows: OddsRow[]; playoffTeams: number; byes: number; myTeamId: string | null; simulations: number }) {
  const sorted = [...rows].sort((a, b) => (a.odds.avgSeed ?? 99) - (b.odds.avgSeed ?? 99) || b.odds.playoffPct - a.odds.playoffPct);
  const seeds = Array.from({ length: playoffTeams }, (_, i) => i + 1);
  return (
    <div>
      <div className="scroll-thin relative overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-[2px] text-xs">
          <caption className="sr-only">Chance of finishing as each playoff seed</caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-panel px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">Team</th>
              {seeds.map((s) => (
                <th key={s} className={cn("px-1 py-1 text-center text-[11px] font-semibold uppercase tracking-wide", s <= byes ? "text-gold-600 dark:text-gold-400" : "text-muted")} title={s <= byes ? "Bye seed" : undefined}>
                  #{s}
                </th>
              ))}
              <th className="px-1 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">Out</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ team, odds: o }) => {
              const out = Math.max(0, 1 - o.playoffPct);
              const cells = [...seeds.map((s) => ({ key: `#${s}`, p: o.seedDist[s - 1] ?? 0, label: `the #${s} seed` })), { key: "out", p: out, label: "missing the playoffs" }];
              return (
                <tr key={team.id}>
                  <th scope="row" className={cn("sticky left-0 z-[1] max-w-[150px] truncate bg-panel px-2 py-1 text-left font-semibold", team.id === myTeamId ? "text-ink" : "text-ink/90")}>
                    {team.name}
                  </th>
                  {cells.map((c) => {
                    const text = c.p >= 1 ? "100" : c.p >= 0.995 ? ">99" : c.p >= 0.005 ? String(Math.round(c.p * 100)) : c.p > 0 ? "<1" : "";
                    return (
                      <td
                        key={c.key}
                        title={`${team.name}: ${fmtProb(c.p)} chance of ${c.label}`}
                        style={c.p > 0 ? heat(c.p) : undefined}
                        className={cn(
                          "h-8 min-w-[40px] rounded-[3px] text-center font-semibold tabular-nums",
                          c.p > 0 ? "bg-[color:var(--hl)] text-[color:var(--tl)] dark:bg-[color:var(--hd)] dark:text-[color:var(--td)]" : "bg-sunken/60 text-muted",
                          c.key === "out" && "border-l-2 border-panel",
                        )}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>Chance (%)</span>
        <span className="inline-flex overflow-hidden rounded" aria-hidden>
          {LIGHT.map((c, i) => (
            <span key={c} className="h-2.5 w-4 bg-[color:var(--hl)] dark:bg-[color:var(--hd)]" style={{ "--hl": c, "--hd": DARK[i] } as React.CSSProperties} />
          ))}
        </span>
        <span>0 → 100 · blank = never in {simulations.toLocaleString()} simulated seasons</span>
      </div>
    </div>
  );
}
