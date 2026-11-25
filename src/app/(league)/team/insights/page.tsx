// Lineup insights — "What can I do to score more this week (and beyond)?" (docs/DESIGN.md §4). Summary strip
// (projection, optimal, win %, efficiency), then start/sit swaps and injury / bye alerts (primary, one tap to apply),
// then secondary modules cut to their top rows: matchup difficulty, waiver targets, efficiency, byes, roster age and
// expiring contracts. Explanations live behind ⓘ; long lists behind "Show more"; the full DvP table behind a tap.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, Collapsible, EmptyState, MoreLink, PageHeader, Panel, RankBar, RankList, SeeAll, StatGrid, SummaryStrip, type SummaryItem } from "@/components/ui/core";
import { ShowMore, TrendChart } from "@/components/ui/client";
import { HeadshotBadge, InjuryLetter, OppLine, PosPill, SlotPill } from "@/components/ui/fantasy";
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
        <EmptyState title="No team to analyze">Join a team to see start/sit help, waiver targets and more.</EmptyState>
      </div>
    );
  }
  const teamId = resolved.teamId;
  const maxWeek = lastFantasyWeek(ctx.settings);
  const requested = Number.parseInt(sp.week ?? "", 10);
  const week = clamp(Number.isFinite(requested) ? requested : ctx.week, 1, maxWeek);
  const [data, team] = await Promise.all([loadInsights(ctx, teamId, week), db.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } })]);
  const q = resolved.commishEdit ? `?team=${teamId}` : "";
  const ss = data.startSit;
  const e = data.efficiency;
  const summary: SummaryItem[] = [
    { label: "Proj", value: fmtPts(ss.currentProj, 1), sub: "your lineup" },
    {
      label: "Optimal",
      value: fmtPts(ss.optimalProj, 1),
      sub: ss.gain > 0.05 ? <span className="font-semibold text-win">+{ss.gain.toFixed(1)}</span> : "you're optimal",
      title: "Best lineup by projection (locked, injured and bye-week players excluded)",
    },
    {
      label: "Win",
      value: ss.winNow === null ? "—" : fmtPct(ss.winNow),
      sub: ss.winNow !== null && ss.winOptimal !== null && ss.winOptimal - ss.winNow > 0.001 ? <span className="text-win">→ {fmtPct(ss.winOptimal)}</span> : ss.opponent ? "this week" : "no game",
      title: ss.opponent
        ? `Win probability vs ${ss.opponent.name} (proj ${fmtPts(ss.opponent.projected, 1)})${ss.winOptimal !== null ? ` · ${fmtPct(ss.winOptimal)} with the optimal lineup` : ""}`
        : undefined,
    },
    e.mine
      ? { label: "Eff.", value: fmtPct(e.mine.pct), sub: `${ordinal(e.mine.rank)} of ${e.league.length}`, title: "Lineup efficiency: season starter points as a share of your best possible lineups" }
      : { label: "Alerts", value: data.alerts.length, sub: data.alerts.length ? "starters" : "all clear", tone: data.alerts.length ? "bad" : undefined },
  ];

  return (
    <div>
      <TeamTabs active="insights" teamId={resolved.commishEdit ? teamId : null} keepers={ctx.settings.keepers.enabled} />
      <PageHeader
        kicker={team.name}
        title="Lineup insights"
        actions={<WeekPicker basePath="/team/insights" week={week} currentWeek={ctx.week} maxWeek={maxWeek} extraQuery={resolved.commishEdit ? { team: teamId } : {}} />}
      />

      <div className="space-y-4">
        <SummaryStrip items={summary} className="max-[379px]:grid-cols-2" />
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <StartSitPanel data={data} teamId={teamId} rosterHref={`/team${q}${q ? "&" : "?"}week=${week}`} />
          <AlertsPanel data={data} teamId={teamId} />
        </div>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <WaiverPanel data={data} />
          <DifficultyPanel data={data} />
          <EfficiencyPanel data={data} myTeamId={teamId} />
          <ByePanel data={data} />
          <RosterAgePanel data={data} />
          <ExpiringPanel data={data} contractsHref={`/team/contracts${q}`} />
        </div>
        {data.dvp && <DvpTablePanel dvp={data.dvp} />}
      </div>
    </div>
  );
}

function short(name: string) {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(" ")}` : name;
}

/** name (+ red injury letter) · grey "POS TEAM · proj" — the one-line player identity used in insight rows */
function Who({ p, proj, phoneShort, noMeta }: { p: PlayerBrief; proj?: number; /** "B. Robinson" on phones */ phoneShort?: boolean; noMeta?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 items-center gap-1.5">
        <Link href={`/players/${p.id}`} title={p.name} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline sm:text-sm">
          {phoneShort ? (
            <>
              <span className="sm:hidden">{short(p.name)}</span>
              <span className="hidden sm:inline">{p.name}</span>
            </>
          ) : (
            p.name
          )}
        </Link>
        <InjuryLetter status={p.injuryStatus} className="text-[13px]" />
      </span>
      <span className={cn("mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted", noMeta && "hidden")}>
        <PosPill pos={p.pos} />
        <span className="truncate">
          {p.team ?? "FA"}
          {proj !== undefined && <> · proj {fmtPts(proj, 1)}</>}
        </span>
      </span>
    </span>
  );
}

// ───────── Start / sit ─────────
function StartSitPanel({ data, teamId, rosterHref }: { data: InsightsData; teamId: string; rosterHref: string }) {
  const ss = data.startSit;
  return (
    <Panel
      title="Start / sit"
      subtitle={ss.opponent ? `vs ${ss.opponent.name} · proj ${fmtPts(ss.opponent.projected, 1)}` : "No opponent this week"}
      info={
        <>
          <p>Swaps that raise your projected score, best first. Locked, injured (Out / IR) and bye-week players are left out.</p>
          <p>Win % comes from both lineups&apos; projections and their spread; &quot;Apply&quot; saves the lineup with that one swap.</p>
        </>
      }
      noPad
      actions={
        data.editable && ss.swaps.length > 1 ? (
          <ApplyLineupButton teamId={teamId} week={data.week} lineup={ss.optimalLineup} label={`Apply all +${ss.gain.toFixed(1)}`} size="md" successMessage={`Optimal lineup saved (+${ss.gain.toFixed(1)} projected).`} />
        ) : undefined
      }
    >
      {!data.editable ? (
        <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">{data.readOnlyReason}</p>
      ) : ss.swaps.length === 0 ? (
        <p className="flex items-center gap-2 border-t border-line/70 px-4 py-3 text-[15px] font-semibold text-win sm:text-sm">
          <CheckCircle2 size={17} aria-hidden /> Your lineup is the best by projection
        </p>
      ) : (
        <ShowMore as="ul" initial={4} className="divide-y divide-line/70 border-t border-line/70">
          {ss.swaps.map((s) => (
            <li key={s.in.id} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
              <HeadshotBadge player={{ id: s.in.id, fullName: s.in.name, position: s.in.position }} nflTeam={s.in.team} size={40} />
              <span className="min-w-0 flex-1">
                <Who p={s.in} phoneShort noMeta />
                <span className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-muted">
                  {s.out ? (
                    <>
                      <span className="font-semibold text-ink">{s.in.pos}</span> over {short(s.out.name)} · {s.slotLabel}
                    </>
                  ) : (
                    <span className="text-loss">empty {s.slotLabel}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="numeral block text-[15px] font-bold text-win">+{s.gain.toFixed(1)}</span>
                {s.winAfter !== null && <span className="numeral block text-[12px] text-muted">{fmtPct(s.winAfter)} win</span>}
              </span>
              <ApplyLineupButton teamId={teamId} week={data.week} lineup={s.lineup} successMessage={`Started ${s.in.name}${s.out ? ` over ${s.out.name}` : ""}.`} />
            </li>
          ))}
        </ShowMore>
      )}
      <SeeAll href={rosterHref}>Edit lineup</SeeAll>
    </Panel>
  );
}

// ───────── Alerts ─────────
function AlertsPanel({ data, teamId }: { data: InsightsData; teamId: string }) {
  const label = { injury: "Out", doubtful: "Doubtful", bye: "Bye", empty: "Empty" } as const;
  const tone = { injury: "red", doubtful: "amber", bye: "neutral", empty: "red" } as const;
  return (
    <Panel title="Injury & bye alerts" subtitle={data.alerts.length ? `${data.alerts.length} starter${data.alerts.length === 1 ? "" : "s"} may not play` : undefined} noPad>
      {data.alerts.length === 0 ? (
        <p className="flex items-center gap-2 border-t border-line/70 px-4 py-3 text-[15px] font-semibold text-win sm:text-sm">
          <CheckCircle2 size={17} aria-hidden /> Every starter is healthy and playing
        </p>
      ) : (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {data.alerts.map((a, i) => (
            <li key={i} className="px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone={tone[a.kind]}>{label[a.kind]}</Badge>
                <span className="shrink-0 text-[13px] font-semibold text-muted">{a.slotLabel}</span>
                {a.player ? <span className="min-w-0 flex-1"><Who p={a.player} proj={a.player.projected} /></span> : <span className="text-[15px] font-semibold text-loss">No one in this slot</span>}
              </div>
              <div className="mt-2 divide-y divide-line/70 rounded-lg bg-sunken px-3">
                <div className="flex min-h-12 items-center gap-2 py-1.5">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Bench</span>
                  {a.bench ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <Who p={a.bench} proj={a.bench.projected} />
                      </span>
                      {data.editable && <ApplyLineupButton teamId={teamId} week={data.week} lineup={a.bench.lineup} label="Start" successMessage={`Started ${a.bench.name} at ${a.slotLabel}.`} />}
                    </>
                  ) : (
                    <span className="text-[13px] text-muted">No healthy, eligible bench player</span>
                  )}
                </div>
                <div className="flex min-h-12 items-center gap-2 py-1.5">
                  <span className="w-12 shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">FA</span>
                  {a.freeAgent ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <Who p={a.freeAgent} proj={a.freeAgent.projected} />
                      </span>
                      <MoreLink href={`/players/${a.freeAgent.id}`} className="min-h-10">
                        View
                      </MoreLink>
                    </>
                  ) : (
                    <span className="text-[13px] text-muted">No free agent projects higher</span>
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

// ───────── Matchup difficulty ─────────
function DifficultyPanel({ data }: { data: InsightsData }) {
  const through = data.dvp?.throughWeek ?? 0;
  return (
    <Panel
      title="Matchup difficulty"
      subtitle={through > 0 ? "Opponent's rank vs the position · 1 = toughest" : "Available after Week 1"}
      info={<p>Fantasy points each defense has allowed per game to the position, Weeks 1–{through || 1}. Rank 1 of 32 is the toughest matchup; green is easy, red is hard.</p>}
      noPad
    >
      {data.difficulty.length === 0 ? (
        <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No starters set.</p>
      ) : (
        <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
          {data.difficulty.map((d, i) => (
            <li key={i} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
              <SlotPill slot={d.slotLabel} className="h-7 w-11 text-[14px]" />
              <span className="min-w-0 flex-1">
                <Link href={`/players/${d.player.id}`} title={d.player.name} className="block truncate text-[15px] font-semibold leading-5 text-ink hover:underline sm:text-sm">
                  {d.player.name}
                </Link>
                <span className="mt-0.5 flex min-w-0 text-[13px] leading-[18px]">
                  <OppLine opp={d.opponent ? `${d.home ? "vs" : "@"} ${d.opponent}` : "BYE"} difficulty={d.tone === "easy" ? "easy" : d.tone === "tough" ? "hard" : null} />
                </span>
              </span>
              <span className="shrink-0 text-right">
                {d.rank !== null && d.tone ? <DifficultyChip rank={d.rank} of={d.of} tone={d.tone} perGame={d.perGame ?? undefined} showLabel className="text-[12px]" /> : <span className="text-faint">—</span>}
                {d.perGame !== null && <span className="numeral mt-0.5 block text-[12px] text-muted">{d.perGame.toFixed(1)}/g</span>}
              </span>
            </li>
          ))}
        </ShowMore>
      )}
    </Panel>
  );
}

// ───────── Waiver targets ─────────
function WaiverPanel({ data }: { data: InsightsData }) {
  const w = data.waivers;
  const groups = w.targets.filter((t) => t.players.length > 0);
  return (
    <Panel
      title="Waiver targets"
      subtitle="Free agents where your starters rank lowest"
      info={
        <p>
          Rest-of-season projections, Weeks {w.fromWeek}–{w.toWeek}. The chips rank your top players at each position against the league (1st = best); targets are the
          best free agents who beat a current starter.
        </p>
      }
      noPad
      actions={<MoreLink href="/players?status=available">All</MoreLink>}
    >
      <div className="scroll-thin -mt-0.5 flex gap-1.5 overflow-x-auto px-4 pb-3">
        {w.needs.map((n) => {
          const weak = n.rank > Math.ceil((2 * n.of) / 3);
          const strong = n.rank <= Math.ceil(n.of / 3);
          return (
            <span
              key={n.pos}
              title={`Your top ${n.pos}s average ${n.mine.toFixed(1)} ROS pts (league avg ${n.leagueAvg.toFixed(1)})`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-sunken pl-1 pr-2.5 text-[13px]"
            >
              <PosPill pos={n.pos} />
              <b className={cn("numeral font-semibold", weak ? "text-loss" : strong ? "text-win" : "text-ink")}>{ordinal(n.rank)}</b>
            </span>
          );
        })}
      </div>
      {groups.length === 0 ? (
        <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No free agent beats your starters at your weakest positions.</p>
      ) : (
        groups.map((t) => (
          <div key={t.pos} className="border-t border-line/70">
            <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
              <h3 className="eyebrow truncate">
                {t.pos} · you rank {ordinal(t.rank)} of {t.of}
              </h3>
              <MoreLink href={`/players?status=available&pos=${t.pos}`}>More {t.pos}</MoreLink>
            </div>
            <ul className="divide-y divide-line/70">
              {t.players.slice(0, 3).map((p) => (
                <li key={p.player.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                  <HeadshotBadge player={{ id: p.player.id, fullName: p.player.name, position: p.player.position }} nflTeam={p.player.team} size={40} />
                  <span className="min-w-0 flex-1">
                    <Who p={p.player} />
                    {p.replaces && <span className="block truncate text-[12px] text-muted">over {p.replaces}</span>}
                  </span>
                  <span className="shrink-0 text-right" title={`ROS ${p.ros.toFixed(1)} · this week ${p.weekProj.toFixed(1)}`}>
                    <span className="numeral block text-[15px] font-bold text-win">+{p.upgrade.toFixed(1)}</span>
                    <span className="numeral block text-[12px] text-muted">ROS {p.ros.toFixed(1)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Panel>
  );
}

// ───────── Efficiency ─────────
function EfficiencyPanel({ data, myTeamId }: { data: InsightsData; myTeamId: string }) {
  const e = data.efficiency;
  const top = Math.max(0.01, ...e.league.map((r) => r.pct));
  return (
    <Panel title="Lineup efficiency" subtitle="Starter points vs your best possible lineup" info={<p>Efficiency = points your starters scored ÷ points of the best lineup you could have set from your roster that week. &quot;Left on bench&quot; is the difference.</p>}>
      {!e.mine || e.weeks.length === 0 ? (
        <p className="text-[13px] text-muted">Appears once a week is final.</p>
      ) : (
        <>
          <StatGrid
            cols={3}
            items={[
              { label: "Efficiency", value: fmtPct(e.mine.pct, 1), sub: `${ordinal(e.mine.rank)} of ${e.league.length}`, tone: e.mine.rank <= Math.ceil(e.league.length / 3) ? "good" : e.mine.rank > Math.ceil((2 * e.league.length) / 3) ? "bad" : undefined },
              { label: "On bench", value: fmtPts(e.mine.left, 1), sub: "season pts" },
              { label: "Per week", value: fmtPts(e.mine.left / e.weeks.length, 1), sub: "avg lost" },
            ]}
          />
          <div className="mt-4">
            <TrendChart
              ariaLabel="Weekly lineup efficiency"
              kind="bar"
              height={150}
              data={e.weeks.map((w) => ({ week: `W${w.week}`, pct: Math.round(w.pct * 1000) / 10 }))}
              x="week"
              series={[{ key: "pct", label: "Efficiency %" }]}
              yDomain={[0, 100]}
            />
          </div>
          <div className="-mb-3 mt-2 divide-y divide-line/70 border-t border-line/70">
            <Collapsible summary="Week by week" meta={`${e.weeks.length} weeks`}>
              <ul className="divide-y divide-line/70 text-[13px]">
                {e.weeks.map((w) => (
                  <li key={w.week} className="flex min-h-9 items-center justify-between gap-3">
                    <span className="font-semibold text-muted">Week {w.week}</span>
                    <span className="numeral text-ink">
                      {fmtPts(w.actual, 1)} <span className="text-muted">of {fmtPts(w.optimal, 1)}</span> · <b className="font-semibold">{fmtPct(w.pct)}</b>
                      <span className="text-loss"> −{w.left.toFixed(1)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Collapsible>
            <Collapsible summary="League rankings" meta={`${ordinal(e.mine.rank)} of ${e.league.length}`} bodyClassName="-mx-4 pb-1">
              <RankList>
                {e.league.map((r) => (
                  <RankBar key={r.teamId} rank={r.rank} title={r.name} sub={`Bench ${fmtPts(r.left, 0)}`} titleText={`${r.name} · ${fmtPts(r.left, 1)} season points left on the bench`} value={r.pct} max={top} display={fmtPct(r.pct, 1)} mine={r.teamId === myTeamId} href={`/teams/${r.teamId}`} />
                ))}
              </RankList>
            </Collapsible>
          </div>
        </>
      )}
    </Panel>
  );
}

// ───────── Bye planner ─────────
function ByePanel({ data }: { data: InsightsData }) {
  const weeks = data.byes.filter((b) => b.onBye.length > 0 || b.short.length > 0);
  return (
    <Panel title="Bye weeks" subtitle="Your active roster, rest of season" info={<p>Each week with players on a bye. Starters in this week&apos;s lineup are highlighted in blue; a red line means you won&apos;t have enough eligible players to fill those slots.</p>} noPad>
      {weeks.length === 0 ? (
        <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No byes ahead for your active players.</p>
      ) : (
        <ShowMore as="ul" initial={3} className="divide-y divide-line/70 border-t border-line/70">
          {weeks.map((b) => (
            <li key={b.week} className="flex gap-3 px-4 py-3">
              <span className="w-11 shrink-0 text-center">
                <span className="block text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Wk</span>
                <span className="numeral block text-[22px] font-semibold leading-7 text-ink">{b.week}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap gap-1.5">
                  {b.onBye.map((p) => (
                    <span key={p.id} title={p.starter ? `${p.name} · starter` : p.name} className={cn("inline-flex h-7 max-w-full items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[13px]", p.starter ? "bg-brand-600/[0.08] font-semibold text-ink dark:bg-brand-400/15" : "bg-sunken text-ink/85")}>
                      <PosPill pos={p.pos} />
                      <span className="truncate">{short(p.name)}</span>
                    </span>
                  ))}
                </span>
                {b.startersOnBye > 0 && <span className="mt-1 block text-[12px] text-muted">{b.startersOnBye} starter{b.startersOnBye === 1 ? "" : "s"} on bye</span>}
                {b.short.length > 0 && (
                  <span className="mt-1.5 flex items-start gap-1.5 text-[13px] font-semibold text-loss">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{b.short.map((s) => `${s.pos}: ${s.have} for ${s.need} slot${s.need === 1 ? "" : "s"}`).join(" · ")}</span>
                  </span>
                )}
              </span>
            </li>
          ))}
        </ShowMore>
      )}
    </Panel>
  );
}

// ───────── Roster age ─────────
function RosterAgePanel({ data }: { data: InsightsData }) {
  const r = data.roster;
  return (
    <Panel title="Roster age" info={<p>Average age of your rostered players by position vs the league average. Red is more than 1.5 years older than the league, green more than 1.5 years younger.</p>} noPad>
      <div className="px-4 pb-3">
        <StatGrid
          cols={2}
          items={[
            { label: "Your team", value: r.avgAge ?? "—", sub: "avg age" },
            { label: "League", value: r.leagueAvgAge ?? "—", sub: "avg age" },
          ]}
        />
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Pos</th>
            <th className="num">Players</th>
            <th className="num">Yours</th>
            <th className="num">League</th>
          </tr>
        </thead>
        <tbody>
          {r.ages.map((a) => (
            <tr key={a.pos}>
              <td>
                <PosPill pos={a.pos} />
              </td>
              <td className="num">{a.count}</td>
              <td className={cn("num font-semibold", a.mine !== null && a.league !== null && a.mine > a.league + 1.5 && "text-loss", a.mine !== null && a.league !== null && a.mine < a.league - 1.5 && "text-win")}>{a.mine ?? "—"}</td>
              <td className="num text-muted">{a.league ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ───────── Expiring contracts ─────────
function ExpiringPanel({ data, contractsHref }: { data: InsightsData; contractsHref: string }) {
  const r = data.roster;
  const maxHist = Math.max(1, ...r.histogram.map((h) => h.count));
  return (
    <Panel
      title="Expiring contracts"
      subtitle={r.expiring.length ? `${r.expiring.length} players · ${fmtMoney(r.expiringTotal)} coming off` : "None this season"}
      noPad
      actions={<MoreLink href={contractsHref}>Contracts</MoreLink>}
    >
      {r.expiring.length > 0 && (
        <ShowMore as="ul" initial={3} className="divide-y divide-line/70 border-t border-line/70">
          {r.expiring.map((x) => (
            <li key={x.player.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1">
                <Who p={x.player} />
              </span>
              {x.isRookie && <Badge tone="brand">Rookie</Badge>}
              <span className="numeral shrink-0 text-[15px] font-semibold text-ink">{fmtMoney(x.salary)}</span>
            </li>
          ))}
        </ShowMore>
      )}
      <div className="border-t border-line/70 px-4">
        <Collapsible summary="Years remaining" meta={`${r.rookieCount} rookie deal${r.rookieCount === 1 ? "" : "s"}`}>
          <ul className="space-y-2">
            {r.histogram.map((h, i) => (
              <li key={h.years} className="grid grid-cols-[52px_1fr_28px] items-center gap-2 text-[13px]">
                <span className="text-muted">
                  {h.years}
                  {i === r.histogram.length - 1 ? "+" : ""} yr{h.years === 1 && i !== r.histogram.length - 1 ? "" : "s"}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]">
                  <span className="block h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${(h.count / maxHist) * 100}%` }} />
                </span>
                <span className="numeral text-right font-semibold">{h.count}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      </div>
    </Panel>
  );
}

// ───────── Full DvP table ─────────
function DvpTablePanel({ dvp }: { dvp: NonNullable<InsightsData["dvp"]> }) {
  return (
    <Panel title="Defense vs position" noPad info={<p>Fantasy points allowed per game to each position, Weeks 1–{dvp.throughWeek}. Rank 1 = toughest; green = easy matchup, red = hard.</p>}>
      <div className="border-t border-line/70 px-4">
        <Collapsible summary={`All ${dvp.teams.length} defenses`} meta={`Wk 1–${dvp.throughWeek}`} bodyClassName="-mx-4 pb-0">
          <div className="scroll-thin overflow-x-auto border-t border-line/70">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th className="tbl-sticky">Defense</th>
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
                    <td className="tbl-sticky font-semibold">{t.team}</td>
                    {dvp.positions.map((p) => {
                      const c = t.cells[p];
                      return (
                        <td key={p} className="num whitespace-nowrap">
                          <span className="mr-1 text-muted">{c.perGame.toFixed(1)}</span>
                          <DifficultyChip rank={c.rank} of={dvp.teams.length} tone={c.tone} perGame={c.perGame} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>
      </div>
    </Panel>
  );
}
