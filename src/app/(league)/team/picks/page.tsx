// My rookie draft picks for the next N seasons (owned + traded away), with projected slots for next season.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRightLeft, ListOrdered, Repeat } from "lucide-react";
import { Badge, ButtonLink, EmptyState, Panel, StatTile, TeamLogo } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { loadPicks, loadTeamHeader, resolveManagedTeam, type PickRow } from "@/lib/team/data";
import { formatDate } from "@/lib/team/format";
import { orderMethodLabel } from "@/lib/team/picks";
import { fmtMoney, ordinal } from "@/lib/utils";
import { TeamTabs } from "@/components/team/team-tabs";

export const metadata: Metadata = { title: "Draft Picks" };

export default async function PicksPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const resolved = await resolveManagedTeam(ctx, sp.team);
  if (resolved.kind === "redirect") redirect(resolved.to);
  if (resolved.kind === "none") {
    return (
      <div>
        <TeamTabs active="picks" keepers={ctx.settings.keepers.enabled} />
        <EmptyState title="No team">Join a team to see its rookie draft picks.</EmptyState>
      </div>
    );
  }
  const { settings } = ctx;
  const teamId = resolved.teamId;
  const [header, data] = await Promise.all([loadTeamHeader(ctx, teamId), loadPicks(ctx, teamId)]);
  const rounds = settings.draft.rookie.rounds;
  const firsts = data.owned.filter((p) => p.round === 1).length;
  const acquired = data.owned.filter((p) => p.originalTeam.id !== teamId).length;
  const ownOriginal = data.owned.length - acquired;
  const tz = settings.general.timezone;
  const nextSeason = data.seasons[0];

  return (
    <div>
      <TeamTabs active="picks" teamId={resolved.commishEdit ? teamId : null} keepers={settings.keepers.enabled} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">{header.team.name}</div>
          <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide text-ink sm:text-3xl">Rookie draft picks</h1>
          <p className="text-sm text-muted">
            {data.seasons[0]}–{data.seasons[data.seasons.length - 1]} · {rounds} round{rounds === 1 ? "" : "s"} · {settings.draft.rookie.style === "SNAKE" ? "snake" : "linear"} order by {orderMethodLabel(settings.draft.rookie.orderMethod)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/rookies" variant="secondary" size="sm">
            <ListOrdered size={14} /> Rookie rankings
          </ButtonLink>
          {settings.trades.enabled && settings.trades.allowDraftPickTrading && (
            <ButtonLink href="/trades/new" size="sm">
              <Repeat size={14} /> Propose a trade
            </ButtonLink>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Picks owned" value={data.owned.length} sub={`${ownOriginal} own · ${acquired} acquired`} />
        <StatTile label="1st-rounders" value={firsts} sub={`next ${data.seasons.length} drafts`} />
        <StatTile label="Acquired" value={acquired} sub="from other teams" tone={acquired > 0 ? "good" : "neutral"} />
        <StatTile label="Traded away" value={data.tradedAway.length} tone={data.tradedAway.length > 0 ? "bad" : "neutral"} />
      </div>

      {data.nextDraft && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100">
          <span>
            <b>{data.nextDraft.name}</b> · {data.nextDraft.status === "LIVE" ? "live now" : data.nextDraft.status === "COMPLETE" ? "complete" : data.nextDraft.startTime ? `starts ${formatDate(data.nextDraft.startTime, tz)}` : "date to be announced"}
          </span>
          <Link href="/draft/rookie" className="link font-semibold">
            Draft room
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {data.seasons.map((season) => {
          const mine = data.owned.filter((p) => p.season === season);
          const gone = data.tradedAway.filter((p) => p.season === season);
          return (
            <Panel key={season} title={`${season} rookie draft`} subtitle={season === nextSeason ? "Projected slots from current standings" : "Order set by that season's standings"} noPad>
              {mine.length === 0 && gone.length === 0 ? (
                <div className="p-3 text-sm text-muted">No picks in the {season} draft.</div>
              ) : (
                <ul className="-mb-px -mr-px grid sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: rounds }, (_, i) => i + 1).flatMap((round) => [
                    ...mine.filter((p) => p.round === round).map((p) => <PickCard key={p.id} p={p} myTeamId={teamId} tz={tz} />),
                    ...gone.filter((p) => p.round === round).map((p) => <TradedCard key={p.id} p={p} />),
                  ])}
                </ul>
              )}
            </Panel>
          );
        })}

        <Panel
          title={
            <span className="flex items-center gap-2">
              <ArrowRightLeft size={16} /> Picks traded away
            </span>
          }
          subtitle="Your original picks now held by other teams"
          noPad
        >
          {data.tradedAway.length === 0 ? (
            <div className="p-3">
              <EmptyState title="You still own all of your picks" />
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pick</th>
                  <th>Held by</th>
                  <th className="hidden sm:table-cell">Projected</th>
                  <th className="hidden sm:table-cell">Traded</th>
                </tr>
              </thead>
              <tbody>
                {data.tradedAway.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold">
                      {p.season} {ordinal(p.round)}
                    </td>
                    <td>
                      <Link href={`/teams/${p.owner.id}`} className="inline-flex items-center gap-2 hover:underline">
                        <TeamLogo team={p.owner} size={22} />
                        {p.owner.name}
                      </Link>
                    </td>
                    <td className="hidden text-sm sm:table-cell">{p.pickInRound ? `${p.round}.${String(p.pickInRound).padStart(2, "0")} · ${p.tier}` : "TBD"}</td>
                    <td className="hidden text-xs text-muted sm:table-cell">{p.acquiredAt ? formatDate(p.acquiredAt, tz) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function PickCard({ p, myTeamId, tz }: { p: PickRow; myTeamId: string; tz: string }) {
  const via = p.originalTeam.id !== myTeamId;
  return (
    <li className="flex items-center gap-3 border-b border-r border-line bg-panel p-3">
      <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-line bg-sunken">
        <span className="font-display text-lg font-extrabold leading-none">{p.pickInRound ? `${p.round}.${String(p.pickInRound).padStart(2, "0")}` : ordinal(p.round)}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted">{p.pickInRound ? (p.projected ? "proj" : "set") : "round"}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">
            {p.season} {ordinal(p.round)} round
          </span>
          {via && <Badge tone="gold">via {p.originalTeam.abbrev}</Badge>}
        </div>
        <div className="text-xs text-muted">
          {p.pickInRound ? (
            <>
              {p.tier}
              {p.overall ? ` · #${p.overall} overall` : ""}
              {p.salary !== null ? ` · rookie scale ${fmtMoney(p.salary)}` : ""}
            </>
          ) : (
            "Slot TBD"
          )}
        </div>
        {via && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
            <TeamLogo team={p.originalTeam} size={14} /> {p.originalTeam.name}
            {p.acquiredAt && <> · acquired {formatDate(p.acquiredAt, tz)}</>}
          </div>
        )}
      </div>
    </li>
  );
}

function TradedCard({ p }: { p: PickRow }) {
  return (
    <li className="flex items-center gap-3 border-b border-r border-line bg-sunken/40 p-3 text-muted">
      <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-line">
        <span className="font-display text-lg font-extrabold leading-none opacity-60">{ordinal(p.round)}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide">traded</span>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">
          {p.season} {ordinal(p.round)} round
        </div>
        <div className="flex items-center gap-1 text-xs">
          Now owned by <TeamLogo team={p.owner} size={14} />
          <Link href={`/teams/${p.owner.id}`} className="font-medium hover:underline">
            {p.owner.name}
          </Link>
        </div>
      </div>
    </li>
  );
}
