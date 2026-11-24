// Contracts & cap: every contract with cap hits by season, future commitments chart, dead money and
// contract actions (extend / franchise tag / rookie option) when the league enables them.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Skull } from "lucide-react";
import { Badge, EmptyState, InjuryTag, Panel, StatTile } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { loadContracts, loadTeamHeader, resolveManagedTeam } from "@/lib/team/data";
import { formatDate } from "@/lib/team/format";
import { cn, fmtMoney } from "@/lib/utils";
import { ContractBadges } from "@/components/team/bits";
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

  return (
    <div>
      <TeamTabs active="contracts" teamId={resolved.commishEdit ? teamId : null} keepers={settings.keepers.enabled} />
      <div className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">{header.team.name}</div>
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide text-ink sm:text-3xl">Contracts &amp; cap</h1>
        {!capOn && <p className="text-sm text-muted">This league doesn&apos;t use a salary cap — salaries are tracked for reference only.</p>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Salary cap" value={fmtMoney(cap.cap)} sub={settings.salaryCap.floor ? `floor ${fmtMoney(settings.salaryCap.floor)}` : undefined} />
        <StatTile label="Committed" value={fmtMoney(cap.committed)} sub={`${fmtMoney(cap.totalSalary)} total salary`} />
        <StatTile label="Cap space" value={fmtMoney(cap.space)} tone={cap.space < 0 ? "bad" : "good"} sub={cap.committed < settings.salaryCap.floor ? `${fmtMoney(settings.salaryCap.floor - cap.committed)} under floor` : undefined} />
        <StatTile label="Dead money" value={fmtMoney(cap.deadMoney)} tone={cap.deadMoney > 0 ? "bad" : "neutral"} sub={`${data.deadCap.length} player${data.deadCap.length === 1 ? "" : "s"}`} />
        <StatTile label={`${season + 1} committed`} value={fmtMoney((cap.bySeason[1]?.committed ?? 0) + (data.deadBySeason[1] ?? 0))} sub={`of ${fmtMoney(data.caps[1] ?? cap.cap)}`} />
        <StatTile label="Expiring" value={expiring.length} sub={`${fmtMoney(expiring.reduce((a, r) => a + r.salary, 0))} coming off`} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="min-w-0" title="Future commitments" subtitle={`Next ${data.seasons.length} seasons (contracts${settings.contracts.annualRaisePercent ? ` with ${settings.contracts.annualRaisePercent}% annual raises` : ""} + dead money)`}>
          <ContractsChart data={chart} />
          <div className="mt-3 overflow-x-auto">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Season</th>
                <th className="num">Contracts</th>
                <th className="num">Dead</th>
                <th className="num">Cap</th>
                <th className="num">Space</th>
                <th className="num hidden sm:table-cell">Players</th>
              </tr>
            </thead>
            <tbody>
              {chart.map((c, i) => (
                <tr key={c.season}>
                  <td className="font-semibold">{c.season}</td>
                  <td className="num tabular-nums">{fmtMoney(c.contracts)}</td>
                  <td className={cn("num tabular-nums", c.dead > 0 && "text-loss")}>{fmtMoney(c.dead)}</td>
                  <td className="num tabular-nums text-muted">{fmtMoney(c.cap)}</td>
                  <td className={cn("num font-bold tabular-nums", c.cap - c.contracts - c.dead < 0 ? "text-loss" : "text-win")}>{fmtMoney(c.cap - c.contracts - c.dead)}</td>
                  <td className="num hidden tabular-nums sm:table-cell">{data.rows.filter((r) => r.contractYears > i).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Panel>
        <Panel title="League contract rules" bodyClassName="text-sm">
          <dl className="space-y-1.5">
            <Rule label="Contract length" value={contractsOn ? `${settings.contracts.minYears}–${settings.contracts.maxYears} years` : "Contracts off"} />
            <Rule label="Annual raise" value={`${settings.contracts.annualRaisePercent}%`} />
            <Rule
              label="Extensions"
              value={
                c.extensionsAllowed
                  ? `up to +${c.extensionMaxYearsAdded} yrs · +${c.extensionRaisePercent}%/yr · ${windowLabel}${c.extensionsPerTeamPerSeason !== null ? ` · ${c.extensionsPerTeamPerSeason}/season` : ""}`
                  : "Not allowed"
              }
            />
            {c.lengthLimits.length > 0 && <Rule label="Long deals" value={c.lengthLimits.map((l) => `≤ ${l.maxCount} of ${l.years}+ yrs`).join(" · ")} />}
            <Rule
              label="Franchise tag"
              value={
                ft.enabled
                  ? `${ft.perTeam}/season · ${ft.years} yr · ${ft.costMethod === "TOP5_AVG_AT_POSITION" ? `avg of top ${ft.topN} at position` : `+${ft.raisePercent}%`}${ft.eligibility === "ANY_PLAYER" ? " · any player" : ""} · repeat ×${ft.consecutiveMultiplier} (max ${ft.maxConsecutive})`
                  : "Off"
              }
            />
            <Rule label="Rookie option" value={c.rookieFourthYearOption ? `+${c.rookieOptionRaisePercent}% · round ${c.rookieOptionRounds.join("/") || "none"} picks` : "Off"} />
            <Rule
              label="Dead money"
              value={settings.salaryCap.deadMoney.enabled ? `${settings.salaryCap.deadMoney.currentSeasonPercent}% now, ${settings.salaryCap.deadMoney.futureSeasonPercent}% per future year${settings.salaryCap.deadMoney.rookieContractsExempt ? " · rookies exempt" : ""}` : "None"}
            />
            <Rule label="IR / taxi cap hit" value={`IR ${settings.roster.irCountsAgainstCap ? "counts" : "exempt"} · taxi ${settings.roster.taxiCountsAgainstCap ? "counts" : `${settings.roster.taxiCapPercent}%`}`} />
            {ft.enabled && <Rule label="Tags used" value={`${data.tagsUsed} of ${ft.perTeam} this season`} />}
            {c.extensionsAllowed && c.extensionsPerTeamPerSeason !== null && <Rule label="Extensions used" value={`${data.extensionsUsed} of ${c.extensionsPerTeamPerSeason} this season`} />}
          </dl>
          {actionNote && <p className="mt-3 rounded-md bg-sunken px-2.5 py-2 text-xs text-muted">{actionNote}</p>}
          <Link href="/rules" className="link mt-3 inline-block text-xs font-semibold">
            Full league rules
          </Link>
        </Panel>
      </div>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <FileText size={16} /> Contracts
          </span>
        }
        subtitle={`${data.rows.length} players · cap hit by season`}
        noPad
        className="mb-4"
      >
        {data.rows.length === 0 ? (
          <div className="p-3">
            <EmptyState title="No players under contract" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] bg-sunken">Player</th>
                  <th className="num">Salary</th>
                  <th className="num">Yrs</th>
                  {data.seasons.map((s) => (
                    <th key={s} className="num hidden md:table-cell">
                      {s}
                    </th>
                  ))}
                  <th className="hidden lg:table-cell">Acquired</th>
                  <th className="num hidden sm:table-cell" title="Dead money if dropped today">
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
                      <td className="sticky left-0 z-[1] bg-panel">
                        <div className="flex min-w-[150px] items-center gap-1">
                          <Link href={`/players/${r.playerId}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                            {r.name}
                          </Link>
                          <InjuryTag status={r.injuryStatus} />
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted">
                          {r.position} · {r.nflTeam ?? "FA"}
                          {r.age ? ` · ${r.age}y` : ""}
                          {r.status !== "ACTIVE" && <Badge tone={r.status === "IR" ? "red" : "amber"}>{r.status}</Badge>}
                          <ContractBadges isRookie={r.isRookie} isTagged={r.isTagged} years={r.contractYears} />
                        </div>
                      </td>
                      <td className="num whitespace-nowrap">
                        <b className="tabular-nums">{fmtMoney(r.salary)}</b>
                        {r.capHit !== r.salary && <span className="block text-[11px] text-muted">hit {fmtMoney(r.capHit)}</span>}
                      </td>
                      <td className="num whitespace-nowrap">
                        <span className="tabular-nums">{r.contractYears}</span>
                        <span className="block text-[11px] text-muted">thru {r.contractEnd}</span>
                      </td>
                      {r.bySeason.map((v, i) => (
                        <td key={i} className={cn("num hidden tabular-nums md:table-cell", v === null && "text-muted/60", i === r.contractYears - 1 && "font-semibold")}>
                          {v === null ? "—" : fmtMoney(i === 0 ? r.capHit : v)}
                        </td>
                      ))}
                      <td className="hidden whitespace-nowrap text-xs lg:table-cell">
                        {VIA[r.acquiredVia] ?? r.acquiredVia}
                        <span className="block text-[11px] text-muted">{formatDate(r.acquiredAt, settings.general.timezone)}</span>
                      </td>
                      <td className={cn("num hidden whitespace-nowrap tabular-nums sm:table-cell", cut > 0 ? "text-loss" : "text-muted")} title={r.cutCost.map((d) => `${d.season}: ${fmtMoney(d.amount)}`).join(", ") || "No dead money"}>
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
        )}
      </Panel>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <Skull size={16} className="text-loss" /> Dead money
          </span>
        }
        subtitle="Cap penalties from released contracts"
        noPad
      >
        {data.deadCap.length === 0 ? (
          <div className="p-3">
            <EmptyState title="No dead money">You haven&apos;t taken a cap penalty. Cut costs are shown in the table above before you drop anyone.</EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Player</th>
                  {data.seasons.map((s) => (
                    <th key={s} className="num">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.deadCap.map((d) => (
                  <tr key={d.playerId}>
                    <td>
                      <Link href={`/players/${d.playerId}`} className="font-semibold hover:underline">
                        {d.name}
                      </Link>
                      <span className="block text-[11px] text-muted">
                        {d.position} · {d.nflTeam ?? "FA"}
                      </span>
                    </td>
                    {data.seasons.map((s) => {
                      const amt = d.bySeason.find((x) => x.season === s)?.amount ?? 0;
                      return (
                        <td key={s} className={cn("num tabular-nums", amt ? "text-loss" : "text-muted/60")}>
                          {amt ? fmtMoney(amt) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="font-bold">
                  <td>Total</td>
                  {data.deadBySeason.map((v, i) => (
                    <td key={i} className="num tabular-nums">
                      {fmtMoney(v)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
