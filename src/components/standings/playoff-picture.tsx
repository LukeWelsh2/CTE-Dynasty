// "If the season ended today": seeds, byes and first-round games from the current standings.
import { MoreLink, Panel, TeamLogo } from "@/components/ui/core";
import { bracketPlan, roundPairings } from "@/lib/playoffs/structure";
import type { StandingsView } from "@/lib/playoffs/view";
import { cn, record } from "@/lib/utils";
import { fmtProb } from "./bits";

export function PlayoffPicture({ view, myTeamId, title = "Playoff picture" }: { view: StandingsView; myTeamId: string | null; title?: string }) {
  const byId = new Map(view.standings.map((r) => [r.team.id, r]));
  const plan = bracketPlan(view.seeds.length);
  const r1 = roundPairings(plan, 1, false, new Map()) ?? [];
  const team = (seed: number) => byId.get(view.seeds[seed - 1] ?? "");
  const byes = r1.filter((p) => p.away === null && p.home !== null).map((p) => p.home!);
  const games = r1.filter((p) => p.home !== null && p.away !== null);
  const bubble = view.standings.filter((r) => !view.seedOf.has(r.team.id) && view.clinch.get(r.team.id)?.playoffs !== "eliminated").slice(0, 3);
  const Line = ({ seed }: { seed: number }) => {
    const r = team(seed);
    if (!r) return null;
    const o = view.odds.odds.get(r.team.id);
    return (
      <div className="flex min-h-8 items-center gap-2.5 py-1">
        <span className="numeral w-4 text-right text-[13px] font-semibold text-muted">{seed}</span>
        <TeamLogo team={r.team} size={22} />
        <span className={cn("min-w-0 flex-1 truncate text-[15px] sm:text-sm", r.team.id === myTeamId ? "font-semibold text-brand-600 dark:text-brand-400" : "text-ink")}>{r.team.name}</span>
        <span className="numeral text-[13px] text-muted">{record(r.wins, r.losses, r.ties)}</span>
        {o && <span className="numeral w-10 text-right text-[13px] font-semibold text-ink" title="Title odds">{fmtProb(o.champPct)}</span>}
      </div>
    );
  };
  return (
    <Panel
      title={title}
      subtitle={view.playoffsStarted ? "Final seeds" : "If the season ended today"}
      info={view.odds.odds.size > 0 ? <p>The right-hand number is each seed&apos;s chance to win the title; for teams in the hunt it is their chance to make the playoffs.</p> : undefined}
      infoTitle="Playoff picture"
      actions={<MoreLink href="/playoffs">Bracket</MoreLink>}
    >
      {!view.seeds.length ? (
        <p className="text-[13px] text-muted">Seeds appear once games have been played.</p>
      ) : (
        <div className="space-y-3">
          {byes.length > 0 && (
            <div>
              <div className="eyebrow mb-0.5">First-round bye</div>
              {byes.map((s) => (
                <Line key={s} seed={s} />
              ))}
            </div>
          )}
          {games.length > 0 && (
            <div>
              <div className="eyebrow mb-0.5">{plan.rounds === 1 ? "Final" : "Opening round"}</div>
              <ul className="divide-y divide-line/70">
                {games.map((g) => (
                  <li key={g.slot} className="py-1">
                    <Line seed={g.home!} />
                    <Line seed={g.away!} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bubble.length > 0 && !view.playoffsStarted && (
            <div>
              <div className="eyebrow mb-0.5">In the hunt</div>
              {bubble.map((r) => {
                const o = view.odds.odds.get(r.team.id);
                return (
                  <div key={r.team.id} className="flex min-h-8 items-center gap-2.5 py-1 text-[15px] sm:text-sm">
                    <span className="w-4" />
                    <TeamLogo team={r.team} size={22} />
                    <span className={cn("min-w-0 flex-1 truncate", r.team.id === myTeamId ? "font-semibold text-brand-600 dark:text-brand-400" : "text-ink")}>{r.team.name}</span>
                    <span className="numeral text-[13px] text-muted">{record(r.wins, r.losses, r.ties)}</span>
                    {o && <span className="numeral w-10 text-right text-[13px] font-semibold text-muted" title="Playoff odds">{fmtProb(o.playoffPct)}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
