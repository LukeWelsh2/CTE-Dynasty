// Keepers — "Who do I keep, and what does next season's cap look like?"
// Window status (one line + deadline countdown), summary strip (expiring · keeping · next-season payroll · cap
// space), the expiring contracts as tappable keep rows (now → keeper salary), what rolls over, the cap projection
// meter, the keeper rules behind a tap, and (after the deadline, or for the commissioner) every team's keepers.
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Lock, Shield } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, Badge, Collapsible, EmptyState, PageHeader, Panel, StatRow, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { TeamTabs } from "@/components/team/team-tabs";
import { TeamSwitcher } from "@/components/team/team-switcher";
import { Countdown } from "@/components/waivers/countdown";
import { PayrollMeter, RuleLine } from "@/components/waivers/bits";
import { ClearKeepersButton, KeeperToggle } from "@/components/waivers/keeper-toggle";
import { loadKeeperWindow, loadLeagueKeepers, loadTeamKeepers, type KeeperRow } from "@/lib/keepers/data";
import { keeperCapEnforcement, type CapProjection } from "@/lib/keepers/logic";
import { capLimitLabel } from "@/lib/roster-rules";
import type { LeagueSettings } from "@/lib/settings/schema";
import { fmtDateTime } from "@/lib/waivers/format";
import { cn, fmtMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Keepers" };

const STATUS_TONE = { OPEN: "green", NOT_OPEN: "neutral", LOCKED: "red", DISABLED: "neutral" } as const;
const STATUS_LABEL = { OPEN: "Window open", NOT_OPEN: "Not open yet", LOCKED: "Locked", DISABLED: "Off" } as const;

/**
 * How keepers.mustBeCapCompliant applies to next season's payroll: measured against its ceiling (capLimit: the cap, or
 * cap + softCapMaxOverage for a soft cap), blocking or only warning as keeperCapEnforcement (the offseason cap rule) says.
 */
function keeperCapRule(p: Pick<CapProjection, "limit">, settings: LeagueSettings, now: Date): { short: string; rule: string } {
  const label = capLimitLabel(settings);
  if (!settings.keepers.mustBeCapCompliant) return { short: "cap compliance not required", rule: "Not required" };
  if (p.limit === null) return { short: `no ${label} to stay under`, rule: `Required (no ${label} is set)` };
  const ceiling = `${fmtMoney(p.limit)} ${label}`;
  if (keeperCapEnforcement(settings, now) === "WARN") return { short: `over the ${ceiling} is only a warning`, rule: `Required (${ceiling}) — only a warning right now` };
  return { short: `must stay under the ${ceiling}`, rule: `Required (${ceiling})` };
}

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
    showLeague ? loadLeagueKeepers(league.id, nextSeason, settings) : Promise.resolve([]),
  ]);

  const header = (
    <>
      <TeamTabs active="keepers" keepers={k.enabled} />
      <PageHeader
        kicker={team && team.id !== myTeam?.id ? `Managing ${team.name}` : team?.name}
        title="Keepers"
        actions={isCommish && teams.length > 0 ? <TeamSwitcher teams={teams} current={team?.id ?? null} myTeamId={myTeam?.id ?? null} /> : undefined}
      />
    </>
  );

  if (!k.enabled) {
    return (
      <div>
        {header}
        <EmptyState title="Keepers are turned off">Every contract follows the league&apos;s contract rules at the rollover.</EmptyState>
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
  const hasLimit = k.maxKeepers !== null || (k.minKeepers ?? 0) > 0;
  const windowLine =
    window.status === "OPEN"
      ? window.deadline
        ? `Locks ${fmtDateTime(window.deadline, tz)}`
        : "No deadline set yet"
      : window.status === "NOT_OPEN"
        ? window.opensAt
          ? `Opens ${fmtDateTime(window.opensAt, tz)}${window.deadline ? ` · deadline ${fmtDateTime(window.deadline, tz)}` : ""}`
          : "Opens after the season · plan below"
        : window.status === "LOCKED"
          ? `Final${window.deadline ? (window.deadline <= now ? ` · deadline was ${fmtDateTime(window.deadline, tz)}` : " · locked early by the commissioner") : ""}`
          : "";

  return (
    <div>
      {header}

      {/* the window: one status line + the deadline countdown */}
      <section className="card mb-4 flex items-center gap-3 px-4 py-3">
        {window.status === "LOCKED" ? <Lock className="shrink-0 text-loss" size={20} aria-hidden /> : <CalendarClock className="shrink-0 text-brand-600 dark:text-brand-400" size={20} aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={STATUS_TONE[window.status]}>{STATUS_LABEL[window.status]}</Badge>
            <span className="truncate text-[15px] font-semibold text-ink" title={window.label}>
              {window.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-muted" title={windowLine}>
            {windowLine}
          </p>
        </div>
        {window.deadline && window.status !== "LOCKED" && (
          <div className="shrink-0 text-right">
            <div className="eyebrow">Deadline</div>
            <Countdown to={window.deadline.toISOString()} initialNow={now.getTime()} className="text-[20px] font-semibold text-ink" doneText="now" />
          </div>
        )}
      </section>

      {commishSelects && !isCommish && (
        <Alert tone="info" className="mb-4">
          The commissioner designates keepers in this league — tell them who you want to keep before the deadline.
        </Alert>
      )}
      {commishOverride && managing && (
        <Alert tone="warn" className="mb-4 flex items-center gap-2">
          <Shield size={15} className="shrink-0" aria-hidden /> Commissioner override: the window is {window.status === "LOCKED" ? "locked" : "closed"}, changes are audit-logged.
        </Alert>
      )}

      {!team || !view || !p ? (
        <EmptyState title="No team selected">{isCommish ? "Pick a team with the selector above." : "You need a team in this league to designate keepers."}</EmptyState>
      ) : (
        <>
          <SummaryStrip
            className="mb-4"
            items={[
              { label: "Expiring", value: expiring.length, sub: `${expiring.filter((r) => r.eligible).length} eligible` },
              {
                label: "Keeping",
                value: view.check.max !== null ? `${view.check.counted}/${view.check.max}` : view.check.counted,
                sub: view.check.min ? `min ${view.check.min}` : k.rookiesCountTowardLimit ? "rookies count" : "rookies free",
                tone: view.check.counted ? "brand" : undefined,
                title: k.rookiesCountTowardLimit ? undefined : "Rookie deals don't count toward the limit",
              },
              ...(capOn
                ? [
                    { label: `${nextSeason} pay`, value: fmtMoney(p.committed), sub: `of ${fmtMoney(p.cap)}`, title: p.deadMoney ? `${fmtMoney(p.deadMoney)} dead money included` : undefined },
                    // over the cap but under a soft-cap limit is allowed: only over the ceiling reads as bad
                    { label: "Space", value: fmtMoney(p.space), sub: p.overCap ? "over the limit" : `${nextSeason} cap`, tone: (p.overCap ? "bad" : p.space < 0 ? undefined : "good") as "bad" | "good" | undefined, title: keeperCapRule(p, settings, now).short },
                  ]
                : []),
            ]}
          />

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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-4">
              <Panel
                title="Expiring contracts"
                subtitle={settings.contracts.enabled ? `Kept players sign a ${nextSeason} keeper deal` : "Designate a player to keep him"}
                info={
                  <p>
                    Tap the circle to keep a player at his keeper salary ({escalationText(k.escalation)}). Undesignated expiring players are released at the rollover
                    {k.releasedPlayersReturnTo === "AUCTION_POOL" ? " and return to the auction pool" : " and become free agents"}.
                    {hasLimit && !k.rookiesCountTowardLimit ? " Rookie deals don't count toward the keeper limit." : ""}
                  </p>
                }
                actions={canEdit && designated.length > 0 ? <ClearKeepersButton teamId={team.id} /> : undefined}
                noPad
              >
                {expiring.length ? (
                  <ul className="divide-y divide-line/70 border-t border-line/70">
                    {expiring.map((r) => (
                      <ExpiringRow key={r.playerId} r={r} teamId={team.id} canEdit={canEdit} commish={isCommish} maxYearsKept={k.maxYearsKept} hasLimit={hasLimit} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No expiring contracts" className="mx-4 mb-4">
                    Every player is under contract for {nextSeason} and rolls over.
                  </EmptyState>
                )}
              </Panel>

              {rolling.length > 0 && (
                <Panel title="Under contract" subtitle={`Roll over${settings.contracts.annualRaisePercent ? ` with a ${settings.contracts.annualRaisePercent}% raise` : ""} · not keepers`} noPad>
                  <ShowMore as="ul" initial={5} moreLabel={`Show all ${rolling.length}`} className="divide-y divide-line/70 border-t border-line/70">
                    {rolling.map((r) => (
                      <li key={r.playerId} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                        <HeadshotBadge player={{ id: r.player.id, fullName: r.player.fullName, position: r.player.position }} nflTeam={r.player.team} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Link href={`/players/${r.player.id}`} title={r.player.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
                              {r.player.fullName}
                            </Link>
                            <InjuryLetter status={r.player.injuryStatus} className="text-[13px]" />
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                            <PosPill pos={r.player.position} />
                            <span className="shrink-0">{r.player.position === "DEF" ? "" : (r.player.team ?? "FA")}</span>
                            {r.isRookieContract && <Badge tone="brand">Rookie</Badge>}
                            {r.status !== r.statusNext && (
                              <span className="truncate text-amber-700 dark:text-amber-300">
                                {r.status} → {r.statusNext}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="numeral block text-[15px] font-semibold leading-5 text-ink">
                            {r.salaryNext !== r.salary && <span className="font-normal text-muted">${r.salary} → </span>}${r.salaryNext}
                          </span>
                          <span className="numeral block text-[12px] leading-4 text-muted">
                            {r.contractYears - 1} yr{r.contractYears - 1 === 1 ? "" : "s"} left
                          </span>
                        </span>
                      </li>
                    ))}
                  </ShowMore>
                </Panel>
              )}
            </div>

            <aside className="min-w-0 space-y-4">
              {capOn && (
                <Panel title={`${nextSeason} cap`}>
                  <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
                    <span className="text-muted">Payroll</span>
                    <span className="numeral">
                      <b className="text-ink">{fmtMoney(p.committed)}</b> <span className="text-muted">/ {fmtMoney(p.cap)}</span>
                    </span>
                  </div>
                  <PayrollMeter committed={p.committed} cap={p.cap} dead={p.deadMoney} />
                  <div className="mt-3 divide-y divide-line/70">
                    <StatRow label="Under contract" value={fmtMoney(p.rows.filter((r) => r.outcome === "ROLLS").reduce((a, r) => a + r.capHitNext, 0))} />
                    <StatRow label={`Keepers (${designated.length})`} value={fmtMoney(p.rows.filter((r) => r.outcome === "KEPT").reduce((a, r) => a + r.capHitNext, 0))} />
                    <StatRow label="Dead money" value={fmtMoney(p.deadMoney)} tone={p.deadMoney ? "bad" : undefined} />
                    <StatRow label="Cap" value={fmtMoney(p.cap)} sub={settings.salaryCap.annualCapIncrease ? `+${fmtMoney(settings.salaryCap.annualCapIncrease)} a year` : undefined} />
                    {p.limit !== null && p.limit !== p.cap && <StatRow label="Soft-cap limit" value={fmtMoney(p.limit)} tone={p.overCap ? "bad" : undefined} />}
                    <StatRow label="Space" value={fmtMoney(p.space)} tone={p.overCap ? "bad" : p.space < 0 ? undefined : "good"} strong />
                  </div>
                </Panel>
              )}
              <section className="card px-4">
                <Collapsible summary="Keeper rules" meta={k.maxKeepers !== null ? `${k.maxKeepers} max` : "no limit"}>
                  <dl>
                    <RuleLine label="Selected by">{commishSelects ? "The commissioner" : "Each manager"}</RuleLine>
                    <RuleLine label="Keeper salary">{escalationText(k.escalation)}</RuleLine>
                    <RuleLine label="Keeper limit">
                      {k.maxKeepers !== null ? `${k.maxKeepers} max` : "No limit"}
                      {k.minKeepers ? ` · ${k.minKeepers} min` : ""}
                    </RuleLine>
                    <RuleLine label="Rookie contracts">{k.rookiesCountTowardLimit ? "Count toward the limit" : "Don't count"}</RuleLine>
                    <RuleLine label="Times kept">{k.maxYearsKept !== null ? k.maxYearsKept : "Unlimited"}</RuleLine>
                    <RuleLine label="Players on IR">{k.allowKeepingIR ? "Can be kept" : "Can't be kept"}</RuleLine>
                    {capOn && <RuleLine label="Cap compliance">{keeperCapRule(p, settings, now).rule}</RuleLine>}
                    <RuleLine label="Released players">{k.releasedPlayersReturnTo === "AUCTION_POOL" ? "Return to the auction pool" : "Become free agents"}</RuleLine>
                    <RuleLine label="Deadline">{window.deadline ? fmtDateTime(window.deadline, tz, { year: true }) : "Not set"}</RuleLine>
                  </dl>
                </Collapsible>
              </section>
            </aside>
          </div>
        </>
      )}

      <Panel
        id="league"
        className="mt-4"
        title={`League keepers ${nextSeason}`}
        subtitle={showLeague ? (window.status === "LOCKED" ? "Final · designations are locked" : "Commissioner view · revealed to all at the deadline") : undefined}
        noPad
      >
        {!showLeague ? (
          <p className="flex items-center gap-2 border-t border-line/70 px-4 py-4 text-[14px] text-muted">
            <Lock size={15} className="shrink-0" aria-hidden /> Revealed when the deadline passes{window.deadline ? ` (${fmtDateTime(window.deadline, tz)})` : ""}.
          </p>
        ) : leagueKeepers.length === 0 ? (
          <p className="border-t border-line/70 px-4 py-4 text-[14px] text-muted">No keepers designated yet.</p>
        ) : (
          <div className="grid border-t border-line/70 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((t) => {
              const list = byTeam.get(t.id) ?? [];
              const total = list.reduce((a, d) => a + d.keeperSalary, 0);
              return (
                <div key={t.id} className="border-b border-line/70 px-4 py-3 sm:odd:border-r">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <Link href={`/teams/${t.id}`} className="flex min-h-8 min-w-0 items-center gap-2 hover:underline">
                      <TeamLogo team={t} size={24} />
                      <span className={cn("truncate text-[15px] font-semibold", t.id === myTeam?.id ? "text-brand-600 dark:text-brand-400" : "text-ink")}>{t.name}</span>
                    </Link>
                    <span className="numeral shrink-0 text-[13px] text-muted">
                      {list.length} · ${total}
                    </span>
                  </div>
                  {list.length ? (
                    <ul className="space-y-1 text-[14px]">
                      {list.map((d) => (
                        <li key={d.id} className="flex min-h-7 items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <PosPill pos={d.player.position} />
                            <Link href={`/players/${d.player.id}`} title={d.player.fullName} className="truncate text-ink hover:underline">
                              {d.player.fullName}
                            </Link>
                            <InjuryLetter status={d.player.injuryStatus} className="text-[12px]" />
                          </span>
                          <span className="numeral shrink-0 text-[13px] text-muted">
                            ${d.currentSalary} → <b className="text-ink">${d.keeperSalary}</b>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-muted">No keepers</p>
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

/** One expiring contract: keep toggle · headshot · name / position + team + badges / note · now → keeper salary. */
function ExpiringRow({ r, teamId, canEdit, commish, maxYearsKept, hasLimit }: { r: KeeperRow; teamId: string; canEdit: boolean; commish: boolean; maxYearsKept: number | null; hasLimit: boolean }) {
  const inc = r.keeperSalary - r.salary;
  const disabled = !canEdit || (!r.eligible && !commish && !r.designated) || (r.designationStatus === "LOCKED" && !commish);
  const note = !r.eligible
    ? { text: r.reason ?? "Not eligible", cls: "text-loss" }
    : r.designated
      ? { text: `Kept at $${r.keeperSalary} for ${r.keeperYears} yr${r.keeperYears === 1 ? "" : "s"}`, cls: "text-win" }
      : !r.countsTowardLimit && hasLimit
        ? { text: "Rookie deal · doesn't count toward the limit", cls: "text-muted" }
        : null;
  return (
    <li className={cn("flex min-h-[68px] items-center gap-3 px-4 py-2.5", r.designated && "bg-brand-600/[0.05] dark:bg-brand-400/10", !r.eligible && !r.designated && "opacity-80")}>
      <span className="flex w-6 shrink-0 flex-col items-center gap-0.5">
        <KeeperToggle teamId={teamId} playerId={r.playerId} playerName={r.player.fullName} checked={r.designated} disabled={disabled} title={r.reason ?? undefined} />
        {r.designationStatus === "LOCKED" && (
          <span className="text-muted" title="Locked at the deadline">
            <Lock size={11} aria-label="Locked" />
          </span>
        )}
      </span>
      <HeadshotBadge player={{ id: r.player.id, fullName: r.player.fullName, position: r.player.position }} nflTeam={r.player.team} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link href={`/players/${r.player.id}`} title={r.player.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
            {r.player.fullName}
          </Link>
          <InjuryLetter status={r.player.injuryStatus} className="text-[13px]" />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
          <PosPill pos={r.player.position} />
          <span className="shrink-0">{r.player.position === "DEF" ? "" : (r.player.team ?? "FA")}</span>
          {r.status !== "ACTIVE" && <Badge tone={r.status === "IR" ? "red" : "amber"}>{r.status}</Badge>}
          {r.isRookieContract && <Badge tone="brand">Rookie</Badge>}
          {r.isFranchiseTagged && <Badge tone="purple">Tag</Badge>}
          {r.keeperCount > 0 && (
            <span className="numeral truncate">
              kept {r.keeperCount}
              {maxYearsKept !== null ? `/${maxYearsKept}` : "×"}
            </span>
          )}
        </span>
        {note && (
          <span className={cn("mt-0.5 block truncate text-[12px] leading-4", note.cls)} title={note.text}>
            {note.text}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="numeral block text-[15px] leading-5 text-ink">
          <span className="text-muted">${r.salary} →</span> <b className="font-semibold">${r.keeperSalary}</b>
        </span>
        <span className="numeral block text-[12px] leading-4 text-muted">
          {inc > 0 && <span className="text-loss">+{inc} · </span>}
          {r.keeperYears} yr{r.keeperYears === 1 ? "" : "s"}
        </span>
      </span>
    </li>
  );
}
