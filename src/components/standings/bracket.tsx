// Playoff bracket rendering (server): round columns of matchup cards with live scores, byes and placeholders.
import Link from "next/link";
import { LiveDot, TeamLogo } from "@/components/ui/core";
import type { BracketGameView, BracketSide, BracketView } from "@/lib/playoffs/view";
import { weekRangeLabel } from "@/lib/playoffs/structure";
import { cn, fmtPts } from "@/lib/utils";
import { fmtProb } from "./bits";

function StatusPill({ status }: { status: BracketGameView["status"] }) {
  if (status === "LIVE")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-live">
        <LiveDot /> Live
      </span>
    );
  if (status === "FINAL") return <span className="text-[10px] font-bold uppercase tracking-wide text-ink">Final</span>;
  if (status === "PROJECTED") return <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Projected</span>;
  return <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Upcoming</span>;
}

function SideRow({ side, status, myTeamId, loserAdvances }: { side: BracketSide; status: BracketGameView["status"]; myTeamId: string | null; loserAdvances: boolean }) {
  if (!side.team) {
    return (
      <div className="flex h-9 items-center gap-2 px-2">
        <span className="w-4" />
        <span className={cn("truncate text-xs", side.placeholder === "BYE" ? "font-bold uppercase tracking-wider text-muted/80" : "italic text-muted")}>{side.placeholder ?? "TBD"}</span>
      </div>
    );
  }
  const mine = side.team.id === myTeamId;
  // in the toilet bowl the loser advances: highlight the team that moves on, dim the one that escapes
  const advanced = loserAdvances ? side.lost : side.won;
  const out = loserAdvances ? side.won : side.lost;
  return (
    <div className={cn("flex h-9 items-center gap-2 px-2", mine && "bg-gold-300/15", out && "opacity-60")}>
      <span className="w-4 text-right text-[10px] font-bold tabular-nums text-muted">{side.seed ?? ""}</span>
      <TeamLogo team={side.team} size={20} />
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", advanced ? "font-bold text-ink" : "font-medium", mine && "text-ink")} title={side.team.name}>
        {side.team.name}
      </span>
      {side.median && (
        <span
          className={cn(
            "shrink-0 rounded px-1 text-[9px] font-bold uppercase leading-4 ring-1",
            side.median === "W" ? "text-win ring-win/40" : side.median === "L" ? "text-loss ring-loss/40" : "text-muted ring-line",
          )}
          title={`Against the week's league median: ${side.median}`}
        >
          Med {side.median}
        </span>
      )}
      <span className="shrink-0 text-right">
        {status === "FINAL" || status === "LIVE" ? (
          <span className={cn("block text-sm font-bold tabular-nums", advanced ? "text-ink" : "text-muted")}>{fmtPts(side.score ?? 0)}</span>
        ) : status === "PROJECTED" && side.champPct !== null ? (
          <span className="block text-[11px] tabular-nums text-muted" title="Chance to win the title">
            {fmtProb(side.champPct)} title
          </span>
        ) : side.projected ? (
          <span className="block text-[11px] tabular-nums text-muted" title="Projected points">
            {fmtPts(side.projected, 1)} proj
          </span>
        ) : null}
        {status === "LIVE" && side.projected !== null && <span className="block text-[10px] tabular-nums text-muted">{fmtPts(side.projected, 1)} proj</span>}
      </span>
    </div>
  );
}

export function GameCard({ game, myTeamId, loserAdvances = false, className }: { game: BracketGameView; myTeamId: string | null; loserAdvances?: boolean; className?: string }) {
  const showProb = (game.status === "LIVE" || game.status === "UPCOMING") && game.home.team && game.away.team && game.home.winProb !== null;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-sunken/70 px-2 py-1">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
          {game.bye ? "First-round bye" : weekRangeLabel(game.weeks)}
          {game.weeks.length > 1 && !game.bye ? " · total" : ""}
        </span>
        {!game.bye && <StatusPill status={game.status} />}
      </div>
      <div className="divide-y divide-line/70">
        <SideRow side={game.home} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} />
        <SideRow side={game.away} status={game.status} myTeamId={myTeamId} loserAdvances={loserAdvances} />
      </div>
      {showProb && (
        <div className="flex h-1" aria-label={`Win probability ${Math.round((game.home.winProb ?? 0.5) * 100)}% to ${Math.round((game.away.winProb ?? 0.5) * 100)}%`}>
          <span className="bg-brand-600" style={{ width: `${(game.home.winProb ?? 0.5) * 100}%` }} />
          <span className="flex-1 bg-gold-500" />
        </div>
      )}
    </>
  );
  const cls = cn(
    "relative block w-full overflow-hidden rounded-md border bg-panel shadow-panel",
    game.status === "LIVE" ? "border-live/60" : "border-line",
    game.bye && "border-dashed bg-panel/70",
    className,
  );
  return game.matchupId ? (
    <Link href={`/scoring/${game.matchupId}`} className={cn(cls, "transition-colors hover:border-brand-300 dark:hover:border-brand-700")} aria-label={`${game.label}: ${game.home.team?.name ?? "TBD"} vs ${game.away.team?.name ?? "TBD"}`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Round columns; games are spaced so later rounds sit between the games that feed them. */
export function BracketBoard({ bracket, myTeamId, third }: { bracket: BracketView; myTeamId: string | null; third?: BracketGameView | null }) {
  const rounds = bracket.rounds.filter((r) => r.games.length);
  if (!rounds.length) return <p className="p-3 text-sm text-muted">Not enough teams for a bracket.</p>;
  const tallest = Math.max(...rounds.map((r) => r.games.length), third ? 3 : 0);
  return (
    <div className="scroll-thin relative overflow-x-auto">
      <div className="flex min-w-max snap-x gap-4 p-3 sm:gap-6" style={{ minHeight: `${tallest * 104 + 32}px` }}>
        {rounds.map((r, ri) => (
          <section key={r.round} className="relative flex w-[232px] shrink-0 snap-start flex-col sm:w-[264px]" aria-label={r.heading}>
            <header className="mb-2 flex items-baseline justify-between gap-2 border-b-2 border-gold-500 pb-1">
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">{r.heading}</h3>
              <span className="text-[11px] text-muted">{weekRangeLabel(r.weeks)}</span>
            </header>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {r.games.map((g) => (
                <div key={g.key} className={cn("relative", ri < rounds.length - 1 && "after:absolute after:left-full after:top-1/2 after:hidden after:w-4 after:border-t after:border-line sm:after:block sm:after:w-6")}>
                  <GameCard game={g} myTeamId={myTeamId} loserAdvances={bracket.loserAdvances} />
                </div>
              ))}
            </div>
            {third && ri === rounds.length - 1 && (
              <div className="absolute inset-x-0 bottom-0">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">3rd place game</div>
                <GameCard game={third} myTeamId={myTeamId} />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
