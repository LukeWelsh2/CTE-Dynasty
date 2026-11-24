// Contracts & cap — "How much cap room do I have, now and later, and which contracts can I act on?"
// Summary strip (cap room, committed, next season, expiring) + the cap meter, then the contracts list (phones: one
// row per player with salary / years and the extend · tag · option buttons; md+: the full table with cap hit by
// season, acquisition and cut cost), future commitments (chart + 4-column table), dead money, and the league's
// contract rules behind a tap.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Collapsible, EmptyState, PageHeader, Panel, StatRow, SummaryStrip } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { getLeagueContext } from "@/lib/league";
import { loadContracts, loadTeamHeader, resolveManagedTeam, type ContractRow } from "@/lib/team/data";
import { formatDate } from "@/lib/team/format";
import { cn, fmtMoney } from "@/lib/utils";
import { CapMeter, ContractBadges } from "@/components/team/bits";
import { ContractActions } from "@/components/team/contract-actions";
import { ContractsChart } from "@/components/team/contracts-chart";
import { TeamTabs } from "@/components/team/team-tabs";

export const metadata: Metadata = { title: "Contracts & Cap" };

const VIA: Record<string, string> = {
  AUCTION: "Auction",
  ROOKIE_DRAFT: "Rookie draft",
  DRAFT: "Draft",
  WAIVER: "Waivers",
  FREE_AGENT: "Free agent",
  TRADE: "Trade",
  KEEPER: "Keeper",
  COMMISSIONER: "Commissioner",
};

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const resolved = await resolveManagedTeam(ctx, sp.team);
  if (resolved.kind === "redirect") redirect(resolved.to);
  if (resolved.kind === "none") {
    return (
      <div>
        <TeamTabs active="contracts" keepers={ctx.settings.keepers.enabled} />
        <EmptyState title="No team">You need a team in this league to manage contracts.</EmptyState>
      </div>
    );
  }
  const { settings, season } = ctx;
  const teamId = resolved.teamId;
  const [header, data] = await Promise.all([loadTeamHeader(ctx, teamId), loadContracts(ctx, teamId, { manage: true })]);
  const { cap } = data;
  const capOn = settings.salaryCap.enabled;
  const contractsOn = settings.contracts.enabled;
  // show the actions column only when something can actually be done now (the rules panel explains the windows)
  const anyActions = data.rows.some((r) => r.extension?.ok || r.tag?.ok || r.option?.ok);
  const expiring = data.rows.filter((r) => r.contractYears <= 1);
  const chart = data.seasons.map((s, i) => ({
    season: s,
    contracts: i === 0 ? cap.committed - cap.deadMoney : (cap.bySeason[i]?.committed ?? 0),
    dead: data.deadBySeason[i] ?? 0,
    cap: data.caps[i],
  }));
  const ft = settings.contracts.franchiseTag;
  const c = settings.contracts;
  const windowLabel =
    c.extensionWindow === "ANY_TIME" ? "any time" : c.extensionWindow === "ANY_OFFSEASON" ? "in the offseason" : "in the offseason before the final year";
  const offseason = data.window === "OFFSEASON";
  const actionNote = !contractsOn
    ? null
    : offseason
      ? `The ${season} season is over: contract changes count against the ${data.capSeason} cap. Franchise tags and rookie options are open now.`
      : `Extensions: ${windowLabel}.${ft.enabled || c.rookieFourthYearOption ? ` Franchise tags and rookie options open in the offseason, after the ${season} season ends.` : ""}`;
  const next = chart[1];
  const underFloor = settings.salaryCap.floor > 0 && cap.committed < settings.salaryCap.floor;

  return (
    <div>
      <TeamTabs active="contracts" teamId={resolved.commishEdit ? teamId : null} keepers={settings.keepers.enabled} />
      <PageHeader kicker={header.team.name} title="Contracts & cap" subtitle={!capOn ? "No salary cap in this league · salaries for reference" : undefined} />

      <div className="space-y-4">
        <div>
          <SummaryStrip
            items={[
              { label: "Room", value: fmtMoney(cap.space), tone: cap.space < 0 ? "bad" : "good", sub: `of ${fmtMoney(cap.cap)}` },
              { label: "Used", value: fmtMoney(cap.committed), sub: cap.deadMoney > 0 ? <span className="text-loss">{fmtMoney(cap.deadMoney)} dead</span> : `${data.rows.length} players`, title: `Committed against the cap · ${fmtMoney(cap.totalSalary)} total salary` },
              next
                ? { label: String(next.season), value: fmtMoney(next.contracts + next.dead), sub: `of ${fmtMoney(next.cap)}`, title: `${next.season} commitments (contracts + dead money)` }
                : { label: "Dead", value: fmtMoney(cap.deadMoney), sub: `${data.deadCap.length} players`, tone: cap.deadMoney > 0 ? "bad" : undefined },
              { label: "Expiring", value: expiring.length, sub: `${fmtMoney(expiring.reduce((a, r) => a + r.salary, 0))} off` },
            ]}
          />
          {capOn && (
            <div className="mt-3 px-1">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-muted">
                  Cap used
                  {underFloor && <span className="font-semibold text-loss"> · {fmtMoney(settings.salaryCap.floor - cap.committed)} under the floor</span>}
                </span>
                <span className="numeral shrink-0 font-semibold text-ink">
                  {fmtMoney(cap.committed)} / {fmtMoney(cap.cap)}
                </span>
              </div>
              <CapMeter committed={cap.committed} deadMoney={cap.deadMoney} cap={cap.cap} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel
            className="min-w-0"
            title="Contracts"
            subtitle={`${data.rows.length} players · by salary`}
            info={
              <>
                <p>Salary is this season&apos;s contract amount; &quot;hit&quot; is what counts against the cap when it differs (IR / taxi rules).</p>
                <p>Cut cost is the dead money you&apos;d take if you dropped the player today. Badges: R rookie contract · FT franchise tag · EXP expires after this season.</p>
                {actionNote && <p>{actionNote}</p>}
              </>
            }
            noPad
          >
            {data.rows.length === 0 ? (
              <div className="border-t border-line/70 p-4">
                <EmptyState title="No players under contract" />
              </div>
            ) : (
              <>
                {/* phones: one row per contract, the numbers that matter right-aligned */}
                <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
                  {data.rows.map((r) => (
                    <ContractListRow key={r.playerId} r={r} teamId={teamId} capSeason={data.capSeason} season={season} showActions={anyActions} />
                  ))}
                </ul>
                <div className="scroll-thin hidden overflow-x-auto border-t border-line/70 md:block">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="tbl-sticky">Player</th>
                        <th className="num">Salary</th>
                        <th className="num">Yrs</th>
                        {data.seasons.map((s) => (
                          <th key={s} className="num">
                            {s}
                          </th>
                        ))}
                        <th className="hidden lg:table-cell">Acquired</th>
                        <th className="num" title="Dead money if dropped today">
                          Cut cost
                        </th>
                        {anyActions && <th className="text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => {
                        const cut = r.cutCost.reduce((a, d) => a + d.amount, 0);
                        return (
                          <tr key={r.playerId}>
                            <td className="tbl-sticky">
                              <div className="flex min-w-[170px] items-center gap-1.5">
                                <Link href={`/players/${r.playerId}`} title={r.name} className="truncate font-semibold text-ink hover:underline">
                                  {r.name}
                                </Link>
                                <InjuryLetter status={r.injuryStatus} className="text-[12px]" />
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                                <PosPill pos={r.position} />
                                {r.nflTeam ?? "FA"}
                                {r.age ? ` · ${r.age}y` : ""}
                                {r.status !== "ACTIVE" && <Badge tone={r.status === "IR" ? "red" : "neutral"}>{r.status}</Badge>}
                                <ContractBadges isRookie={r.isRookie} isTagged={r.isTagged} years={r.contractYears} />
                              </div>
                            </td>
                            <td className="num whitespace-nowrap">
                              <b className="font-semibold">{fmtMoney(r.salary)}</b>
                              {r.capHit !== r.salary && <span className="block text-[12px] text-muted">hit {fmtMoney(r.capHit)}</span>}
                            </td>
                            <td className="num whitespace-nowrap">
                              {r.contractYears}
                              <span className="block text-[12px] text-muted">thru {r.contractEnd}</span>
                            </td>
                            {r.bySeason.map((v, i) => (
                              <td key={i} className={cn("num", v === null && "text-faint", i === r.contractYears - 1 && "font-semibold")}>
                                {v === null ? "—" : fmtMoney(i === 0 ? r.capHit : v)}
                              </td>
                            ))}
                            <td className="hidden whitespace-nowrap text-[13px] lg:table-cell">
                              {VIA[r.acquiredVia] ?? r.acquiredVia}
                              <span className="block text-[12px] text-muted">{formatDate(r.acquiredAt, settings.general.timezone)}</span>
                            </td>
                            <td className={cn("num whitespace-nowrap", cut > 0 ? "text-loss" : "text-faint")} title={r.cutCost.map((d) => `${d.season}: ${fmtMoney(d.amount)}`).join(", ") || "No dead money"}>
                              {cut > 0 ? fmtMoney(cut) : "—"}
                            </td>
                            {anyActions && (
                              <td className="text-right">
                                <ContractActions teamId={teamId} row={r} capSeason={data.capSeason} season={season} />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>

          <div className="min-w-0 space-y-4">
            <Panel
              title="Future commitments"
              subtitle={`Next ${data.seasons.length} seasons${settings.contracts.annualRaisePercent ? ` · ${settings.contracts.annualRaisePercent}% raises` : ""}`}
              info={<p>Contracts already on the books for each season plus dead money, against that season&apos;s cap. Space = cap − contracts − dead money.</p>}
              noPad
            >
              <div className="px-4 pb-3">
                <ContractsChart data={chart} />
              </div>
              <table className="tbl border-t border-line/70">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th className="num">Contracts</th>
                    <th className="num">Dead</th>
                    <th className="num">Space</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.map((row, i) => (
                    <tr key={row.season}>
                      <td className="font-semibold">
                        {row.season}
                        <span className="block text-[12px] font-normal text-muted">
                          {data.rows.filter((r) => r.contractYears > i).length} players
                        </span>
                      </td>
                      <td className="num">{fmtMoney(row.contracts)}</td>
                      <td className={cn("num", row.dead > 0 ? "text-loss" : "text-faint")}>{row.dead > 0 ? fmtMoney(row.dead) : "—"}</td>
                      <td className="num">
                        <b className={cn("font-semibold", row.cap - row.contracts - row.dead < 0 ? "text-loss" : "text-win")}>{fmtMoney(row.cap - row.contracts - row.dead)}</b>
                        <span className="block text-[12px] text-muted">of {fmtMoney(row.cap)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="Dead money" subtitle={data.deadCap.length ? `${data.deadCap.length} released contract${data.deadCap.length === 1 ? "" : "s"}` : undefined} noPad>
              {data.deadCap.length === 0 ? (
                <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No dead money</p>
              ) : (
                <ul className="divide-y divide-line/70 border-t border-line/70">
                  {data.deadCap.map((d) => {
                    const later = d.bySeason.filter((x) => x.amount && x.season !== data.seasons[0]);
                    const now = d.bySeason.find((x) => x.season === data.seasons[0])?.amount ?? 0;
                    return (
                      <li key={d.playerId} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                        <span className="min-w-0 flex-1">
                          <Link href={`/players/${d.playerId}`} className="block truncate text-[15px] font-semibold text-ink hover:underline sm:text-sm">
                            {d.name}
                          </Link>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
                            <PosPill pos={d.position} /> {d.nflTeam ?? "FA"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={cn("numeral block text-[15px] font-semibold", now ? "text-loss" : "text-faint")}>{now ? fmtMoney(now) : "—"}</span>
                          {later.length > 0 && <span className="numeral block text-[12px] text-muted">+{later.map((x) => `${fmtMoney(x.amount)} '${String(x.season).slice(2)}`).join(", ")}</span>}
                        </span>
                      </li>
                    );
                  })}
                  <li className="flex min-h-11 items-center justify-between gap-3 px-4 text-[13px] font-semibold">
                    <span>Total</span>
                    <span className="numeral text-muted">{data.deadBySeason.map((v, i) => `${fmtMoney(v)} '${String(data.seasons[i]).slice(2)}`).join(" · ")}</span>
                  </li>
                </ul>
              )}
            </Panel>

            <Panel title="League contract rules" noPad>
              <div className="divide-y divide-line/70 border-t border-line/70 px-4">
                <Collapsible summary="Contracts" meta={contractsOn ? `${settings.contracts.minYears}–${settings.contracts.maxYears} yrs` : "Off"}>
                  <div className="divide-y divide-line/70">
                    <StatRow label="Contract length" value={contractsOn ? `${settings.contracts.minYears}–${settings.contracts.maxYears} years` : "Contracts off"} />
                    <StatRow label="Annual raise" value={`${settings.contracts.annualRaisePercent}%`} />
                    {c.lengthLimits.length > 0 && <StatRow label="Long deals" value={c.lengthLimits.map((l) => `≤ ${l.maxCount} of ${l.years}+ yrs`).join(" · ")} />}
                    <StatRow
                      label="Dead money"
                      value={settings.salaryCap.deadMoney.enabled ? `${settings.salaryCap.deadMoney.currentSeasonPercent}% now · ${settings.salaryCap.deadMoney.futureSeasonPercent}%/yr` : "None"}
                      sub={settings.salaryCap.deadMoney.enabled && settings.salaryCap.deadMoney.rookieContractsExempt ? "Rookie contracts exempt" : undefined}
                    />
                    <StatRow label="IR / taxi cap hit" value={`IR ${settings.roster.irCountsAgainstCap ? "counts" : "exempt"} · taxi ${settings.roster.taxiCountsAgainstCap ? "counts" : `${settings.roster.taxiCapPercent}%`}`} />
                  </div>
                </Collapsible>
                <Collapsible summary="Extensions" meta={c.extensionsAllowed ? (c.extensionsPerTeamPerSeason !== null ? `${data.extensionsUsed} of ${c.extensionsPerTeamPerSeason} used` : "Allowed") : "Off"}>
                  <p className="text-[13px] leading-5 text-muted">
                    {c.extensionsAllowed
                      ? `Up to +${c.extensionMaxYearsAdded} years at +${c.extensionRaisePercent}% per year, ${windowLabel}${c.extensionsPerTeamPerSeason !== null ? ` · ${c.extensionsPerTeamPerSeason} per team per season` : ""}.`
                      : "Not allowed in this league."}
                  </p>
                </Collapsible>
                <Collapsible summary="Franchise tag" meta={ft.enabled ? `${data.tagsUsed} of ${ft.perTeam} used` : "Off"}>
                  <p className="text-[13px] leading-5 text-muted">
                    {ft.enabled
                      ? `${ft.perTeam} per season · ${ft.years} year · ${ft.costMethod === "TOP5_AVG_AT_POSITION" ? `average of the top ${ft.topN} salaries at the position` : `+${ft.raisePercent}% raise`}${ft.eligibility === "ANY_PLAYER" ? " · any player" : ""} · repeat tags ×${ft.consecutiveMultiplier} (max ${ft.maxConsecutive}).`
                      : "Not used in this league."}
                  </p>
                </Collapsible>
                <Collapsible summary="Rookie option" meta={c.rookieFourthYearOption ? `+${c.rookieOptionRaisePercent}%` : "Off"}>
                  <p className="text-[13px] leading-5 text-muted">
                    {c.rookieFourthYearOption ? `An extra year at +${c.rookieOptionRaisePercent}% for round ${c.rookieOptionRounds.join("/") || "none"} rookie picks.` : "Not used in this league."}
                  </p>
                </Collapsible>
                {actionNote && (
                  <Collapsible summary="When you can act" meta={offseason ? "Offseason" : "In season"}>
                    <p className="text-[13px] leading-5 text-muted">{actionNote}</p>
                  </Collapsible>
                )}
              </div>
              <Link href="/rules" className="flex min-h-12 items-center justify-center border-t border-line/70 text-[14px] font-semibold text-brand-600 hover:bg-sunken/70 dark:text-brand-400">
                Full league rules
              </Link>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Phone contract row: headshot · name / position + team + badges / "thru 2027 · cut $8" · salary + years · actions */
function ContractListRow({ r, teamId, capSeason, season, showActions }: { r: ContractRow; teamId: string; capSeason: number; season: number; showActions: boolean }) {
  const cut = r.cutCost.reduce((a, d) => a + d.amount, 0);
  return (
    <li className="flex min-h-[68px] items-center gap-3 px-4 py-2.5">
      <HeadshotBadge player={{ id: r.playerId, fullName: r.name, position: r.position }} nflTeam={r.nflTeam} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link href={`/players/${r.playerId}`} title={r.name} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
            {r.name}
          </Link>
          <InjuryLetter status={r.injuryStatus} className="text-[13px]" />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
          <PosPill pos={r.position} />
          <span className="shrink-0">
            {r.nflTeam ?? "FA"}
            {r.age ? ` · ${r.age}y` : ""}
          </span>
          {r.status !== "ACTIVE" && <Badge tone={r.status === "IR" ? "red" : "neutral"}>{r.status}</Badge>}
          <ContractBadges isRookie={r.isRookie} isTagged={r.isTagged} years={r.contractYears} className="shrink-0" />
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">
          thru {r.contractEnd}
          {cut > 0 ? <span className="text-loss"> · cut {fmtMoney(cut)}</span> : " · no cut cost"}
          {r.capHit !== r.salary ? ` · hit ${fmtMoney(r.capHit)}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="numeral block text-[17px] font-semibold leading-6 text-ink">{fmtMoney(r.salary)}</span>
        <span className="numeral block text-[12px] text-muted">
          {r.contractYears} yr{r.contractYears === 1 ? "" : "s"}
        </span>
      </span>
      {showActions && (r.extension?.ok || r.tag?.ok || r.option?.ok) && (
        <span className="shrink-0">
          <ContractActions teamId={teamId} row={r} capSeason={capSeason} season={season} />
        </span>
      )}
    </li>
  );
}
