"use client";
// Head-to-head live scoring (matchup detail) — the canonical "Matchup" pattern (docs/DESIGN.md §6.1), mirroring the
// reference app the league uses: a blue week bar; round logos + records either side of the two big condensed scores
// and a VS badge (projections in grey under each); YET TO PLAY / WIN label rows with a two-part win bar; a segmented
// switch [my team | Matchup | opponent]; side-by-side starter rows (name, position pill + NFL team + injury letter,
// game line · points over projection, mirrored on the right — the slot is implied by the row order). Bench and
// reserve sit below as grey section bars (tap to open). Tap a row's points for its scoring breakdown.
// Live updates: score.update → totals / win probability, player.points → cells (flash), nfl.games → clocks,
// anything structural → throttled router.refresh().
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { PlayerPointsEvent, ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import type { GameLite, MatchupSide, NflGamesEvent, PlayerCell } from "@/lib/live/types";
import { fmtScore, gameStatusLabel } from "@/lib/live/format";
import { LiveDot, TeamLogo } from "@/components/ui/core";
import { LiveNumber, SegmentedControl } from "@/components/ui/client";
import { BarTotal, fmtPoints, H2HPlayerBlock, PointsStack, RosterRow, RosterStat, SectionBar, SlotPill, VsBadge, WeekBanner, type H2HPlayer } from "@/components/ui/fantasy";
import { MatchupHeader } from "@/components/ui/matchup-header";
import { cn } from "@/lib/utils";
import { ordinalShort } from "./bits";
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

/** Every side-by-side row: left player | the two points columns (one button: the scoring breakdown) | right player */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 sm:gap-4";

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
  const [view, setView] = useState<"matchup" | "left" | "right">("matchup");
  // the compact score bar appears only once the header has scrolled away (no duplicate score on screen)
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerGone, setHeaderGone] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeaderGone(!e!.isIntersecting && e!.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
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
  const leftOnBench = (s: MatchupSide) => Math.max(0, Math.round((s.optimalPoints - s.score) * 100) / 100);
  const headerSide = (s: MatchupSide, t: { score: number; projected: number }) => ({
    team: s.team,
    href: s.team.id === props.myTeamId ? "/team" : `/teams/${s.team.id}`,
    record: s.team.record,
    badge: s.seed ?? s.team.rank,
    badgeTitle: s.seed ? `Seed ${s.seed}` : s.team.rank ? `${ordinalShort(s.team.rank)} in the standings` : undefined,
    score: t.score,
    // final: the pre-game projection (the live projection equals the score by then)
    projected: final ? s.projected : t.projected,
    yetToPlay: s.yetToPlay,
    playing: s.inProgress,
    mine: s.team.id === props.myTeamId,
  });
  const adjustments = [left, right].filter((s): s is MatchupSide => !!s && !!s.adjustments);
  const seg = (s: MatchupSide | null, fallback: string) => (
    <span className="block min-w-0 truncate" title={s?.team.name}>
      {s?.team.name ?? fallback}
    </span>
  );

  return (
    <div className="space-y-4">
      {/* ── One white sheet on phones (edge to edge, hairlines only); a card from sm */}
      <section aria-label="Matchup" className="-mx-3 bg-panel px-4 pb-1 pt-3 sm:mx-0 sm:rounded-card sm:px-5 sm:shadow-card">
        <WeekBanner>
          <span>
            Week {m.week}
            {m.label ? ` · ${m.label}` : ""}
          </span>
          {live && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.04em]">
              · <LiveDot className="bg-white" /> Live
            </span>
          )}
          {final && <span className="text-[13px] font-semibold uppercase tracking-[0.04em] opacity-90">· Final</span>}
        </WeekBanner>

        <div ref={headerRef} className="mx-auto mt-4 max-w-[560px]">
          {left && right ? (
            <MatchupHeader
              className={headerFit(totals.left.score, totals.right.score)}
              left={headerSide(left, totals.left)}
              right={headerSide(right, totals.right)}
              leftWinProb={leftWp}
              status={m.status}
              decided={decided}
              winLabel={m.game ? "Game win" : "Win"}
            />
          ) : (
            <p className="py-6 text-center text-[15px] font-semibold text-muted">{(left ?? right)?.team.name ?? "Team"} has a bye this week</p>
          )}
        </div>
        {m.game && left && right && (
          <PlayoffGameLine
            game={m.game}
            sides={leftIsHome ? { homeId: left.team.id, homeName: left.team.name, awayName: right.team.name } : { homeId: right.team.id, homeName: right.team.name, awayName: left.team.name }}
            className="mx-auto mt-3 max-w-[560px] rounded-lg bg-sunken px-3 py-2 text-center text-[13px]"
          />
        )}
        {adjustments.length > 0 && (
          <p className="mt-2 text-center text-[12px] text-muted">
            Includes commissioner adjustments:{" "}
            {adjustments.map((s, i) => (
              <span key={s.team.id} className="numeral font-semibold text-ink">
                {i > 0 ? " · " : ""}
                {s.team.abbrev} {s.adjustments > 0 ? "+" : ""}
                {s.adjustments.toFixed(2)}
              </span>
            ))}
          </p>
        )}

        {left && right && (
          <SegmentedControl<"left" | "matchup" | "right">
            full
            ariaLabel="View"
            // equal thirds; long team names end in "…" instead of scrolling the control
            className="mt-4 [&>.segmented-item]:min-w-0 [&>.segmented-item]:px-2.5"
            value={view}
            onChange={setView}
            options={[
              { value: "left", label: seg(left, "Left"), title: `${left.team.name} lineup` },
              { value: "matchup", label: "Matchup" },
              { value: "right", label: seg(right, "Right"), title: `${right.team.name} lineup` },
            ]}
          />
        )}

        {view === "matchup" || !left || !right ? (
          <div role="list" aria-label="Starting lineups" className="mt-1">
            {Array.from({ length: rowCount }, (_, i) => {
              const l = left?.starters[i];
              const r = right?.starters[i];
              const slot = l ?? r!;
              const key = `s${i}`;
              return <Row key={key} left={l} right={r} slotLabel={slot.slotLabel} expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />;
            })}
          </div>
        ) : (
          <TeamLineup side={view === "left" ? left : right} total={view === "left" ? totals.left : totals.right} final={final} {...cellProps} />
        )}
      </section>

      {/* ── Bench and reserve (Matchup view): grey section bars, open on tap; their totals stay on the bar */}
      {view === "matchup" && left && right && benchCount > 0 && (
        <section aria-label="Bench" className="-mx-3 bg-panel px-4 py-3 sm:mx-0 sm:rounded-card sm:px-5 sm:shadow-card">
          <button type="button" onClick={() => setShowBench((v) => !v)} aria-expanded={showBench} className="block w-full text-left">
            <SectionBar
              as="div"
              title={
                <span className="inline-flex items-center gap-1.5">
                  Bench
                  <ChevronDown size={16} className={cn("text-muted transition-transform duration-200", showBench && "rotate-180")} aria-hidden />
                </span>
              }
              right={upcoming ? <span>{left.bench.length + right.bench.length} players</span> : <BarTotal label="Pts" value={`${fmtScore(left.benchPoints)} · ${fmtScore(right.benchPoints)}`} />}
            />
          </button>
          {showBench && (
            <>
              {!upcoming && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 border-b border-line/70 px-1 py-2.5 text-[13px]">
                  <span className={cn("numeral text-right font-semibold", leftOnBench(left) > 0 ? "text-loss" : "text-win")} title={`Best possible lineup ${fmtScore(left.optimalPoints)}`}>
                    {leftOnBench(left) > 0 ? fmtScore(leftOnBench(left)) : "Optimal"}
                  </span>
                  <span className="eyebrow text-center">Left on bench{final ? "" : " so far"}</span>
                  <span className={cn("numeral font-semibold", leftOnBench(right) > 0 ? "text-loss" : "text-win")} title={`Best possible lineup ${fmtScore(right.optimalPoints)}`}>
                    {leftOnBench(right) > 0 ? fmtScore(leftOnBench(right)) : "Optimal"}
                  </span>
                </div>
              )}
              <div role="list" aria-label="Bench">
                {Array.from({ length: benchCount }, (_, i) => {
                  const key = `b${i}`;
                  return <Row key={key} left={left.bench[i]} right={right.bench[i]} slotLabel="Bench" expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />;
                })}
              </div>
            </>
          )}
          {reserveCount > 0 && (
            <>
              <button type="button" onClick={() => setShowReserve((v) => !v)} aria-expanded={showReserve} className="mt-3 block w-full text-left">
                <SectionBar
                  as="div"
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      IR / Taxi
                      <ChevronDown size={16} className={cn("text-muted transition-transform duration-200", showReserve && "rotate-180")} aria-hidden />
                    </span>
                  }
                  right={<span>{left.reserve.length + right.reserve.length} players</span>}
                />
              </button>
              {showReserve && (
                <div role="list" aria-label="IR and taxi">
                  {Array.from({ length: reserveCount }, (_, i) => {
                    const key = `r${i}`;
                    const l = left.reserve[i];
                    const r = right.reserve[i];
                    return <Row key={key} left={l} right={r} slotLabel={(l ?? r)!.slotLabel} expanded={open.has(key)} onToggle={() => toggle(key)} {...cellProps} />;
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ── Compact score bar: only while the header is off screen */}
      {left && right && headerGone && (
        <div className="bar-top fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] motion-safe:animate-fade-in" aria-hidden>
          <div className="mx-auto flex h-12 max-w-[560px] items-center gap-2 px-4">
            <TeamLogo team={left.team} size={26} round />
            <span className="truncate text-[14px] font-semibold text-ink">{left.team.abbrev}</span>
            <LiveNumber value={totals.left.score} format={(n) => fmtPoints(n)} className="ml-auto font-score text-[24px] font-bold leading-none text-ink" />
            <VsBadge size={22} className="mx-1" />
            <LiveNumber value={totals.right.score} format={(n) => fmtPoints(n)} className="font-score text-[24px] font-bold leading-none text-ink" />
            <span className="ml-auto truncate text-[14px] font-semibold text-ink">{right.team.abbrev}</span>
            <TeamLogo team={right.team} size={26} round />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Phones: the two header scores shrink with the screen so a long score ("154.64") never runs into a logo — sized so
 * the longer of the two fits its column with a few px to spare (40px again from ~420px; capped at 40 everywhere).
 */
function headerFit(a: number, b: number): string | undefined {
  const len = Math.max(fmtPoints(a).length, fmtPoints(b).length);
  if (len >= 6) return "[&_.font-score]:[font-size:min(40px,calc((100vw_-_202px)/5.5))]";
  if (len === 5) return "[&_.font-score]:[font-size:min(40px,calc((100vw_-_202px)/4.5))]";
  return undefined;
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

interface CellCtx {
  games: Record<string, GameLite>;
  tz: string;
  patch: Patch;
}

/** "Sun 1 PM" / "Thu 8:20 PM" in the league timezone (fits a phone's half-row next to the opponent). */
function kickoffShort(start: string | Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).formatToParts(new Date(start));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const min = get("minute");
  return `${get("weekday")} ${get("hour")}${min && min !== "00" ? `:${min}` : ""} ${get("dayPeriod")}`.trim();
}

/** A cell's game line + live state: "Sun 1:00 PM vs MIA" · "Q3 4:21 · 14-10 vs MIA ●" · "26-9 vs MIA (F)" · "BYE". */
function gameInfo(c: PlayerCell, games: Record<string, GameLite>, tz: string): { line: React.ReactNode; started: boolean; playing: boolean } {
  const p = c.player!;
  const g = c.gameId ? (games[c.gameId] ?? null) : null;
  const state = g ? (g.state as PlayerCell["gameState"]) : c.gameState;
  const opp = c.opp && c.opp !== "BYE" ? c.opp : "";
  if (!g || state === "bye") return { line: <span className="font-semibold">BYE</span>, started: false, playing: false };
  if (state === "pre") {
    const when = g.statusDetail && /postponed|delayed|canceled|cancelled/i.test(g.statusDetail) ? g.statusDetail : kickoffShort(g.startTime, tz);
    return { line: `${when}${opp ? ` ${opp}` : ""}`, started: false, playing: false };
  }
  const team = p.nflTeam ?? "";
  const mine = g.homeTeam === team ? g.homeScore : g.awayScore;
  const theirs = g.homeTeam === team ? g.awayScore : g.homeScore;
  if (state === "post") return { line: `${mine}-${theirs}${opp ? ` ${opp}` : ""} (${(g.period ?? 4) > 4 ? "F/OT" : "F"})`, started: true, playing: false };
  const hasBall = g.possession === team;
  return {
    line: (
      <span className="font-semibold text-live">
        {gameStatusLabel(g, tz)} · {mine}-{theirs}
        {opp ? ` ${opp}` : ""}
        {hasBall && (
          <span className="ml-1 text-ink" title="Has the ball" aria-label="has the ball">
            ●
          </span>
        )}
        {hasBall && g.redZone && <span className="ml-1 rounded bg-live/15 px-1 text-[11px] font-bold uppercase text-live">RZ</span>}
      </span>
    ),
    started: true,
    playing: true,
  };
}

function toH2H(c: PlayerCell, games: Record<string, GameLite>, tz: string): { p: H2HPlayer; started: boolean } {
  const pl = c.player!;
  const info = gameInfo(c, games, tz);
  return {
    p: {
      id: pl.id,
      short: shortName(pl),
      name: pl.name,
      position: pl.position,
      nflTeam: pl.nflTeam,
      injury: pl.injuryStatus,
      game: info.line,
      playing: info.playing,
      note: c.autoSubFor ? `Auto-sub for ${c.autoSubFor}` : undefined,
    },
    started: info.started,
  };
}

function CellPoints({ c, align, ctx }: { c?: PlayerCell; align: "left" | "right"; ctx: CellCtx }) {
  if (!c?.player) return <div className="w-14 sm:w-16" />;
  const live = ctx.patch[c.player.id];
  const points = live?.points ?? c.points;
  const { started } = gameInfo(c, ctx.games, ctx.tz);
  const has = started || points !== 0;
  return (
    // wide enough for "21.36" in the condensed numerals (24px on phones, leaving the names and game lines more room;
    // 26px from sm), so the two columns never run into the names
    <div key={live?.at ?? 0} className={cn("w-14 rounded sm:w-16", live && "animate-flash")}>
      <PointsStack
        align={align === "left" ? "right" : "left"}
        points={has ? fmtPoints(points) : "—"}
        dim={!has}
        projected={c.projected.toFixed(1)}
        className="max-sm:[&>span:first-child]:text-[24px] max-sm:[&>span:first-child]:leading-6"
      />
    </div>
  );
}

function Row({ left, right, slotLabel, expanded, onToggle, games, tz, patch }: CellCtx & { left?: PlayerCell; right?: PlayerCell; slotLabel: string; expanded: boolean; onToggle: () => void }) {
  const ctx = { games, tz, patch };
  const hasDetail = !!(left?.player || right?.player);
  const block = (c: PlayerCell | undefined, align: "left" | "right") =>
    c?.player ? <H2HPlayerBlock p={toH2H(c, games, tz).p} align={align} /> : <H2HPlayerBlock p={null} align={align} empty={c ? "Empty" : undefined} />;
  const playing = (c?: PlayerCell) => !!c?.player && gameInfo(c, games, tz).playing;
  return (
    <div role="listitem" className="border-b border-line/70 last:border-b-0">
      <div className={cn(ROW_GRID, "min-h-[76px] items-start", (playing(left) || playing(right)) && "bg-live/[0.03]")}>
        {block(left, "left")}
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasDetail}
          aria-expanded={expanded}
          aria-label={`${slotLabel}: ${expanded ? "hide" : "show"} scoring breakdown`}
          title={`${slotLabel} · scoring breakdown`}
          className={cn("grid grid-cols-2 gap-3 rounded-lg px-0.5 transition-colors hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent sm:gap-6", expanded && "bg-brand-600/[0.06] dark:bg-brand-400/15")}
        >
          <CellPoints c={left} align="left" ctx={ctx} />
          <CellPoints c={right} align="right" ctx={ctx} />
        </button>
        {block(right, "right")}
      </div>
      {expanded && hasDetail && (
        <div className="-mx-4 grid grid-cols-1 gap-3 border-t border-line/70 bg-sunken px-4 py-3 text-[13px] motion-safe:animate-fade-in sm:-mx-5 sm:grid-cols-2 sm:gap-6 sm:px-5">
          <div className="eyebrow sm:col-span-2">{slotLabel}</div>
          <Breakdown c={left} />
          <Breakdown c={right} alignRight />
        </div>
      )}
    </div>
  );
}

/** One team's whole lineup in the Roster-row style (the segmented control's team views). */
function TeamLineup({ side, total, final, games, tz, patch }: CellCtx & { side: MatchupSide; total: { score: number; projected: number }; final: boolean }) {
  const rows = (cells: PlayerCell[], slotOf: (c: PlayerCell) => string) =>
    cells.map((c, i) => {
      const pl = c.player;
      const live = pl ? patch[pl.id] : undefined;
      const points = live?.points ?? c.points;
      const info = pl ? gameInfo(c, games, tz) : null;
      const has = !!info && (info.started || points !== 0);
      return (
        <RosterRow
          key={`${c.slot}-${i}`}
          slot={<SlotPill slot={slotOf(c)} />}
          player={pl ? { id: pl.id, name: pl.name, short: shortName(pl), position: pl.position, nflTeam: pl.nflTeam, injury: pl.injuryStatus } : null}
          href={pl ? `/players/${pl.id}` : undefined}
          opp={info ? <span className="truncate text-muted">{info.line}</span> : undefined}
          stats={
            pl ? (
              <>
                <RosterStat label="Pts" value={has ? fmtPoints(points) : "—"} tone={has ? undefined : "muted"} />
                <RosterStat label="Proj" value={c.projected.toFixed(1)} className="w-12" />
              </>
            ) : undefined
          }
        />
      );
    });
  return (
    <div className="mt-3 space-y-3 pb-3">
      <SectionBar title="Starters" right={<BarTotal label={final ? "Pts" : "Proj"} value={final ? fmtPoints(total.score) : total.projected.toFixed(1)} />} />
      <div role="list" aria-label={`${side.team.name} starters`}>{rows(side.starters, (c) => c.slot)}</div>
      {side.bench.length > 0 && (
        <>
          <SectionBar title="Bench" right={<BarTotal label="Pts" value={fmtPoints(side.benchPoints)} />} />
          <div role="list" aria-label={`${side.team.name} bench`}>{rows(side.bench, () => "BN")}</div>
        </>
      )}
      {side.reserve.length > 0 && (
        <>
          <SectionBar title="IR / Taxi" right={<span>{side.reserve.length}</span>} />
          <div role="list" aria-label={`${side.team.name} IR and taxi`}>{rows(side.reserve, (c) => c.slot)}</div>
        </>
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
