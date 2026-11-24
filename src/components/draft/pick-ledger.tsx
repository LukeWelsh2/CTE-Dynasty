// Pick ownership ledger: original team × season-round, showing who owns each pick now (server component).
// Quiet by default: a grey dot where the original team still owns the pick, the new owner's logo + abbrev (blue) where
// it was traded. Sticky team column; scrolls sideways on phones. Legend lives in the panel's ⓘ.
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
    <div className="scroll-thin overflow-x-auto border-t border-line/70">
      <table className="tbl tbl-compact" style={{ minWidth: 96 + cols.length * 64 + 56 }}>
        <thead>
          <tr>
            <th className="tbl-sticky !z-20" rowSpan={2}>
              Team
            </th>
            {seasons.map((s) => (
              <th key={s} colSpan={rounds} className="border-l border-line/70 !text-center">
                {s}
              </th>
            ))}
            <th className="num border-l border-line/70" rowSpan={2} title="Unused picks currently owned in this window">
              Owns
            </th>
          </tr>
          <tr>
            {cols.map((c) => (
              <th key={`${c.season}-${c.round}`} className={cn("!text-center", c.round === 1 && "border-l border-line/70")}>
                {ordinal(c.round)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id} className={cn(t.id === myTeamId && "row-mine")}>
              <td className="tbl-sticky">
                <span className="flex min-w-0 items-center gap-2" title={t.name}>
                  <TeamLogo team={t} size={22} />
                  <span className={cn("font-semibold sm:hidden", t.id === myTeamId && "text-brand-600 dark:text-brand-400")}>{t.abbrev}</span>
                  <span className={cn("hidden max-w-[160px] truncate font-semibold sm:inline", t.id === myTeamId && "text-brand-600 dark:text-brand-400")}>{t.name}</span>
                </span>
              </td>
              {cols.map((c) => {
                const p = byKey.get(`${t.id}|${c.season}|${c.round}`);
                const first = c.round === 1 && "border-l border-line/70";
                if (!p)
                  return (
                    <td key={`${c.season}-${c.round}`} className={cn("text-center text-faint", first)}>
                      —
                    </td>
                  );
                const owner = teamById.get(p.ownerTeamId);
                const traded = p.ownerTeamId !== p.originalTeamId;
                const label = p.playerId ? "Used" : p.pickInRound ? roundPickLabel(p.round, p.pickInRound) : null;
                return (
                  <td key={`${c.season}-${c.round}`} className={cn("text-center", first)}>
                    <div className="flex min-h-9 flex-col items-center justify-center leading-tight">
                      {traded && owner ? (
                        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 dark:text-brand-400" title={`Owned by ${owner.name} (via ${t.name})`}>
                          <TeamLogo team={owner} size={16} /> {owner.abbrev}
                        </span>
                      ) : (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink/25 dark:bg-white/30" title={`Still owned by ${t.name}`} aria-label="Own" />
                      )}
                      {label && <span className="numeral mt-0.5 text-[12px] text-muted">{label}</span>}
                    </div>
                  </td>
                );
              })}
              <td className="num border-l border-line/70 font-semibold">{owned.get(t.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
