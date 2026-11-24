import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { capHit, isIrEligible, isTaxiEligible, validateRoster } from "@/lib/roster";
import { pickShortLabel } from "@/lib/picks";
import { Alert, Badge, EmptyState, PageHeader, Panel, StatTile, TeamLogo } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { FaabAdjust, ForceAdd, PickOwnerSelect, RosterEditor, type RosterRow } from "@/components/commissioner/roster-tools";
import { LUXURY_TAX_PAID_AS, amnestyStatus, capProblem, deadMoneyPreview, effectiveRosterSettings, luxuryTaxFor } from "@/lib/commissioner/roster-logic";
import { amnestyUsedCount } from "@/lib/commissioner/roster-data";
import { forgiveDeadMoney } from "@/lib/commissioner/roster-actions";
import { fmtDateTime } from "@/lib/commissioner/time";
import { cn, fmtMoney, timeAgo } from "@/lib/utils";

export const metadata = { title: "Rosters & Contracts" };

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, IR: 1, TAXI: 2 };

export default async function CommissionerRostersPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await requireCommissioner();
  const { league, settings, season, week } = ctx;
  const tz = settings.general.timezone;
  const sp = await searchParams;
  const teams = await db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" }, include: { owner: { select: { name: true } } } });
  if (!teams.length) return <EmptyState title="No teams yet">Add teams under Members first.</EmptyState>;
  const team = teams.find((t) => t.id === sp.team) ?? teams.find((t) => t.id === ctx.myTeam?.id) ?? teams[0];

  const [spots, states, ownedPicks, ledger, recent, teamSpotCounts, amnestyUsed] = await Promise.all([
    db.rosterSpot.findMany({ where: { teamId: team.id }, include: { player: true } }),
    db.leaguePlayerState.findMany({ where: { leagueId: league.id, NOT: { deadCap: { equals: [] } } }, include: { player: { select: { id: true, fullName: true, position: true } } } }),
    db.draftPick.findMany({
      where: { leagueId: league.id, playerId: null, OR: [{ ownerTeamId: team.id }, { originalTeamId: team.id }] },
      include: { originalTeam: { select: { name: true, abbrev: true } }, ownerTeam: { select: { name: true, abbrev: true } } },
      orderBy: [{ season: "asc" }, { round: "asc" }],
    }),
    db.faabLedger.findMany({ where: { teamId: team.id, season }, orderBy: { createdAt: "desc" } }),
    db.transaction.findMany({ where: { leagueId: league.id, type: "COMMISSIONER", OR: [{ teamId: team.id }, { relatedTeamId: team.id }] }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.rosterSpot.groupBy({ by: ["teamId"], where: { leagueId: league.id }, _count: true }),
    amnestyUsedCount(league.id, team.id),
  ]);
  const amnesty = amnestyStatus(settings, amnestyUsed);
  // offseason roster limit (settings.roster.offseasonMaxActiveRoster) until the cutdown date
  const rules = effectiveRosterSettings(settings, league.phase);
  const maxActive = rules.roster.maxActiveRoster;

  const deadRows: { playerId: string; name: string; position: string; season: number; amount: number }[] = [];
  for (const s of states)
    for (const d of (s.deadCap as { teamId: string; season: number; amount: number }[]) ?? [])
      if (d.teamId === team.id && d.season >= season) deadRows.push({ playerId: s.playerId, name: s.player.fullName, position: s.player.position, season: d.season, amount: d.amount });
  deadRows.sort((a, b) => a.season - b.season || b.amount - a.amount);
  const deadThisSeason = deadRows.filter((d) => d.season === season).reduce((a, d) => a + d.amount, 0);
  const committed = spots.reduce((a, s) => a + capHit(s, settings), 0) + deadThisSeason;
  // cap checked separately so a soft cap uses cap + max overage (salaryCap.capType / softCapMaxOverage)
  const overCap = capProblem(committed, settings);
  const problems = [...validateRoster(spots, rules, { checkCap: false }), ...(overCap ? [overCap] : [])];
  const luxuryTax = luxuryTaxFor(committed, settings);
  const counts = { ACTIVE: 0, IR: 0, TAXI: 0 } as Record<string, number>;
  for (const s of spots) counts[s.status] = (counts[s.status] ?? 0) + 1;
  const faab = ledger.length ? ledger.reduce((a, l) => a + l.amount, 0) : team.faabBalance;
  const undroppable = new Set(settings.waivers.undroppablePlayerIds);
  const countByTeam = new Map(teamSpotCounts.map((c) => [c.teamId, c._count]));

  const rows: RosterRow[] = spots
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.salary - a.salary)
    .map((s) => ({
      spotId: s.id,
      playerId: s.playerId,
      name: s.player.fullName,
      position: s.player.position,
      nflTeam: s.player.team,
      injuryStatus: s.player.injuryStatus,
      status: (["ACTIVE", "IR", "TAXI"].includes(s.status) ? s.status : "ACTIVE") as RosterRow["status"],
      salary: s.salary,
      contractYears: s.contractYears,
      isRookieContract: s.isRookieContract,
      isFranchiseTagged: s.isFranchiseTagged,
      acquiredVia: s.acquiredVia,
      acquired: timeAgo(s.acquiredAt),
      dead: deadMoneyPreview(s, settings, season, week, league.phase),
      irEligible: isIrEligible(s.player, settings),
      taxiEligible: isTaxiEligible(s.player, settings),
      undroppable: undroppable.has(s.playerId),
    }));
  const teamOpts = teams.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev }));

  return (
    <div>
      <PageHeader kicker="Commissioner" title="Rosters & Contracts" subtitle="Edit any roster: contracts, statuses, force adds and drops, trades of players or picks, FAB and dead money. Changes post to the transaction log." />

      <nav aria-label="Choose a team" className="scroll-thin -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {teams.map((t) => (
          <Link
            key={t.id}
            href={`/commissioner/rosters?team=${t.id}`}
            aria-current={t.id === team.id ? "page" : undefined}
            className={cn("flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-semibold", t.id === team.id ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-panel text-ink hover:bg-sunken")}
          >
            <TeamLogo team={t} size={20} className="rounded-full" />
            {t.abbrev}
            <span className={cn("tabular-nums", t.id === team.id ? "text-white/75" : "text-muted")}>{countByTeam.get(t.id) ?? 0}</span>
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <TeamLogo team={team} size={40} />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{team.name}</h2>
          <p className="text-xs text-muted">
            {team.owner?.name ?? "No manager"} · <Link href={`/teams/${team.id}`} className="link">Team page</Link>
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {settings.salaryCap.enabled && (
          <StatTile
            label={settings.salaryCap.capType === "SOFT" ? "Soft cap space" : "Cap space"}
            value={fmtMoney(settings.salaryCap.cap - committed)}
            tone={overCap ? "bad" : committed > settings.salaryCap.cap ? undefined : "good"}
            sub={luxuryTax ? `$${committed} of $${settings.salaryCap.cap} · $${luxuryTax} luxury tax, ${LUXURY_TAX_PAID_AS[settings.salaryCap.luxuryTaxPaidAs]}` : `$${committed} of $${settings.salaryCap.cap}`}
          />
        )}
        {settings.salaryCap.enabled && <StatTile label="Dead money" value={`$${deadThisSeason}`} sub={`${season} season`} />}
        <StatTile
          label="Active"
          value={`${counts.ACTIVE}/${maxActive}`}
          tone={counts.ACTIVE > maxActive ? "bad" : undefined}
          sub={maxActive !== settings.roster.maxActiveRoster ? `offseason limit (${settings.roster.maxActiveRoster} in season)` : undefined}
        />
        <StatTile label="IR" value={`${counts.IR}/${settings.roster.irSlots}`} tone={counts.IR > settings.roster.irSlots ? "bad" : undefined} />
        <StatTile label="Taxi" value={`${counts.TAXI}/${settings.roster.taxiSlots}`} tone={counts.TAXI > settings.roster.taxiSlots ? "bad" : undefined} />
        <StatTile label="FAB" value={`$${faab}`} sub={`of $${settings.waivers.faabBudget} budget`} />
      </div>

      {problems.length > 0 && (
        <Alert tone="error" className="mb-4">
          <b>Roster problems:</b> {problems.join(" ")}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Roster" subtitle={`${spots.length} players · edit a row and press Save`} noPad>
            {rows.length ? <RosterEditor rows={rows} teams={teamOpts} teamId={team.id} season={season} amnesty={amnesty} /> : <p className="p-3 text-sm text-muted">This roster is empty. Add players on the right.</p>}
          </Panel>

          <Panel title="Draft picks" subtitle={`Unused picks ${team.name} owns or originally held`} noPad>
            {ownedPicks.length ? (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Pick</th>
                      <th>Original team</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownedPicks.map((p) => {
                      const label = `${pickShortLabel(p)} (${p.originalTeam.abbrev})`;
                      return (
                        <tr key={p.id} className={cn(p.ownerTeamId !== team.id && "opacity-75")}>
                          <td className="font-semibold">
                            {pickShortLabel(p)}
                            {p.overall ? <span className="ml-1 text-xs text-muted">#{p.overall}</span> : null}
                          </td>
                          <td className="text-xs">{p.originalTeam.name}</td>
                          <td>
                            <PickOwnerSelect pickId={p.id} ownerId={p.ownerTeamId} teams={teamOpts} label={label} />
                            {p.ownerTeamId !== team.id && <Badge tone="neutral" className="ml-1">Traded away</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-3 text-sm text-muted">No unused picks. Picks are created for the next {settings.trades.futurePickYears} seasons × {settings.draft.rookie.rounds} rounds at season rollover.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Force add a player">
            <ForceAdd teamId={team.id} teamName={team.name} defaults={{ salary: settings.salaryCap.minSalary, years: settings.contracts.defaultFreeAgentYears, maxYears: settings.contracts.maxYears }} />
          </Panel>

          <Panel title="FAB balance" subtitle={`${season} ledger`}>
            <FaabAdjust teamId={team.id} balance={faab} />
            {ledger.length > 0 && (
              <ul className="mt-3 max-h-48 divide-y divide-line overflow-y-auto rounded-md border border-line text-xs">
                {ledger.slice(0, 20).map((l) => (
                  <li key={l.id} className="flex justify-between gap-2 px-2 py-1.5">
                    <span className="text-muted">
                      {l.reason.replace(/_/g, " ").toLowerCase()} · {timeAgo(l.createdAt)}
                    </span>
                    <span className={cn("font-semibold tabular-nums", l.amount > 0 ? "text-win" : "text-loss")}>
                      {l.amount > 0 ? "+" : "−"}${Math.abs(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {settings.salaryCap.enabled && (
            <Panel
              title="Dead money"
              subtitle={amnesty.allowed ? `Amnesty cuts: ${amnesty.used} of ${amnesty.allowed} used (life of the league)` : "Cut penalties on this team's cap"}
              actions={amnesty.allowed ? <Badge tone={amnesty.remaining ? "green" : "neutral"}>{amnesty.remaining} left</Badge> : undefined}
              noPad
            >
              {deadRows.length ? (
                <ul className="divide-y divide-line">
                  {deadRows.map((d) => (
                    <li key={`${d.playerId}-${d.season}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium">{d.name}</span> <span className="text-xs text-muted">{d.position} · {d.season}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="font-semibold tabular-nums text-loss">${d.amount}</span>
                        <ActionButton action={forgiveDeadMoney.bind(null, { playerId: d.playerId, teamId: team.id, season: d.season })} confirm={`Forgive $${d.amount} of ${d.season} dead money for ${d.name}?`} size="xs" variant="ghost">
                          Forgive
                        </ActionButton>
                        {amnesty.remaining > 0 && (
                          <ActionButton
                            action={forgiveDeadMoney.bind(null, { playerId: d.playerId, teamId: team.id, season: null, amnesty: true })}
                            confirm={`Use one of ${team.name}'s amnesty cuts (${amnesty.remaining} left) to wipe all of ${d.name}'s remaining dead money?`}
                            size="xs"
                            variant="secondary"
                          >
                            Amnesty
                          </ActionButton>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-3 text-sm text-muted">No dead money on the books.{amnesty.remaining ? " Amnesty cuts can also be used when dropping a player." : ""}</p>
              )}
            </Panel>
          )}

          <Panel title="Commissioner changes" subtitle="Recent overrides for this team" noPad>
            {recent.length ? (
              <ul className="divide-y divide-line">
                {recent.map((t) => (
                  <li key={t.id} className="px-3 py-2 text-xs">
                    <div className="text-ink">{t.description}</div>
                    <div className="text-muted" title={fmtDateTime(t.createdAt, tz)}>
                      {timeAgo(t.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-3 text-sm text-muted">No commissioner changes for this team yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
