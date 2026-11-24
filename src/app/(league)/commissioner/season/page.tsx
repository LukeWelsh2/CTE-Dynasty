// Commissioner: season & phase control — phase, keeper window, week override, rollover preview + typed
// confirmation, and the audit trail of every season action.
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarRange, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Alert, Badge, PageHeader, Panel, StatTile, TeamLogo } from "@/components/ui/core";
import { KeeperWindowForm, PhaseForm, RolloverForm, WeekOverrideForm } from "@/components/waivers/season-forms";
import { RuleLine } from "@/components/waivers/bits";
import { PHASES, PHASE_INFO, rolloverConfirmText, utcToZonedLocal, type Phase } from "@/lib/season/logic";
import { previewRollover } from "@/lib/season/rollover";
import { loadKeeperWindow, loadLeagueKeeperSummary } from "@/lib/keepers/data";
import { fmtDateTime, tzAbbrev } from "@/lib/waivers/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Season & Phases" };

const ACTION_LABEL: Record<string, string> = {
  "season.phase": "Phase changed",
  "season.week_override": "Week override",
  "season.rollover": "Season rollover",
  "keepers.window": "Keeper window",
  "keepers.lock": "Keepers locked",
  "keepers.designate": "Keeper designated",
  "keepers.undesignate": "Keeper removed",
  "keepers.clear": "Keepers cleared",
  "waivers.process_now": "Waivers processed",
};

function auditText(action: string, d: Record<string, unknown>, tz: string): string {
  switch (action) {
    case "season.phase":
      return `${PHASE_INFO[d.from as Phase]?.label ?? d.from} → ${PHASE_INFO[d.to as Phase]?.label ?? d.to}`;
    case "season.week_override":
      return d.to ? `Pinned to Week ${d.to}` : "Following the NFL week";
    case "season.rollover":
      return `${d.from} → ${d.to}: ${d.kept ?? 0} kept, ${d.released ?? 0} released${d.force ? " (forced)" : ""}`;
    case "keepers.window": {
      const a = (d.after ?? {}) as { windowOpens?: string | null; deadline?: string | null };
      return `Opens ${a.windowOpens ? fmtDateTime(a.windowOpens, tz) : "—"} · deadline ${a.deadline ? fmtDateTime(a.deadline, tz) : "—"}`;
    }
    case "keepers.lock":
      return `${d.locked ?? 0} keepers locked for ${d.season}`;
    case "keepers.designate":
    case "keepers.undesignate":
      return `${d.player ?? "Player"}${Array.isArray(d.overrides) && d.overrides.length ? ` (override: ${(d.overrides as string[]).join("; ")})` : ""}`;
    case "waivers.process_now":
      return `${d.awarded ?? 0} won · ${d.lost ?? 0} lost · ${d.invalid ?? 0} invalid`;
    default:
      return "";
  }
}

export default async function SeasonControlPage() {
  const ctx = await requireCommissioner();
  const { league, settings, nfl } = ctx;
  const tz = settings.general.timezone;
  const now = new Date();
  const [preview, window, keeperSummary, audits] = await Promise.all([
    previewRollover(league.id),
    loadKeeperWindow(league, settings, now),
    settings.keepers.enabled ? loadLeagueKeeperSummary(league.id, settings, league.season) : Promise.resolve([]),
    db.auditLog.findMany({
      where: { leagueId: league.id, OR: [{ action: { startsWith: "season." } }, { action: { startsWith: "keepers." } }, { action: "waivers.process_now" }] },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);
  const phase = league.phase as Phase;
  const confirmText = rolloverConfirmText(league.season + 1);
  const designatedTotal = keeperSummary.reduce((a, t) => a + t.view.rows.filter((r) => r.designated).length, 0);
  const teamsNoKeepers = keeperSummary.filter((t) => t.view.rows.some((r) => r.expiring && r.eligible) && !t.view.rows.some((r) => r.designated)).length;
  const keeperProblems = keeperSummary.filter((t) => t.view.check.errors.length > 0);

  return (
    <div>
      <PageHeader kicker="Commissioner" title="Season & Phases" subtitle="Move the league through its calendar, run the keeper window and start the next league year" />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Season" value={league.season} sub={`NFL ${nfl.season} · ${nfl.seasonType}`} />
        <StatTile label="Phase" value={<span className="text-xl">{PHASE_INFO[phase]?.label ?? phase}</span>} sub={PHASES.indexOf(phase) >= 0 ? `Step ${PHASES.indexOf(phase) + 1} of ${PHASES.length}` : undefined} />
        <StatTile label="Current week" value={`Week ${ctx.week}`} sub={league.weekOverride ? "Pinned by commissioner" : `Following the NFL (Week ${nfl.week})`} />
        <StatTile label="Keeper window" value={<span className="text-xl">{window.status === "OPEN" ? "Open" : window.status === "LOCKED" ? "Locked" : window.status === "DISABLED" ? "Off" : "Closed"}</span>} sub={window.deadline ? `Deadline ${fmtDateTime(window.deadline, tz)}` : "No deadline set"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Panel title="League phase" subtitle="Phases drive what managers can do (lineups, waivers, trades, keepers)">
            <PhaseForm current={league.phase} phases={PHASES.map((p) => ({ key: p, ...PHASE_INFO[p] }))} />
          </Panel>

          {settings.keepers.enabled && (
            <Panel
              title={`Keeper window — keepers for ${league.season + 1}`}
              subtitle={window.status === "OPEN" ? "Open now" : window.status === "LOCKED" ? "Locked" : "Closed"}
              actions={<Badge tone={window.status === "OPEN" ? "green" : window.status === "LOCKED" ? "red" : "neutral"}>{window.label}</Badge>}
            >
              <KeeperWindowForm opens={utcToZonedLocal(settings.keepers.windowOpens, tz)} deadline={utcToZonedLocal(settings.keepers.deadline, tz)} tzLabel={tzAbbrev(tz)} canLock={window.status === "OPEN" || (window.status === "NOT_OPEN" && designatedTotal > 0)} />
              <p className="mt-3 text-xs text-muted">
                The window is open while the league is in the Keeper phase, or between the opening time and the deadline. Reminders go out 7 days, 24 hours and 2 hours before the deadline; at the deadline every
                designation locks and the league is notified. Moving the deadline later re-opens locked designations.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Designated</div>
                  <div className="font-display text-xl font-bold">{designatedTotal}</div>
                </div>
                <div className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Teams with none yet</div>
                  <div className="font-display text-xl font-bold">{teamsNoKeepers}</div>
                </div>
                <div className="rounded-md border border-line bg-sunken/50 px-3 py-2 text-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Rule problems</div>
                  <div className={cn("font-display text-xl font-bold", keeperProblems.length && "text-loss")}>{keeperProblems.length}</div>
                </div>
              </div>
              {keeperProblems.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {keeperProblems.map((t) => (
                    <li key={t.team.id} className="flex flex-wrap items-center gap-1.5">
                      <TeamLogo team={t.team} size={16} />
                      <Link href={`/team/keepers?team=${t.team.id}`} className="link font-semibold">
                        {t.team.name}
                      </Link>
                      <span className="text-loss">{t.view.check.errors.join(" ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel title={`Roll over to ${preview.toSeason}`} subtitle="Starts the next league year. Review the preview first — this can't be undone." id="rollover" noPad>
            <div className="space-y-3 p-3">
              {preview.resumable && <Alert tone="warn">A previous rollover finished the roster moves but not the draft picks / schedule. Run it again to finish.</Alert>}
              {preview.phaseProblem && !preview.resumable && (
                <Alert tone="warn" className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{preview.phaseProblem}</span>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Keepers kept" value={preview.totals.kept} />
                <StatTile label="Contracts released" value={preview.totals.released} tone={preview.totals.released ? "bad" : undefined} />
                <StatTile label="Contracts rolling" value={preview.totals.rolled} />
                <StatTile label="Taxi promotions" value={preview.totals.promoted} />
              </div>
              <dl className="rounded-md border border-line px-3 py-1">
                <RuleLine label="Season">
                  {preview.fromSeason} → {preview.toSeason} (phase becomes Preseason, week override cleared)
                </RuleLine>
                {settings.salaryCap.enabled && (
                  <RuleLine label="Salary cap">
                    ${preview.capNow} → ${preview.capNext}
                  </RuleLine>
                )}
                {settings.contracts.enabled && (
                  <RuleLine label="Contracts">
                    1 year off every contract{settings.contracts.annualRaisePercent ? `, ${settings.contracts.annualRaisePercent}% raise` : ""}; expiring players {settings.keepers.enabled ? "kept only if designated" : "released"}
                  </RuleLine>
                )}
                <RuleLine label="FAB">
                  Reset to ${settings.waivers.faabBudget}
                  {settings.waivers.faabRollover ? " + unused balance" : ""}
                </RuleLine>
                <RuleLine label="Waiver order">Reverse {preview.fromSeason} standings</RuleLine>
                <RuleLine label="Draft picks">
                  {preview.pickSeasons[0]}–{preview.pickSeasons[preview.pickSeasons.length - 1]} for every team ({preview.picksToCreate} new)
                </RuleLine>
                <RuleLine label="Schedule">{preview.scheduleExists ? `${preview.toSeason} schedule already exists (kept)` : `${preview.scheduleWeeks}-week ${preview.toSeason} schedule generated`}</RuleLine>
                <RuleLine label="Clean-up">
                  {preview.pendingClaims} pending claim{preview.pendingClaims === 1 ? "" : "s"} cancelled · ${preview.expiredDeadMoney} expired dead money cleared
                  {preview.missingTeamSeasons ? ` · ${preview.missingTeamSeasons} ${preview.fromSeason} history rows saved` : ""}
                  {preview.voidDesignations ? ` · ${preview.voidDesignations} void designation${preview.voidDesignations === 1 ? "" : "s"}` : ""}
                </RuleLine>
              </dl>
            </div>
            <div className="max-h-[560px] overflow-auto border-y border-line">
              <table className="tbl">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Team</th>
                    <th className="num">Kept</th>
                    <th className="num">Released</th>
                    <th className="num hidden sm:table-cell">Rolling</th>
                    {settings.salaryCap.enabled && <th className="num">{preview.toSeason} payroll</th>}
                    <th className="num hidden md:table-cell">FAB</th>
                    <th className="num hidden md:table-cell">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.teams.map((t) => (
                    <tr key={t.team.id}>
                      <td>
                        <div className="flex min-w-0 items-center gap-2">
                          <TeamLogo team={t.team} size={22} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{t.team.name}</div>
                            <div className="text-[11px] text-muted">{t.record}</div>
                          </div>
                        </div>
                        {(t.released.length > 0 || t.promoted.length > 0) && (
                          <details className="mt-1 text-[11px] text-muted">
                            <summary className="cursor-pointer select-none">Details</summary>
                            {t.kept.length > 0 && <p>Kept: {t.kept.map((k) => `${k.name} ($${k.salary})`).join(", ")}</p>}
                            {t.released.length > 0 && <p className="text-loss">Released: {t.released.map((k) => `${k.name} ($${k.salary})`).join(", ")}</p>}
                            {t.promoted.length > 0 && <p>Promoted from taxi: {t.promoted.join(", ")}</p>}
                          </details>
                        )}
                      </td>
                      <td className="num">{t.kept.length}</td>
                      <td className={cn("num", t.released.length && "text-loss")}>{t.released.length}</td>
                      <td className="num hidden sm:table-cell">{t.rolled}</td>
                      {settings.salaryCap.enabled && <td className={cn("num font-semibold", t.payrollNext > preview.capNext && "text-loss")}>${t.payrollNext}</td>}
                      <td className="num hidden md:table-cell">
                        ${t.faabNow} → <b>${t.faabNext.total}</b>
                      </td>
                      <td className="num hidden md:table-cell">
                        #{t.priorityNow} → <b>#{t.priorityNext}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3">
              <RolloverForm toSeason={preview.toSeason} confirmText={confirmText} needsForce={!!preview.phaseProblem} resumable={preview.resumable} />
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="Week override" subtitle="Pin the current week, or follow the NFL">
            <WeekOverrideForm current={league.weekOverride} nflWeek={nfl.week} />
          </Panel>

          <Panel title="League calendar" noPad>
            <ol className="px-3 py-2 text-sm">
              {PHASES.map((p, i) => (
                <li key={p} className="flex items-start gap-2 py-1.5">
                  <span className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", p === phase ? "bg-brand-600 text-white" : PHASES.indexOf(phase) > i ? "bg-green-600 text-white" : "bg-sunken text-muted")}>
                    {PHASES.indexOf(phase) > i ? <CheckCircle2 size={12} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("font-semibold", p === phase ? "text-ink" : "text-muted")}>{PHASE_INFO[p].label}</span>
                    <span className="block text-[11px] text-muted">{PHASE_INFO[p].description}</span>
                  </span>
                </li>
              ))}
              <li className="flex items-start gap-2 py-1.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
                  <CalendarRange size={12} />
                </span>
                <span className="text-[11px] text-muted">Rollover → {league.season + 1} Preseason</span>
              </li>
            </ol>
          </Panel>

          <Panel title="Season audit log" noPad>
            {audits.length ? (
              <ul className="divide-y divide-line/70">
                {audits.map((a) => (
                  <li key={a.id} className="px-3 py-2 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink">{ACTION_LABEL[a.action] ?? a.action}</span>
                      <span className="shrink-0 text-[11px] text-muted">{fmtDateTime(a.createdAt, tz)}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {auditText(a.action, (a.details ?? {}) as Record<string, unknown>, tz)}
                      {a.actor ? ` · ${a.actor.name}` : " · automatic"}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-sm text-muted">No season actions yet.</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
