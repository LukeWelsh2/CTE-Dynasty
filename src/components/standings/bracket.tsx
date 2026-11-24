// Playoff bracket rendering (server). Phones: `BracketList`, the rounds stacked top to bottom (round heading as a grey
// section bar, each game as a two-line row: seed · logo · team · score / title odds). md+: `BracketBoard`, round
// columns of game cards spaced so later rounds sit between the games that feed them.
import Link from "next/link";
import { LiveDot, TeamLogo } from "@/components/ui/core";
import { SectionBar } from "@/components/ui/fantasy";
import type { BracketGameView, BracketSide, BracketView } from "@/lib/playoffs/view";
import { weekRangeLabel } from "@/lib/playoffs/structure";
import { cn, fmtPts } from "@/lib/utils";
import { fmtProb } from "./bits";

function StatusPill({ status }: { status: BracketGameView["status"] }) {
  const cls = "text-[11px] font-semibold uppercase tracking-[0.04em]";
  if (status === "LIVE")
    return (
      <span className={cn("inline-flex items-center gap-1 text-live", cls)}>
        <LiveDot className="h-1.5 w-1.5" /> Live
      </span>
    );
  if (status === "FINAL") return <span className={cn("text-ink", cls)}>Final</span>;
  if (status === "PROJECTED") return <span className={cn("text-muted", cls)}>Projected</span>;
  return <span className={cn("text-muted", cls)}>Upcoming</span>;
}

/** The right-hand number of a side: score once started, else title odds (projected bracket) or projected points. */
function SideValue({ side, status, advanced, size }: { side: BracketSide; status: BracketGameView["status"]; advanced: boolean; size: "sm" | "md" }) {
  if (status === "FINAL" || status === "LIVE")
    return (
      <span className="shrink-0 text-right">
        <span className={cn("numeral block font-semibold", size === "md" ? "text-[15px] leading-5" : "text-[14px] leading-5", advanced ? "text-ink" : "text-muted")}>{fmtPts(side.score ?? 0)}</span>
        {status === "LIVE" && side.projected !== null && <span className="numeral block text-[12px] leading-4 text-muted">{fmtPts(side.projected, 1)} proj</span>}
      </span>
    );
  if (status === "PROJECTED" && side.champPct !== null)
    return (
      <span className="numeral shrink-0 text-right text-[13px] text-muted" title="Chance to win the title">
        <span className="font-semibold text-ink">{fmtProb(side.champPct)}</span> title
      </span>
    );
  if (side.projected)
    return (
      <span className="numeral shrink-0 text-right text-[13px] text-muted" title="Projected points">
        {fmtPts(side.projected, 1)} proj
      </span>
    );
  return null;
}

function MedianChip({ median }: { median: string }) {
  return (
    <span
      className={cn("shrink-0 rounded px-1 text-[11px] font-semibold uppercase leading-4 ring-1 ring-inset", median === "W" ? "text-win ring-win/40" : median === "L" ? "text-loss ring-loss/40" : "text-muted ring-line")}
      title={`Against the week's league median: ${median}`}
    >
      Med {median}
    </span>
  );
}

function SideRow({ side, status, myTeamId, loserAdvances, size = "sm" }: { side: BracketSide; status: BracketGameView["status"]; myTeamId: string | null; loserAdvances: boolean; size?: "sm" | "md" }) {
  const h = size === "md" ? "h-10" : "h-9";
  if (!side.team) {
    return (
      <div className={cn("flex items-center gap-2 px-3", h)}>
        <span className="w-5 shrink-0" />
        <span className="shrink-0 rounded-full bg-sunken" style={{ width: size === "md" ? 24 : 20, height: size === "md" ? 24 : 20 }} aria-hidden />
        <span className={cn("truncate text-[13px]", side.placeholder === "BYE" ? "font-semibold uppercase tracking-[0.04em] text-muted" : "text-muted")}>{side.placeholder === "BYE" ? "Bye" : (side.placeholder ?? "TBD")}</span>
      </div>
    );
  }
  const mine = side.team.id === myTeamId;
  // in the toilet bowl the loser advances: highlight the team that moves on, dim the one that escapes
  const advanced = loserAdvances ? side.lost : side.won;
  const out = loserAdvances ? side.won : side.lost;
  return (
    <div className={cn("flex items-center gap-2 px-3", h, out && "opacity-60")}>
      <span className="numeral w-5 shrink-0 text-right text-[12px] font-semibold text-muted">{side.seed ?? ""}</span>
      <TeamLogo team={side.team} size={size === "md" ? 24 : 20} />
      <span
        className={cn("min-w-0 flex-1 truncate", size === "md" ? "text-[15px]" : "text-[13px]", advanced ? "font-bold" : "font-semibold", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}
        title={side.team.name}
      >
        {side.team.name}
      </span>
      {side.median && <MedianChip median={side.median} />}
      <SideValue side={side} status={status} advanced={advanced || status === "LIVE"} size={size} />
    </div>
  );
}

/** two-part bar: the home side's chance (blue) vs the away side's (grey) */
function ProbBar({ game }: { game: BracketGameView }) {
  const p = game.home.winProb ?? 0.5;
  return (
    <div className="flex h-1 gap-px" role="img" aria-label={`Win probability ${Math.round(p * 100)}% to ${Math.round((game.away.winProb ?? 1 - p) * 100)}%`}>
      <span className="bg-brand-600 dark:bg-brand-400" style={{ width: `${p * 100}%` }} />
      <span className="flex-1 bg-ink/15 dark:bg-white/20" />
    </div>
  );
}

export function GameCard({ game, myTeamId, loserAdvances = false, className }: { game: BracketGameView; myTeamId: string | null; loserAdvances?: boolean; className?: string }) {
  const showProb = (game.status === "LIVE" || game.status === "UPCOMING") && game.home.team && game.away.team && game.home.winProb !== null;
  const mine = !!myTeamId && (game.home.team?.id === myTeamId || game.away.team?.id === myTeamId);
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-line/70 px-3 py-1">
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">
          {game.bye ? "First-round bye" : weekRangeLabel(game.weeks)}
          {game.weeks.length > 1 && !game.bye ? " · total" : ""}
        </span>
        {!game.bye && <StatusPill status={game.status} />}
      </div>
      <div className="divide-y divide-line/70">
        <SideRow side={game.home} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} />
        <SideRow side={game.away} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} />
      </div>
      {showProb && <ProbBar game={game} />}
    </>
  );
  const cls = cn(
    "relative block w-full overflow-hidden rounded-[10px] bg-panel shadow-card",
    game.status === "LIVE" && "shadow-[inset_3px_0_0_rgb(var(--c-live)),var(--shadow-card)]",
    mine && game.status !== "LIVE" && "shadow-[inset_3px_0_0_rgb(var(--c-accent)),var(--shadow-card)]",
    game.bye && "border border-dashed border-line bg-sunken/50 shadow-none",
    className,
  );
  return game.matchupId ? (
    <Link href={`/scoring/${game.matchupId}`} className={cn(cls, "transition-colors hover:bg-sunken/60")} aria-label={`${game.label}: ${game.home.team?.name ?? "TBD"} vs ${game.away.team?.name ?? "TBD"}`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * md+: round columns; games are spaced so later rounds sit between the games that feed them. The 3rd place game sits
 * under the final, in the column's flow: the final stays centered while there's room below it for the 3rd place card,
 * and moves up rather than overlapping it (a small bracket, or live cards with projections).
 */
export function BracketBoard({ bracket, myTeamId, third }: { bracket: BracketView; myTeamId: string | null; third?: BracketGameView | null }) {
  const rounds = bracket.rounds.filter((r) => r.games.length);
  if (!rounds.length) return <p className="px-4 pb-4 text-[13px] text-muted">Not enough teams for a bracket.</p>;
  // a column with the 3rd place game needs the final plus a 3rd place card (with its heading) above and below the
  // center line: four card heights keep the final centered
  const tallest = Math.max(...rounds.map((r) => r.games.length), third ? 4 : 0);
  const games = (r: (typeof rounds)[number], ri: number) =>
    r.games.map((g) => (
      <div key={g.key} className={cn("relative", ri < rounds.length - 1 && "after:absolute after:left-full after:top-1/2 after:w-6 after:border-t after:border-line")}>
        <GameCard game={g} myTeamId={myTeamId} loserAdvances={bracket.loserAdvances} />
      </div>
    ));
  return (
    <div className="scroll-thin relative overflow-x-auto border-t border-line/70">
      <div className="flex min-w-max snap-x gap-6 p-4" style={{ minHeight: `${tallest * 104 + 32}px` }}>
        {rounds.map((r, ri) => (
          <section key={r.round} className="relative flex w-[264px] shrink-0 snap-start flex-col" aria-label={r.heading}>
            <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
              <h3 className="text-[15px] font-bold text-ink">{r.heading}</h3>
              <span className="text-[12px] text-muted">{weekRangeLabel(r.weeks)}</span>
            </header>
            {third && ri === rounds.length - 1 ? (
              <div className="flex flex-1 flex-col">
                {/* equal-growing spacers above and below center the final; the lower one holds the 3rd place game and
                    never shrinks below it */}
                <div className="min-h-3 flex-1" aria-hidden />
                <div className="flex flex-col gap-3">{games(r, ri)}</div>
                <div className="flex flex-1 flex-col justify-end pt-4">
                  <div className="eyebrow mb-1">3rd place game</div>
                  <GameCard game={third} myTeamId={myTeamId} />
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-around gap-3">{games(r, ri)}</div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/** One game as a list row (phones): week · status on a micro line, then the two sides. */
function GameRow({ game, myTeamId, loserAdvances }: { game: BracketGameView; myTeamId: string | null; loserAdvances: boolean }) {
  const mine = !!myTeamId && (game.home.team?.id === myTeamId || game.away.team?.id === myTeamId);
  const showProb = (game.status === "LIVE" || game.status === "UPCOMING") && game.home.team && game.away.team && game.home.winProb !== null;
  // a first-round bye: one line, the team and "Bye"
  if (game.bye) {
    const side = game.home.team ? game.home : game.away;
    return (
      <div className={cn("flex min-h-12 items-center gap-2 py-1.5 pr-4", mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}>
        <div className="min-w-0 flex-1">
          <SideRow side={side} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} size="md" />
        </div>
        <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[12px] font-semibold text-muted">Bye</span>
      </div>
    );
  }
  // the round bar already names the week(s); a game shows its status once it is set (live / final / upcoming)
  const inner = (
    <>
      {(game.status !== "PROJECTED" || game.weeks.length > 1) && (
        <div className="flex items-center justify-between gap-2 px-3 pt-2">
          <span className="truncate text-[12px] text-muted">{game.weeks.length > 1 ? `${weekRangeLabel(game.weeks)} · total` : ""}</span>
          {game.status !== "PROJECTED" && <StatusPill status={game.status} />}
        </div>
      )}
      <div className="py-1">
        <SideRow side={game.home} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} size="md" />
        <SideRow side={game.away} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} size="md" />
      </div>
      {showProb && <ProbBar game={game} />}
    </>
  );
  const cls = cn(
    "block transition-colors",
    mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]",
    game.status === "LIVE" && "shadow-[inset_3px_0_0_rgb(var(--c-live))]",
  );
  return game.matchupId ? (
    <Link href={`/scoring/${game.matchupId}`} className={cn(cls, "hover:bg-sunken/70 active:bg-sunken")} aria-label={`${game.label}: ${game.home.team?.name ?? "TBD"} vs ${game.away.team?.name ?? "TBD"}`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Phones: the rounds stacked (round bar, then its games as rows); the 3rd place game after the final. */
export function BracketList({ bracket, myTeamId, third }: { bracket: BracketView; myTeamId: string | null; third?: BracketGameView | null }) {
  const rounds = bracket.rounds.filter((r) => r.games.length);
  if (!rounds.length) return <p className="px-4 pb-4 text-[13px] text-muted">Not enough teams for a bracket.</p>;
  return (
    <div className="space-y-3 px-3 pb-3">
      {rounds.map((r, ri) => (
        <section key={r.round} aria-label={r.heading}>
          <SectionBar as="h3" title={r.heading} right={weekRangeLabel(r.weeks)} />
          <div className="divide-y divide-line/70">
            {r.games.map((g) => (
              <GameRow key={g.key} game={g} myTeamId={myTeamId} loserAdvances={bracket.loserAdvances} />
            ))}
            {third && ri === rounds.length - 1 && (
              <div>
                <div className="eyebrow px-3 pt-3">3rd place game</div>
                <GameRow game={third} myTeamId={myTeamId} loserAdvances={false} />
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
