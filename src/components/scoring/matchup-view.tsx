"use client";
// Head-to-head live scoring (matchup detail, docs/DESIGN.md → Reference screens → Matchup). Summary card (scores or
// projections, win %, head-to-head CompareBars), then starters aligned slot-by-slot (left | slot | right) with
// expandable scoring breakdowns; bench + reserve behind a tap; sticky score bar; live updates:
//   score.update → totals / win probability, player.points → cells (flash), nfl.games → clocks,
//   anything structural → throttled router.refresh().
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { PlayerPointsEvent, ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import type { GameLite, MatchupSide, NflGamesEvent, PlayerCell } from "@/lib/live/types";
import { fmtScore, gameStatusLabel, teamGameScore } from "@/lib/live/format";
import { CompareBar, GameStatus, InjuryTag, LiveDot, Panel, PlayerHeadshot, TeamLogo } from "@/components/ui/core";
import { contrastPair } from "@/components/home/bits";
import { LiveNumber } from "@/components/ui/client";
import { cn } from "@/lib/utils";
import { ordinalShort, WinProbRow } from "./bits";
import { useThrottledRefresh } from "./live-scoreboard";
import { patchGameWeek, PlayoffGameLine, type PlayoffGameContext } from "./playoff-game";

export interface MatchupViewProps {
  leagueId: string;
  tz: string;
  /**
   * `homeWinProb`: the week's own. `game`: a week of a multi-week playoff game — its combined score and week-of-game,
   * with the home team's chance to win the whole game (shown instead of the week's odds)
   */
  matchup: { id: string; week: number; status: string; homeWinProb: number; label: string | null; game?: (PlayoffGameContext & { homeWinProb: number }) | null };
  left: MatchupSide | null;
  right: MatchupSide | null;
  /** left side is the home team */
  leftIsHome: boolean;
  games: Record<string, GameLite>;
  myTeamId: string | null;
}

type Patch = Record<string, { points: number; at: number }>;

/** The three-column grid every lineup row (and the sticky score bar) shares: left | slot | right */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]";

export function MatchupView(props: MatchupViewProps) {
  const { leagueId, tz, leftIsHome } = props;
  const [seen, setSeen] = useState(props);
  const [m, setM] = useState(props.matchup);
  const [totals, setTotals] = useState({ left: sideTotals(props.left), right: sideTotals(props.right) });
  const [games, setGames] = useState(props.games);
  const [patch, setPatch] = useState<Patch>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showReserve, setShowReserve] = useState(false);
  const [showBench, setShowBench] = useState(false);
  if (seen !== props) {
    // fresh server data replaces live patches
    setSeen(props);
    setM(props.matchup);
    setTotals({ left: sideTotals(props.left), right: sideTotals(props.right) });
    setGames(props.games);
    setPatch({});
  }
  const refresh = useThrottledRefresh(12_000);
  const ids = new Set([...(props.left ? allCells(props.left) : []), ...(props.right ? allCells(props.right) : [])].map((c) => c.player?.id).filter(Boolean) as string[]);

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type === "score.update") {
      const u = e.data as ScoreUpdateEvent;
      if (u.matchupId !== m.id) return;
      // for a week of a multi-week playoff game the event carries the whole-game odds (what the server stores); the
      // week's own odds stay as they were until the refresh below reloads them
      setM((x) => ({ ...x, status: u.status, homeWinProb: x.game ? x.homeWinProb : u.homeWinProb, game: x.game ? { ...patchGameWeek(x.game, x.id, u.homeScore, u.awayScore, u.status), homeWinProb: u.homeWinProb } : x.game }));
      setTotals({
        left: { score: leftIsHome ? u.homeScore : u.awayScore, projected: leftIsHome ? u.homeProjected : u.awayProjected },
        right: { score: leftIsHome ? u.awayScore : u.homeScore, projected: leftIsHome ? u.awayProjected : u.homeProjected },
      });
      refresh();
    } else if (e.type === "player.points") {
      const p = e.data as PlayerPointsEvent;
      if (p.week !== m.week || !ids.has(p.playerId)) return;
      setPatch((x) => ({ ...x, [p.playerId]: { points: p.points, at: Date.now() } }));
      refresh();
    } else if (e.type === "nfl.games") {
      const d = e.data as NflGamesEvent;
      if (d.week !== m.week) return;
      setGames((g) => {
        const next = { ...g };
        for (const x of d.games) if (next[x.id]) next[x.id] = x;
        return next;
      });
    } else if (e.type === "scores.refresh") {
      if ((e.data as ScoresRefreshEvent).week === m.week) refresh(true);
    }
  });

  const { left, right } = props;
  const final = m.status === "FINAL";
  const live = m.status === "LIVE";
  const decided = m.game ? m.game.status === "FINAL" : final;
  const homeWp = m.game ? m.game.homeWinProb : m.homeWinProb;
  const leftWp = leftIsHome ? homeWp : 1 - homeWp;
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const rowCount = Math.max(left?.starters.length ?? 0, right?.starters.length ?? 0);
  const benchCount = Math.max(left?.bench.length ?? 0, right?.bench.length ?? 0);
  const reserveCount = Math.max(left?.reserve.length ?? 0, right?.reserve.length ?? 0);
  const cellProps = { games, tz, patch };

  const upcoming = m.status === "UPCOMING";
  const [lc, rc] = left && right ? contrastPair(left.team, right.team) : ["rgb(var(--c-accent))", "rgb(var(--c-ink) / 0.72)"];
  const leftOnBench = (s: MatchupSide) => Math.max(0, Math.round((s.optimalPoints - s.score) * 100) / 100);

  return (
    <div className="space-y-4">
      {/* ── Summary: the two scores (projections before kickoff), win probability, then the head-to-head numbers */}
      <section className="card overflow-hidden" aria-label="Matchup score">
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow min-w-0 truncate">
              Week {m.week}
              {m.label ? ` · ${m.label}` : ""}
            </span>
            {upcoming ? <span className="eyebrow shrink-0">Upcoming</span> : <GameStatus status={m.status} className="shrink-0" />}
          </div>
          <div className="flex items-stretch gap-3 sm:gap-6">
            <HeaderSide side={left} other={totals.right} align="left" score={totals.left} final={final} myTeamId={props.myTeamId} status={m.status} />
            <HeaderSide side={right} other={totals.left} align="right" score={totals.right} final={final} myTeamId={props.myTeamId} status={m.status} />
          </div>
          {m.game && left && right && (
            <PlayoffGameLine
              game={m.game}
              sides={leftIsHome ? { homeId: left.team.id, homeName: left.team.name, awayName: right.team.name } : { homeId: right.team.id, homeName: right.team.name, awayName: left.team.name }}
              className="rounded-lg bg-sunken px-3 py-2 text-[13px]"
            />
          )}
          {left && right && (
            <WinProbRow
              leftProb={leftWp}
              left={left.team}
              right={right.team}
              final={decided}
              size="sm"
              caption={m.game ? (decided ? "Game result" : "Game win %") : undefined}
            />
          )}
        </div>
        {left && right && (
          <div className="divide-y divide-line/70 border-t border-line/70 px-4">
            {!upcoming && (
              <CompareBar label={final ? "Proj was" : "Live proj"} left={final ? left.projected : totals.left.projected} right={final ? right.projected : totals.right.projected} leftColor={lc} rightColor={rc} />
            )}
            {!final && <CompareBar label="Yet to play" left={left.yetToPlay} right={right.yetToPlay} decimals={0} leftColor={lc} rightColor={rc} />}
            {live && <CompareBar label="Playing" left={left.inProgress} right={right.inProgress} decimals={0} leftColor={lc} rightColor={rc} />}
            {!upcoming && !final && <CompareBar label="Done" left={left.done} right={right.done} decimals={0} leftColor={lc} rightColor={rc} />}
            {!upcoming && <CompareBar label="Bench pts" left={left.benchPoints} right={right.benchPoints} decimals={2} leftColor={lc} rightColor={rc} />}
            {!upcoming && (
              <CompareBar
                label="Left on bench"
                left={leftOnBench(left)}
                right={leftOnBench(right)}
                decimals={2}
                lowerIsBetter
                leftColor={lc}
                rightColor={rc}
              />
            )}
          </div>
        )}
      </section>

      {/* ── Sticky compact score bar (solid, sits under the page's top edge while the lineups scroll) */}
      {left && right && (
        <div className="bar-top sticky top-0 z-20 -mx-3 px-3 py-2 sm:mx-0 sm:rounded-card sm:px-0" aria-label="Score">
          <div className={cn(ROW_GRID, "items-center")}>
            <div className="flex min-w-0 items-center gap-2 sm:pl-4">
              <TeamLogo team={left.team} size={24} />
              <span className="truncate text-sm font-semibold text-ink" title={left.team.name}>
                {left.team.abbrev}
              </span>
              <LiveNumber value={upcoming ? totals.left.projected : totals.left.score} decimals={upcoming ? 1 : 2} className={cn("ml-auto text-lg font-semibold", final && totals.left.score < totals.right.score ? "text-muted" : "text-ink")} />
            </div>
            <span className="flex items-center justify-center">
              {live ? <LiveDot /> : <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{final ? "Final" : "Proj"}</span>}
            </span>
            <div className="flex min-w-0 items-center gap-2 sm:pr-4">
              <LiveNumber value={upcoming ? totals.right.projected : totals.right.score} decimals={upcoming ? 1 : 2} className={cn("text-lg font-semibold", final && totals.right.score < totals.left.score ? "text-muted" : "text-ink")} />
              <span className="ml-auto truncate text-sm font-semibold text-ink" title={right.team.name}>
                {right.team.abbrev}
              </span>
              <TeamLogo team={right.team} size={24} />
            </div>
          </div>
        </div>
      )}

      {/* ── Starters: the primary content */}
      <Panel
        title="Starters"
        info={
          <>
            <p>Each row lines up the two starters in the same lineup slot. The big number is points scored; the grey number under it is the projection.</p>
            <p>Tap the position in the middle for that slot&apos;s scoring breakdown (stat line and points per stat).</p>
            <p>A red tint means the player&apos;s game is in progress; ● marks the team with the ball and RZ the red zone.</p>
          </>
        }
        infoTitle="Reading the lineups"
        noPad
      >
        <div role="list" aria-label="Starting lineups" className="border-t border-line/70">
          {Array.from({ length: rowCount }, (_, i) => {
            const l = left?.starters[i];
            const r = right?.starters[i];
            const slot = l ?? r!;
            const key = `s${i}`;
            return <Row key={key} left={l} right={r} slot={slot.slot} slotLabel={slot.slotLabel} expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />;
          })}
        </div>
        {left && right && (
          <div className={cn(ROW_GRID, "items-center border-t border-line/70")}>
            <TotalCell side={left} total={totals.left} align="left" final={final} />
            <span className="text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Total</span>
            <TotalCell side={right} total={totals.right} align="right" final={final} />
          </div>
        )}
      </Panel>

      {/* ── Bench and reserve: behind a tap (their totals are in the summary above) */}
      {benchCount > 0 && (
        <section className="card overflow-hidden" aria-label="Bench">
          <button
            type="button"
            onClick={() => setShowBench((v) => !v)}
            aria-expanded={showBench}
            className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left transition-colors hover:bg-sunken/70"
          >
            <span className="text-[17px] font-bold tracking-[-0.01em] text-ink">
              Bench <span className="text-[13px] font-medium text-muted">{(left?.bench.length ?? 0) + (right?.bench.length ?? 0)} players</span>
            </span>
            <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform duration-200", showBench && "rotate-180")} aria-hidden />
          </button>
          {showBench && (
            <div role="list" aria-label="Bench" className="border-t border-line/70">
              {Array.from({ length: benchCount }, (_, i) => {
                const key = `b${i}`;
                return <Row key={key} left={left?.bench[i]} right={right?.bench[i]} slot="BN" slotLabel="Bench" expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />;
              })}
            </div>
          )}
          {showBench && left && right && m.status !== "UPCOMING" && (
            <div className="grid grid-cols-1 gap-1.5 border-t border-line/70 bg-sunken px-4 py-2.5 text-[13px] sm:grid-cols-2">
              <BenchSummary side={left} final={final} />
              <BenchSummary side={right} final={final} alignRight />
            </div>
          )}
        </section>
      )}

      {reserveCount > 0 && (
        <section className="card overflow-hidden" aria-label="Reserve">
          <button
            type="button"
            onClick={() => setShowReserve((v) => !v)}
            aria-expanded={showReserve}
            className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left transition-colors hover:bg-sunken/70"
          >
            <span className="text-[17px] font-bold tracking-[-0.01em] text-ink">
              Reserve <span className="text-[13px] font-medium text-muted">IR / Taxi · {(left?.reserve.length ?? 0) + (right?.reserve.length ?? 0)}</span>
            </span>
            <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform duration-200", showReserve && "rotate-180")} aria-hidden />
          </button>
          {showReserve && (
            <div role="list" className="border-t border-line/70">
              {Array.from({ length: reserveCount }, (_, i) => {
                const key = `r${i}`;
                const l = left?.reserve[i];
                const r = right?.reserve[i];
                return <Row key={key} left={l} right={r} slot={(l ?? r)!.slot} slotLabel={(l ?? r)!.slotLabel} expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />;
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** "J. Chase" / "GB DEF" for narrow screens */
function shortName(p: NonNullable<PlayerCell["player"]>): string {
  if (p.position === "DEF") return `${p.nflTeam ?? ""} DEF`.trim();
  const parts = p.name.split(/\s+/);
  if (parts.length < 2) return p.name;
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts[parts.length - 1]!) ? parts.pop() : null;
  const last = parts.slice(1).join(" ");
  return `${parts[0]![0]}. ${last}${suffix ? ` ${suffix}` : ""}`;
}

function sideTotals(s: MatchupSide | null) {
  return { score: s?.score ?? 0, projected: s?.liveProjected ?? 0 };
}

function allCells(s: MatchupSide): PlayerCell[] {
  return [...s.starters, ...s.bench, ...s.reserve];
}

function HeaderSide({
  side,
  other,
  align,
  score,
  final,
  myTeamId,
  status,
}: {
  side: MatchupSide | null;
  other: { score: number; projected: number };
  align: "left" | "right";
  score: { score: number; projected: number };
  final: boolean;
  myTeamId: string | null;
  status: string;
}) {
  const right = align === "right";
  if (!side) return <div className={cn("flex-1 text-[15px] font-semibold text-muted", right && "text-right")}>Bye</div>;
  const upcoming = status === "UPCOMING";
  const dim = !upcoming && score.score < other.score;
  const mine = side.team.id === myTeamId;
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-2", right && "items-end text-right")}>
      <TeamLogo team={side.team} size={40} />
      <div className="min-w-0 max-w-full">
        <Link
          href={mine ? "/team" : `/teams/${side.team.id}`}
          title={side.team.name}
          className={cn("line-clamp-2 break-words text-[15px] font-semibold leading-5 hover:underline sm:text-[17px] sm:leading-6", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}
        >
          {side.team.name}
        </Link>
        {/* one truncating line: record · rank · manager(s) */}
        <div className="truncate text-[13px] leading-6 text-muted">
          <span className="numeral">
            {side.seed ? `#${side.seed} · ` : ""}
            {side.team.record}
            {side.team.rank ? ` · ${ordinalShort(side.team.rank)}` : ""}
          </span>
          {side.team.managers.map((mg) => (
            <span key={mg.id}>
              {" · "}
              <Link href={`/managers/${mg.id}`} className="hover:text-ink hover:underline">
                {mg.name}
              </Link>
            </span>
          ))}
        </div>
      </div>
      {/* pinned to the bottom of the (equal-height) side so both scores share a baseline when one name wraps */}
      <div className={cn("mt-auto", right && "text-right")}>
        {upcoming ? (
          <>
            <div className="eyebrow">Proj</div>
            <LiveNumber value={score.projected} decimals={1} className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[52px]" />
          </>
        ) : (
          <>
            <LiveNumber value={score.score} className={cn("text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]", dim ? "text-muted" : "text-ink")} />
            <div className="text-[13px] text-muted">
              {final ? "Proj was" : "Live proj"} <span className="numeral font-semibold text-ink">{fmtScore(!final ? score.projected : side.projected, 1)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TotalCell({ side, total, align, final }: { side: MatchupSide; total: { score: number; projected: number }; align: "left" | "right"; final: boolean }) {
  // final: compare with the pre-game projection (the live projection equals the score by then)
  const proj = final ? side.projected : total.projected;
  const right = align === "right";
  return (
    <div className={cn("flex min-w-0 flex-col px-2 py-2.5 sm:px-4", right ? "items-start" : "items-end")}>
      <LiveNumber value={total.score} className="text-xl font-semibold text-ink" />
      <span className="numeral text-[12px] text-muted">
        {side.adjustments ? `adj ${side.adjustments > 0 ? "+" : ""}${side.adjustments.toFixed(2)} · ` : ""}proj {fmtScore(proj, 1)}
      </span>
    </div>
  );
}

function BenchSummary({ side, final, alignRight }: { side: MatchupSide; final: boolean; alignRight?: boolean }) {
  const left = Math.max(0, Math.round((side.optimalPoints - side.score) * 100) / 100);
  return (
    <div className={cn("text-muted", alignRight && "sm:text-right")}>
      <span className="font-semibold text-ink">{side.team.abbrev}</span> bench <span className="numeral font-semibold text-ink">{fmtScore(side.benchPoints)}</span>
      {" · "}
      {left > 0 ? (
        <span title={`Best possible lineup ${fmtScore(side.optimalPoints)}`}>
          <span className="numeral font-semibold text-loss">{fmtScore(left)}</span> left on bench{final ? "" : " so far"}
        </span>
      ) : (
        <span className="font-medium text-win">optimal lineup{final ? "" : " so far"}</span>
      )}
    </div>
  );
}

interface CellCtx {
  games: Record<string, GameLite>;
  tz: string;
  patch: Patch;
}

function Row({
  left,
  right,
  slot,
  slotLabel,
  expanded,
  onToggle,
  games,
  tz,
  patch,
}: CellCtx & { left?: PlayerCell; right?: PlayerCell; slot: string; slotLabel: string; expanded: boolean; onToggle: () => void }) {
  const hasDetail = !!(left?.player || right?.player);
  return (
    <div role="listitem" className="border-b border-line/70 last:border-b-0">
      <div className={cn(ROW_GRID, "items-stretch")}>
        <Cell c={left} align="left" games={games} tz={tz} patch={patch} />
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasDetail}
          aria-expanded={expanded}
          aria-label={`${slotLabel}: ${expanded ? "hide" : "show"} scoring breakdown`}
          title={slotLabel}
          className={cn(
            "flex min-h-[56px] flex-col items-center justify-center gap-0.5 transition-colors hover:bg-sunken disabled:cursor-default",
            expanded && "bg-brand-600/[0.06] dark:bg-brand-400/15",
          )}
        >
          <span className="text-[12px] font-bold uppercase tracking-[0.02em] text-muted">{slot === "SFLEX" ? "SF" : slot === "FLEX" ? "FLX" : slot}</span>
          {hasDetail && <ChevronDown size={14} className={cn("text-faint transition-transform duration-200", expanded && "rotate-180 text-brand-600")} aria-hidden />}
        </button>
        <Cell c={right} align="right" games={games} tz={tz} patch={patch} />
      </div>
      {expanded && hasDetail && (
        <div className="grid grid-cols-1 gap-3 border-t border-line/70 bg-sunken px-4 py-3 text-[13px] motion-safe:animate-fade-in sm:grid-cols-2 sm:gap-6">
          <Breakdown c={left} />
          <Breakdown c={right} alignRight />
        </div>
      )}
    </div>
  );
}

function Breakdown({ c, alignRight }: { c?: PlayerCell; alignRight?: boolean }) {
  if (!c?.player) return <div className="hidden sm:block" />;
  return (
    <div className={cn("min-w-0", alignRight && "sm:text-right")}>
      <div className={cn("mb-1 flex items-baseline justify-between gap-2", alignRight && "sm:flex-row-reverse")}>
        <span className="truncate font-semibold text-ink">{c.player.name}</span>
        <span className="numeral shrink-0 font-semibold text-ink">{c.points.toFixed(2)}</span>
      </div>
      {c.statLine && <p className="mb-1 text-muted">{c.statLine}</p>}
      {c.breakdown.length ? (
        <table className="w-full text-[13px]">
          <tbody>
            {c.breakdown.map((b) => (
              <tr key={b.label} className="border-b border-line/70 last:border-0">
                <td className="py-1 text-left text-muted">{b.label}</td>
                <td className="py-1 text-right tabular-nums text-muted">{Number.isInteger(b.value) ? b.value : b.value.toFixed(1)}</td>
                <td className={cn("w-16 py-1 text-right font-semibold tabular-nums", b.points < 0 ? "text-loss" : "text-ink")}>
                  {b.points > 0 ? "+" : ""}
                  {b.points.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={cn("flex items-center gap-1 text-muted", alignRight && "sm:justify-end")}>
          <Info size={12} aria-hidden /> No scoring stats yet · projected {c.projected.toFixed(1)}
        </p>
      )}
    </div>
  );
}

function Cell({ c, align, games, tz, patch }: CellCtx & { c?: PlayerCell; align: "left" | "right" }) {
  const right = align === "right";
  if (!c || !c.player) {
    return <div className={cn("flex items-center px-3 py-2.5 text-[13px] font-semibold text-loss", right && "justify-end")}>{c ? "Empty" : ""}</div>;
  }
  const p = c.player;
  const g = c.gameId ? games[c.gameId] ?? null : null;
  const live = patch[p.id];
  const points = live?.points ?? c.points;
  const state = g ? (g.state as PlayerCell["gameState"]) : c.gameState;
  const started = state === "in" || state === "post";
  const playing = state === "in";
  const hasBall = !!g && playing && g.possession === p.nflTeam;
  const status =
    !g || state === "bye" ? (
      <span className="font-semibold">BYE</span>
    ) : state === "pre" ? (
      <span>{gameStatusLabel(g, tz)}</span>
    ) : (
      <span className={cn(playing && "font-semibold text-live")}>
        {gameStatusLabel(g, tz)} {teamGameScore(p.nflTeam!, g)}
        {hasBall && (
          <span className="ml-1 text-ink" title="Has the ball" aria-label="has the ball">
            ●
          </span>
        )}
        {hasBall && g.redZone && <span className="ml-1 rounded bg-live/15 px-1 text-[10px] font-bold uppercase text-live">RZ</span>}
      </span>
    );
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 px-2 py-2 sm:gap-3 sm:px-4", right && "flex-row-reverse", playing && "bg-live/[0.04]")}>
      <PlayerHeadshot player={{ id: p.id, fullName: p.name, position: p.position }} size={36} className="hidden sm:block" />
      <div className={cn("min-w-0 flex-1", right && "text-right")}>
        <div className={cn("flex items-center gap-1", right && "flex-row-reverse")}>
          <Link href={`/players/${p.id}`} className="truncate text-[14px] font-semibold leading-5 text-ink hover:underline sm:text-sm" title={p.name}>
            <span className="sm:hidden">{shortName(p)}</span>
            <span className="hidden sm:inline">{p.name}</span>
          </Link>
          <InjuryTag status={p.injuryStatus} />
        </div>
        <div className="truncate text-[12px] leading-4 text-muted">
          <span className="hidden sm:inline">
            {p.position} · {p.nflTeam ?? "FA"} {c.opp && c.opp !== "BYE" ? `${c.opp} · ` : ""}
          </span>
          {status}
        </div>
        {c.autoSubFor && <div className="truncate text-[12px] font-semibold leading-4 text-brand-600 dark:text-brand-400">Auto-sub for {c.autoSubFor}</div>}
        {c.statLine && <div className="hidden truncate text-[12px] leading-4 text-ink/70 sm:block">{c.statLine}</div>}
      </div>
      <div className={cn("w-[3.25rem] shrink-0 sm:w-14", right ? "text-left" : "text-right")}>
        <div key={live?.at ?? 0} className={cn("rounded px-0.5", live && "animate-flash")}>
          {started || points ? (
            <span className={cn("numeral block text-[17px] font-semibold leading-tight sm:text-lg", started ? "text-ink" : "text-muted")}>{points.toFixed(2)}</span>
          ) : (
            <span className="block text-[17px] font-semibold leading-tight text-faint sm:text-lg" aria-label="No points yet">
              —
            </span>
          )}
        </div>
        <div className="numeral px-0.5 text-[12px] text-muted" title="Projected points">
          {c.projected.toFixed(1)}
        </div>
      </div>
    </div>
  );
}
