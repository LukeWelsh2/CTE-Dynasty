// Web version of a weekly recap (server component) rendered from the stored RecapContent. v3 layout (docs/DESIGN.md):
// white cards, 17px sentence-case section titles, award / player / team lists as rows, the week's matchups as
// compact score cards (per-team notes one tap away), next week as MatchupRows; explanations behind ⓘ.
import Link from "next/link";
import { ArrowLeftRight, ChevronDown, HeartPulse, Repeat, UserMinus, UserPlus } from "lucide-react";
import { Badge, Chip, EmptyState, InjuryTag, MatchupRow, MoreLink, NflLogo, Panel, PlayerHeadshot, PosBadge, StatGrid, WinProbBar } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { ShowMore } from "@/components/ui/client";
import { cn } from "@/lib/utils";
import { previewGameNote, recapGameLine, showWinnerLow } from "@/lib/recap/compute";
import type { RecapContent, RecapMatchup, RecapSide } from "@/lib/recap/types";
import { AwardIcon, EffBar, fmtWhen, MoveArrow, pctText, pts, RecapLogo, safeColor, SectionTitle, TeamName, teamOf, WinProbChart } from "./bits";

type C = RecapContent;

function PlayerName({ p, className }: { p: { id: string; name: string; position: string; nflTeam: string | null }; className?: string }) {
  return (
    <Link href={`/players/${p.id}`} title={p.name} className={cn("py-[3px] font-semibold text-ink hover:text-brand-600 hover:underline dark:hover:text-brand-400", className)}>
      {p.name}
    </Link>
  );
}

/** Jump chips for the recap's sections: a sticky row that scrolls sideways on phones. */
export function SectionNav({ c }: { c: C }) {
  const items = [
    c.matchupOfWeek && { id: "motw", label: "Matchup of the week" },
    c.awards.length && { id: "awards", label: "Awards" },
    c.matchups.length && { id: "scores", label: "Scores" },
    c.efficiency.length && { id: "efficiency", label: "Efficiency" },
    c.topPerformers.length && { id: "performers", label: "Top players" },
    c.standings.length && { id: "standings", label: "Standings" },
    c.playoffOdds?.rows.length && { id: "odds", label: "Playoff odds" },
    (c.transactions.trades.length || c.transactions.moves.length) && { id: "transactions", label: "Transactions" },
    c.nextWeek && { id: "next", label: `Week ${c.nextWeek.week} preview` },
    c.nextWeek && !c.nextWeek.historical && { id: "injuries", label: "Injuries" },
  ].filter(Boolean) as { id: string; label: string }[];
  return (
    <nav aria-label="Recap sections" className="bar-top sticky top-0 z-20 -mx-3 mb-4 px-3 py-2 sm:mx-0 sm:rounded-card sm:px-2">
      <ScrollRow className="gap-2">
        {items.map((i) => (
          <Chip key={i.id} href={`#${i.id}`} size="sm">
            {i.label}
          </Chip>
        ))}
      </ScrollRow>
    </nav>
  );
}

/** Title block: kicker, headline, the storyline, prev / next. The week's numbers follow as a SummaryStrip (page). */
export function RecapHero({ c, sentAt, prev, next }: { c: C; sentAt: Date | null; prev: number | null; next: number | null }) {
  const tz = c.timezone;
  const seasonQs = (w: number) => `/recaps/${w}?season=${c.season}`;
  return (
    <header className="mb-4">
      <div className="eyebrow mb-1">
        {c.weekLabel} recap · {c.season}
      </div>
      <h1 className="text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[30px]">{c.headline}</h1>
      <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-ink/85">{c.intro}</p>
      {c.specialNote && <p className="mt-3 inline-block rounded-lg bg-gold-400/15 px-3 py-1.5 text-[14px] text-gold-700 dark:text-gold-400">{c.specialNote}</p>}
      <p className="mt-2 text-[13px] text-muted">
        Updated {fmtWhen(c.generatedAt, tz)}
        {sentAt ? ` · emailed ${fmtWhen(sentAt, tz, false)}` : ""}
      </p>
      <nav aria-label="Other weeks" className="mt-3 flex items-center justify-between gap-2">
        {prev ? (
          <Link href={seasonQs(prev)} className="inline-flex min-h-10 items-center rounded-full bg-panel px-3.5 text-[14px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken">
            ← Week {prev}
          </Link>
        ) : (
          <span />
        )}
        <Link href={`/recaps?season=${c.season}`} className="inline-flex min-h-10 items-center text-[14px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
          All recaps
        </Link>
        {next ? (
          <Link href={seasonQs(next)} className="inline-flex min-h-10 items-center rounded-full bg-panel px-3.5 text-[14px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken">
            Week {next} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </header>
  );
}

/** A multi-week playoff game's standing after this week (combined score), under the week's scores. */
function GameLine({ c, m, className }: { c: C; m: RecapMatchup; className?: string }) {
  const g = m.game;
  if (!g) return null;
  const line = recapGameLine(g, { id: m.home.teamId, name: teamOf(c.teams, m.home.teamId).name }, { id: m.away.teamId, name: teamOf(c.teams, m.away.teamId).name }, c.decimals);
  return (
    <p className={cn("flex min-w-0 items-baseline gap-1.5 text-[13px] leading-snug", className)}>
      <span className={cn("shrink-0 rounded px-1.5 py-px text-[11px] font-bold uppercase tracking-[0.04em]", g.decided ? "bg-gold-400/20 text-gold-700 dark:text-gold-400" : "bg-sunken text-muted")}>
        {g.decided ? `${g.legs}-wk total` : `Wk ${g.leg} of ${g.legs}`}
      </span>
      <span className={cn("min-w-0", g.decided ? "font-semibold text-ink" : "text-muted")}>{line}</span>
    </p>
  );
}

/** One team line of a matchup: logo · name + record · score (winner bold). */
function SideLine({ c, side, won, tie, top }: { c: C; side: RecapSide; won: boolean; tie?: boolean; top?: boolean }) {
  const t = teamOf(c.teams, side.teamId);
  return (
    <div className="flex min-h-12 items-center gap-3 py-1.5">
      <RecapLogo team={t} size={32} />
      <div className="min-w-0 flex-1">
        <TeamName team={t} logo={false} showRecord className="text-[15px] sm:text-sm" />
        {top && side.top && (
          <div className="mt-0.5 flex min-w-0 items-baseline gap-1 text-[13px] text-muted">
            <span className="shrink-0">Top</span>
            <PlayerName p={side.top} className="min-w-0 truncate" />
            <span className="numeral shrink-0">{pts(side.top.points, c.decimals)}</span>
          </div>
        )}
      </div>
      {won && <Badge tone="green">W</Badge>}
      {tie && <Badge>T</Badge>}
      <span className={cn("numeral w-[76px] shrink-0 text-right text-[22px] font-semibold", won ? "text-ink" : "text-muted")}>{pts(side.score, c.decimals)}</span>
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
  const winnerPre = pre === null || !m.winnerTeamId ? null : m.winnerTeamId === m.home.teamId ? pre : 1 - pre;
  return (
    <section id="motw" className="mb-5 scroll-mt-16" aria-labelledby="motw-title">
      <Panel
        title={<span id="motw-title">Matchup of the week</span>}
        actions={<Badge tone="brand">{motw.reasonLabel}</Badge>}
        bodyClassName="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"
      >
        <div className="min-w-0">
          <div className="divide-y divide-line/70">
            <SideLine c={c} side={m.away} won={m.winnerTeamId === m.away.teamId} top />
            <SideLine c={c} side={m.home} won={m.winnerTeamId === m.home.teamId} top />
          </div>
          <GameLine c={c} m={m} className="pb-1" />
          <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-ink sm:text-sm">{motw.summary}</p>
          {m.blurb !== motw.summary && <p className="mt-1.5 max-w-[70ch] text-[14px] leading-relaxed text-muted sm:text-[13px]">{m.blurb}</p>}
        </div>
        <div className="min-w-0 space-y-4 rounded-xl bg-sunken p-3">
          {m.wpSeries.length >= 2 ? (
            <div>
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="font-semibold text-ink">Win probability</span>
                {motw.wpSwing !== null && <span className="text-muted">{pctText(motw.wpSwing)} swing</span>}
              </div>
              <WinProbChart series={m.wpSeries} homeColor={home.primaryColor} awayColor={away.primaryColor} homeName={home.name} awayName={away.name} />
              <div className="mt-1 flex justify-between gap-2 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: safeColor(home.primaryColor) }} aria-hidden /> {home.abbrev} above the line
                </span>
                {showWinnerLow(m.winnerLowWinProb, winnerPre) && <span>Winner&apos;s low: {pctText(m.winnerLowWinProb!)}</span>}
              </div>
            </div>
          ) : m.game ? (
            <p className="text-[13px] text-muted">Week {m.game.leg} of a {m.game.legs}-week game: decided on the combined score, so a single week&apos;s win-probability track isn&apos;t shown.</p>
          ) : (
            <p className="text-[13px] text-muted">No live win-probability track was recorded for this game.</p>
          )}
          {pre !== null && (
            <div>
              <div className="mb-1.5 flex justify-between text-[12px] font-semibold text-muted">
                <span className="numeral">
                  {away.abbrev} {pctText(1 - pre)}
                </span>
                <span className="uppercase tracking-[0.04em]">Pre-game</span>
                <span className="numeral">
                  {home.abbrev} {pctText(pre)}
                </span>
              </div>
              <WinProbBar left={1 - pre} leftColor={safeColor(away.primaryColor)} rightColor={safeColor(home.primaryColor, "#f5b301")} label={`Pre-game: ${away.name} ${pctText(1 - pre)}, ${home.name} ${pctText(pre)}`} />
            </div>
          )}
          <StatGrid
            cols={2}
            items={[
              { label: m.game ? (m.game.decided ? `${m.game.legs}-wk margin` : "Margin so far") : "Margin", value: pts(m.game ? Math.abs(m.game.homeTotal - m.game.awayTotal) : m.margin, c.decimals) },
              { label: m.game ? "Combined (wk)" : "Combined", value: pts(m.combined, c.decimals) },
            ]}
          />
          <MoreLink href={`/scoring/${m.id}`}>Box score</MoreLink>
        </div>
      </Panel>
    </section>
  );
}

export function AwardsGrid({ c, isCommish }: { c: C; isCommish: boolean }) {
  if (!c.awards.length) return null;
  const award = (a: C["awards"][number]) => {
    const t = teamOf(c.teams, a.teamId);
    return (
      <>
        <div className="flex items-start gap-3">
          <AwardIcon k={a.key} size={16} />
          <div className="min-w-0 flex-1">
            <div className="eyebrow">{a.title}</div>
            <TeamName team={t} logo={20} className="mt-1 text-[15px] sm:text-sm" />
          </div>
          <div className="numeral shrink-0 text-[20px] font-semibold text-ink">{a.value}</div>
        </div>
        <p className="mt-2 text-[14px] leading-snug text-muted sm:text-[13px]">{a.detail}</p>
        {a.player && (
          <div className="mt-2 flex items-center gap-2 border-t border-line/70 pt-2 text-[13px]">
            <PlayerHeadshot player={{ id: a.player.id, fullName: a.player.name, position: a.player.position }} size={28} />
            <PlayerName p={a.player} className="min-w-0 truncate" />
            <span className="shrink-0 text-muted">
              {a.player.position}
              {a.player.nflTeam ? ` · ${a.player.nflTeam}` : ""}
            </span>
            <span className="numeral ml-auto shrink-0 font-semibold">{pts(a.player.points, c.decimals)}</span>
          </div>
        )}
      </>
    );
  };
  return (
    <section className="mb-5" aria-labelledby="awards">
      <SectionTitle id="awards" title="Weekly awards" subtitle={`${c.awards.length} award${c.awards.length === 1 ? "" : "s"}`} actions={isCommish ? <MoreLink href="/commissioner/settings?tab=niche">Choose</MoreLink> : undefined} />
      {/* phones: one card of award rows; md+: a grid of cards */}
      <ul className="card divide-y divide-line/70 overflow-hidden md:hidden">
        {c.awards.map((a) => (
          <li key={a.key} className="px-4 py-3">
            {award(a)}
          </li>
        ))}
      </ul>
      <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-3">
        {c.awards.map((a) => (
          <article key={a.key} className="card flex flex-col p-4">
            {award(a)}
          </article>
        ))}
      </div>
    </section>
  );
}

function SideNotes({ c, side }: { c: C; side: RecapSide }) {
  const t = teamOf(c.teams, side.teamId);
  return (
    <div className="min-w-0 space-y-1 text-[13px] leading-snug">
      <div className="truncate font-semibold text-ink" title={t.name}>
        {t.abbrev}
      </div>
      {side.top ? (
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="shrink-0 text-muted">Top</span>
          <PlayerName p={side.top} className="min-w-0 truncate" />
          <span className="numeral shrink-0">{pts(side.top.points, c.decimals)}</span>
        </div>
      ) : (
        <div className="text-muted">No starters</div>
      )}
      {side.benchMiss ? (
        <div className="flex min-w-0 items-baseline gap-1" title={`${side.benchMiss.benched.name} (${pts(side.benchMiss.benched.points, c.decimals)}) sat while ${side.benchMiss.started.name} scored ${pts(side.benchMiss.started.points, c.decimals)}`}>
          <span className="shrink-0 text-muted">Bench</span>
          <PlayerName p={side.benchMiss.benched} className="min-w-0 truncate" />
          <span className="numeral shrink-0 font-semibold text-loss">+{pts(side.benchMiss.diff, c.decimals)}</span>
        </div>
      ) : (
        <div className="text-muted">No bench misses</div>
      )}
      <EffBar value={side.efficiency} className="pt-0.5" />
    </div>
  );
}

function MatchupCard({ c, m }: { c: C; m: RecapMatchup }) {
  // a week of a multi-week game that isn't over has no winner, but it isn't a tie either
  const tie = m.winnerTeamId === null && !(m.game && !m.game.decided);
  const label = m.rivalry ?? m.label ?? (m.kind === "PLAYOFF" ? "Playoffs" : m.kind === "CONSOLATION" ? "Consolation" : null);
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="flex min-h-10 items-center justify-between gap-2 px-4 pt-2">
        <span className="eyebrow truncate">{label ?? (c.matchupOfWeek?.matchupId === m.id ? "Matchup of the week" : "Final")}</span>
        <MoreLink href={`/scoring/${m.id}`}>Box score</MoreLink>
      </div>
      <div className="divide-y divide-line/70 px-4">
        <SideLine c={c} side={m.away} won={m.winnerTeamId === m.away.teamId} tie={tie} />
        <SideLine c={c} side={m.home} won={m.winnerTeamId === m.home.teamId} tie={tie} />
      </div>
      <GameLine c={c} m={m} className="px-4 pb-1.5" />
      <p className="px-4 pb-3 pt-1 text-[14px] leading-snug text-ink/85 sm:text-[13px]">{m.blurb}</p>
      {/* each team's top player, biggest bench miss and lineup efficiency: one tap away */}
      <details className="group mt-auto border-t border-line/70">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[14px] font-semibold text-brand-600 dark:text-brand-400 [&::-webkit-details-marker]:hidden">
          Top players, bench, efficiency
          <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="grid grid-cols-2 gap-3 bg-sunken px-4 py-3">
          <SideNotes c={c} side={m.away} />
          <SideNotes c={c} side={m.home} />
        </div>
      </details>
    </article>
  );
}

export function ScoresGrid({ c }: { c: C }) {
  if (!c.matchups.length) return null;
  return (
    <section className="mb-5" aria-labelledby="scores">
      <SectionTitle id="scores" title="Final scores" subtitle={`${c.matchups.length} game${c.matchups.length === 1 ? "" : "s"}`} info={<p>Every game of the week. Open a game&apos;s details for each team&apos;s top performer, biggest bench miss and lineup efficiency.</p>} />
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
      <SectionTitle id="efficiency" title="Lineup efficiency" subtitle="Points scored vs the best lineup" info={<p>Points scored ÷ the best possible lineup in hindsight (actual points, players on the roster at lock). “Left” is the points left on the bench.</p>} />
      <div className="card overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <table className="tbl table-fixed">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-8">#</th>
                <th>Team</th>
                <th className="num w-[68px]">Actual</th>
                <th className="num hidden w-[72px] sm:table-cell">Optimal</th>
                <th className="num w-[56px]">Left</th>
                <th className="w-14 text-right sm:w-[34%] sm:text-left">
                  <span className="sm:hidden">Eff</span>
                  <span className="hidden sm:inline">Efficiency</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {c.efficiency.map((e, i) => {
                const t = teamOf(c.teams, e.teamId);
                return (
                  <tr key={e.teamId} className={cn(myTeamId === e.teamId && "row-mine")}>
                    <td className="numeral text-muted">{i + 1}</td>
                    <td className="min-w-0">
                      <TeamName team={t} logo={20} className="max-w-full" />
                    </td>
                    <td className="num">{pts(e.starterPoints, c.decimals)}</td>
                    <td className="num hidden sm:table-cell">{pts(e.optimalPoints, c.decimals)}</td>
                    <td className={cn("num", e.pointsLeft >= 20 && "font-semibold text-loss")}>{pts(e.pointsLeft, c.decimals)}</td>
                    <td>
                      <EffBar value={e.efficiency} compact />
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
      <SectionTitle id="performers" title="Top NFL performers" subtitle="League scoring · who owns them" />
      <div className="card overflow-hidden">
      <ShowMore as="ol" initial={5} className="divide-y divide-line/70">
        {c.topPerformers.map((p, i) => {
          const owner = p.ownerTeamId ? teamOf(c.teams, p.ownerTeamId) : null;
          return (
            <li key={p.id} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
              <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{i + 1}</span>
              <PlayerHeadshot player={{ id: p.id, fullName: p.name, position: p.position }} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <PlayerName p={p} className="min-w-0 truncate text-[15px] sm:text-sm" />
                  <PosBadge pos={p.position} />
                  {p.nflTeam && <span className="shrink-0 text-[12px] text-muted">{p.nflTeam}</span>}
                </div>
                {p.statLine && <div className="truncate text-[13px] text-muted">{p.statLine}</div>}
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px]">
                  {owner ? (
                    <>
                      <TeamName team={owner} logo={16} className="min-w-0" />
                      {!p.started && <Badge tone="red">Benched</Badge>}
                    </>
                  ) : (
                    <Badge tone="green">Free agent</Badge>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="numeral text-[20px] font-semibold text-ink">{pts(p.points, c.decimals)}</div>
                {p.projected > 0 && <div className="numeral text-[12px] text-muted">proj {pts(p.projected, c.decimals)}</div>}
              </div>
            </li>
          );
        })}
      </ShowMore>
      </div>
    </section>
  );
}

export function StandingsMovement({ c, myTeamId }: { c: C; myTeamId: string | null }) {
  if (!c.standings.length) return null;
  return (
    <section className="mb-5" aria-labelledby="standings">
      <SectionTitle id="standings" title="Standings movement" subtitle={`After Week ${c.week}`} actions={<MoreLink href="/standings">Standings</MoreLink>} />
      <div className="card overflow-hidden">
        <div className="max-h-[560px] overflow-auto">
          <table className="tbl table-fixed">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-8">#</th>
                <th className="w-10">
                  <span className="sr-only">Change</span>
                </th>
                <th>Team</th>
                <th className="num w-[72px]">W-L</th>
                <th className="num w-[72px]">PF</th>
              </tr>
            </thead>
            <tbody>
              {c.standings.map((s) => {
                const t = teamOf(c.teams, s.teamId);
                return (
                  <tr key={s.teamId} className={cn(myTeamId === s.teamId && "row-mine")}>
                    <td className="numeral font-semibold">{s.rank}</td>
                    <td>
                      <MoveArrow change={s.change} />
                    </td>
                    <td>
                      <div className="min-w-0">
                        <TeamName team={t} logo={20} className="max-w-full" />
                        {c.lastPlace?.teamId === s.teamId && (
                          <div className="truncate pl-7 text-[12px] font-semibold text-amber-700 dark:text-amber-300" title="Last place trophy holder">
                            {c.lastPlace.trophy}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap">
                      {s.result && (
                        <span className={cn("mr-1.5 text-[12px] font-bold", s.result === "W" ? "text-win" : s.result === "L" ? "text-loss" : "text-muted")} title={`Week ${c.week}: ${s.result === "W" ? "win" : s.result === "L" ? "loss" : "tie"}`}>
                          {s.result}
                        </span>
                      )}
                      {s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`}
                    </td>
                    <td className="num">{pts(s.pointsFor, c.decimals)}</td>
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
      <SectionTitle id="odds" title="Playoff odds movers" subtitle={o.fromWeek ? `Since Week ${o.fromWeek}` : `Through Week ${o.toWeek}`} actions={<MoreLink href="/playoffs">Playoffs</MoreLink>} />
      <div className="card overflow-hidden">
      <ShowMore as="ul" initial={6} className="divide-y divide-line/70">
        {o.rows.map((r) => {
          const t = teamOf(c.teams, r.teamId);
          const d = Math.round(r.delta * 100);
          return (
            <li key={r.teamId} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <TeamName team={t} logo={24} className="min-w-0 flex-1 text-[15px] sm:text-sm" />
              <span className="flex shrink-0 items-center gap-2">
                <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-ink/[0.07] sm:block dark:bg-white/[0.08]" aria-hidden>
                  <span className="block h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${Math.round(r.after * 100)}%` }} />
                </span>
                <span className="numeral w-11 text-right text-[15px] font-semibold text-ink">{pctText(r.after)}</span>
              </span>
              <span className={cn("numeral w-10 shrink-0 text-right text-[13px] font-semibold", d > 0 ? "text-win" : d < 0 ? "text-loss" : "text-muted")}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "0"}</span>
            </li>
          );
        })}
      </ShowMore>
      </div>
    </section>
  );
}

const MOVE_ICON = { ADD: UserPlus, WAIVER: UserPlus, DROP: UserMinus, MOVE: ArrowLeftRight } as const;

export function TransactionsBlock({ c }: { c: C }) {
  const tx = c.transactions;
  const commishMoves = tx.moves.filter((m) => m.byCommissioner).length;
  if (!tx.trades.length && !tx.moves.length) {
    return (
      <section className="mb-5" aria-labelledby="transactions">
        <SectionTitle id="transactions" title="Trades & transactions" />
        <EmptyState title="A quiet week on the wire" icon={<Repeat size={22} />}>
          No trades, adds or drops in Week {c.week}.
        </EmptyState>
      </section>
    );
  }
  return (
    <section className="mb-5" aria-labelledby="transactions">
      <SectionTitle
        id="transactions"
        title="Trades & transactions"
        subtitle={`${tx.adds} add${tx.adds === 1 ? "" : "s"} · ${tx.drops} drop${tx.drops === 1 ? "" : "s"} · ${tx.trades.length} trade${tx.trades.length === 1 ? "" : "s"}${tx.faabSpent ? ` · $${tx.faabSpent} FAB` : ""}${commishMoves ? ` · ${commishMoves} by commish` : ""}`}
        actions={<MoreLink href="/transactions">Log</MoreLink>}
      />
      <div className="space-y-3">
        {tx.trades.map((tr) => (
          <article key={tr.tradeId} className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <ArrowLeftRight size={15} className="text-muted" aria-hidden />
              <span className="eyebrow">Trade</span>
              <span className="text-muted">{fmtWhen(tr.at, c.timezone)}</span>
              {tr.status === "REVERSED" && <Badge tone="red">Reversed by commissioner</Badge>}
            </div>
            <div className={cn("grid gap-3", tr.sides.length > 1 && "sm:grid-cols-2")}>
              {tr.sides.map((s) => (
                <div key={s.teamId} className="min-w-0 rounded-lg bg-sunken p-3">
                  <TeamName team={teamOf(c.teams, s.teamId)} logo={20} className="text-[15px] sm:text-sm" />
                  <div className="eyebrow mt-1.5">Receives</div>
                  <ul className="mt-0.5 space-y-0.5 text-[14px] sm:text-[13px]">{s.received.length ? s.received.map((r) => <li key={r}>{r}</li>) : <li className="text-muted">Nothing</li>}</ul>
                </div>
              ))}
            </div>
          </article>
        ))}
        {tx.moves.length > 0 && (
          <div className="card overflow-hidden">
          <ShowMore as="ul" initial={5} className="divide-y divide-line/70">
            {tx.moves.map((mv, i) => {
              const Icon = MOVE_ICON[mv.type] ?? UserPlus;
              const t = mv.teamId ? teamOf(c.teams, mv.teamId) : null;
              return (
                <li key={`${mv.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5 text-[14px] sm:text-[13px]">
                  <Icon size={16} className={cn("mt-0.5 shrink-0", mv.type === "DROP" ? "text-loss" : mv.type === "MOVE" ? "text-muted" : "text-win")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {t && <TeamName team={t} logo={16} className="min-w-0 text-[13px]" />}
                      {mv.byCommissioner && <Badge tone="neutral">Commish</Badge>}
                    </div>
                    <div className="text-ink">{mv.description}</div>
                  </div>
                  <span className="shrink-0 text-[12px] text-muted">{fmtWhen(mv.at, c.timezone, false)}</span>
                </li>
              );
            })}
          </ShowMore>
          </div>
        )}
        {(tx.biggestFaab || tx.mostActiveTeamId) && (
          <p className="text-[13px] text-muted">
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
        subtitle={nw.historical ? "Pre-game projections" : "Projections as of this recap"}
        info={<p>{nw.historical ? `Pre-game projections and win probabilities. This recap was written after Week ${nw.week} kicked off.` : "Projected scores and win probabilities as of this recap."}</p>}
        actions={<MoreLink href={`/scoring?week=${nw.week}`}>Scoreboard</MoreLink>}
      />
      {nw.matchups.length ? (
        <ul className="card divide-y divide-line/70 overflow-hidden">
          {nw.matchups.map((m) => {
            const a = teamOf(c.teams, m.away.teamId);
            const h = teamOf(c.teams, m.home.teamId);
            const mine = !!myTeamId && (m.away.teamId === myTeamId || m.home.teamId === myTeamId);
            return (
              <li key={m.id}>
                <MatchupRow
                  href={`/scoring/${m.id}`}
                  mine={mine}
                  myTeamId={myTeamId}
                  status="UPCOMING"
                  label={m.label}
                  note={m.game ? previewGameNote(c, m) : undefined}
                  homeWinProb={m.home.winProb}
                  decimals={c.decimals}
                  away={{ team: { ...a, id: a.id || `away-${m.id}` }, score: 0, projected: m.away.projected, record: a.record }}
                  home={{ team: { ...h, id: h.id || `home-${m.id}` }, score: 0, projected: m.home.projected, record: h.record }}
                  logo={(t) => <RecapLogo team={t.id === a.id ? a : h} size={24} />}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="Matchups not set yet">Week {nw.week} pairings appear once the schedule or bracket is set.</EmptyState>
      )}
      {nw.marquee.length > 0 && (
        <Panel title="NFL games to watch" subtitle="Most league starters' projected points" className="mt-3" noPad>
          <ul className="grid grid-cols-1 divide-y divide-line/70 border-t border-line/70 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
            {nw.marquee.map((g) => (
              <li key={g.id} className="flex flex-col gap-1 px-4 py-2.5 sm:border-r sm:border-line/70 sm:last:border-r-0">
                <div className="flex items-center gap-1.5 text-[15px] font-semibold sm:text-sm">
                  <NflLogo abbr={g.away} size={22} />
                  {g.away}
                  <span className="text-muted">@</span>
                  <NflLogo abbr={g.home} size={22} />
                  {g.home}
                </div>
                <div className="text-[13px] text-muted">{fmtWhen(g.kickoff, c.timezone)}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
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
  // a backfilled recap has no injury report for a week that was already being played
  if (!c.nextWeek || c.nextWeek.historical) return null;
  return (
    <section className="mb-5" aria-labelledby="injuries">
      <SectionTitle id="injuries" title="Injuries to watch" subtitle={`Projected Week ${c.nextWeek.week} starters`} actions={<MoreLink href="/injuries">Report</MoreLink>} />
      {c.injuries.length ? (
        <div className="card overflow-hidden">
        <ShowMore as="ul" initial={5} className="divide-y divide-line/70">
          {c.injuries.map((r) => {
            const t = teamOf(c.teams, r.teamId);
            return (
              <li key={`${r.teamId}-${r.player.id}`} className={cn("flex min-h-[56px] items-center gap-3 px-4 py-2", myTeamId === r.teamId && "mine shadow-[inset_3px_0_0_rgb(var(--c-accent))]")}>
                <PlayerHeadshot player={{ id: r.player.id, fullName: r.player.name, position: r.player.position }} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <PlayerName p={r.player} className="min-w-0 truncate text-[15px] sm:text-sm" />
                    <InjuryTag status={r.status} />
                  </div>
                  <div className="truncate text-[13px] text-muted">
                    {r.slot} · {r.player.position}
                    {r.player.nflTeam ? ` ${r.player.nflTeam}` : ""}
                    {r.bodyPart ? ` · ${r.bodyPart}` : ""}
                    {r.practice ? ` · ${r.practice}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="max-w-[64px] truncate text-[12px] font-semibold text-muted">{t.abbrev}</span>
                  <RecapLogo team={t} size={22} />
                </div>
              </li>
            );
          })}
        </ShowMore>
        </div>
      ) : (
        <EmptyState title="Clean bill of health" icon={<HeartPulse size={22} />}>
          No projected starters carry an injury designation right now.
        </EmptyState>
      )}
    </section>
  );
}
