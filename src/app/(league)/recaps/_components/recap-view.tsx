// Web version of a weekly recap (server component) rendered from the stored RecapContent.
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, HeartPulse, Repeat, UserMinus, UserPlus } from "lucide-react";
import { Badge, EmptyState, InjuryTag, NflLogo, Panel, PlayerHeadshot, PosBadge, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import type { RecapContent, RecapMatchup, RecapSide } from "@/lib/recap/types";
import { AwardIcon, EffBar, fmtWhen, MoveArrow, pctText, ProbBar, pts, safeColor, SectionTitle, TeamName, teamOf, WinProbChart } from "./bits";

type C = RecapContent;

function PlayerName({ p, className }: { p: { id: string; name: string; position: string; nflTeam: string | null }; className?: string }) {
  return (
    <Link href={`/players/${p.id}`} className={cn("font-semibold text-brand-700 hover:underline dark:text-brand-300", className)}>
      {p.name}
    </Link>
  );
}

export function SectionNav({ c }: { c: C }) {
  const items = [
    c.matchupOfWeek && { id: "motw", label: "Matchup of the Week" },
    c.awards.length && { id: "awards", label: "Awards" },
    c.matchups.length && { id: "scores", label: "Scores" },
    c.efficiency.length && { id: "efficiency", label: "Efficiency" },
    c.topPerformers.length && { id: "performers", label: "Top players" },
    c.standings.length && { id: "standings", label: "Standings" },
    c.playoffOdds?.rows.length && { id: "odds", label: "Playoff odds" },
    (c.transactions.trades.length || c.transactions.moves.length) && { id: "transactions", label: "Transactions" },
    c.nextWeek && { id: "next", label: `Week ${c.nextWeek.week} preview` },
    c.injuries.length && { id: "injuries", label: "Injuries" },
  ].filter(Boolean) as { id: string; label: string }[];
  return (
    <nav aria-label="Recap sections" className="sticky top-0 z-20 -mx-3 mb-4 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-2">
      <div className="scroll-thin flex gap-1.5 overflow-x-auto">
        {items.map((i) => (
          <a key={i.id} href={`#${i.id}`} className="chip shrink-0 whitespace-nowrap hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-200">
            {i.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function RecapHero({ c, sentAt, prev, next }: { c: C; sentAt: Date | null; prev: number | null; next: number | null }) {
  const tz = c.timezone;
  const tiles = [
    { label: "High score", value: pts(c.stats.highScore, c.decimals) },
    { label: "Low score", value: pts(c.stats.lowScore, c.decimals) },
    { label: "League avg", value: pts(c.stats.average, c.decimals) },
    { label: "Avg efficiency", value: pctText(c.stats.averageEfficiency) },
  ];
  const seasonQs = (w: number) => `/recaps/${w}?season=${c.season}`;
  return (
    <header className="relative mb-4 overflow-hidden rounded-xl border border-brand-900 bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 text-white shadow-panel">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gold-500/10 blur-2xl" aria-hidden />
      <div className="relative grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400">
            <span>{c.weekLabel} recap</span>
            <span className="text-white/40">·</span>
            <span>{c.season}</span>
          </div>
          <h1 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-wide sm:text-[34px]">{c.headline}</h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-white/85">{c.intro}</p>
          {c.specialNote && <p className="mt-3 inline-block rounded-md border border-gold-400/40 bg-gold-500/15 px-2.5 py-1 text-sm text-gold-300">{c.specialNote}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-white/70">
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={13} aria-hidden /> Updated {fmtWhen(c.generatedAt, tz)}
            </span>
            {sentAt ? <Badge tone="gold">Emailed {fmtWhen(sentAt, tz, false)}</Badge> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 self-start">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-white/60">{t.label}</div>
              <div className="font-display text-xl font-bold tabular-nums">{t.value}</div>
            </div>
          ))}
          <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
            {prev ? (
              <Link href={seasonQs(prev)} className="rounded-md border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/85 hover:bg-white/10">
                ← Week {prev}
              </Link>
            ) : (
              <span />
            )}
            <Link href={`/recaps?season=${c.season}`} className="text-xs font-semibold text-white/70 hover:text-white hover:underline">
              All recaps
            </Link>
            {next ? (
              <Link href={seasonQs(next)} className="rounded-md border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/85 hover:bg-white/10">
                Week {next} →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function MotwSide({ c, side, won }: { c: C; side: RecapSide; won: boolean }) {
  const t = teamOf(c.teams, side.teamId);
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-lg border p-3", won ? "border-gold-400/60 bg-gold-300/10" : "border-line bg-sunken/40")}>
      <TeamLogo team={t} size={48} />
      <div className="min-w-0 flex-1">
        <TeamName team={t} logo={false} showRecord />
        {side.top && (
          <div className="mt-0.5 truncate text-xs text-muted">
            Top: <PlayerName p={side.top} className="text-xs" /> {pts(side.top.points, c.decimals)}
          </div>
        )}
      </div>
      <div className={cn("font-display text-3xl font-extrabold tabular-nums", won ? "text-ink" : "text-muted")}>{pts(side.score, c.decimals)}</div>
    </div>
  );
}

export function MatchupOfWeek({ c }: { c: C }) {
  const motw = c.matchupOfWeek;
  const m = motw ? c.matchups.find((x) => x.id === motw.matchupId) : null;
  if (!motw || !m) return null;
  const home = teamOf(c.teams, m.home.teamId);
  const away = teamOf(c.teams, m.away.teamId);
  const pre = m.preGameHomeWinProb;
  return (
    <section id="motw" className="mb-5 scroll-mt-16" aria-labelledby="motw-title">
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/70 px-3 py-2">
          <h2 id="motw-title" className="font-display text-[15px] font-bold uppercase tracking-wide">
            Matchup of the Week
          </h2>
          <span className="rounded bg-gold-500 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-950">{motw.reasonLabel}</span>
        </div>
        <div className="grid gap-4 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:p-4">
          <div className="space-y-2">
            <MotwSide c={c} side={m.away} won={m.winnerTeamId === m.away.teamId} />
            <MotwSide c={c} side={m.home} won={m.winnerTeamId === m.home.teamId} />
            <p className="pt-1 text-sm leading-relaxed text-ink">{motw.summary}</p>
            <p className="text-sm leading-relaxed text-muted">{m.blurb}</p>
          </div>
          <div className="space-y-3 rounded-lg border border-line bg-sunken/40 p-3">
            {m.wpSeries.length >= 2 ? (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">Win probability</span>
                  {motw.wpSwing !== null && <span className="text-muted">{pctText(motw.wpSwing)} swing</span>}
                </div>
                <WinProbChart series={m.wpSeries} homeColor={home.primaryColor} awayColor={away.primaryColor} homeName={home.name} awayName={away.name} />
                <div className="flex justify-between text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: safeColor(home.primaryColor) }} aria-hidden /> {home.abbrev} above the line
                  </span>
                  {m.winnerLowWinProb !== null && <span>Winner&apos;s low: {pctText(m.winnerLowWinProb)}</span>}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted">No live win-probability track was recorded for this game.</div>
            )}
            {pre !== null && (
              <div>
                <div className="mb-1 flex justify-between text-[11px] font-semibold text-muted">
                  <span>
                    {away.abbrev} {pctText(1 - pre)}
                  </span>
                  <span>Pre-game odds</span>
                  <span>
                    {home.abbrev} {pctText(pre)}
                  </span>
                </div>
                <ProbBar left={1 - pre} leftColor={away.primaryColor} rightColor={home.primaryColor} label={`Pre-game: ${away.name} ${pctText(1 - pre)}, ${home.name} ${pctText(pre)}`} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-md bg-panel px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted">Margin</div>
                <div className="font-bold tabular-nums">{pts(m.margin, c.decimals)}</div>
              </div>
              <div className="rounded-md bg-panel px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted">Combined</div>
                <div className="font-bold tabular-nums">{pts(m.combined, c.decimals)}</div>
              </div>
            </div>
            <Link href={`/scoring/${m.id}`} className="block text-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Full box score →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AwardsGrid({ c, isCommish }: { c: C; isCommish: boolean }) {
  if (!c.awards.length) return null;
  return (
    <section className="mb-5" aria-labelledby="awards">
      <SectionTitle
        id="awards"
        title="Weekly awards"
        actions={
          isCommish ? (
            <Link href="/commissioner/settings?tab=niche" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Choose awards
            </Link>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {c.awards.map((a) => {
          const t = teamOf(c.teams, a.teamId);
          return (
            <article key={a.key} className="relative flex flex-col overflow-hidden rounded-lg border border-line bg-panel p-3 shadow-panel">
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: safeColor(t.primaryColor) }} aria-hidden />
              <div className="flex items-start gap-3">
                <AwardIcon k={a.key} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-gold-600 dark:text-gold-400">{a.title}</div>
                  <TeamName team={t} logo={20} className="mt-1 text-sm" />
                </div>
                <div className="shrink-0 font-display text-xl font-extrabold tabular-nums text-ink">{a.value}</div>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-muted">{a.detail}</p>
              {a.player && (
                <div className="mt-2 flex items-center gap-2 border-t border-line/70 pt-2 text-xs">
                  <PlayerHeadshot player={{ id: a.player.id, fullName: a.player.name, position: a.player.position }} size={26} />
                  <PlayerName p={a.player} className="truncate text-xs" />
                  <span className="text-muted">
                    {a.player.position}
                    {a.player.nflTeam ? ` · ${a.player.nflTeam}` : ""}
                  </span>
                  <span className="ml-auto font-bold tabular-nums">{pts(a.player.points, c.decimals)}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SideRow({ c, side, won, tie }: { c: C; side: RecapSide; won: boolean; tie: boolean }) {
  const t = teamOf(c.teams, side.teamId);
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: safeColor(t.primaryColor) }} aria-hidden />
      <TeamName team={t} logo={28} showRecord className="flex-1" />
      {won && <Badge tone="green">W</Badge>}
      {tie && <Badge>T</Badge>}
      <span className={cn("w-[72px] shrink-0 text-right font-display text-xl font-bold tabular-nums", won ? "text-ink" : "text-muted")}>{pts(side.score, c.decimals)}</span>
    </div>
  );
}

function SideNotes({ c, side }: { c: C; side: RecapSide }) {
  const t = teamOf(c.teams, side.teamId);
  return (
    <div className="min-w-0 space-y-0.5 text-[12px] leading-snug">
      <div className="truncate font-semibold text-muted">{t.abbrev}</div>
      {side.top ? (
        <div className="truncate">
          <span className="text-muted">Top </span>
          <PlayerName p={side.top} className="text-[12px]" /> <span className="tabular-nums">{pts(side.top.points, c.decimals)}</span>
        </div>
      ) : (
        <div className="text-muted">No starters</div>
      )}
      {side.benchMiss ? (
        <div className="truncate" title={`${side.benchMiss.benched.name} (${pts(side.benchMiss.benched.points, c.decimals)}) sat while ${side.benchMiss.started.name} scored ${pts(side.benchMiss.started.points, c.decimals)}`}>
          <span className="text-muted">Bench miss </span>
          <PlayerName p={side.benchMiss.benched} className="text-[12px]" /> <span className="font-semibold text-loss">+{pts(side.benchMiss.diff, c.decimals)}</span>
        </div>
      ) : (
        <div className="text-muted">No bench misses</div>
      )}
      <EffBar value={side.efficiency} className="pt-0.5" />
    </div>
  );
}

function MatchupCard({ c, m }: { c: C; m: RecapMatchup }) {
  const tie = m.winnerTeamId === null;
  const label = m.rivalry ?? m.label ?? (m.kind === "PLAYOFF" ? "Playoffs" : m.kind === "CONSOLATION" ? "Consolation" : null);
  return (
    <article className="flex flex-col rounded-lg border border-line bg-panel shadow-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="truncate text-[11px] font-bold uppercase tracking-wide text-muted">{label ?? (c.matchupOfWeek?.matchupId === m.id ? "Matchup of the Week" : "Final")}</span>
        <Link href={`/scoring/${m.id}`} className="shrink-0 text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Box score
        </Link>
      </div>
      <div className="px-3 pt-1">
        <SideRow c={c} side={m.away} won={m.winnerTeamId === m.away.teamId} tie={tie} />
        <SideRow c={c} side={m.home} won={m.winnerTeamId === m.home.teamId} tie={tie} />
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-line/70 px-3 py-2">
        <SideNotes c={c} side={m.away} />
        <SideNotes c={c} side={m.home} />
      </div>
      <p className="mt-auto border-t border-line/70 bg-sunken/40 px-3 py-2 text-[13px] leading-snug text-ink">{m.blurb}</p>
    </article>
  );
}

export function ScoresGrid({ c }: { c: C }) {
  if (!c.matchups.length) return null;
  return (
    <section className="mb-5" aria-labelledby="scores">
      <SectionTitle id="scores" title="Final scores" subtitle="Top performer, biggest bench miss and lineup efficiency for every team." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {c.matchups.map((m) => (
          <MatchupCard key={m.id} c={c} m={m} />
        ))}
      </div>
    </section>
  );
}

export function EfficiencyTable({ c, myTeamId }: { c: C; myTeamId: string | null }) {
  if (!c.efficiency.length) return null;
  return (
    <section className="mb-5" aria-labelledby="efficiency">
      <SectionTitle id="efficiency" title="Lineup efficiency" subtitle="Points scored ÷ the best possible lineup in hindsight (actual points, players on the roster at lock)." />
      <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
        <div className="max-h-[520px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-8">#</th>
                <th>Team</th>
                <th className="num">Actual</th>
                <th className="num hidden sm:table-cell">Optimal</th>
                <th className="num">Left</th>
                <th className="w-[38%] min-w-[110px]">Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {c.efficiency.map((e, i) => {
                const t = teamOf(c.teams, e.teamId);
                return (
                  <tr key={e.teamId} className={cn(myTeamId === e.teamId && "bg-gold-300/10")}>
                    <td className="text-muted">{i + 1}</td>
                    <td className="max-w-[160px]">
                      <TeamName team={t} logo={20} />
                    </td>
                    <td className="num">{pts(e.starterPoints, c.decimals)}</td>
                    <td className="num hidden sm:table-cell">{pts(e.optimalPoints, c.decimals)}</td>
                    <td className={cn("num", e.pointsLeft >= 20 && "font-semibold text-loss")}>{pts(e.pointsLeft, c.decimals)}</td>
                    <td>
                      <EffBar value={e.efficiency} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function TopPerformers({ c }: { c: C }) {
  if (!c.topPerformers.length) return null;
  return (
    <section className="mb-5" aria-labelledby="performers">
      <SectionTitle id="performers" title="Top NFL performers" subtitle="Highest fantasy scores in league scoring, and who owns them." />
      <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
        {c.topPerformers.map((p, i) => {
          const owner = p.ownerTeamId ? teamOf(c.teams, p.ownerTeamId) : null;
          return (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-5 shrink-0 text-center font-display text-lg font-bold text-muted">{i + 1}</span>
              <PlayerHeadshot player={{ id: p.id, fullName: p.name, position: p.position }} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PlayerName p={p} className="truncate" />
                  <PosBadge pos={p.position} />
                  {p.nflTeam && <span className="text-[11px] text-muted">{p.nflTeam}</span>}
                </div>
                {p.statLine && <div className="truncate text-xs text-muted">{p.statLine}</div>}
                <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                  {owner ? (
                    <>
                      <TeamName team={owner} logo={16} className="text-xs" />
                      {!p.started && <Badge tone="red">Benched</Badge>}
                    </>
                  ) : (
                    <Badge tone="green">Free agent</Badge>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-display text-2xl font-extrabold tabular-nums">{pts(p.points, c.decimals)}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted">proj {pts(p.projected, c.decimals)}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function StandingsMovement({ c, myTeamId }: { c: C; myTeamId: string | null }) {
  if (!c.standings.length) return null;
  return (
    <section className="mb-5" aria-labelledby="standings">
      <SectionTitle
        id="standings"
        title="Standings movement"
        subtitle={`After Week ${c.week}`}
        actions={
          <Link href="/standings" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Full standings
          </Link>
        }
      />
      <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
        <div className="max-h-[560px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-8">#</th>
                <th className="w-8">
                  <span className="sr-only">Change</span>
                </th>
                <th>Team</th>
                <th className="num">W-L</th>
                <th className="num hidden sm:table-cell">PF</th>
                <th className="num">Wk</th>
              </tr>
            </thead>
            <tbody>
              {c.standings.map((s) => {
                const t = teamOf(c.teams, s.teamId);
                return (
                  <tr key={s.teamId} className={cn(myTeamId === s.teamId && "bg-gold-300/10")}>
                    <td className="font-semibold">{s.rank}</td>
                    <td>
                      <MoveArrow change={s.change} />
                    </td>
                    <td className="max-w-[170px]">
                      <div className="flex items-center gap-1.5">
                        <TeamName team={t} logo={20} className="min-w-0" />
                        {c.lastPlace?.teamId === s.teamId && (
                          <Badge tone="amber" title="Last place trophy holder">
                            {c.lastPlace.trophy}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap">{s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`}</td>
                    <td className="num hidden sm:table-cell">{pts(s.pointsFor, c.decimals)}</td>
                    <td className="num">
                      {s.result && <span className={cn("text-xs font-bold", s.result === "W" ? "text-win" : s.result === "L" ? "text-loss" : "text-muted")}>{s.result}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function PlayoffOddsMovers({ c }: { c: C }) {
  const o = c.playoffOdds;
  if (!o || !o.rows.length) return null;
  return (
    <section className="mb-5" aria-labelledby="odds">
      <SectionTitle
        id="odds"
        title="Playoff odds movers"
        subtitle={o.fromWeek ? `Change since results through Week ${o.fromWeek}` : `Results through Week ${o.toWeek}`}
        actions={
          <Link href="/playoffs" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Bracket &amp; odds
          </Link>
        }
      />
      <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
        <table className="tbl">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">Odds</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {o.rows.map((r) => {
              const t = teamOf(c.teams, r.teamId);
              const d = Math.round(r.delta * 100);
              return (
                <tr key={r.teamId}>
                  <td className="max-w-[160px]">
                    <TeamName team={t} logo={20} />
                  </td>
                  <td className="num">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-sunken sm:block" aria-hidden>
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.round(r.after * 100)}%` }} />
                      </div>
                      <span className="font-semibold">{pctText(r.after)}</span>
                    </div>
                  </td>
                  <td className={cn("num font-bold", d > 0 ? "text-win" : d < 0 ? "text-loss" : "text-muted")}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const MOVE_ICON = { ADD: UserPlus, WAIVER: UserPlus, DROP: UserMinus } as const;

export function TransactionsBlock({ c }: { c: C }) {
  const tx = c.transactions;
  if (!tx.trades.length && !tx.moves.length) {
    return (
      <section className="mb-5" aria-labelledby="transactions">
        <SectionTitle id="transactions" title="Trades & transactions" />
        <EmptyState title="A quiet week on the wire" icon={<Repeat size={22} />}>
          No trades, adds or drops were made during Week {c.week}.
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="mb-5" aria-labelledby="transactions">
      <SectionTitle
        id="transactions"
        title="Trades & transactions"
        subtitle={`${tx.adds} add${tx.adds === 1 ? "" : "s"} · ${tx.drops} drop${tx.drops === 1 ? "" : "s"} · ${tx.trades.length} trade${tx.trades.length === 1 ? "" : "s"}${tx.faabSpent ? ` · $${tx.faabSpent} FAB spent` : ""}`}
        actions={
          <Link href="/transactions" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Transaction log
          </Link>
        }
      />
      <div className="space-y-3">
        {tx.trades.map((tr) => (
          <article key={tr.tradeId} className="rounded-lg border border-line bg-panel p-3 shadow-panel">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <ArrowLeftRight size={14} className="text-brand-600" aria-hidden />
              <span className="font-bold uppercase tracking-wide text-muted">Trade</span>
              <span className="text-muted">{fmtWhen(tr.at, c.timezone)}</span>
              {tr.status === "REVERSED" && <Badge tone="red">Reversed by commissioner</Badge>}
            </div>
            <div className={cn("grid gap-3", tr.sides.length > 1 && "sm:grid-cols-2")}>
              {tr.sides.map((s) => (
                <div key={s.teamId} className="min-w-0 rounded-md bg-sunken/50 p-2">
                  <TeamName team={teamOf(c.teams, s.teamId)} logo={20} className="text-sm" />
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Receives</div>
                  <ul className="mt-0.5 space-y-0.5 text-[13px]">
                    {s.received.length ? s.received.map((r) => <li key={r}>{r}</li>) : <li className="text-muted">Nothing</li>}
                  </ul>
                </div>
              ))}
            </div>
          </article>
        ))}
        {tx.moves.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
            {tx.moves.map((mv, i) => {
              const Icon = MOVE_ICON[mv.type] ?? UserPlus;
              const t = mv.teamId ? teamOf(c.teams, mv.teamId) : null;
              return (
                <li key={`${mv.at}-${i}`} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
                  <Icon size={15} className={cn("mt-0.5 shrink-0", mv.type === "DROP" ? "text-loss" : "text-win")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    {t && <TeamName team={t} logo={16} className="text-xs" />}
                    <div className="text-ink">{mv.description}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">{fmtWhen(mv.at, c.timezone, false)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {(tx.biggestFaab || tx.mostActiveTeamId) && (
          <p className="text-xs text-muted">
            {tx.biggestFaab && (
              <>
                Biggest splash: <b className="text-ink">{teamOf(c.teams, tx.biggestFaab.teamId).name}</b> paid ${tx.biggestFaab.amount} for {tx.biggestFaab.player?.name ?? "a player"}.{" "}
              </>
            )}
            {tx.mostActiveTeamId && (
              <>
                Most active: <b className="text-ink">{teamOf(c.teams, tx.mostActiveTeamId).name}</b>.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function fmtLine(spread: number | null, details: string | null): string {
  if (details) return details;
  if (spread === null) return "—";
  return spread === 0 ? "PK" : spread > 0 ? `+${spread}` : String(spread);
}

export function NextWeekPreview({ c, myTeamId }: { c: C; myTeamId: string | null }) {
  const nw = c.nextWeek;
  if (!nw) return null;
  return (
    <section className="mb-5" aria-labelledby="next">
      <SectionTitle
        id="next"
        title={`Week ${nw.week} preview`}
        subtitle="Projected scores and win probabilities as of this recap."
        actions={
          <Link href={`/scoring?week=${nw.week}`} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Week {nw.week} scoreboard
          </Link>
        }
      />
      {nw.matchups.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {nw.matchups.map((m) => {
            const a = teamOf(c.teams, m.away.teamId);
            const h = teamOf(c.teams, m.home.teamId);
            const mine = myTeamId && (m.away.teamId === myTeamId || m.home.teamId === myTeamId);
            const fav = m.home.winProb >= m.away.winProb ? h : a;
            return (
              <Link
                key={m.id}
                href={`/scoring/${m.id}`}
                className={cn("block rounded-lg border bg-panel p-3 shadow-panel transition-colors hover:border-brand-400", mine ? "border-gold-400/70" : "border-line")}
              >
                {(m.label || mine) && (
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                    {mine && <Badge tone="gold">Your matchup</Badge>}
                    {m.label && <span className="truncate">{m.label}</span>}
                  </div>
                )}
                {[
                  { t: a, s: m.away },
                  { t: h, s: m.home },
                ].map(({ t, s }) => (
                  <div key={t.id} className="flex items-center gap-2 py-1">
                    <TeamLogo team={t} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{t.name}</span>
                      {t.record && <span className="block text-[11px] leading-tight text-muted">{t.record}</span>}
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-bold tabular-nums">{pts(s.projected, c.decimals)}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-muted">proj</span>
                    </span>
                    <span className={cn("w-11 text-right text-sm font-bold tabular-nums", s.winProb >= 0.5 ? "text-ink" : "text-muted")}>{pctText(s.winProb)}</span>
                  </div>
                ))}
                <ProbBar
                  className="mt-1.5"
                  left={m.away.winProb}
                  leftColor={a.primaryColor}
                  rightColor={h.primaryColor}
                  label={`${a.name} ${pctText(m.away.winProb)}, ${h.name} ${pctText(m.home.winProb)}; ${fav.name} favored`}
                />
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Matchups not set yet">Week {nw.week} pairings appear here once the schedule or playoff bracket is set.</EmptyState>
      )}
      {nw.marquee.length > 0 && (
        <Panel title="NFL games to watch" subtitle="Most league starters' projected points" className="mt-3" noPad>
          <ul className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
            {nw.marquee.map((g) => (
              <li key={g.id} className="flex flex-col gap-1 px-3 py-2.5 sm:border-r sm:border-line sm:last:border-r-0">
                <div className="flex items-center gap-1.5 text-sm font-bold">
                  <NflLogo abbr={g.away} size={22} />
                  {g.away}
                  <span className="text-muted">@</span>
                  <NflLogo abbr={g.home} size={22} />
                  {g.home}
                </div>
                <div className="text-xs text-muted">{fmtWhen(g.kickoff, c.timezone)}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  <span>
                    <span className="text-muted">Line </span>
                    <b>{fmtLine(g.spread, g.oddsDetails)}</b>
                  </span>
                  <span>
                    <span className="text-muted">O/U </span>
                    <b>{g.overUnder ?? "—"}</b>
                  </span>
                  <span>
                    <span className="text-muted">Starters </span>
                    <b>{g.starters}</b>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </section>
  );
}

export function InjuriesToWatch({ c, myTeamId }: { c: C; myTeamId: string | null }) {
  if (!c.nextWeek) return null;
  return (
    <section className="mb-5" aria-labelledby="injuries">
      <SectionTitle
        id="injuries"
        title="Injuries to watch"
        subtitle={`Projected Week ${c.nextWeek.week} starters with an injury designation`}
        actions={
          <Link href="/injuries" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Injury report
          </Link>
        }
      />
      {c.injuries.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
          {c.injuries.map((r) => {
            const t = teamOf(c.teams, r.teamId);
            return (
              <li key={`${r.teamId}-${r.player.id}`} className={cn("flex items-center gap-2.5 px-3 py-2", myTeamId === r.teamId && "bg-gold-300/10")}>
                <PlayerHeadshot player={{ id: r.player.id, fullName: r.player.name, position: r.player.position }} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <PlayerName p={r.player} className="truncate text-sm" />
                    <InjuryTag status={r.status} />
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {r.slot} · {r.player.position}
                    {r.player.nflTeam ? ` ${r.player.nflTeam}` : ""}
                    {r.bodyPart ? ` · ${r.bodyPart}` : ""}
                    {r.practice ? ` · ${r.practice}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <TeamLogo team={t} size={20} className="ml-auto" />
                  <div className="mt-0.5 max-w-[90px] truncate text-[10px] text-muted">{t.abbrev}</div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="Clean bill of health" icon={<HeartPulse size={22} />}>
          No projected starters carry an injury designation right now.
        </EmptyState>
      )}
    </section>
  );
}
