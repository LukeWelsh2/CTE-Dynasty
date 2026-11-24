// Standings tables (server components): overall, by division and all-play.
import { Fragment } from "react";
import type { LeagueSettings } from "@/lib/settings/schema";
import type { StandingRow } from "@/lib/standings";
import type { StandingsView } from "@/lib/playoffs/view";
import { MARKER_INFO } from "@/lib/sim/clinch";
import { cn, fmtPts, record } from "@/lib/utils";
import { fmtProb, LastFive, OddsCell, Streak, TeamCell } from "./bits";
import type { PhoneStandingsRow } from "./standings-list";

// v3: the sticky first column and "my row" tint come from the kit's .tbl-sticky / .row-mine (globals.css)
const stickyTh = "sticky top-0 z-10";
const stickyFirstTh = "tbl-sticky top-0 !z-20";
const stickyFirstTd = "tbl-sticky";
const mineTd = "";

function gb(n: number) {
  if (n <= 0) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function signed(n: number) {
  const v = Math.round(n * 100) / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function divRecord(r: StandingRow) {
  return record(r.divWins, r.divLosses, r.divTies);
}

function CutRow({ colSpan, label, tone }: { colSpan: number; label: string; tone: "playoff" | "bye" }) {
  return (
    <tr aria-hidden className="pointer-events-none">
      <td colSpan={colSpan} className="!border-0 !p-0">
        <div className={cn("relative h-0 border-t", tone === "playoff" ? "border-dashed border-ink/35 dark:border-white/35" : "border-dotted border-ink/30 dark:border-white/30")}>
          <span className="sticky left-3 inline-block -translate-y-1/2 rounded-full bg-panel px-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-muted ring-1 ring-inset ring-line">
            {label}
          </span>
        </div>
      </td>
    </tr>
  );
}

/** Serializable rows for the phone list (StandingsList): the same columns as OverallTable. */
export function phoneStandingsRows(view: StandingsView, settings: LeagueSettings, myTeamId: string | null): PhoneStandingsRow[] {
  const hasDivs = view.standings.some((r) => r.team.division);
  const showAllPlay = settings.standings.showAllPlayRecord !== false;
  const B = view.schedule.plan.byes;
  return view.standings.map((r) => {
    const seed = view.seedOf.get(r.team.id) ?? null;
    const o = view.odds.odds.get(r.team.id);
    const prev = view.odds.previous.get(r.team.id);
    const st = view.clinch.get(r.team.id);
    const ex = view.extras.get(r.team.id);
    const mk = view.markers.get(r.team.id) ?? null;
    const delta = o && prev ? Math.round((o.playoffPct - prev.playoffPct) * 100) : null;
    return {
      team: { id: r.team.id, name: r.team.name, abbrev: r.team.abbrev, logoUrl: r.team.logoUrl, primaryColor: r.team.primaryColor, secondaryColor: r.team.secondaryColor },
      rank: r.rank,
      owner: view.owners.get(r.team.id) ?? null,
      mine: r.team.id === myTeamId,
      marker: mk ? { code: mk, title: MARKER_INFO[mk].description } : null,
      seed,
      byeSeed: !!seed && seed <= B,
      record: record(r.wins, r.losses, r.ties),
      pct: r.pct.toFixed(3).replace(/^0/, ""),
      gb: gb(r.gamesBack),
      div: hasDivs ? divRecord(r) : null,
      pf: fmtPts(r.pointsFor),
      pa: fmtPts(r.pointsAgainst),
      diff: Math.round((r.pointsFor - r.pointsAgainst) * 100) / 100,
      streak: r.streak,
      last5: r.last5,
      allPlay: showAllPlay ? record(r.allPlayWins, r.allPlayLosses, r.allPlayTies) : null,
      median: view.medianGame ? record(r.medianWins, r.medianLosses) : null,
      hiWk: ex?.highWeeks ?? 0,
      avg: fmtPts(ex?.avgPF ?? 0, 1),
      odds: o ? fmtProb(o.playoffPct, st?.playoffs) : null,
      oddsDelta: delta,
      oddsClinched: st?.playoffs === "clinched",
      oddsOut: st?.playoffs === "eliminated",
      tieNote: view.tieNotes.get(r.team.id) ?? null,
    };
  });
}

/** Where the phone list draws its bye / playoff lines (same rule as OverallTable). */
export function standingsCuts(view: StandingsView): { playoffAfter: number | null; byeAfter: number | null } {
  const rows = view.standings;
  const N = view.schedule.plan.teams;
  const B = view.schedule.plan.byes;
  const byesAreTop = rows.slice(0, B).every((r) => (view.seedOf.get(r.team.id) ?? 99) <= B);
  return { playoffAfter: N > 0 && N < rows.length ? N : null, byeAfter: B > 0 && byesAreTop && B < N ? B : null };
}

/** Rank number; when the team is tied in win pct with the next team, a dotted underline + tooltip says why it ranks higher. */
function RankNum({ rank, note, narrow }: { rank: number; note?: string; narrow?: boolean }) {
  return (
    <span
      className={cn("shrink-0 text-right text-[13px] font-semibold tabular-nums text-muted", narrow ? "w-4" : "w-5", note && "cursor-help underline decoration-dotted underline-offset-2")}
      title={note}
      aria-label={note ? `Rank ${rank}. ${note}` : undefined}
    >
      {rank}
    </span>
  );
}

interface TableProps {
  view: StandingsView;
  settings: LeagueSettings;
  myTeamId: string | null;
}

/** League-wide table with playoff cut line, clinch markers and playoff odds. */
export function OverallTable({ view, settings, myTeamId }: TableProps) {
  const rows = view.standings;
  const hasDivs = rows.some((r) => r.team.division);
  const showAllPlay = settings.standings.showAllPlayRecord !== false;
  const hasOdds = view.odds.odds.size > 0;
  const N = view.schedule.plan.teams;
  const B = view.schedule.plan.byes;
  const topN = rows.slice(0, N).map((r) => r.team.id);
  const seedsAreTop = topN.every((id) => view.seedOf.has(id));
  const byesAreTop = rows.slice(0, B).every((r) => (view.seedOf.get(r.team.id) ?? 99) <= B);
  const cols = 11 + (hasDivs ? 1 : 0) + (showAllPlay ? 1 : 0) + (view.medianGame ? 1 : 0) + (hasOdds ? 1 : 0);
  return (
    <div className="card scroll-thin relative max-h-[78vh] overflow-auto">
      <table className="tbl min-w-[860px] [&_td]:whitespace-nowrap">
        <caption className="sr-only">Overall standings</caption>
        <thead>
          <tr>
            <th className={cn(stickyFirstTh, "min-w-[200px]")}>Team</th>
            <th className={cn(stickyTh, "num")}>W-L-T</th>
            <th className={cn(stickyTh, "num")} title="Win percentage">Pct</th>
            <th className={cn(stickyTh, "num")} title="Games behind the leader">GB</th>
            {hasDivs && <th className={cn(stickyTh, "num")} title="Division record">Div</th>}
            <th className={cn(stickyTh, "num")} title="Points for">PF</th>
            <th className={cn(stickyTh, "num")} title="Points against">PA</th>
            <th className={cn(stickyTh, "num")} title="Point differential">Diff</th>
            <th className={stickyTh} title="Current streak">Strk</th>
            <th className={stickyTh}>Last 5</th>
            {showAllPlay && <th className={cn(stickyTh, "num")} title="Record if you played every team every week">All-Play</th>}
            {view.medianGame && <th className={cn(stickyTh, "num")} title="Record against the weekly league median">Median</th>}
            <th className={cn(stickyTh, "num")} title="Weeks with the league's highest score">Hi Wk</th>
            <th className={cn(stickyTh, "num")} title="Average points per game">Avg</th>
            {hasOdds && <th className={cn(stickyTh, "num")} title="Chance to make the playoffs (Monte Carlo)">Playoff %</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const mine = r.team.id === myTeamId;
            const seed = view.seedOf.get(r.team.id) ?? null;
            const o = view.odds.odds.get(r.team.id);
            const prev = view.odds.previous.get(r.team.id);
            const st = view.clinch.get(r.team.id);
            const ex = view.extras.get(r.team.id);
            return (
              <Fragment key={r.team.id}>
                {B > 0 && i === B && byesAreTop && B < N && <CutRow colSpan={cols} label="Bye line" tone="bye" />}
                {i === N && <CutRow colSpan={cols} label={seedsAreTop ? "Playoff line" : "Playoff line · seeds marked #"} tone="playoff" />}
                <tr className={cn("group", mine && "row-mine font-medium")}>
                  <td className={cn(stickyFirstTd, mine && mineTd)}>
                    <span className="flex items-center gap-2">
                      <RankNum rank={r.rank} note={view.tieNotes.get(r.team.id)} />
                      <TeamCell team={r.team} owner={view.owners.get(r.team.id) ?? null} myTeamId={myTeamId} marker={view.markers.get(r.team.id)} seed={seed} byeSeed={!!seed && seed <= B} />
                    </span>
                  </td>
                  <td className={cn("num font-semibold", mine && mineTd)}>{record(r.wins, r.losses, r.ties)}</td>
                  <td className={cn("num", mine && mineTd)}>{r.pct.toFixed(3).replace(/^0/, "")}</td>
                  <td className={cn("num text-muted", mine && mineTd)}>{gb(r.gamesBack)}</td>
                  {hasDivs && <td className={cn("num", mine && mineTd)}>{divRecord(r)}</td>}
                  <td className={cn("num font-semibold", mine && mineTd)}>{fmtPts(r.pointsFor)}</td>
                  <td className={cn("num", mine && mineTd)}>{fmtPts(r.pointsAgainst)}</td>
                  <td className={cn("num", r.pointsFor - r.pointsAgainst >= 0 ? "text-win" : "text-loss", mine && mineTd)}>{signed(r.pointsFor - r.pointsAgainst)}</td>
                  <td className={cn(mine && mineTd)}>
                    <Streak value={r.streak} />
                  </td>
                  <td className={cn(mine && mineTd)}>
                    <LastFive results={r.last5} />
                  </td>
                  {showAllPlay && <td className={cn("num", mine && mineTd)}>{record(r.allPlayWins, r.allPlayLosses, r.allPlayTies)}</td>}
                  {view.medianGame && <td className={cn("num", mine && mineTd)}>{record(r.medianWins, r.medianLosses)}</td>}
                  <td className={cn("num", mine && mineTd)}>{ex?.highWeeks ?? 0}</td>
                  <td className={cn("num", mine && mineTd)}>{fmtPts(ex?.avgPF ?? 0, 1)}</td>
                  {hasOdds && (
                    <td className={cn("num", mine && mineTd)}>
                      <OddsCell p={o?.playoffPct} decided={st?.playoffs} delta={o && prev ? o.playoffPct - prev.playoffPct : null} />
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One table per division with games-behind measured from the division leader. */
export function DivisionTables({ view, settings, myTeamId }: TableProps) {
  const names = new Map(settings.general.divisions.map((d) => [d.id, d.name]));
  const groups = new Map<string, StandingRow[]>();
  for (const r of view.standings) {
    const k = r.team.division ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const order = [...settings.general.divisions.map((d) => d.id).filter((id) => groups.has(id)), ...[...groups.keys()].filter((k) => !names.has(k))];
  const hasOdds = view.odds.odds.size > 0;
  return (
    <div className="grid grid-cols-1 gap-4">
      {order.map((k) => {
        const rows = [...groups.get(k)!].sort((a, b) => a.divisionRank - b.divisionRank);
        const leader = rows[0]!;
        const title = k ? `${names.get(k) ?? k} Division` : "No division";
        return (
          <section key={k || "none"} className="card overflow-hidden" aria-label={title}>
            <header className="flex items-baseline justify-between gap-3 px-4 pb-2.5 pt-3.5">
              <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
              <span className="text-[13px] text-muted">{rows.length} teams</span>
            </header>
            <div className="scroll-thin relative overflow-x-auto">
              <table className="tbl min-w-[620px] [&_td]:whitespace-nowrap">
                <thead>
                  <tr>
                    <th className="tbl-sticky min-w-[190px]">Team</th>
                    <th className="num">W-L-T</th>
                    <th className="num">Pct</th>
                    <th className="num" title="Games behind the division leader">GB</th>
                    <th className="num" title="Division record">Div</th>
                    <th className="num">PF</th>
                    <th className="num">PA</th>
                    <th>Strk</th>
                    <th>Last 5</th>
                    {hasOdds && <th className="num" title="Chance to win the division">Div %</th>}
                    {hasOdds && <th className="num" title="Chance to make the playoffs">Playoff %</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const mine = r.team.id === myTeamId;
                    const o = view.odds.odds.get(r.team.id);
                    const st = view.clinch.get(r.team.id);
                    const back = (leader.wins - r.wins + (r.losses - leader.losses)) / 2;
                    return (
                      <tr key={r.team.id} className={cn("group", mine && "row-mine")}>
                        <td className={cn(stickyFirstTd, mine && mineTd)}>
                          <span className="flex items-center gap-2">
                            <RankNum rank={r.divisionRank} note={view.divisionTieNotes.get(r.team.id)} narrow />
                            <TeamCell team={r.team} owner={view.owners.get(r.team.id) ?? null} myTeamId={myTeamId} marker={view.markers.get(r.team.id)} compact />
                          </span>
                        </td>
                        <td className={cn("num font-semibold", mine && mineTd)}>{record(r.wins, r.losses, r.ties)}</td>
                        <td className={cn("num", mine && mineTd)}>{r.pct.toFixed(3).replace(/^0/, "")}</td>
                        <td className={cn("num text-muted", mine && mineTd)}>{gb(back)}</td>
                        <td className={cn("num", mine && mineTd)}>{divRecord(r)}</td>
                        <td className={cn("num", mine && mineTd)}>{fmtPts(r.pointsFor)}</td>
                        <td className={cn("num", mine && mineTd)}>{fmtPts(r.pointsAgainst)}</td>
                        <td className={cn(mine && mineTd)}>
                          <Streak value={r.streak} />
                        </td>
                        <td className={cn(mine && mineTd)}>
                          <LastFive results={r.last5} />
                        </td>
                        {hasOdds && (
                          <td className={cn("num", mine && mineTd)}>
                            <OddsCell p={o?.divisionPct} decided={st?.division} showBar={false} />
                          </td>
                        )}
                        {hasOdds && (
                          <td className={cn("num", mine && mineTd)}>
                            <OddsCell p={o?.playoffPct} decided={st?.playoffs} showBar={false} />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** All-play ("breakdown") standings: every team vs every team every week, with luck vs the actual record. */
export function AllPlayTable({ view, myTeamId }: Omit<TableProps, "settings">) {
  const rows = [...view.standings]
    .map((r) => {
      const g = r.allPlayWins + r.allPlayLosses + r.allPlayTies;
      const apPct = g ? (r.allPlayWins + r.allPlayTies * 0.5) / g : 0;
      const ex = view.extras.get(r.team.id);
      const games = ex?.games ?? 0;
      const expW = apPct * games;
      return { r, apPct, expW, luck: (ex?.h2hWins ?? 0) + (ex?.h2hTies ?? 0) * 0.5 - expW, games };
    })
    .sort((a, b) => b.apPct - a.apPct || b.r.pointsFor - a.r.pointsFor);
  return (
    <div className="card scroll-thin relative overflow-x-auto">
      <table className="tbl min-w-[760px] [&_td]:whitespace-nowrap">
        <caption className="sr-only">All-play standings</caption>
        <thead>
          <tr>
            <th className="tbl-sticky min-w-[200px]">Team</th>
            <th className="num" title="Record against every team, every week">All-Play</th>
            <th className="num">AP Pct</th>
            <th className="num" title="Actual head-to-head record">Actual</th>
            <th className="num" title="Wins expected from the all-play win rate">Exp. W</th>
            <th className="num" title="Actual head-to-head wins minus expected wins">Luck</th>
            <th className="num">PF</th>
            <th className="num" title="Weeks with the league's highest score">Hi Wk</th>
            <th className="num" title="Weeks with the league's lowest score">Lo Wk</th>
            <th className="num" title="Best single-week score">Best</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, apPct, expW, luck }, i) => {
            const mine = r.team.id === myTeamId;
            const ex = view.extras.get(r.team.id);
            return (
              <tr key={r.team.id} className={cn("group", mine && "row-mine")}>
                <td className={cn(stickyFirstTd, mine && mineTd)}>
                  <span className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-muted">{i + 1}</span>
                    <TeamCell team={r.team} owner={view.owners.get(r.team.id) ?? null} myTeamId={myTeamId} />
                  </span>
                </td>
                <td className={cn("num font-semibold", mine && mineTd)}>{record(r.allPlayWins, r.allPlayLosses, r.allPlayTies)}</td>
                <td className={cn("num", mine && mineTd)}>{apPct.toFixed(3).replace(/^0/, "")}</td>
                <td className={cn("num", mine && mineTd)}>{record(ex?.h2hWins ?? 0, ex?.h2hLosses ?? 0, ex?.h2hTies ?? 0)}</td>
                <td className={cn("num", mine && mineTd)}>{expW.toFixed(1)}</td>
                <td className={cn("num font-semibold", luck >= 0.5 ? "text-win" : luck <= -0.5 ? "text-loss" : "text-muted", mine && mineTd)}>
                  {luck > 0 ? "+" : ""}
                  {luck.toFixed(1)}
                </td>
                <td className={cn("num", mine && mineTd)}>{fmtPts(r.pointsFor)}</td>
                <td className={cn("num", mine && mineTd)}>{ex?.highWeeks ?? 0}</td>
                <td className={cn("num", mine && mineTd)}>{ex?.lowWeeks ?? 0}</td>
                <td className={cn("num", mine && mineTd)}>{fmtPts(ex?.bestWeek ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
