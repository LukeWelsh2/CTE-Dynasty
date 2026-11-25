import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { chipClass, MoreLink, PageHeader, Panel, SummaryStrip } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { ActionButton } from "@/components/ui/client";
import { AdjustmentForm, RegenerateForm, WeekEditor, WeekOverrideForm, type WeekRow } from "@/components/commissioner/schedule-tools";
import { deleteScoreAdjustment, recalculateWeek } from "@/lib/commissioner/schedule-actions";
import { lastRegularWeek } from "@/lib/commissioner/settings-validate";
import { hasFullPowers } from "@/lib/commissioner/server";
import { fmtDateTime } from "@/lib/commissioner/time";
import { statCorrectionCutoff } from "@/lib/commissioner/stat-corrections";
import { cn } from "@/lib/utils";

export const metadata = { title: "Schedule & Scores" };

const GENERATOR: Record<string, string> = { ROUND_ROBIN: "round-robin", DIVISION_WEIGHTED: "division-weighted", MANUAL: "round-robin starting" };

export default async function CommissionerSchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireCommissioner();
  const { league, settings, season } = ctx;
  const tz = settings.general.timezone;
  const sp = await searchParams;
  const maxWeek = lastFantasyWeek(settings);
  const week = Math.min(maxWeek, Math.max(1, Number(sp.week) || ctx.week));
  const firstWeek = settings.general.firstWeek;
  const lastReg = lastRegularWeek(settings);

  const [teams, matchups, adjustments, kickoff] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" }, select: { id: true, name: true, abbrev: true } }),
    db.matchup.findMany({ where: { leagueId: league.id, season }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
    db.scoreAdjustment.findMany({ where: { leagueId: league.id, season }, include: { team: { select: { name: true, abbrev: true } } }, orderBy: [{ week: "desc" }, { createdAt: "desc" }] }),
    db.nflGame.aggregate({ where: { season, week, seasonType: "REG" }, _max: { startTime: true } }),
  ]);
  // settings.general.statCorrectionDay / statCorrectionHour: when late stat corrections stop changing results
  const lastKickoff = kickoff._max.startTime;
  const correctionCutoff = lastKickoff ? statCorrectionCutoff(lastKickoff, settings) : null;
  const correctionsClosed = !!correctionCutoff && Date.now() >= correctionCutoff.getTime();
  const abbrev = new Map(teams.map((t) => [t.id, t.abbrev]));
  const weekMatchups = matchups.filter((m) => m.week === week);
  const regular: WeekRow[] = weekMatchups.filter((m) => !m.isPlayoff).map((m) => ({ id: m.id, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, label: m.label, status: m.status, homeScore: m.homeScore, awayScore: m.awayScore }));
  const playoff = weekMatchups.filter((m) => m.isPlayoff);
  const weeksWithGames = new Set(matchups.map((m) => m.week));
  const playedThrough = Math.max(0, ...matchups.filter((m) => !m.isPlayoff && m.status !== "UPCOMING").map((m) => m.week));
  const defaultFrom = Math.min(lastReg, Math.max(firstWeek, playedThrough + 1));
  const pastLocked = week < ctx.week && !settings.commissioner.canEditPastScores;
  const canFull = hasFullPowers(ctx);

  // season grid: team -> week -> opponent
  const grid = new Map<string, Map<number, string>>();
  for (const t of teams) grid.set(t.id, new Map());
  for (const m of matchups.filter((x) => !x.isPlayoff && x.week <= lastReg)) {
    if (m.homeTeamId) grid.get(m.homeTeamId)?.set(m.week, m.awayTeamId ? `${abbrev.get(m.awayTeamId)}` : "BYE");
    if (m.awayTeamId) grid.get(m.awayTeamId)?.set(m.week, m.homeTeamId ? `@${abbrev.get(m.homeTeamId)}` : "BYE");
  }
  const regWeeks = Array.from({ length: lastReg - firstWeek + 1 }, (_, i) => firstWeek + i);

  const weekLabel = week === ctx.week ? (league.weekOverride ? "pinned" : "current") : week > lastReg ? "playoffs" : week < ctx.week ? "played" : "upcoming";

  return (
    <div>
      <PageHeader
        title="Schedule"
        subtitle={`${season} · Weeks ${firstWeek}–${lastReg} · playoffs ${settings.playoffs.startWeek}–${maxWeek}`}
        actions={<MoreLink href="/schedule">Public</MoreLink>}
      />

      {/* week picker: scrolls sideways, the selected week stays in view; a dot marks the league's week */}
      <ScrollRow as="nav" aria-label="Week" className="-mx-3 mb-4 gap-1.5 px-3 pb-0.5 sm:mx-0 sm:px-0">
        {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
          <Link
            key={w}
            href={`/commissioner/schedule?week=${w}`}
            scroll={false}
            aria-current={w === week ? "page" : undefined}
            aria-label={`Week ${w}${w === ctx.week ? " (current)" : ""}${!weeksWithGames.has(w) ? " (no games yet)" : ""}`}
            className={cn(chipClass(w === week, "md", "relative min-w-11 px-0 tabular-nums"), !weeksWithGames.has(w) && w !== week && "text-muted")}
          >
            {w}
            {w === ctx.week && <span className={cn("absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full", w === week ? "bg-white" : "bg-brand-600 dark:bg-brand-400")} aria-hidden />}
          </Link>
        ))}
      </ScrollRow>

      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Week", value: week, sub: weekLabel },
          { label: "Games", value: weekMatchups.length, sub: playoff.length ? `${playoff.length} playoff` : "this week" },
          { label: "Adjust", value: adjustments.length, sub: "this season", href: "#adjust", title: "Score adjustments this season" },
          correctionCutoff
            ? { label: "Fixes", value: correctionsClosed ? "Closed" : "Open", tone: correctionsClosed ? "muted" : "good", sub: fmtDateTime(correctionCutoff, tz, { dateOnly: true }), title: `Stat corrections ${correctionsClosed ? "closed" : "change results until"} ${fmtDateTime(correctionCutoff, tz)}` }
            : { label: "Played", value: playedThrough || "—", sub: "through wk" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel
            title={`Week ${week} games`}
            subtitle={week > lastReg ? "Playoff week" : pastLocked ? "Past week · locked by league rules" : undefined}
            info={
              <>
                <p>Change opponents, add or remove games. Saving recalculates the week.</p>
                {correctionCutoff && (
                  <p>
                    Stat corrections {correctionsClosed ? "closed" : "change results until"} {fmtDateTime(correctionCutoff, tz)} (Settings › General). Recalculate re-scores the week from the latest stats.
                  </p>
                )}
              </>
            }
            actions={
              weekMatchups.length > 0 && !pastLocked ? (
                <ActionButton
                  action={recalculateWeek.bind(null, { week })}
                  size="sm"
                  variant="secondary"
                  confirm={correctionsClosed ? `Week ${week}'s stat-correction cutoff has passed, so late corrections normally don't change results. Recalculate anyway (commissioner override)?` : undefined}
                >
                  Recalculate
                </ActionButton>
              ) : undefined
            }
          >
            {week <= lastReg || regular.length ? <WeekEditor key={`${week}-${regular.map((r) => `${r.id}:${r.homeTeamId}:${r.awayTeamId}`).join()}`} week={week} rows={regular} teams={teams} editable={!pastLocked} /> : null}
            {playoff.length > 0 && (
              <div className="mt-3">
                <div className="eyebrow mb-1.5">Playoff games · managed under Season</div>
                <ul className="divide-y divide-line/70 overflow-hidden rounded-lg ring-1 ring-inset ring-line/80">
                  {playoff.map((m) => (
                    <li key={m.id} className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm">
                          {m.awayTeamId ? abbrev.get(m.awayTeamId) : "TBD"} @ {m.homeTeamId ? abbrev.get(m.homeTeamId) : "TBD"}
                        </span>
                        {m.label && <span className="block truncate text-[13px] text-muted">{m.label}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="numeral block text-[15px] font-semibold text-ink sm:text-sm">
                          {m.awayScore.toFixed(2)}–{m.homeScore.toFixed(2)}
                        </span>
                        <span className="block text-[12px] text-muted">{m.status === "FINAL" ? "Final" : m.status === "LIVE" ? "Live" : "Upcoming"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!weekMatchups.length && week > lastReg && <p className="text-[15px] text-muted sm:text-sm">The Week {week} bracket isn&apos;t set yet (Season › Playoffs).</p>}
          </Panel>

          <Panel
            id="adjust"
            title="Score adjustments"
            subtitle={`${adjustments.length} this season`}
            info={<p>Add or remove points for a team in a week (stat corrections after the cutoff, penalties). Every change recalculates that week.</p>}
            className="scroll-mt-4"
            noPad
          >
            <div className="px-4 pb-4">
              <AdjustmentForm teams={teams} defaultWeek={week} maxWeek={maxWeek} minWeek={settings.commissioner.canEditPastScores ? 1 : ctx.week} />
            </div>
            {adjustments.length ? (
              <>
                <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
                  {adjustments.map((a) => (
                    <li key={a.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{a.team.name}</span>
                        <span className="block truncate text-[13px] leading-[18px] text-muted">
                          Wk {a.week} · {a.reason}
                        </span>
                      </span>
                      <span className={cn("numeral shrink-0 text-[15px] font-semibold", a.points > 0 ? "text-win" : "text-loss")}>
                        {a.points > 0 ? "+" : ""}
                        {a.points.toFixed(2)}
                      </span>
                      {(settings.commissioner.canEditPastScores || a.week >= ctx.week) && (
                        <ActionButton action={deleteScoreAdjustment.bind(null, { id: a.id })} confirm={`Remove this ${a.points > 0 ? "+" : ""}${a.points} adjustment and recalculate Week ${a.week}?`} size="sm" variant="ghost">
                          Remove
                        </ActionButton>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto border-t border-line/70 md:block">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Week</th>
                        <th>Team</th>
                        <th className="num">Points</th>
                        <th>Reason</th>
                        <th>Added</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map((a) => (
                        <tr key={a.id}>
                          <td>Wk {a.week}</td>
                          <td className="whitespace-nowrap font-semibold">{a.team.name}</td>
                          <td className={cn("num font-semibold", a.points > 0 ? "text-win" : "text-loss")}>
                            {a.points > 0 ? "+" : ""}
                            {a.points.toFixed(2)}
                          </td>
                          <td className="text-[13px]">{a.reason}</td>
                          <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(a.createdAt, tz, { dateOnly: true })}</td>
                          <td className="text-right">
                            {(settings.commissioner.canEditPastScores || a.week >= ctx.week) && (
                              <ActionButton action={deleteScoreAdjustment.bind(null, { id: a.id })} confirm={`Remove this ${a.points > 0 ? "+" : ""}${a.points} adjustment and recalculate Week ${a.week}?`} size="xs" variant="ghost">
                                Remove
                              </ActionButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">No score adjustments this season.</p>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="League week" info={<p>Pin the league to a week (lineups, scoreboard and waivers all follow it) or let it follow the NFL calendar.</p>}>
            <WeekOverrideForm override={league.weekOverride} nflWeek={ctx.nfl.week} maxWeek={maxWeek} current={ctx.week} />
          </Panel>
          {canFull && (
            <Panel
              title="Regenerate schedule"
              info={
                <p>
                  Builds a new {GENERATOR[settings.matchups.scheduleType] ?? "round-robin"} schedule from the current settings and team list. Weeks before the start week are kept. Generator settings live in{" "}
                  <Link href="/commissioner/settings?tab=matchups" className="link">
                    Settings › Matchups
                  </Link>
                  .
                </p>
              }
            >
              <RegenerateForm firstWeek={firstWeek} lastWeek={lastReg} defaultFrom={defaultFrom} playedThrough={playedThrough} generatorLabel={GENERATOR[settings.matchups.scheduleType] ?? "round-robin"} />
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Season grid" subtitle="Regular season opponents · @ = away" noPad className="mt-4">
        <div className="scroll-thin overflow-x-auto border-t border-line/70">
          <table className="tbl tbl-compact text-[13px]">
            <thead>
              <tr>
                <th className="tbl-sticky">Team</th>
                {regWeeks.map((w) => (
                  <th key={w} className={cn("!text-center", w === ctx.week && "!text-brand-600 dark:!text-brand-400")}>
                    <Link href={`/commissioner/schedule?week=${w}`} className="inline-flex min-h-6 min-w-6 items-center justify-center hover:underline">
                      {w}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="tbl-sticky whitespace-nowrap font-semibold">{t.abbrev}</td>
                  {regWeeks.map((w) => {
                    const opp = grid.get(t.id)?.get(w);
                    return (
                      <td key={w} className={cn("whitespace-nowrap text-center", w === week && "bg-brand-600/[0.06] dark:bg-brand-400/10", !opp && "text-loss", opp === "BYE" && "text-muted")}>
                        {opp ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
