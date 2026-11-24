// Playoff odds table + seed-distribution heat map (server components).
import type { SnapshotTeamOdds } from "@/lib/sim/playoff-odds";
import type { ClinchStatus } from "@/lib/sim/clinch";
import type { TeamLite } from "@/lib/playoffs/view";
import { cn, fmtPts, record } from "@/lib/utils";
import { MARKER_INFO } from "@/lib/sim/clinch";
import { fmtProb, OddsCell, TeamCell } from "./bits";
import type { PhoneOddsRow } from "./odds-list";

export interface OddsRow {
  team: TeamLite;
  owner: string | null;
  odds: SnapshotTeamOdds;
  prev: SnapshotTeamOdds | null;
  clinch: ClinchStatus | null;
}

// v3: the sticky first column and "my row" tint come from the kit's .tbl-sticky / .row-mine (globals.css)
const sortOdds = (rows: OddsRow[]) =>
  [...rows].sort((a, b) => b.odds.playoffPct - a.odds.playoffPct || b.odds.champPct - a.odds.champPct || (a.odds.avgSeed ?? 99) - (b.odds.avgSeed ?? 99));

/** Serializable rows for the phone list (OddsList): the same columns as OddsTable, in the same order. */
export function phoneOddsRows(rows: OddsRow[], myTeamId: string | null, showDivision: boolean, hasRemaining: boolean, leverageWeek: number | null): PhoneOddsRow[] {
  return sortOdds(rows).map(({ team, owner, odds: o, prev, clinch }) => {
    const pts = (a: number, b: number | undefined) => (b === undefined ? null : Math.round((a - b) * 100) || null);
    const elim = clinch?.playoffs === "eliminated" ? ("eliminated" as const) : null;
    return {
      team: { id: team.id, name: team.name, abbrev: team.abbrev, logoUrl: team.logoUrl, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor },
      owner,
      mine: team.id === myTeamId,
      marker: o.marker ? { code: o.marker, title: MARKER_INFO[o.marker].description } : null,
      record: record(o.wins, o.losses, o.ties),
      projRecord: hasRemaining ? `${o.projWins.toFixed(1)}-${o.projLosses.toFixed(1)}${o.projTies >= 0.05 ? `-${o.projTies.toFixed(1)}` : ""}` : null,
      projPF: fmtPts(o.projPF, 1),
      playoff: fmtProb(o.playoffPct, clinch?.playoffs),
      playoffDelta: prev ? pts(o.playoffPct, prev.playoffPct) : null,
      playoffClinched: clinch?.playoffs === "clinched",
      out: clinch?.playoffs === "eliminated" || o.playoffPct < 0.005,
      bye: fmtProb(o.byePct, clinch?.bye),
      division: showDivision ? fmtProb(o.divisionPct, clinch?.division) : null,
      finals: fmtProb(o.finalsPct, elim),
      title: fmtProb(o.champPct, elim),
      titleDelta: prev ? pts(o.champPct, prev.champPct) : null,
      avgSeed: o.avgSeed === null ? "—" : o.avgSeed.toFixed(1),
      swing: hasRemaining && leverageWeek !== null ? (o.leverage === null || clinch?.playoffs ? "—" : `±${Math.round(Math.abs(o.leverage) * 100)}`) : null,
    };
  });
}

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
  const sorted = sortOdds(rows);
  return (
    <div className="scroll-thin relative overflow-x-auto border-t border-line/70">
      <table className="tbl min-w-[880px] [&_td]:whitespace-nowrap">
        <caption className="sr-only">Playoff odds by team</caption>
        <thead>
          <tr>
            <th className="tbl-sticky min-w-[200px]">Team</th>
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
            const td = (extra?: string) => cn("num", extra);
            return (
              <tr key={team.id} className={cn("group", mine && "row-mine")}>
                <td className="tbl-sticky">
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
        <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-[13px]">
          <caption className="sr-only">Chance of finishing as each playoff seed</caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-panel px-2 py-1 text-left text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Team</th>
              {seeds.map((s) => (
                <th key={s} className={cn("px-1 py-1 text-center text-[12px] font-semibold uppercase tracking-[0.04em]", s <= byes ? "text-ink" : "text-muted")} title={s <= byes ? "Bye seed" : undefined}>
                  #{s}
                  {s <= byes && <span className="block text-[11px] font-medium normal-case tracking-normal text-muted">bye</span>}
                </th>
              ))}
              <th className="px-1 py-1 text-center text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Out</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ team, odds: o }) => {
              const out = Math.max(0, 1 - o.playoffPct);
              const cells = [...seeds.map((s) => ({ key: `#${s}`, p: o.seedDist[s - 1] ?? 0, label: `the #${s} seed` })), { key: "out", p: out, label: "missing the playoffs" }];
              return (
                <tr key={team.id}>
                  <th scope="row" title={team.name} className={cn("sticky left-0 z-[1] max-w-[128px] truncate bg-panel px-2 py-1 text-left text-[13px] font-semibold sm:max-w-[170px]", team.id === myTeamId ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
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
