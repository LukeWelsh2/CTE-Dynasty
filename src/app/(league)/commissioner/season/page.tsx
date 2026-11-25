// Commissioner: season & phase control — phase, keeper window, week override, rollover preview + typed
// confirmation, and the audit trail of every season action.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, CheckCircle2, ChevronDown } from "lucide-react";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Alert, Badge, PageHeader, Panel, StatGrid, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { KeeperWindowForm, PhaseForm, RolloverForm, WeekOverrideForm } from "@/components/waivers/season-forms";
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

  const keeperStatus = window.status === "OPEN" ? "Open" : window.status === "LOCKED" ? "Locked" : window.status === "DISABLED" ? "Off" : "Closed";
  const phaseLabel = PHASE_INFO[phase]?.label ?? phase;
  const phaseShort = phaseLabel.replace(" season", "").replace(" window", "");

  return (
    <div>
      <PageHeader title="Season" subtitle={`${league.season} league year · NFL ${nfl.season} ${nfl.seasonType.toLowerCase()}`} />
      <SummaryStrip
        className="mb-4"
        items={[
          {
            label: "Phase",
            value: <span className={cn(phaseShort.length > 7 && "text-[17px] sm:text-[24px]")}>{phaseShort}</span>,
            sub: PHASES.indexOf(phase) >= 0 ? `step ${PHASES.indexOf(phase) + 1} of ${PHASES.length}` : undefined,
            title: `${phaseLabel} · ${league.season} season · NFL ${nfl.season} ${nfl.seasonType}`,
          },
          { label: "Week", value: ctx.week, sub: league.weekOverride ? "pinned" : `NFL wk ${nfl.week}`, title: league.weekOverride ? "Pinned by the commissioner" : `Following the NFL (Week ${nfl.week})` },
          { label: "Keepers", value: keeperStatus, sub: window.deadline ? fmtDateTime(window.deadline, tz).split(",")[0] : "no deadline", title: window.deadline ? `Deadline ${fmtDateTime(window.deadline, tz)}` : "No deadline set" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Panel title="League phase" info={<p>The phase controls lineups, waivers, trades and keepers. Each phase&apos;s effect is listed under its name.</p>}>
            <PhaseForm current={league.phase} phases={PHASES.map((p) => ({ key: p, ...PHASE_INFO[p] }))} />
          </Panel>

          {settings.keepers.enabled && (
            <Panel
              title="Keeper window"
              subtitle={`Keepers for ${league.season + 1}`}
              info={
                <p>
                  The window is open while the league is in the Keeper phase, or between the opening time and the deadline. Reminders go out 7 days, 24 hours and 2 hours before the deadline; at the deadline every
                  designation locks and the league is notified. Moving the deadline later re-opens locked designations.
                </p>
              }
              actions={<Badge tone={window.status === "OPEN" ? "green" : window.status === "LOCKED" ? "red" : "neutral"}>{window.status === "OPEN" ? "Open" : window.status === "LOCKED" ? "Locked" : "Closed"}</Badge>}
            >
              <StatGrid
                cols={3}
                className="mb-4"
                items={[
                  { label: "Kept", value: designatedTotal, sub: "designated" },
                  { label: "None yet", value: teamsNoKeepers, sub: "teams" },
                  { label: "Problems", value: keeperProblems.length, tone: keeperProblems.length ? "bad" : undefined, sub: "rule checks" },
                ]}
              />
              {keeperProblems.length > 0 && (
                <ul className="mb-4 space-y-1.5 text-[13px]">
                  {keeperProblems.map((t) => (
                    <li key={t.team.id} className="flex flex-wrap items-center gap-1.5">
                      <TeamLogo team={t.team} size={18} />
                      <Link href={`/team/keepers?team=${t.team.id}`} className="link font-semibold">
                        {t.team.name}
                      </Link>
                      <span className="text-loss">{t.view.check.errors.join(" ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <KeeperWindowForm opens={utcToZonedLocal(settings.keepers.windowOpens, tz)} deadline={utcToZonedLocal(settings.keepers.deadline, tz)} tzLabel={tzAbbrev(tz)} canLock={window.status === "OPEN" || (window.status === "NOT_OPEN" && designatedTotal > 0)} />
            </Panel>
          )}

          <Panel title={`Roll over to ${preview.toSeason}`} subtitle="Starts the next league year · can't be undone" id="rollover" info={<p>Rollover moves every team into the next league year with the changes below. Type the confirmation text to run it.</p>} noPad>
            <div className="space-y-4 px-4 pb-4">
              {preview.resumable && <Alert tone="warn">A previous rollover finished the roster moves but not the draft picks / schedule. Run it again to finish.</Alert>}
              {preview.phaseProblem && !preview.resumable && (
                <Alert tone="warn" icon>
                  {preview.phaseProblem}
                </Alert>
              )}
              {settings.salaryCap.enabled && (settings.salaryCap.rolloverMode ?? "NONE") !== "NONE" && (
                <Alert tone="info">
                  Unused cap room does not carry over. The cap rollover setting (
                  {settings.salaryCap.rolloverMode === "FULL_UNUSED" ? "all unused room" : `${settings.salaryCap.rolloverPercent}% of unused room`}) isn&apos;t applied because the league has one cap for every team —
                  every team starts {preview.toSeason} with the same ${preview.capNext} cap.
                </Alert>
              )}
              <StatGrid
                cols={4}
                items={[
                  { label: "Kept", value: preview.totals.kept, sub: "keepers" },
                  { label: "Released", value: preview.totals.released, tone: preview.totals.released ? "bad" : undefined, sub: "contracts" },
                  { label: "Rolling", value: preview.totals.rolled, sub: "contracts" },
                  { label: "Promoted", value: preview.totals.promoted, sub: "from taxi" },
                ]}
              />
              <dl className="divide-y divide-line/70 rounded-lg ring-1 ring-inset ring-line/80">
                <Line label="Season">
                  {preview.fromSeason} → {preview.toSeason} · phase becomes Preseason, week override cleared
                </Line>
                {settings.salaryCap.enabled && (
                  <Line label="Salary cap">
                    ${preview.capNow} → ${preview.capNext}
                    {settings.salaryCap.annualCapIncrease ? <span className="text-muted"> (+${settings.salaryCap.annualCapIncrease} growth)</span> : null}
                  </Line>
                )}
                {settings.contracts.enabled && (
                  <Line label="Contracts">
                    1 year off every contract{settings.contracts.annualRaisePercent ? `, ${settings.contracts.annualRaisePercent}% raise` : ""}; expiring players {settings.keepers.enabled ? "kept only if designated" : "released"}
                  </Line>
                )}
                <Line label="FAB">
                  Reset to ${settings.waivers.faabBudget}
                  {settings.waivers.faabRollover ? " + unused balance" : ""}
                </Line>
                <Line label="Waiver order">Reverse {preview.fromSeason} standings</Line>
                <Line label="Draft picks">
                  {preview.pickSeasons[0]}–{preview.pickSeasons[preview.pickSeasons.length - 1]} for every team ({preview.picksToCreate} new)
                </Line>
                <Line label="Schedule">{preview.scheduleExists ? `${preview.toSeason} schedule already exists (kept)` : `${preview.scheduleWeeks}-week ${preview.toSeason} schedule generated`}</Line>
                <Line label="Clean-up">
                  {preview.pendingClaims} pending claim{preview.pendingClaims === 1 ? "" : "s"} cancelled · ${preview.expiredDeadMoney} expired dead money cleared
                  {preview.missingTeamSeasons ? ` · ${preview.missingTeamSeasons} ${preview.fromSeason} history rows saved` : ""}
                  {preview.voidDesignations ? ` · ${preview.voidDesignations} void designation${preview.voidDesignations === 1 ? "" : "s"}` : ""}
                </Line>
              </dl>
            </div>

            {/* phones: one row per team, tap for who is kept / released / promoted, FAB and waiver priority */}
            <ul className="divide-y divide-line/70 border-y border-line/70 md:hidden">
              {preview.teams.map((t) => (
                <li key={t.team.id}>
                  <details className="group">
                    <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                      <TeamLogo team={t.team} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold leading-5 text-ink" title={t.team.name}>
                          {t.team.name}
                        </span>
                        <span className="block truncate text-[13px] leading-[18px] text-muted">
                          {t.record} · {t.kept.length} kept · <span className={cn(t.released.length && "text-loss")}>{t.released.length} cut</span>
                        </span>
                      </span>
                      {settings.salaryCap.enabled && (
                        <span className="shrink-0 text-right">
                          <span className={cn("numeral block text-[15px] font-semibold leading-5", t.payrollNext > preview.capNext ? "text-loss" : "text-ink")}>${t.payrollNext}</span>
                          <span className="block text-[12px] leading-4 text-muted">payroll</span>
                        </span>
                      )}
                      <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="space-y-1.5 bg-sunken px-4 py-3 text-[13px]">
                      <p>
                        <span className="eyebrow mr-1.5">Kept</span>
                        {t.kept.length ? t.kept.map((k) => `${k.name} ($${k.salary})`).join(", ") : <span className="text-muted">None</span>}
                      </p>
                      <p>
                        <span className="eyebrow mr-1.5">Released</span>
                        {t.released.length ? <span className="text-loss">{t.released.map((k) => `${k.name} ($${k.salary})`).join(", ")}</span> : <span className="text-muted">None</span>}
                      </p>
                      {t.promoted.length > 0 && (
                        <p>
                          <span className="eyebrow mr-1.5">From taxi</span>
                          {t.promoted.join(", ")}
                        </p>
                      )}
                      <p>
                        <span className="eyebrow mr-1.5">Rolling</span>
                        {t.rolled} contracts
                      </p>
                      <p>
                        <span className="eyebrow mr-1.5">FAB</span>${t.faabNow} → <b>${t.faabNext.total}</b>
                        <span className="eyebrow ml-3 mr-1.5">Priority</span>#{t.priorityNow} → <b>#{t.priorityNext}</b>
                      </p>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            <div className="hidden max-h-[560px] overflow-auto border-y border-line/70 md:block">
              <table className="tbl">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Team</th>
                    <th className="num">Kept</th>
                    <th className="num">Released</th>
                    <th className="num">Rolling</th>
                    {settings.salaryCap.enabled && <th className="num">{preview.toSeason} payroll</th>}
                    <th className="num">FAB</th>
                    <th className="num">Priority</th>
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
                            <div className="text-[12px] text-muted">{t.record}</div>
                          </div>
                        </div>
                        {(t.released.length > 0 || t.promoted.length > 0) && (
                          <details className="mt-1 text-[12px] text-muted">
                            <summary className="inline-flex min-h-6 cursor-pointer select-none items-center font-semibold text-brand-600 dark:text-brand-400">Details</summary>
                            {t.kept.length > 0 && <p>Kept: {t.kept.map((k) => `${k.name} ($${k.salary})`).join(", ")}</p>}
                            {t.released.length > 0 && <p className="text-loss">Released: {t.released.map((k) => `${k.name} ($${k.salary})`).join(", ")}</p>}
                            {t.promoted.length > 0 && <p>Promoted from taxi: {t.promoted.join(", ")}</p>}
                          </details>
                        )}
                      </td>
                      <td className="num">{t.kept.length}</td>
                      <td className={cn("num", t.released.length && "text-loss")}>{t.released.length}</td>
                      <td className="num">{t.rolled}</td>
                      {settings.salaryCap.enabled && <td className={cn("num font-semibold", t.payrollNext > preview.capNext && "text-loss")}>${t.payrollNext}</td>}
                      <td className="num">
                        ${t.faabNow} → <b>${t.faabNext.total}</b>
                      </td>
                      <td className="num">
                        #{t.priorityNow} → <b>#{t.priorityNext}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4">
              <RolloverForm toSeason={preview.toSeason} confirmText={confirmText} needsForce={!!preview.phaseProblem} resumable={preview.resumable} />
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="Week override" info={<p>Pin the current week, or follow the NFL calendar.</p>}>
            <WeekOverrideForm current={league.weekOverride} nflWeek={nfl.week} />
          </Panel>

          <Panel title="League calendar" noPad>
            <ol className="border-t border-line/70 px-4 py-2">
              {PHASES.map((p, i) => (
                <li key={p} className="flex items-start gap-3 py-2">
                  <span className={cn("mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold", p === phase ? "bg-brand-600 text-white" : PHASES.indexOf(phase) > i ? "bg-green-700 text-white" : "bg-sunken text-muted")}>
                    {PHASES.indexOf(phase) > i ? <CheckCircle2 size={14} aria-label="done" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-[15px] font-semibold sm:text-sm", p === phase ? "text-ink" : "text-muted")}>{PHASE_INFO[p].label}</span>
                    <span className="block text-[13px] leading-snug text-muted">{PHASE_INFO[p].description}</span>
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-3 py-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-muted">
                  <CalendarRange size={14} aria-hidden />
                </span>
                <span className="text-[13px] text-muted">Rollover → {league.season + 1} Preseason</span>
              </li>
            </ol>
          </Panel>

          <Panel title="Season log" noPad>
            {audits.length ? (
              <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
                {audits.map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold text-ink sm:text-sm">{ACTION_LABEL[a.action] ?? a.action}</span>
                      <span className="shrink-0 text-[12px] text-muted">{fmtDateTime(a.createdAt, tz)}</span>
                    </div>
                    <div className="text-[13px] text-muted">
                      {auditText(a.action, (a.details ?? {}) as Record<string, unknown>, tz)}
                      {a.actor ? ` · ${a.actor.name}` : " · automatic"}
                    </div>
                  </li>
                ))}
              </ShowMore>
            ) : (
              <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">No season actions yet.</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** A rollover line: label over value on phones, side by side from sm. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 sm:flex sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="eyebrow sm:shrink-0 sm:text-[13px] sm:font-normal sm:normal-case sm:tracking-normal">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-[15px] text-ink sm:mt-0 sm:text-right sm:text-sm">{children}</dd>
    </div>
  );
}
