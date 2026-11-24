// All teams in the league: record, rank, cap space, FAB, roster counts and top salaries.
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, InjuryTag, PageHeader, TeamLogo } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { loadLeagueTeams } from "@/lib/team/data";
import { cn, fmtMoney, fmtPts, ordinal } from "@/lib/utils";
import { CapMeter, CountPill } from "@/components/team/bits";
import { TeamTabs } from "@/components/team/team-tabs";

export const metadata: Metadata = { title: "All Teams" };

export default async function TeamsPage() {
  const ctx = await getLeagueContext();
  const { settings } = ctx;
  const teams = await loadLeagueTeams(ctx);
  const divisions = new Map(settings.general.divisions.map((d) => [d.id, d.name]));

  return (
    <div>
      {ctx.myTeam && <TeamTabs active="teams" keepers={settings.keepers.enabled} />}
      <PageHeader title="All teams" subtitle={`${teams.length} teams · ${ctx.season} season · sorted by standings`} />
      {teams.length === 0 ? (
        <EmptyState title="No teams yet">The commissioner hasn&apos;t created any teams.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const mine = t.team.id === ctx.myTeam?.id;
            return (
              <li key={t.team.id}>
                <Link
                  href={mine ? "/team" : `/teams/${t.team.id}`}
                  className={cn(
                    "group block h-full overflow-hidden rounded-lg border bg-panel shadow-panel transition-colors hover:border-brand-300 dark:hover:border-brand-700",
                    mine ? "border-gold-400 ring-1 ring-gold-400/60" : "border-line",
                  )}
                >
                  <div className="h-1" style={{ background: `linear-gradient(90deg, ${t.team.primaryColor} 0 70%, ${t.team.secondaryColor} 70% 100%)` }} />
                  <div className="p-3">
                    <div className="flex items-start gap-3">
                      <TeamLogo team={t.team} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-lg font-bold uppercase leading-tight tracking-wide text-ink group-hover:text-brand-700 dark:group-hover:text-brand-300">{t.team.name}</span>
                          {mine && <Badge tone="gold">You</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {t.owner?.name ?? "No manager"}
                          {t.team.division && divisions.get(t.team.division) ? ` · ${divisions.get(t.team.division)}` : ""}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-xl font-bold tabular-nums leading-none">{t.record}</div>
                        <div className="text-[11px] text-muted">{t.rank ? `${ordinal(t.rank)} · ${fmtPts(t.pointsFor, 1)} PF` : "—"}</div>
                      </div>
                    </div>

                    {t.capSpace !== null && (
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-[11px]">
                          <span className="font-semibold uppercase tracking-wide text-muted">Cap</span>
                          <span className="tabular-nums text-muted">
                            {fmtMoney(t.committed)} / {fmtMoney(settings.salaryCap.cap)} · <b className={t.capSpace < 0 ? "text-loss" : "text-win"}>{fmtMoney(t.capSpace)} space</b>
                          </span>
                        </div>
                        <CapMeter committed={t.committed} deadMoney={t.deadMoney} cap={settings.salaryCap.cap} />
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <CountPill label="Active" value={t.limits.active} max={t.limits.maxActive} />
                      {t.limits.irSlots > 0 && <CountPill label="IR" value={t.limits.ir} max={t.limits.irSlots} />}
                      {t.limits.taxiSlots > 0 && <CountPill label="Taxi" value={t.limits.taxi} max={t.limits.taxiSlots} />}
                      {t.faab !== null && <CountPill label="FAB" value={t.faab} max={null} money />}
                    </div>

                    <ol className="mt-3 space-y-1 border-t border-line pt-2">
                      {t.top.length === 0 && <li className="text-xs text-muted">Empty roster</li>}
                      {t.top.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="w-7 shrink-0 text-[10px] font-bold text-muted">{p.position}</span>
                            <span className="truncate font-medium">{p.name}</span>
                            <InjuryTag status={p.injuryStatus} />
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted">
                            <b className="text-ink">{fmtMoney(p.salary)}</b> · {p.contractYears}y
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
