// "If the season ended today": seeds, byes and first-round games from the current standings.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Panel, TeamLogo } from "@/components/ui/core";
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
      <div className={cn("flex items-center gap-2 py-1", r.team.id === myTeamId && "font-semibold")}>
        <span className="w-5 text-right text-xs font-bold tabular-nums text-muted">{seed}</span>
        <TeamLogo team={r.team} size={20} />
        <span className="min-w-0 flex-1 truncate text-sm">{r.team.name}</span>
        <span className="text-xs tabular-nums text-muted">{record(r.wins, r.losses, r.ties)}</span>
        {o && <span className="w-10 text-right text-[11px] tabular-nums text-muted" title="Title odds">{fmtProb(o.champPct)}</span>}
      </div>
    );
  };
  return (
    <Panel
      title={title}
      subtitle={view.playoffsStarted ? "Final seeds" : "If the season ended today"}
      actions={
        <Link href="/playoffs" className="inline-flex items-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Bracket <ChevronRight size={14} aria-hidden />
        </Link>
      }
    >
      {!view.seeds.length ? (
        <p className="text-sm text-muted">Seeds appear once games have been played.</p>
      ) : (
        <div className="space-y-3">
          {byes.length > 0 && (
            <div>
              <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-gold-600 dark:text-gold-400">First-round bye</div>
              {byes.map((s) => (
                <Line key={s} seed={s} />
              ))}
            </div>
          )}
          {games.length > 0 && (
            <div>
              <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{plan.rounds === 1 ? "Final" : "Opening round"}</div>
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
              <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">In the hunt</div>
              {bubble.map((r) => {
                const o = view.odds.odds.get(r.team.id);
                return (
                  <div key={r.team.id} className="flex items-center gap-2 py-1 text-sm">
                    <span className="w-5" />
                    <TeamLogo team={r.team} size={20} />
                    <span className="min-w-0 flex-1 truncate">{r.team.name}</span>
                    <span className="text-xs tabular-nums text-muted">{record(r.wins, r.losses, r.ties)}</span>
                    {o && <span className="w-10 text-right text-[11px] tabular-nums text-muted" title="Playoff odds">{fmtProb(o.playoffPct)}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {view.odds.odds.size > 0 && <p className="text-[11px] text-muted">Right column: title odds (playoff odds for teams in the hunt).</p>}
        </div>
      )}
    </Panel>
  );
}
