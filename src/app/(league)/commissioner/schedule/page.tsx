import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { Badge, PageHeader, Panel } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { AdjustmentForm, RegenerateForm, WeekEditor, WeekOverrideForm, type WeekRow } from "@/components/commissioner/schedule-tools";
import { deleteScoreAdjustment, recalculateWeek } from "@/lib/commissioner/schedule-actions";
import { lastRegularWeek } from "@/lib/commissioner/settings-validate";
import { hasFullPowers } from "@/lib/commissioner/server";
import { fmtDateTime } from "@/lib/commissioner/time";
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

  const [teams, matchups, adjustments] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" }, select: { id: true, name: true, abbrev: true } }),
    db.matchup.findMany({ where: { leagueId: league.id, season }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
    db.scoreAdjustment.findMany({ where: { leagueId: league.id, season }, include: { team: { select: { name: true, abbrev: true } } }, orderBy: [{ week: "desc" }, { createdAt: "desc" }] }),
  ]);
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

  return (
    <div>
      <PageHeader
        kicker="Commissioner"
        title="Schedule & Scores"
        subtitle={`${season} · regular season Weeks ${firstWeek}-${lastReg}, playoffs Weeks ${settings.playoffs.startWeek}-${maxWeek} · ${adjustments.length} score adjustment${adjustments.length === 1 ? "" : "s"}`}
        actions={
          <Link href="/schedule" className="link text-sm">
            Public schedule
          </Link>
        }
      />

      <nav aria-label="Week" className="scroll-thin -mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
          <Link
            key={w}
            href={`/commissioner/schedule?week=${w}`}
            aria-current={w === week ? "page" : undefined}
            className={cn(
              "flex h-9 min-w-[2.5rem] shrink-0 flex-col items-center justify-center rounded-md border px-2 text-xs font-bold",
              w === week ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-panel text-ink hover:bg-sunken",
              !weeksWithGames.has(w) && w !== week && "opacity-50",
            )}
          >
            {w}
            {w === ctx.week && <span className={cn("h-1 w-1 rounded-full", w === week ? "bg-white" : "bg-gold-500")} aria-label="current week" />}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel
            title={`Week ${week} matchups`}
            subtitle={week > lastReg ? "Playoff week" : pastLocked ? "Past week — locked by league rules" : "Change opponents, add or remove games. Saving recalculates the week."}
            actions={
              weekMatchups.length > 0 && !pastLocked ? (
                <ActionButton action={recalculateWeek.bind(null, { week })} size="xs" variant="secondary">
                  Recalculate Week {week}
                </ActionButton>
              ) : undefined
            }
          >
            {week <= lastReg || regular.length ? <WeekEditor key={`${week}-${regular.map((r) => `${r.id}:${r.homeTeamId}:${r.awayTeamId}`).join()}`} week={week} rows={regular} teams={teams} editable={!pastLocked} /> : null}
            {playoff.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Playoff games (managed under Season)</div>
                <ul className="divide-y divide-line rounded-md border border-line">
                  {playoff.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span>
                        {m.label && <Badge tone={m.isChampionship ? "gold" : m.isConsolation ? "neutral" : "brand"} className="mr-2">{m.label}</Badge>}
                        {m.awayTeamId ? abbrev.get(m.awayTeamId) : "TBD"} @ {m.homeTeamId ? abbrev.get(m.homeTeamId) : "TBD"}
                      </span>
                      <span className="tabular-nums text-muted">
                        {m.awayScore.toFixed(2)}–{m.homeScore.toFixed(2)} · {m.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!weekMatchups.length && week > lastReg && <p className="text-sm text-muted">The playoff bracket for Week {week} hasn&apos;t been created yet (Season › Playoffs).</p>}
          </Panel>

          <Panel id="adjust" title="Score adjustments" subtitle="Add or remove points for a team in a week (stat corrections after the cutoff, penalties). Every change recalculates that week." noPad>
            <div className="border-b border-line p-3">
              <AdjustmentForm teams={teams} defaultWeek={week} maxWeek={maxWeek} minWeek={settings.commissioner.canEditPastScores ? 1 : ctx.week} />
            </div>
            {adjustments.length ? (
              <div className="overflow-x-auto">
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
                        <td className="text-xs">{a.reason}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(a.createdAt, tz, { dateOnly: true })}</td>
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
            ) : (
              <p className="p-3 text-sm text-muted">No score adjustments this season.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="League week">
            <WeekOverrideForm override={league.weekOverride} nflWeek={ctx.nfl.week} maxWeek={maxWeek} current={ctx.week} />
          </Panel>
          {canFull && (
            <Panel title="Regenerate schedule">
              <RegenerateForm firstWeek={firstWeek} lastWeek={lastReg} defaultFrom={defaultFrom} playedThrough={playedThrough} generatorLabel={GENERATOR[settings.matchups.scheduleType] ?? "round-robin"} />
              <p className="mt-2 text-xs text-muted">
                Generator settings:{" "}
                <Link href="/commissioner/settings?tab=matchups" className="link">
                  Settings › Matchups
                </Link>
              </p>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Season grid" subtitle="Every team's regular season opponents (@ = away)" noPad className="mt-4">
        <div className="overflow-x-auto">
          <table className="tbl tbl-compact text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-sunken">Team</th>
                {regWeeks.map((w) => (
                  <th key={w} className={cn("!text-center", w === ctx.week && "text-gold-600 dark:text-gold-400")}>
                    <Link href={`/commissioner/schedule?week=${w}`} className="hover:underline">
                      {w}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="sticky left-0 z-[5] whitespace-nowrap bg-panel font-semibold">{t.abbrev}</td>
                  {regWeeks.map((w) => {
                    const opp = grid.get(t.id)?.get(w);
                    return (
                      <td key={w} className={cn("whitespace-nowrap text-center", w === week && "bg-brand-50/60 dark:bg-brand-900/20", !opp && "text-loss", opp === "BYE" && "text-muted")}>
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
