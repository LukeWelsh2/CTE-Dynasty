"use client";
// Head-to-head live scoring (matchup detail). Starters aligned slot-by-slot (left | slot | right),
// expandable scoring breakdowns, bench + reserve, sticky score bar, live updates:
//   score.update → totals / win probability, player.points → cells (flash), nfl.games → clocks,
//   anything structural → throttled router.refresh().
import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { PlayerPointsEvent, ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import type { GameLite, MatchupSide, NflGamesEvent, PlayerCell } from "@/lib/live/types";
import { fmtScore, gameStatusLabel, teamGameScore } from "@/lib/live/format";
import { InjuryTag, PlayerHeadshot, PosBadge, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { MatchupStatus, TeamRecord, WinProbBar } from "./bits";
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

export function MatchupView(props: MatchupViewProps) {
  const { leagueId, tz, leftIsHome } = props;
  const [seen, setSeen] = useState(props);
  const [m, setM] = useState(props.matchup);
  const [totals, setTotals] = useState({ left: sideTotals(props.left), right: sideTotals(props.right) });
  const [games, setGames] = useState(props.games);
  const [patch, setPatch] = useState<Patch>({});
  const [flashTotals, setFlashTotals] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
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
      setFlashTotals(Date.now());
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
  const [showReserve, setShowReserve] = useState(false);
  const cellProps = { games, tz, patch };

  return (
    <div>
      {/* ── Scoreboard header */}
      <section className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel" aria-label="Matchup score">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-sunken/60 px-3 py-1.5">
          <MatchupStatus status={m.status} label={m.label} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Week {m.week}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 p-3 sm:gap-4 sm:p-4">
          <HeaderSide side={left} align="left" score={totals.left} flashKey={flashTotals} final={final} other={totals.right} myTeamId={props.myTeamId} status={m.status} />
          <div className="pt-4 text-center font-display text-sm font-bold uppercase text-muted sm:pt-6">vs</div>
          <HeaderSide side={right} align="right" score={totals.right} flashKey={flashTotals} final={final} other={totals.left} myTeamId={props.myTeamId} status={m.status} />
        </div>
        {m.game && left && right && (
          <PlayoffGameLine
            game={m.game}
            sides={leftIsHome ? { homeId: left.team.id, homeName: left.team.name, awayName: right.team.name } : { homeId: right.team.id, homeName: right.team.name, awayName: left.team.name }}
            className="border-t border-line px-3 py-2 text-xs sm:px-4"
          />
        )}
        {left && right && (
          <div className="border-t border-line px-3 py-2.5 sm:px-4">
            <WinProbBar
              leftProb={leftWp}
              leftColor={left.team.primaryColor}
              rightColor={right.team.primaryColor}
              leftLabel={left.team.abbrev}
              rightLabel={right.team.abbrev}
              final={decided}
              caption={m.game ? (decided ? "Game result" : "Game win prob") : undefined}
              size="lg"
            />
          </div>
        )}
      </section>

      {/* ── Sticky compact score bar */}
      {left && right && (
        <div className="sticky top-0 z-20 -mx-3 mt-3 border-y border-line bg-panel/95 px-3 py-1.5 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <TeamLogo team={left.team} size={22} />
              <span className="truncate font-semibold">{left.team.abbrev}</span>
              <span className="ml-auto font-display text-lg font-extrabold tabular-nums">{fmtScore(totals.left.score)}</span>
            </div>
            <span className="w-12 text-center text-[10px] font-bold uppercase tracking-wider text-muted sm:w-16">Slot</span>
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-display text-lg font-extrabold tabular-nums">{fmtScore(totals.right.score)}</span>
              <span className="ml-auto truncate font-semibold">{right.team.abbrev}</span>
              <TeamLogo team={right.team} size={22} />
            </div>
          </div>
        </div>
      )}

      {/* ── Starters */}
      <section className="mt-2 overflow-hidden rounded-lg border border-line bg-panel shadow-panel" aria-label="Starting lineups">
        <SectionLabel>Starters</SectionLabel>
        {Array.from({ length: rowCount }, (_, i) => {
          const l = left?.starters[i];
          const r = right?.starters[i];
          const slot = l ?? r!;
          const key = `s${i}`;
          return (
            <Fragment key={key}>
              <Row left={l} right={r} slot={slot.slot} slotLabel={slot.slotLabel} expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />
            </Fragment>
          );
        })}
        {left && right && (
          <div className="grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] items-center border-t-2 border-line bg-sunken/60 text-sm font-bold sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]">
            <TotalCell side={left} total={totals.left} align="left" final={final} />
            <span className="text-center text-[10px] uppercase tracking-wider text-muted">Total</span>
            <TotalCell side={right} total={totals.right} align="right" final={final} />
          </div>
        )}
      </section>

      {/* ── Bench */}
      {benchCount > 0 && (
        <section className="mt-3 overflow-hidden rounded-lg border border-line bg-panel shadow-panel" aria-label="Bench">
          <SectionLabel>
            <span>Bench</span>
          </SectionLabel>
          {Array.from({ length: benchCount }, (_, i) => {
            const key = `b${i}`;
            return <Row key={key} left={left?.bench[i]} right={right?.bench[i]} slot="BN" slotLabel="BN" expanded={open.has(key)} onToggle={() => toggle(key)} muted {...cellProps} />;
          })}
          {left && right && m.status !== "UPCOMING" && (
            <div className="grid grid-cols-1 gap-2 border-t border-line bg-sunken/60 px-3 py-2 text-xs sm:grid-cols-2">
              <BenchSummary side={left} final={final} />
              <BenchSummary side={right} final={final} alignRight />
            </div>
          )}
        </section>
      )}

      {reserveCount > 0 && (
        <section className="mt-3 overflow-hidden rounded-lg border border-line bg-panel" aria-label="Reserve">
          <button type="button" onClick={() => setShowReserve((v) => !v)} aria-expanded={showReserve} className="flex w-full items-center justify-between bg-sunken/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink">
            <span>Reserve · IR / Taxi ({(left?.reserve.length ?? 0) + (right?.reserve.length ?? 0)})</span>
            <ChevronDown size={14} className={cn("transition-transform", showReserve && "rotate-180")} />
          </button>
          {showReserve &&
            Array.from({ length: reserveCount }, (_, i) => {
              const key = `r${i}`;
              const l = left?.reserve[i];
              const r = right?.reserve[i];
              return <Row key={key} left={l} right={r} slot={(l ?? r)!.slot} slotLabel={(l ?? r)!.slotLabel} expanded={open.has(key)} onToggle={() => toggle(key)} muted {...cellProps} />;
            })}
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between bg-brand-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white dark:bg-brand-950">{children}</div>;
}

function HeaderSide({
  side,
  align,
  score,
  other,
  flashKey,
  final,
  myTeamId,
  status,
}: {
  side: MatchupSide | null;
  align: "left" | "right";
  score: { score: number; projected: number };
  other: { score: number; projected: number };
  flashKey: number;
  final: boolean;
  myTeamId: string | null;
  status: string;
}) {
  if (!side) return <div className={cn("text-sm text-muted", align === "right" && "text-right")}>Bye</div>;
  const right = align === "right";
  const upcoming = status === "UPCOMING";
  const winning = !upcoming && score.score > other.score;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3", right && "items-end sm:flex-row-reverse")}>
      <TeamLogo team={side.team} size={52} className="hidden sm:inline-flex" />
      <TeamLogo team={side.team} size={36} className="sm:hidden" />
      <div className={cn("min-w-0", right && "text-right")}>
        <div className={cn("flex items-center gap-1.5", right && "justify-end")}>
          {side.seed && <span className="text-[11px] font-bold text-muted">#{side.seed}</span>}
          <Link href={`/teams/${side.team.id}`} className={cn("truncate font-display text-base font-bold leading-tight hover:underline sm:text-lg", side.team.id === myTeamId ? "text-brand-700 dark:text-brand-300" : "text-ink")}>
            {side.team.name}
          </Link>
        </div>
        <div className={cn("flex flex-wrap items-center gap-x-2 text-[11px] text-muted", right && "justify-end")}>
          <TeamRecord record={side.team.record} rank={side.team.rank} />
          {side.team.managers.map((mg) => (
            <Link key={mg.id} href={`/managers/${mg.id}`} className="link">
              {mg.name}
            </Link>
          ))}
        </div>
        <div key={flashKey} className={cn("mt-1 inline-block rounded px-1 font-display text-3xl font-extrabold leading-none tabular-nums sm:text-4xl", flashKey && "animate-flash", upcoming ? "text-muted" : winning || final ? "text-ink" : "text-ink/75")}>
          {upcoming ? "0.00" : fmtScore(score.score)}
        </div>
        <div className="mt-1 text-[11px] tabular-nums text-muted">
          {upcoming ? "Projected" : final ? "Projected was" : "Live projected"} <span className="font-semibold text-ink/80">{fmtScore(upcoming || !final ? score.projected : side.projected, 1)}</span>
        </div>
        {!final && (
          <div className={cn("mt-1 flex flex-wrap gap-1 text-[10px] font-semibold uppercase tracking-wide", right && "justify-end")}>
            <span className="rounded bg-sunken px-1.5 py-px text-muted" title="Yet to play">{side.yetToPlay} yet to play</span>
            {!upcoming && (
              <>
                <span className={cn("rounded px-1.5 py-px", side.inProgress ? "bg-live/10 text-live" : "bg-sunken text-muted")} title="In progress">{side.inProgress} playing</span>
                <span className="rounded bg-sunken px-1.5 py-px text-muted" title="Done or bye">{side.done} done</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TotalCell({ side, total, align, final }: { side: MatchupSide; total: { score: number; projected: number }; align: "left" | "right"; final: boolean }) {
  // final: compare with the pre-game projection (the live projection equals the score by then)
  const proj = final ? `proj ${fmtScore(side.projected, 1)}` : `proj ${fmtScore(total.projected, 1)}`;
  return (
    <div className={cn("flex items-baseline gap-2 px-3 py-2", align === "right" ? "flex-row-reverse text-right" : "justify-end")}>
      <span className="font-display text-xl font-extrabold tabular-nums">{fmtScore(total.score)}</span>
      <span className="text-[11px] font-normal tabular-nums text-muted">
        {side.adjustments ? `adj ${side.adjustments > 0 ? "+" : ""}${side.adjustments.toFixed(2)} · ` : ""}
        {proj}
      </span>
    </div>
  );
}

function BenchSummary({ side, final, alignRight }: { side: MatchupSide; final: boolean; alignRight?: boolean }) {
  const left = Math.max(0, Math.round((side.optimalPoints - side.score) * 100) / 100);
  return (
    <div className={cn("text-muted", alignRight && "sm:text-right")}>
      <span className="font-semibold text-ink">{side.team.abbrev}</span> bench <span className="font-semibold tabular-nums text-ink">{fmtScore(side.benchPoints)}</span>
      {" · "}
      {left > 0 ? (
        <span title={`Best possible lineup ${fmtScore(side.optimalPoints)}`}>
          <span className="font-semibold tabular-nums text-loss">{fmtScore(left)}</span> left on bench{final ? "" : " so far"}
        </span>
      ) : (
        <span className="text-win">optimal lineup{final ? "" : " so far"}</span>
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
  muted,
  games,
  tz,
  patch,
}: CellCtx & { left?: PlayerCell; right?: PlayerCell; slot: string; slotLabel: string; expanded: boolean; onToggle: () => void; muted?: boolean }) {
  const hasDetail = !!(left?.player || right?.player);
  return (
    <div className={cn("border-b border-line/70 last:border-b-0", muted && "bg-sunken/20")}>
      <div className="grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] items-stretch sm:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]">
        <Cell c={left} align="left" games={games} tz={tz} patch={patch} />
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasDetail}
          aria-expanded={expanded}
          aria-label={`${slotLabel}: ${expanded ? "hide" : "show"} scoring breakdown`}
          title={slotLabel}
          className="flex flex-col items-center justify-center gap-0.5 border-x border-line/70 bg-sunken/50 py-2 hover:bg-sunken disabled:cursor-default"
        >
          <PosBadge pos={slot} />
          {hasDetail && <ChevronDown size={12} className={cn("text-muted transition-transform", expanded && "rotate-180")} aria-hidden />}
        </button>
        <Cell c={right} align="right" games={games} tz={tz} patch={patch} />
      </div>
      {expanded && hasDetail && (
        <div className="grid grid-cols-1 gap-3 border-t border-line/70 bg-sunken/40 px-3 py-2 text-xs sm:grid-cols-2">
          <Breakdown c={left} />
          <Breakdown c={right} alignRight />
        </div>
      )}
    </div>
  );
}

function Breakdown({ c, alignRight }: { c?: PlayerCell; alignRight?: boolean }) {
  if (!c?.player) return <div />;
  return (
    <div className={cn(alignRight && "sm:text-right")}>
      <div className="mb-1 font-semibold text-ink">{c.player.name}</div>
      {c.breakdown.length ? (
        <table className="w-full text-[11px]">
          <tbody>
            {c.breakdown.map((b) => (
              <tr key={b.label} className="border-b border-line/50 last:border-0">
                <td className="py-0.5 text-muted">{b.label}</td>
                <td className="py-0.5 text-right tabular-nums text-muted">{Number.isInteger(b.value) ? b.value : b.value.toFixed(1)}</td>
                <td className={cn("w-14 py-0.5 text-right font-semibold tabular-nums", b.points < 0 ? "text-loss" : "text-ink")}>{b.points > 0 ? "+" : ""}{b.points.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="flex items-center gap-1 text-muted">
          <Info size={12} aria-hidden /> No scoring stats yet · projected {c.projected.toFixed(1)}
        </p>
      )}
    </div>
  );
}

function Cell({ c, align, games, tz, patch }: CellCtx & { c?: PlayerCell; align: "left" | "right" }) {
  const right = align === "right";
  if (!c || !c.player) {
    return (
      <div className={cn("flex items-center px-3 py-2.5 text-xs italic text-muted", right && "justify-end")}>{c ? "Empty slot" : ""}</div>
    );
  }
  const p = c.player;
  const g = c.gameId ? games[c.gameId] ?? null : null;
  const live = patch[p.id];
  const points = live?.points ?? c.points;
  const state = g ? (g.state as PlayerCell["gameState"]) : c.gameState;
  const started = state === "in" || state === "post";
  const hasBall = !!g && state === "in" && g.possession === p.nflTeam;
  const status =
    !g || state === "bye" ? (
      <span className="font-semibold">BYE</span>
    ) : state === "pre" ? (
      <span>{gameStatusLabel(g, tz)}</span>
    ) : (
      <span className={cn(state === "in" && "font-semibold text-live")}>
        {gameStatusLabel(g, tz)}
        <span className="hidden sm:inline"> ·</span> {teamGameScore(p.nflTeam!, g)}
        {hasBall && (
          <span className="ml-1 text-gold-600 dark:text-gold-400" title="Has the ball">
            ●
          </span>
        )}
        {hasBall && g.redZone && <span className="ml-1 rounded bg-live/15 px-1 text-[9px] font-bold uppercase text-live">RZ</span>}
      </span>
    );
  return (
    <div className={cn("flex min-w-0 items-center gap-2 px-2 py-2 sm:gap-2.5 sm:px-3", right && "flex-row-reverse")}>
      <PlayerHeadshot player={{ id: p.id, fullName: p.name, position: p.position }} size={34} className="hidden sm:block" />
      <div className={cn("min-w-0 flex-1", right && "text-right")}>
        <div className={cn("flex items-center gap-1", right && "flex-row-reverse")}>
          <Link href={`/players/${p.id}`} className="truncate text-[13px] font-semibold text-brand-700 hover:underline dark:text-brand-300" title={p.name}>
            <span className="sm:hidden">{shortName(p)}</span>
            <span className="hidden sm:inline">{p.name}</span>
          </Link>
          <InjuryTag status={p.injuryStatus} />
        </div>
        <div className="truncate text-[11px] leading-tight text-muted">
          <span className="hidden sm:inline">
            {p.position} · {p.nflTeam ?? "FA"} {c.opp && c.opp !== "BYE" ? `${c.opp} · ` : ""}
          </span>
          {status}
        </div>
        {c.autoSubFor && <div className="truncate text-[11px] font-semibold leading-tight text-brand-600 dark:text-brand-300">Auto-sub for {c.autoSubFor}</div>}
        {c.statLine && <div className="hidden truncate text-[11px] leading-tight text-ink/70 sm:block">{c.statLine}</div>}
      </div>
      <div className={cn("w-12 shrink-0 sm:w-14", right ? "text-left" : "text-right")}>
        <div key={live?.at ?? 0} className={cn("rounded px-0.5 font-display text-base font-bold leading-tight tabular-nums sm:text-lg", live && "animate-flash", !started && "text-muted")}>
          {started || points ? points.toFixed(2) : "—"}
        </div>
        <div className="text-[10px] tabular-nums text-muted" title="Projected">
          {c.projected.toFixed(1)}
        </div>
      </div>
    </div>
  );
}
