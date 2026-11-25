import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { capHit, isIrEligible, isTaxiEligible, validateRoster } from "@/lib/roster";
import { pickShortLabel } from "@/lib/picks";
import { Alert, Badge, Chip, EmptyState, MoreLink, PageHeader, Panel, SummaryStrip, TeamLogo, type SummaryItem } from "@/components/ui/core";
import { ActionButton, ShowMore } from "@/components/ui/client";
import { ScrollRow } from "@/components/ui/scroll-row";
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

  const capped = settings.salaryCap.enabled;
  const space = settings.salaryCap.cap - committed;
  const summary: SummaryItem[] = [
    ...(capped
      ? [
          {
            label: "Cap",
            value: fmtMoney(space),
            tone: overCap ? ("bad" as const) : committed > settings.salaryCap.cap ? undefined : ("good" as const),
            sub: `$${committed} used`,
            title: `${settings.salaryCap.capType === "SOFT" ? "Soft cap" : "Cap"} space: $${committed} of $${settings.salaryCap.cap} committed${luxuryTax ? ` · $${luxuryTax} luxury tax, ${LUXURY_TAX_PAID_AS[settings.salaryCap.luxuryTaxPaidAs]}` : ""}`,
          },
        ]
      : []),
    {
      label: "Active",
      value: `${counts.ACTIVE}/${maxActive}`,
      tone: counts.ACTIVE > maxActive ? ("bad" as const) : undefined,
      sub: maxActive !== settings.roster.maxActiveRoster ? "offseason" : "players",
      title: `${maxActive !== settings.roster.maxActiveRoster ? `Offseason limit (${settings.roster.maxActiveRoster} in season) · ` : ""}IR ${counts.IR}/${settings.roster.irSlots} · Taxi ${counts.TAXI}/${settings.roster.taxiSlots}`,
    },
    ...(capped ? [] : [{ label: "IR", value: `${counts.IR}/${settings.roster.irSlots}`, tone: counts.IR > settings.roster.irSlots ? ("bad" as const) : undefined }, { label: "Taxi", value: `${counts.TAXI}/${settings.roster.taxiSlots}`, tone: counts.TAXI > settings.roster.taxiSlots ? ("bad" as const) : undefined }]),
    { label: "FAB", value: `$${faab}`, sub: `of $${settings.waivers.faabBudget}`, href: "#fab" },
    ...(capped ? [{ label: "Dead", value: `$${deadThisSeason}`, sub: `${season}`, tone: deadThisSeason ? ("bad" as const) : undefined, href: "#dead" }] : []),
  ];

  return (
    <div>
      <PageHeader title="Rosters" subtitle="Contracts, adds, drops and picks for any team" />

      {/* team picker: scrolls sideways on phones, the current team stays in view */}
      <ScrollRow as="nav" aria-label="Choose a team" className="-mx-3 mb-4 gap-2 px-3 pb-0.5 sm:mx-0 sm:px-0">
        {teams.map((t) => (
          <Chip key={t.id} href={`/commissioner/rosters?team=${t.id}`} active={t.id === team.id} scroll={false} icon={<TeamLogo team={t} size={22} round />} count={countByTeam.get(t.id) ?? 0} title={t.name} className="pl-1.5">
            {t.abbrev}
          </Chip>
        ))}
      </ScrollRow>

      <div className="mb-3 flex items-center gap-3">
        <TeamLogo team={team} size={48} round />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-bold leading-6 tracking-[-0.01em] text-ink" title={team.name}>
            {team.name}
          </h2>
          <p className="truncate text-[13px] text-muted">{team.owner?.name ?? "No manager"}</p>
        </div>
        <MoreLink href={`/teams/${team.id}`}>Team</MoreLink>
      </div>

      <SummaryStrip className="mb-4" items={summary} />

      {problems.length > 0 && (
        <Alert tone="error" icon className="mb-4">
          <b>Roster problems.</b> {problems.join(" ")}
        </Alert>
      )}
      {luxuryTax > 0 && (
        <Alert tone="warn" icon className="mb-4">
          ${luxuryTax} luxury tax, {LUXURY_TAX_PAID_AS[settings.salaryCap.luxuryTaxPaidAs]}.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Panel title="Roster" subtitle={`${spots.length} players`} info={<p>Edit a player&apos;s status, salary, years, rookie deal or franchise tag and press Save on that row. Move sends him (with his contract) to another team; Drop releases him with or without dead money. Every change posts to the transaction log.</p>} noPad>
            {rows.length ? (
              <RosterEditor
                rows={rows}
                teams={teamOpts}
                teamId={team.id}
                season={season}
                amnesty={amnesty}
                limits={{ ACTIVE: `${counts.ACTIVE}/${maxActive}`, IR: `${counts.IR}/${settings.roster.irSlots}`, TAXI: `${counts.TAXI}/${settings.roster.taxiSlots}` }}
              />
            ) : (
              <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">This roster is empty. Use Force add below.</p>
            )}
          </Panel>

          <Panel title="Draft picks" subtitle={`${ownedPicks.filter((p) => p.ownerTeamId === team.id).length} owned · unused`} info={<p>Unused picks {team.name} owns or originally held. Change a pick&apos;s owner to move it between teams. Picks are created for the next {settings.trades.futurePickYears} seasons × {settings.draft.rookie.rounds} rounds at season rollover.</p>} noPad>
            {ownedPicks.length ? (
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {ownedPicks.map((p) => {
                  const label = `${pickShortLabel(p)} (${p.originalTeam.abbrev})`;
                  return (
                    <li key={p.id} className={cn("flex min-h-[56px] items-center gap-3 px-4 py-2", p.ownerTeamId !== team.id && "opacity-75")}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold leading-5 text-ink sm:text-sm">
                          {pickShortLabel(p)}
                          {p.overall ? <span className="ml-1 text-[13px] font-normal text-muted">#{p.overall}</span> : null}
                        </span>
                        <span className="block truncate text-[13px] leading-[18px] text-muted">
                          {p.originalTeam.name}
                          {p.ownerTeamId !== team.id ? " · traded away" : ""}
                        </span>
                      </span>
                      <PickOwnerSelect pickId={p.id} ownerId={p.ownerTeamId} teams={teamOpts} label={label} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No unused picks.</p>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel id="add" title="Force add a player" className="scroll-mt-4">
            <ForceAdd teamId={team.id} teamName={team.name} defaults={{ salary: settings.salaryCap.minSalary, years: settings.contracts.defaultFreeAgentYears, maxYears: settings.contracts.maxYears }} />
          </Panel>

          <Panel id="fab" title="FAB balance" subtitle={`${season} ledger`} className="scroll-mt-4">
            <FaabAdjust teamId={team.id} balance={faab} />
            {ledger.length > 0 && (
              <ul className="-mx-4 mt-3 divide-y divide-line/70 border-t border-line/70 text-[13px]">
                {ledger.slice(0, 20).map((l) => (
                  <li key={l.id} className="flex min-h-10 items-center justify-between gap-2 px-4 py-1.5">
                    <span className="min-w-0 truncate text-muted">
                      {l.reason.replace(/_/g, " ").toLowerCase()} · {timeAgo(l.createdAt)}
                    </span>
                    <span className={cn("numeral shrink-0 font-semibold", l.amount > 0 ? "text-win" : "text-loss")}>
                      {l.amount > 0 ? "+" : "−"}${Math.abs(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {settings.salaryCap.enabled && (
            <Panel
              id="dead"
              title="Dead money"
              subtitle={amnesty.allowed ? `Amnesty: ${amnesty.used} of ${amnesty.allowed} used` : "Cut penalties on the cap"}
              info={<p>Forgive wipes one season of a player&apos;s dead money. An amnesty cut (life of the league) wipes all of it.{amnesty.remaining ? " Amnesty cuts can also be used when dropping a player." : ""}</p>}
              actions={amnesty.allowed ? <Badge tone={amnesty.remaining ? "green" : "neutral"}>{amnesty.remaining} left</Badge> : undefined}
              noPad
              className="scroll-mt-4"
            >
              {deadRows.length ? (
                <ul className="divide-y divide-line/70 border-t border-line/70">
                  {deadRows.map((d) => (
                    <li key={`${d.playerId}-${d.season}`} className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{d.name}</span>
                        <span className="block text-[13px] text-muted">
                          {d.position} · {d.season}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="numeral font-semibold text-loss">${d.amount}</span>
                        <ActionButton action={forgiveDeadMoney.bind(null, { playerId: d.playerId, teamId: team.id, season: d.season })} confirm={`Forgive $${d.amount} of ${d.season} dead money for ${d.name}?`} size="sm" variant="secondary">
                          Forgive
                        </ActionButton>
                        {amnesty.remaining > 0 && (
                          <ActionButton
                            action={forgiveDeadMoney.bind(null, { playerId: d.playerId, teamId: team.id, season: null, amnesty: true })}
                            confirm={`Use one of ${team.name}'s amnesty cuts (${amnesty.remaining} left) to wipe all of ${d.name}'s remaining dead money?`}
                            size="sm"
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
                <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No dead money on the books.</p>
              )}
            </Panel>
          )}

          <Panel title="Commissioner changes" subtitle="Recent overrides for this team" noPad>
            {recent.length ? (
              <ShowMore as="ul" initial={3} className="divide-y divide-line/70 border-t border-line/70">
                {recent.map((t) => (
                  <li key={t.id} className="px-4 py-2.5 text-[14px] leading-snug sm:text-[13px]">
                    <div className="text-ink">{t.description}</div>
                    <div className="text-[12px] text-muted" title={fmtDateTime(t.createdAt, tz)}>
                      {timeAgo(t.createdAt)}
                    </div>
                  </li>
                ))}
              </ShowMore>
            ) : (
              <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">None yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
