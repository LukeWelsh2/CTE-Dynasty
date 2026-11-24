// All teams — "How do the league's teams compare?" One ranked list (standings order by default; Cap room and FAB
// re-rank it with a bar to scale), each row taps open to the details the old cards showed (cap meter with dead money,
// roster counts, FAB, top salaries) with links to the team page and a trade.
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { EmptyState, PageHeader, SegmentedLinks, TeamLogo } from "@/components/ui/core";
import { InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { getLeagueContext } from "@/lib/league";
import { loadLeagueTeams } from "@/lib/team/data";
import { cn, fmtMoney, fmtPts, ordinal } from "@/lib/utils";
import { CapMeter, CountPill } from "@/components/team/bits";
import { TeamTabs } from "@/components/team/team-tabs";

export const metadata: Metadata = { title: "All Teams" };

type View = "standings" | "cap" | "fab";

export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { settings } = ctx;
  const teams = await loadLeagueTeams(ctx);
  const divisions = new Map(settings.general.divisions.map((d) => [d.id, d.name]));
  const capOn = teams.some((t) => t.capSpace !== null);
  const fabOn = teams.some((t) => t.faab !== null);
  const view: View = sp.view === "cap" && capOn ? "cap" : sp.view === "fab" && fabOn ? "fab" : "standings";
  const sorted =
    view === "cap" ? [...teams].sort((a, b) => (b.capSpace ?? 0) - (a.capSpace ?? 0)) : view === "fab" ? [...teams].sort((a, b) => (b.faab ?? 0) - (a.faab ?? 0)) : teams;
  const maxOf = (k: "capSpace" | "faab") => Math.max(1, ...teams.map((t) => t[k] ?? 0));
  const views = [
    { key: "standings", label: "Standings", href: "/teams" },
    ...(capOn ? [{ key: "cap", label: "Cap room", href: "/teams?view=cap" }] : []),
    ...(fabOn ? [{ key: "fab", label: "FAB", href: "/teams?view=fab" }] : []),
  ];
  const canTrade = settings.trades.enabled && !!ctx.myTeam;

  return (
    <div>
      {ctx.myTeam && <TeamTabs active="teams" keepers={settings.keepers.enabled} />}
      <PageHeader kicker={`${ctx.season} season`} title="All teams" subtitle={`${teams.length} teams · tap a team for details`} />
      {teams.length === 0 ? (
        <EmptyState title="No teams yet">The commissioner hasn&apos;t created any teams.</EmptyState>
      ) : (
        <div className="space-y-3">
          {views.length > 1 && <SegmentedLinks options={views} active={view} ariaLabel="Rank teams by" scroll={false} />}
          <ul className="card divide-y divide-line/70 overflow-hidden">
            {sorted.map((t, i) => {
              const mine = t.team.id === ctx.myTeam?.id;
              const href = mine ? "/team" : `/teams/${t.team.id}`;
              const division = t.team.division ? divisions.get(t.team.division) : null;
              const value =
                view === "cap"
                  ? { main: fmtMoney(t.capSpace ?? 0), sub: `of ${fmtMoney(settings.salaryCap.cap)}`, pct: ((t.capSpace ?? 0) / maxOf("capSpace")) * 100, tone: (t.capSpace ?? 0) < 0 ? "text-loss" : "text-ink" }
                  : view === "fab"
                    ? { main: fmtMoney(t.faab ?? 0), sub: "FAB left", pct: ((t.faab ?? 0) / maxOf("faab")) * 100, tone: "text-ink" }
                    : { main: t.record, sub: `${fmtPts(t.pointsFor, 0)} PF`, pct: null, tone: "text-ink" };
              return (
                <li key={t.team.id}>
                  <details className="group">
                    <summary
                      className={cn(
                        "flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70 [&::-webkit-details-marker]:hidden",
                        mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]",
                      )}
                    >
                      <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{view === "standings" ? (t.rank ?? "—") : i + 1}</span>
                      <TeamLogo team={t.team} size={36} round />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-[15px] font-semibold leading-5 sm:text-sm", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")} title={t.team.name}>
                          {t.team.name}
                        </span>
                        <span className="block truncate text-[13px] leading-[18px] text-muted">
                          {t.owner?.name ?? "No manager"}
                          {view !== "standings" ? ` · ${t.record}` : division ? ` · ${division}` : ""}
                          {t.streak && view === "standings" ? ` · ${t.streak}` : ""}
                        </span>
                        {value.pct !== null && (
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-ink/[0.05] dark:bg-white/[0.06]" aria-hidden>
                            <span className={cn("block h-full rounded-full", mine ? "bg-brand-600 dark:bg-brand-400" : "bg-ink/30 dark:bg-white/35")} style={{ width: `${Math.max(2, Math.min(100, value.pct))}%` }} />
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cn("numeral block text-[15px] font-semibold leading-5", value.tone)}>{value.main}</span>
                        <span className="numeral block text-[12px] leading-4 text-muted">{value.sub}</span>
                      </span>
                      <ChevronDown size={16} className="-mr-1 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="space-y-3 bg-sunken px-4 pb-4 pt-3">
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <Mini label="Rank" value={t.rank ? ordinal(t.rank) : "—"} />
                        <Mini label="Record" value={t.record} />
                        <Mini label="PF" value={fmtPts(t.pointsFor, 1)} />
                        <Mini label="FAB" value={t.faab !== null ? fmtMoney(t.faab) : "—"} />
                      </div>
                      {t.capSpace !== null && (
                        <div>
                          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="text-muted">Cap used{t.deadMoney > 0 && <span className="text-loss"> · {fmtMoney(t.deadMoney)} dead</span>}</span>
                            <span className="numeral shrink-0 text-ink">
                              <b className="font-semibold">{fmtMoney(t.committed)}</b> / {fmtMoney(settings.salaryCap.cap)} · <b className={cn("font-semibold", t.capSpace < 0 ? "text-loss" : "text-win")}>{fmtMoney(t.capSpace)}</b>
                            </span>
                          </div>
                          <CapMeter committed={t.committed} deadMoney={t.deadMoney} cap={settings.salaryCap.cap} />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <CountPill label="Active" value={t.limits.active} max={t.limits.maxActive} className="bg-panel" />
                        {t.limits.irSlots > 0 && <CountPill label="IR" value={t.limits.ir} max={t.limits.irSlots} className="bg-panel" />}
                        {t.limits.taxiSlots > 0 && <CountPill label="Taxi" value={t.limits.taxi} max={t.limits.taxiSlots} className="bg-panel" />}
                      </div>
                      {t.top.length > 0 && (
                        <div>
                          <h3 className="eyebrow mb-1">Top salaries</h3>
                          <ul className="divide-y divide-line/70">
                            {t.top.map((p) => (
                              <li key={p.id} className="flex min-h-10 items-center gap-2 text-[15px] sm:text-sm">
                                <PosPill pos={p.position} />
                                <Link href={`/players/${p.id}`} className="min-w-0 truncate font-medium text-ink hover:underline" title={p.name}>
                                  {p.name}
                                </Link>
                                <InjuryLetter status={p.injuryStatus} className="text-[13px]" />
                                <span className="numeral ml-auto shrink-0 text-[13px] text-muted">
                                  <b className="font-semibold text-ink">{fmtMoney(p.salary)}</b> · {p.contractYears}y
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Link href={href} className="inline-flex h-10 items-center gap-1 rounded-control bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 sm:h-9">
                          {mine ? "My team" : "Team page"} <ChevronRight size={15} aria-hidden />
                        </Link>
                        {canTrade && !mine && (
                          <Link href={`/trades/new?team=${t.team.id}`} className="inline-flex h-10 items-center gap-1.5 rounded-control bg-panel px-4 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken sm:h-9">
                            <Repeat size={14} aria-hidden /> Trade
                          </Link>
                        )}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-panel px-1 py-2">
      <div className="truncate text-[12px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">{label}</div>
      <div className="numeral mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}
