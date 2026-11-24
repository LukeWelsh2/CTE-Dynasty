// Keepers: designate which expiring contracts to keep for next season, see what rolls over automatically,
// next season's cap projection, and (after the deadline, or for the commissioner) every team's keepers.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Lock, Shield } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, Badge, EmptyState, InjuryTag, PageHeader, Panel, PlayerLink, PosBadge, StatTile, TeamLogo } from "@/components/ui/core";
import { TeamTabs } from "@/components/team/team-tabs";
import { TeamSwitcher } from "@/components/team/team-switcher";
import { Countdown } from "@/components/waivers/countdown";
import { PayrollMeter, RuleLine } from "@/components/waivers/bits";
import { ClearKeepersButton, KeeperToggle } from "@/components/waivers/keeper-toggle";
import { loadKeeperWindow, loadLeagueKeepers, loadTeamKeepers, type KeeperRow } from "@/lib/keepers/data";
import { nextSeasonCap } from "@/lib/keepers/logic";
import { fmtDateTime } from "@/lib/waivers/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Keepers" };

const STATUS_TONE = { OPEN: "green", NOT_OPEN: "neutral", LOCKED: "red", DISABLED: "neutral" } as const;
const STATUS_LABEL = { OPEN: "Window open", NOT_OPEN: "Not open yet", LOCKED: "Locked", DISABLED: "Off" } as const;

function escalationText(e: { type: string; value: number; minIncrease: number }) {
  if (e.type === "PERCENT") return `+${e.value}% (rounded up${e.minIncrease ? `, at least +$${e.minIncrease}` : ""})`;
  if (e.type === "FLAT") return `+$${e.value} per year kept`;
  return "No raise";
}

export default async function KeepersPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam, isCommish } = ctx;
  const tz = settings.general.timezone;
  const k = settings.keepers;
  const nextSeason = league.season + 1;
  const now = new Date();

  const teams = await db.team.findMany({ where: { leagueId: league.id }, select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true }, orderBy: { name: "asc" } });
  const requested = sp.team && isCommish ? teams.find((t) => t.id === sp.team) : undefined;
  const team = requested ?? (myTeam ? teams.find((t) => t.id === myTeam.id) : undefined);
  const window = await loadKeeperWindow(league, settings, now);
  const managing = !!team && (team.id === myTeam?.id || isCommish);
  const commishSelects = (k.selectionBy ?? "OWNERS") === "COMMISSIONER";
  const canEdit = managing && k.enabled && (isCommish || (window.status === "OPEN" && !commishSelects));
  const commishOverride = isCommish && window.status !== "OPEN";
  const showLeague = isCommish || window.status === "LOCKED";

  const [view, leagueKeepers] = await Promise.all([
    team ? loadTeamKeepers(league.id, team.id, settings, league.season) : Promise.resolve(null),
    showLeague ? loadLeagueKeepers(league.id, nextSeason) : Promise.resolve([]),
  ]);

  const header = (
    <>
      <TeamTabs active="keepers" keepers={k.enabled} />
      <PageHeader
        kicker="My Team"
        title="Keepers"
        subtitle={`Decide which expiring contracts carry into ${nextSeason}`}
        actions={isCommish && teams.length > 0 ? <TeamSwitcher teams={teams} current={team?.id ?? null} myTeamId={myTeam?.id ?? null} /> : undefined}
      />
    </>
  );

  if (!k.enabled) {
    return (
      <div>
        {header}
        <EmptyState title="Keepers are turned off">This league doesn&apos;t use keeper designations. Every contract follows the league&apos;s contract rules at the rollover.</EmptyState>
      </div>
    );
  }

  const expiring = view?.rows.filter((r) => r.expiring) ?? [];
  const rolling = view?.rows.filter((r) => !r.expiring) ?? [];
  const designated = expiring.filter((r) => r.designated);
  const capOn = settings.salaryCap.enabled;
  const p = view?.projection;
  const byTeam = new Map<string, typeof leagueKeepers>();
  for (const d of leagueKeepers) byTeam.set(d.teamId, [...(byTeam.get(d.teamId) ?? []), d]);

  return (
    <div>
      {header}

      <section className={cn("mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3", window.status === "OPEN" ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20" : window.status === "LOCKED" ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20" : "border-line bg-panel")}>
        <div className="flex min-w-0 items-start gap-3">
          {window.status === "LOCKED" ? <Lock className="mt-0.5 shrink-0 text-loss" size={20} /> : <CalendarClock className="mt-0.5 shrink-0 text-brand-600" size={20} />}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[window.status]}>{STATUS_LABEL[window.status]}</Badge>
              <span className="font-semibold text-ink">{window.label}</span>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {window.status === "OPEN" && (window.deadline ? <>Designations lock {fmtDateTime(window.deadline, tz)}.</> : "The commissioner hasn't set a deadline yet.")}
              {window.status === "NOT_OPEN" && (window.opensAt ? <>Opens {fmtDateTime(window.opensAt, tz)}{window.deadline ? ` · deadline ${fmtDateTime(window.deadline, tz)}` : ""}.</> : "The commissioner opens the keeper window after the season. You can plan below in the meantime.")}
              {window.status === "LOCKED" && <>Keepers below are final{window.deadline ? ` (deadline was ${fmtDateTime(window.deadline, tz)})` : ""}. Undesignated expiring players are released at the rollover.</>}
            </p>
          </div>
        </div>
        {window.deadline && window.status !== "LOCKED" && (
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Deadline in</div>
            <Countdown to={window.deadline.toISOString()} initialNow={now.getTime()} className="font-display text-2xl font-bold text-ink" doneText="now" />
          </div>
        )}
      </section>

      {commishSelects && !isCommish && (
        <Alert tone="info" className="mb-4">
          In this league the commissioner designates keepers. Tell the commissioner who you want to keep before the deadline.
        </Alert>
      )}
      {commishOverride && managing && (
        <Alert tone="warn" className="mb-4 flex items-center gap-2">
          <Shield size={14} className="shrink-0" /> Commissioner override: you can change designations while the window is {window.status === "LOCKED" ? "locked" : "closed"}. Changes are audit-logged.
        </Alert>
      )}

      {!team || !view || !p ? (
        <EmptyState title="No team selected">{isCommish ? "Pick a team with the selector above to manage its keepers." : "You need a team in this league to designate keepers."}</EmptyState>
      ) : (
        <>
          {team.id !== myTeam?.id && (
            <div className="mb-3 flex items-center gap-2 text-sm text-muted">
              <TeamLogo team={team} size={22} /> Managing <b className="text-ink">{team.name}</b>
            </div>
          )}
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile label="Expiring contracts" value={expiring.length} sub={`${expiring.filter((r) => r.eligible).length} eligible to keep`} />
            <StatTile label="Designated" value={view.check.max !== null ? `${view.check.counted}/${view.check.max}` : view.check.counted} sub={view.check.min ? `minimum ${view.check.min}` : k.rookiesCountTowardLimit ? "rookies count" : "rookie deals don't count"} />
            {capOn && <StatTile label={`${nextSeason} payroll`} value={`$${p.committed}`} sub={`cap $${p.cap}${p.deadMoney ? ` · $${p.deadMoney} dead` : ""}`} />}
            {capOn && <StatTile label={`${nextSeason} cap space`} value={`$${p.space}`} tone={p.space < 0 ? "bad" : "good"} sub={k.mustBeCapCompliant ? "must stay under the cap" : "cap compliance not required"} />}
          </div>

          {(view.check.errors.length > 0 || view.check.warnings.length > 0) && (
            <div className="mb-4 space-y-2">
              {view.check.errors.map((e) => (
                <Alert key={e} tone="error">
                  {e}
                </Alert>
              ))}
              {view.check.warnings.map((w) => (
                <Alert key={w} tone="warn">
                  {w}
                </Alert>
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <Panel
                title="Expiring contracts"
                subtitle={settings.contracts.enabled ? `Kept players sign a ${nextSeason} keeper deal at the keeper salary` : "Every player must be designated to be kept"}
                actions={canEdit && designated.length > 0 ? <ClearKeepersButton teamId={team.id} /> : undefined}
                noPad
              >
                {expiring.length ? (
                  <div className="max-h-[640px] overflow-auto">
                    <table className="tbl">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th className="w-24">Keep</th>
                          <th>Player</th>
                          <th className="num">Now</th>
                          <th className="num">{nextSeason}</th>
                          <th className="num hidden sm:table-cell">Yrs</th>
                          <th className="num hidden md:table-cell">Kept</th>
                          <th className="hidden lg:table-cell">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expiring.map((r) => (
                          <ExpiringRow key={r.playerId} r={r} teamId={team.id} canEdit={canEdit} commish={isCommish} maxYearsKept={k.maxYearsKept} hasLimit={k.maxKeepers !== null || (k.minKeepers ?? 0) > 0} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No expiring contracts" className="m-3">
                    Every player on this roster is under contract for {nextSeason} and rolls over automatically.
                  </EmptyState>
                )}
              </Panel>

              {rolling.length > 0 && (
                <Panel title="Under contract" subtitle={`Roll over automatically${settings.contracts.annualRaisePercent ? ` with a ${settings.contracts.annualRaisePercent}% raise` : ""} · don't count toward the keeper limit`} noPad>
                  <div className="max-h-[520px] overflow-auto">
                    <table className="tbl">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th>Player</th>
                          <th className="num">Now</th>
                          <th className="num">{nextSeason}</th>
                          <th className="num">Yrs left</th>
                          <th className="hidden sm:table-cell">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rolling.map((r) => (
                          <tr key={r.playerId}>
                            <td>
                              <span className="flex items-center gap-2">
                                <PosBadge pos={r.player.position} />
                                <PlayerLink player={r.player} />
                                {r.isRookieContract && <Badge tone="brand">Rookie</Badge>}
                              </span>
                            </td>
                            <td className="num">${r.salary}</td>
                            <td className="num font-semibold">${r.salaryNext}</td>
                            <td className="num">{r.contractYears - 1}</td>
                            <td className="hidden text-xs sm:table-cell">
                              {r.status === r.statusNext ? r.status : (
                                <span className="text-amber-700 dark:text-amber-300">
                                  {r.status} → {r.statusNext}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </div>

            <aside className="min-w-0 space-y-4">
              {capOn && (
                <Panel title={`${nextSeason} cap projection`}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-muted">Payroll</span>
                    <span className="tabular-nums">
                      <b className="text-ink">${p.committed}</b> / ${p.cap}
                    </span>
                  </div>
                  <PayrollMeter committed={p.committed} cap={p.cap} dead={p.deadMoney} />
                  <dl className="mt-3">
                    <RuleLine label="Under contract">${p.rows.filter((r) => r.outcome === "ROLLS").reduce((a, r) => a + r.capHitNext, 0)}</RuleLine>
                    <RuleLine label={`Keepers (${designated.length})`}>${p.rows.filter((r) => r.outcome === "KEPT").reduce((a, r) => a + r.capHitNext, 0)}</RuleLine>
                    <RuleLine label="Dead money">${p.deadMoney}</RuleLine>
                    <RuleLine label="Cap">
                      ${p.cap}
                      {settings.salaryCap.annualCapIncrease ? <span className="text-muted"> (+${settings.salaryCap.annualCapIncrease})</span> : null}
                    </RuleLine>
                    <RuleLine label="Space">
                      <span className={p.space < 0 ? "text-loss" : "text-win"}>${p.space}</span>
                    </RuleLine>
                  </dl>
                </Panel>
              )}
              <Panel title="Keeper rules" noPad>
                <dl className="px-3 py-1">
                  <RuleLine label="Selected by">{commishSelects ? "The commissioner" : "Each manager"}</RuleLine>
                  <RuleLine label="Keeper salary">{escalationText(k.escalation)}</RuleLine>
                  <RuleLine label="Keeper limit">{k.maxKeepers !== null ? `${k.maxKeepers} max` : "No limit"}{k.minKeepers ? ` · ${k.minKeepers} min` : ""}</RuleLine>
                  <RuleLine label="Rookie contracts">{k.rookiesCountTowardLimit ? "Count toward the limit" : "Don't count"}</RuleLine>
                  <RuleLine label="Times a player can be kept">{k.maxYearsKept !== null ? k.maxYearsKept : "Unlimited"}</RuleLine>
                  <RuleLine label="Players on IR">{k.allowKeepingIR ? "Can be kept" : "Can't be kept"}</RuleLine>
                  {capOn && <RuleLine label="Cap compliance">{k.mustBeCapCompliant ? `Required (cap $${nextSeasonCap(settings)})` : "Not required"}</RuleLine>}
                  <RuleLine label="Released players">{k.releasedPlayersReturnTo === "AUCTION_POOL" ? "Return to the auction pool" : "Become free agents"}</RuleLine>
                  <RuleLine label="Deadline">{window.deadline ? fmtDateTime(window.deadline, tz, { year: true }) : "Not set"}</RuleLine>
                </dl>
              </Panel>
            </aside>
          </div>
        </>
      )}

      <Panel
        id="league"
        className="mt-4"
        title={`League keepers for ${nextSeason}`}
        subtitle={showLeague ? (window.status === "LOCKED" ? "Final — locked at the deadline" : "Commissioner view — managers see this after the deadline") : undefined}
        noPad
      >
        {!showLeague ? (
          <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted">
            <Lock size={14} /> Every team&apos;s keepers are revealed when the deadline passes{window.deadline ? ` (${fmtDateTime(window.deadline, tz)})` : ""}.
          </p>
        ) : leagueKeepers.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">No keepers have been designated yet.</p>
        ) : (
          <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((t) => {
              const list = byTeam.get(t.id) ?? [];
              const total = list.reduce((a, d) => a + d.keeperSalary, 0);
              return (
                <div key={t.id} className="bg-panel px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <Link href={`/teams/${t.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <TeamLogo team={t} size={22} />
                      <span className="truncate text-sm font-semibold text-ink">{t.name}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-muted">
                      {list.length} · ${total}
                    </span>
                  </div>
                  {list.length ? (
                    <ul className="space-y-0.5 text-sm">
                      {list.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <PosBadge pos={d.player.position} className="h-4 min-w-[26px] text-[9px]" />
                            <Link href={`/players/${d.player.id}`} className="truncate text-brand-700 hover:underline dark:text-brand-300">
                              {d.player.fullName}
                            </Link>
                            <InjuryTag status={d.player.injuryStatus} />
                          </span>
                          <span className="shrink-0 tabular-nums text-xs text-muted">
                            ${d.currentSalary} → <b className="text-ink">${d.keeperSalary}</b>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted">No keepers</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function ExpiringRow({ r, teamId, canEdit, commish, maxYearsKept, hasLimit }: { r: KeeperRow; teamId: string; canEdit: boolean; commish: boolean; maxYearsKept: number | null; hasLimit: boolean }) {
  const inc = r.keeperSalary - r.salary;
  const disabled = !canEdit || (!r.eligible && !commish && !r.designated) || (r.designationStatus === "LOCKED" && !commish);
  return (
    <tr className={cn(r.designated && "bg-green-50/60 dark:bg-green-900/10", !r.eligible && !r.designated && "opacity-75")}>
      <td>
        <KeeperToggle teamId={teamId} playerId={r.playerId} playerName={r.player.fullName} checked={r.designated} disabled={disabled} title={r.reason ?? undefined} />
        {r.designationStatus === "LOCKED" && (
          <span className="ml-1 align-middle text-muted" title="Locked at the deadline">
            <Lock size={11} className="inline" />
          </span>
        )}
      </td>
      <td>
        <span className="flex min-w-0 items-center gap-2">
          <PosBadge pos={r.player.position} />
          <PlayerLink player={r.player} />
          {r.status !== "ACTIVE" && <Badge tone={r.status === "IR" ? "red" : "amber"}>{r.status}</Badge>}
          {r.isRookieContract && <Badge tone="brand">Rookie</Badge>}
          {r.isFranchiseTagged && <Badge tone="purple">Tag</Badge>}
        </span>
        {r.reason && !r.eligible && <span className="mt-0.5 block text-[11px] text-loss lg:hidden">{r.reason}</span>}
      </td>
      <td className="num">${r.salary}</td>
      <td className="num">
        <b className="text-ink">${r.keeperSalary}</b>
        {inc > 0 && <span className="ml-1 text-[11px] text-loss">+{inc}</span>}
      </td>
      <td className="num hidden sm:table-cell">{r.keeperYears}</td>
      <td className="num hidden md:table-cell">
        {r.keeperCount}
        {maxYearsKept !== null && <span className="text-muted">/{maxYearsKept}</span>}
      </td>
      <td className="hidden text-xs lg:table-cell">
        {!r.eligible ? (
          <span className="text-loss">{r.reason}</span>
        ) : !r.countsTowardLimit && hasLimit ? (
          <span className="text-muted">Rookie deal — doesn&apos;t count toward the limit</span>
        ) : r.designated ? (
          <span className="text-win">Kept at ${r.keeperSalary} for {r.keeperYears} yr{r.keeperYears === 1 ? "" : "s"}</span>
        ) : (
          <span className="text-muted">Released at the rollover unless kept</span>
        )}
      </td>
    </tr>
  );
}
