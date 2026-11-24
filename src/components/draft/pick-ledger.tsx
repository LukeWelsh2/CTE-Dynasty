// Pick ownership ledger: original team × season-round, showing who owns each pick now (server component).
import type { DraftPick, Team } from "@prisma/client";
import { TeamLogo } from "@/components/ui/core";
import { cn, ordinal } from "@/lib/utils";
import { roundPickLabel } from "@/lib/draft/logic";

export function PickLedger({ teams, picks, seasons, rounds, myTeamId }: { teams: Team[]; picks: DraftPick[]; seasons: number[]; rounds: number; myTeamId: string | null }) {
  const byKey = new Map(picks.map((p) => [`${p.originalTeamId}|${p.season}|${p.round}`, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const owned = new Map<string, number>();
  for (const p of picks) if (!p.playerId) owned.set(p.ownerTeamId, (owned.get(p.ownerTeamId) ?? 0) + 1);
  const cols = seasons.flatMap((s) => Array.from({ length: rounds }, (_, i) => ({ season: s, round: i + 1 })));
  return (
    <div className="scroll-thin max-h-[70vh] overflow-auto">
      <table className="tbl tbl-compact" style={{ minWidth: 120 + cols.length * 88 }}>
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 bg-sunken" rowSpan={2}>
              <span className="sm:hidden">Team</span>
              <span className="hidden sm:inline">Original team</span>
            </th>
            {seasons.map((s) => (
              <th key={s} colSpan={rounds} className="border-l border-line text-center">
                {s}
              </th>
            ))}
            <th className="num border-l border-line" rowSpan={2} title="Unused picks currently owned in this window">
              Owns
            </th>
          </tr>
          <tr>
            {cols.map((c) => (
              <th key={`${c.season}-${c.round}`} className={cn("text-center", c.round === 1 && "border-l border-line")}>
                {ordinal(c.round)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id} className={cn(t.id === myTeamId && "bg-gold-300/10")}>
              <td className="sticky left-0 z-10 bg-panel">
                <span className="flex min-w-0 items-center gap-1.5">
                  <TeamLogo team={t} size={20} />
                  <span className="font-semibold sm:hidden" title={t.name}>
                    {t.abbrev}
                  </span>
                  <span className="hidden max-w-[150px] truncate font-semibold sm:inline">{t.name}</span>
                </span>
              </td>
              {cols.map((c) => {
                const p = byKey.get(`${t.id}|${c.season}|${c.round}`);
                if (!p) return <td key={`${c.season}-${c.round}`} className={cn("text-center text-muted", c.round === 1 && "border-l border-line")}>—</td>;
                const owner = teamById.get(p.ownerTeamId);
                const traded = p.ownerTeamId !== p.originalTeamId;
                return (
                  <td key={`${c.season}-${c.round}`} className={cn("text-center", c.round === 1 && "border-l border-line", traded && "bg-brand-50 dark:bg-brand-900/30")}>
                    <div className="flex flex-col items-center leading-tight">
                      {traded && owner ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 dark:text-brand-200" title={`Owned by ${owner.name} (via ${t.name})`}>
                          <TeamLogo team={owner} size={16} /> {owner.abbrev}
                        </span>
                      ) : (
                        <span className="text-xs text-muted" title="Still owned by the original team">
                          Own
                        </span>
                      )}
                      <span className="text-[10px] text-muted">
                        {p.playerId ? "Used" : p.pickInRound ? roundPickLabel(p.round, p.pickInRound) : traded ? `via ${t.abbrev}` : ""}
                      </span>
                    </div>
                  </td>
                );
              })}
              <td className="num border-l border-line font-semibold">{owned.get(t.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
