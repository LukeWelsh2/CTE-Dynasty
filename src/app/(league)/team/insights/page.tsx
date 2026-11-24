// Manager insights: start/sit, injury & bye alerts, matchup difficulty, waiver targets, lineup efficiency,
// bye-week planner and roster age / contract snapshot.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Gauge, ShieldAlert, Sparkles, Target, TrendingUp, Users } from "lucide-react";
import { Badge, ButtonLink, EmptyState, InjuryTag, Panel, PlayerLink, PosBadge, StatTile } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { loadInsights, type InsightsData, type PlayerBrief } from "@/lib/insights/data";
import { resolveManagedTeam } from "@/lib/team/data";
import { clamp, cn, fmtMoney, fmtPct, fmtPts, ordinal } from "@/lib/utils";
import { ApplyLineupButton } from "@/components/team/apply-lineup-button";
import { DifficultyChip } from "@/components/team/bits";
import { TeamTabs } from "@/components/team/team-tabs";
import { WeekPicker } from "@/components/team/week-picker";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Lineup Insights" };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ week?: string; team?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const resolved = await resolveManagedTeam(ctx, sp.team);
  if (resolved.kind === "redirect") redirect(resolved.to);
  if (resolved.kind === "none") {
    return (
      <div>
        <TeamTabs active="insights" keepers={ctx.settings.keepers.enabled} />
        <EmptyState title="No team to analyze">Insights are built from your roster — join a team to see start/sit help, waiver targets and more.</EmptyState>
      </div>
    );
  }
  const teamId = resolved.teamId;
  const maxWeek = lastFantasyWeek(ctx.settings);
  const requested = Number.parseInt(sp.week ?? "", 10);
  const week = clamp(Number.isFinite(requested) ? requested : ctx.week, 1, maxWeek);
  const [data, team] = await Promise.all([loadInsights(ctx, teamId, week), db.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } })]);
  const q = resolved.commishEdit ? `?team=${teamId}` : "";

  return (
    <div>
      <TeamTabs active="insights" teamId={resolved.commishEdit ? teamId : null} keepers={ctx.settings.keepers.enabled} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">{team.name}</div>
          <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide text-ink sm:text-3xl">Lineup insights</h1>
          <p className="text-sm text-muted">Projection-based recommendations for Week {week}. Apply any suggestion with one click.</p>
        </div>
        <WeekPicker basePath="/team/insights" week={week} currentWeek={ctx.week} maxWeek={maxWeek} extraQuery={resolved.commishEdit ? { team: teamId } : {}} />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <StartSitPanel data={data} teamId={teamId} rosterHref={`/team${q}${q ? "&" : "?"}week=${week}`} />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <AlertsPanel data={data} teamId={teamId} />
          <DifficultyPanel data={data} />
        </div>
        <WaiverPanel data={data} />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <EfficiencyPanel data={data} myTeamId={teamId} />
          <ByePanel data={data} />
        </div>
        <RosterSnapshotPanel data={data} contractsHref={`/team/contracts${q}`} />
        {data.dvp && <DvpTablePanel dvp={data.dvp} />}
      </div>
    </div>
  );
}

function Mini({ p, proj }: { p: PlayerBrief; proj?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <PosBadge pos={p.pos} />
      <span className="min-w-0">
        <Link href={`/players/${p.id}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
          {p.name}
        </Link>
        <InjuryTag status={p.injuryStatus} className="ml-1" />
        <span className="block text-[11px] leading-tight text-muted">
          {p.team ?? "FA"}
          {proj !== undefined && <> · proj {fmtPts(proj, 1)}</>}
        </span>
      </span>
    </span>
  );
}

function pctOrDash(n: number | null) {
  return n === null ? "—" : fmtPct(n);
}

// ───────── (a) Start / Sit ─────────
function StartSitPanel({ data, teamId, rosterHref }: { data: InsightsData; teamId: string; rosterHref: string }) {
  const ss = data.startSit;
  const delta = ss.winNow !== null && ss.winOptimal !== null ? ss.winOptimal - ss.winNow : null;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-gold-500" /> Start / Sit
        </span>
      }
      subtitle={ss.opponent ? `vs ${ss.opponent.name} (proj ${fmtPts(ss.opponent.projected, 1)})` : "No opponent this week"}
      actions={
        data.editable && ss.swaps.length > 0 ? (
          <ApplyLineupButton teamId={teamId} week={data.week} lineup={ss.optimalLineup} label={`Apply optimal (+${ss.gain.toFixed(1)})`} variant="gold" successMessage={`Optimal lineup saved (+${ss.gain.toFixed(1)} projected).`} />
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Current lineup" value={fmtPts(ss.currentProj, 1)} sub="projected points" />
        <StatTile label="Optimal lineup" value={fmtPts(ss.optimalProj, 1)} sub={ss.gain > 0 ? `+${ss.gain.toFixed(1)} available` : "you're optimal"} tone={ss.gain > 0 ? "good" : "neutral"} />
        <StatTile label="Win prob now" value={pctOrDash(ss.winNow)} sub={ss.opponent ? `vs ${ss.opponent.name}` : "—"} />
        <StatTile label="With optimal" value={pctOrDash(ss.winOptimal)} sub={delta !== null ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pts of win %` : "—"} tone={delta !== null && delta > 0.001 ? "good" : "neutral"} />
      </div>
      {!data.editable ? (
        <p className="mt-3 text-sm text-muted">{data.readOnlyReason}</p>
      ) : ss.swaps.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/25 dark:text-green-100">
          <CheckCircle2 size={16} /> Your lineup is already the best by projection (locked, injured and bye-week players excluded).
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Start</th>
                <th>Instead of</th>
                <th className="hidden sm:table-cell">Slot</th>
                <th className="num">Gain</th>
                <th className="num hidden sm:table-cell">Win %</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody>
              {ss.swaps.map((s) => (
                <tr key={s.in.id}>
                  <td>
                    <Mini p={s.in} proj={s.in.projected} />
                  </td>
                  <td>{s.out ? <Mini p={s.out} proj={s.out.projected} /> : <span className="text-sm italic text-loss">Empty slot</span>}</td>
                  <td className="hidden text-xs font-semibold sm:table-cell">{s.slotLabel}</td>
                  <td className="num font-bold text-win">+{s.gain.toFixed(1)}</td>
                  <td className="num hidden whitespace-nowrap sm:table-cell">
                    {s.winAfter !== null && ss.winNow !== null ? (
                      <>
                        {fmtPct(s.winAfter)} <span className="text-[11px] text-win">(+{((s.winAfter - ss.winNow) * 100).toFixed(1)})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <ApplyLineupButton teamId={teamId} week={data.week} lineup={s.lineup} successMessage={`Started ${s.in.name}${s.out ? ` over ${s.out.name}` : ""}.`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 text-right">
        <Link href={rosterHref} className="link text-xs font-semibold">
          Edit lineup manually <ArrowRight size={12} className="inline" />
        </Link>
      </div>
    </Panel>
  );
}

// ───────── (b) Alerts ─────────
function AlertsPanel({ data, teamId }: { data: InsightsData; teamId: string }) {
  const label = { injury: "Out", doubtful: "Doubtful", bye: "Bye", empty: "Empty" } as const;
  const tone = { injury: "red", doubtful: "amber", bye: "purple", empty: "red" } as const;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-loss" /> Injury &amp; bye alerts
        </span>
      }
      subtitle="Starters who won't (or may not) play, with the best replacement"
      noPad
    >
      {data.alerts.length === 0 ? (
        <div className="p-3">
          <EmptyState title="All clear" icon={<CheckCircle2 className="text-win" />}>
            Every starter is healthy and has a game in Week {data.week}.
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {data.alerts.map((a, i) => (
            <li key={i} className="space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={tone[a.kind]}>{label[a.kind]}</Badge>
                  <span className="text-xs font-semibold text-muted">{a.slotLabel}</span>
                  {a.player ? <Mini p={a.player} proj={a.player.projected} /> : <span className="text-sm italic text-loss">No one in this slot</span>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-line bg-sunken/50 p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Best on your bench</div>
                  {a.bench ? (
                    <div className="flex items-center justify-between gap-2">
                      <Mini p={a.bench} proj={a.bench.projected} />
                      {data.editable && <ApplyLineupButton teamId={teamId} week={data.week} lineup={a.bench.lineup} label="Start" successMessage={`Started ${a.bench.name} at ${a.slotLabel}.`} />}
                    </div>
                  ) : (
                    <div className="text-xs text-muted">No healthy, eligible bench player.</div>
                  )}
                </div>
                <div className="rounded-md border border-line bg-sunken/50 p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">Top free agent</div>
                  {a.freeAgent ? (
                    <div className="flex items-center justify-between gap-2">
                      <Mini p={a.freeAgent} proj={a.freeAgent.projected} />
                      <ButtonLink href={`/players/${a.freeAgent.id}`} variant="secondary" size="xs" className="h-7">
                        View
                      </ButtonLink>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">No free agent projects higher.</div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ───────── (c) Matchup difficulty ─────────
function DifficultyPanel({ data }: { data: InsightsData }) {
  const through = data.dvp?.throughWeek ?? 0;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Gauge size={16} className="text-brand-600" /> Matchup difficulty
        </span>
      }
      subtitle={through > 0 ? `Fantasy points allowed to each position, Weeks 1–${through} (1 = toughest of 32)` : "Available after Week 1"}
      noPad
    >
      {data.difficulty.length === 0 ? (
        <div className="p-3 text-sm text-muted">No starters set.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Player</th>
              <th>Opp</th>
              <th className="num">Rank</th>
              <th className="num hidden sm:table-cell">Allowed/g</th>
            </tr>
          </thead>
          <tbody>
            {data.difficulty.map((d, i) => (
              <tr key={i}>
                <td className="text-xs font-semibold text-muted">{d.slotLabel}</td>
                <td>
                  <PlayerLink player={{ id: d.player.id, fullName: d.player.name, position: d.player.position, team: d.player.team, injuryStatus: d.player.injuryStatus }} />
                </td>
                <td className="whitespace-nowrap text-xs font-semibold">{d.opponent ? `${d.home ? "vs" : "@"} ${d.opponent}` : <span className="text-loss">BYE</span>}</td>
                <td className="num">{d.rank !== null && d.tone ? <DifficultyChip rank={d.rank} of={d.of} tone={d.tone} perGame={d.perGame ?? undefined} showLabel /> : <span className="text-muted">—</span>}</td>
                <td className="num hidden tabular-nums sm:table-cell">{d.perGame !== null ? d.perGame.toFixed(1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ───────── (d) Waiver targets ─────────
function WaiverPanel({ data }: { data: InsightsData }) {
  const w = data.waivers;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Target size={16} className="text-win" /> Waiver targets
        </span>
      }
      subtitle={`Best available by rest-of-season projection (Weeks ${w.fromWeek}–${w.toWeek}) where your starters rank lowest`}
      actions={
        <ButtonLink href="/players?status=available" variant="secondary" size="xs" className="h-7">
          All free agents
        </ButtonLink>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {w.needs.map((n) => {
          const weak = n.rank > Math.ceil((2 * n.of) / 3);
          const strong = n.rank <= Math.ceil(n.of / 3);
          return (
            <span
              key={n.pos}
              title={`Your top ${n.pos}s average ${n.mine.toFixed(1)} ROS pts (league avg ${n.leagueAvg.toFixed(1)})`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                weak ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/25 dark:text-red-100" : strong ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/25 dark:text-green-100" : "border-line bg-sunken text-ink",
              )}
            >
              <PosBadge pos={n.pos} />
              <b>{ordinal(n.rank)}</b>
              <span className="opacity-75">of {n.of}</span>
            </span>
          );
        })}
      </div>
      {w.targets.every((t) => t.players.length === 0) ? (
        <EmptyState title="No upgrades on the wire">No free agent projects better than your current starters at your weakest positions.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {w.targets.map((t) => (
            <div key={t.pos} className="overflow-hidden rounded-md border border-line">
              <div className="flex items-center justify-between border-b border-line bg-sunken/70 px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
                  <PosBadge pos={t.pos} /> Your {t.pos}s rank {ordinal(t.rank)} of {t.of}
                </span>
                <Link href={`/players?status=available&pos=${t.pos}`} className="link text-[11px] font-semibold">
                  More
                </Link>
              </div>
              {t.players.length === 0 ? (
                <div className="p-2 text-xs text-muted">No free agent beats your current {t.pos}s.</div>
              ) : (
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="num">ROS</th>
                      <th className="num">Wk</th>
                      <th className="num">+/-</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.players.map((p) => (
                      <tr key={p.player.id}>
                        <td>
                          <PlayerLink player={{ id: p.player.id, fullName: p.player.name, position: p.player.position, team: p.player.team, injuryStatus: p.player.injuryStatus }} />
                          {p.replaces && <span className="block text-[10px] text-muted">over {p.replaces}</span>}
                        </td>
                        <td className="num tabular-nums">{p.ros.toFixed(1)}</td>
                        <td className="num tabular-nums text-muted">{p.weekProj.toFixed(1)}</td>
                        <td className="num font-bold tabular-nums text-win">+{p.upgrade.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ───────── (e) Efficiency ─────────
function EfficiencyPanel({ data, myTeamId }: { data: InsightsData; myTeamId: string }) {
  const e = data.efficiency;
  const max = Math.max(1, ...e.weeks.map((w) => w.optimal));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <TrendingUp size={16} className="text-brand-600" /> Lineup efficiency
        </span>
      }
      subtitle="Actual starter points vs the best lineup you could have set"
    >
      {!e.mine || e.weeks.length === 0 ? (
        <EmptyState title="No completed weeks yet">Efficiency appears once a week is final.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Efficiency" value={fmtPct(e.mine.pct, 1)} sub={`${ordinal(e.mine.rank)} of ${e.league.length}`} tone={e.mine.rank <= Math.ceil(e.league.length / 3) ? "good" : e.mine.rank > Math.ceil((2 * e.league.length) / 3) ? "bad" : "neutral"} />
            <StatTile label="Left on bench" value={fmtPts(e.mine.left, 1)} sub="season points" />
            <StatTile label="Per week" value={fmtPts(e.mine.left / e.weeks.length, 1)} sub="avg lost" />
          </div>
          <ul className="mt-3 space-y-1.5" aria-label="Weekly efficiency">
            {e.weeks.map((w) => (
              <li key={w.week} className="grid grid-cols-[44px_1fr_88px] items-center gap-2 text-xs">
                <span className="font-semibold text-muted">Wk {w.week}</span>
                <span className="relative h-3.5 overflow-hidden rounded bg-sunken ring-1 ring-inset ring-line" title={`${fmtPts(w.actual)} of ${fmtPts(w.optimal)} possible`}>
                  <span className="absolute inset-y-0 left-0 bg-line" style={{ width: `${(w.optimal / max) * 100}%` }} />
                  <span className={cn("absolute inset-y-0 left-0", w.pct >= 0.95 ? "bg-win" : w.pct >= 0.85 ? "bg-brand-600" : "bg-amber-500")} style={{ width: `${(w.actual / max) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">
                  <b>{fmtPct(w.pct)}</b> <span className="text-muted">−{w.left.toFixed(1)}</span>
                </span>
              </li>
            ))}
          </ul>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-brand-700 dark:text-brand-300">League efficiency rankings</summary>
            <table className="tbl tbl-compact mt-2">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="num">Eff.</th>
                  <th className="num">Left on bench</th>
                </tr>
              </thead>
              <tbody>
                {e.league.map((r) => (
                  <tr key={r.teamId} className={cn(r.teamId === myTeamId && "font-bold [&>td]:bg-gold-300/20")}>
                    <td className="tabular-nums">{r.rank}</td>
                    <td>
                      <Link href={`/teams/${r.teamId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="num tabular-nums">{fmtPct(r.pct, 1)}</td>
                    <td className="num tabular-nums">{r.left.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Panel>
  );
}

// ───────── (f) Bye planner ─────────
function ByePanel({ data }: { data: InsightsData }) {
  const weeks = data.byes.filter((b) => b.onBye.length > 0 || b.short.length > 0);
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <CalendarClock size={16} className="text-purple-600" /> Bye-week planner
        </span>
      }
      subtitle="Your active roster's byes for the rest of the season"
      noPad
    >
      {weeks.length === 0 ? (
        <div className="p-3">
          <EmptyState title="No byes ahead">None of your active players have a bye in the remaining weeks.</EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {weeks.map((b) => (
            <li key={b.week} className="flex gap-3 p-3">
              <div className="w-14 shrink-0 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Week</div>
                <div className="font-display text-2xl font-bold leading-none">{b.week}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  {b.onBye.map((p) => (
                    <span key={p.id} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs", p.starter ? "border-purple-300 bg-purple-50 font-semibold dark:border-purple-800 dark:bg-purple-900/30" : "border-line bg-sunken/60")}>
                      <PosBadge pos={p.pos} className="h-4 min-w-[24px] text-[9px]" />
                      {p.name}
                      {p.starter && <span className="text-[9px] font-bold uppercase text-purple-700 dark:text-purple-300">Starter</span>}
                    </span>
                  ))}
                </div>
                {b.short.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-loss">
                    <AlertTriangle size={13} />
                    {b.short.map((s) => `${s.pos}: ${s.have} available for ${s.need} slot${s.need === 1 ? "" : "s"}`).join(" · ")}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ───────── (g) Roster snapshot ─────────
function RosterSnapshotPanel({ data, contractsHref }: { data: InsightsData; contractsHref: string }) {
  const r = data.roster;
  const maxHist = Math.max(1, ...r.histogram.map((h) => h.count));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Users size={16} className="text-brand-600" /> Roster age &amp; contracts
        </span>
      }
      actions={
        <ButtonLink href={contractsHref} variant="secondary" size="xs" className="h-7">
          Contracts &amp; cap
        </ButtonLink>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Average age</h3>
            <span className="text-xs text-muted">
              Team <b className="text-ink">{r.avgAge ?? "—"}</b> · League {r.leagueAvgAge ?? "—"}
            </span>
          </div>
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="num">Players</th>
                <th className="num">Mine</th>
                <th className="num">League</th>
              </tr>
            </thead>
            <tbody>
              {r.ages.map((a) => (
                <tr key={a.pos}>
                  <td>
                    <PosBadge pos={a.pos} />
                  </td>
                  <td className="num tabular-nums">{a.count}</td>
                  <td className={cn("num tabular-nums font-semibold", a.mine !== null && a.league !== null && a.mine > a.league + 1.5 && "text-loss", a.mine !== null && a.league !== null && a.mine < a.league - 1.5 && "text-win")}>{a.mine ?? "—"}</td>
                  <td className="num tabular-nums text-muted">{a.league ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Expiring after this season</h3>
            <span className="text-xs text-muted">
              {r.expiring.length} players · <b className="text-ink">{fmtMoney(r.expiringTotal)}</b>
            </span>
          </div>
          {r.expiring.length === 0 ? (
            <p className="text-sm text-muted">No contracts expire this season.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
              {r.expiring.map((e) => (
                <li key={e.player.id} className="flex items-center justify-between gap-2">
                  <Mini p={e.player} />
                  <span className="shrink-0 tabular-nums">
                    {e.isRookie && <Badge tone="brand" className="mr-1">Rookie</Badge>}
                    {fmtMoney(e.salary)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Years remaining</h3>
          <ul className="space-y-1.5">
            {r.histogram.map((h, i) => (
              <li key={h.years} className="grid grid-cols-[52px_1fr_28px] items-center gap-2 text-xs">
                <span className="text-muted">
                  {h.years}
                  {i === r.histogram.length - 1 ? "+" : ""} yr{h.years === 1 && i !== r.histogram.length - 1 ? "" : "s"}
                </span>
                <span className="h-3 overflow-hidden rounded bg-sunken ring-1 ring-inset ring-line">
                  <span className="block h-full bg-brand-600 dark:bg-brand-500" style={{ width: `${(h.count / maxHist) * 100}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums">{h.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{r.rookieCount} rookie contract{r.rookieCount === 1 ? "" : "s"} on the roster.</p>
        </div>
      </div>
    </Panel>
  );
}

// ───────── Full DvP table ─────────
function DvpTablePanel({ dvp }: { dvp: NonNullable<InsightsData["dvp"]> }) {
  return (
    <Panel title="Defense vs position" subtitle={`Fantasy points allowed per game, Weeks 1–${dvp.throughWeek}. Rank 1 = toughest; green = easy matchup.`} noPad>
      <details>
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-brand-700 dark:text-brand-300">Show all {dvp.teams.length} defenses</summary>
        <div className="overflow-x-auto">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th className="sticky left-0 bg-sunken">Defense</th>
                {dvp.positions.map((p) => (
                  <th key={p} className="num">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dvp.teams.map((t) => (
                <tr key={t.team}>
                  <td className="sticky left-0 bg-panel font-semibold">{t.team}</td>
                  {dvp.positions.map((p) => {
                    const c = t.cells[p];
                    return (
                      <td key={p} className="num whitespace-nowrap">
                        <span className="mr-1 tabular-nums text-muted">{c.perGame.toFixed(1)}</span>
                        <DifficultyChip rank={c.rank} of={dvp.teams.length} tone={c.tone} perGame={c.perGame} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}
