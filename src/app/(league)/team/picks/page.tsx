// Draft picks — "Which rookie picks do I own?" Summary strip (owned, 1sts, acquired, traded away), the next draft as
// one row, then one list per season (owned picks with their projected slot, traded ones dimmed with the new owner),
// and the picks traded away. Order rules sit in the ⓘ.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ListOrdered, Repeat } from "lucide-react";
import { Badge, ButtonLink, EmptyState, PageHeader, Panel, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { loadPicks, loadTeamHeader, resolveManagedTeam, type PickRow } from "@/lib/team/data";
import { formatDate } from "@/lib/team/format";
import { orderMethodLabel } from "@/lib/team/picks";
import { cn, fmtMoney, ordinal } from "@/lib/utils";
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
  const canTradePicks = settings.trades.enabled && settings.trades.allowDraftPickTrading;
  const nd = data.nextDraft;

  return (
    <div>
      <TeamTabs active="picks" teamId={resolved.commishEdit ? teamId : null} keepers={settings.keepers.enabled} />
      <PageHeader
        kicker={header.team.name}
        title="Draft picks"
        subtitle={`${data.seasons[0]}–${data.seasons[data.seasons.length - 1]} · ${rounds} round${rounds === 1 ? "" : "s"} · ${settings.draft.rookie.style === "SNAKE" ? "snake" : "linear"}`}
        actions={
          <>
            <ButtonLink href="/rookies" variant="secondary" size="md">
              <ListOrdered size={15} /> Rookie rankings
            </ButtonLink>
            {canTradePicks && (
              <ButtonLink href="/trades/new" variant="secondary" size="md">
                <Repeat size={15} /> Trade picks
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="space-y-4">
        <SummaryStrip
          className="max-[379px]:grid-cols-2"
          items={[
            { label: "Owned", value: data.owned.length, sub: `${ownOriginal} own · ${acquired} in` },
            { label: "1sts", value: firsts, sub: `${data.seasons.length} drafts`, title: `First-round picks in the next ${data.seasons.length} drafts` },
            { label: "Acquired", value: acquired, sub: "via trade", tone: acquired > 0 ? "good" : undefined },
            { label: "Traded", value: data.tradedAway.length, sub: "away", tone: data.tradedAway.length > 0 ? "bad" : undefined },
          ]}
        />

        {nd && (
          <Link href="/draft/rookie" className="card flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/70">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm">{nd.name}</span>
              <span className="block truncate text-[13px] text-muted">
                {nd.status === "LIVE" ? <span className="font-semibold text-live">Live now</span> : nd.status === "COMPLETE" ? "Complete" : nd.startTime ? `Starts ${formatDate(nd.startTime, tz)}` : "Date to be announced"}
              </span>
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-brand-600 dark:text-brand-400">Draft room</span>
            <ChevronRight size={16} className="-mr-1 shrink-0 text-faint" aria-hidden />
          </Link>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.seasons.map((season) => {
            const mine = data.owned.filter((p) => p.season === season);
            const gone = data.tradedAway.filter((p) => p.season === season);
            return (
              <Panel
                key={season}
                title={`${season} rookie draft`}
                subtitle={season === nextSeason ? "Projected from current standings" : "Order set by that season's standings"}
                info={
                  <p>
                    {settings.draft.rookie.style === "SNAKE" ? "Snake" : "Linear"} order by {orderMethodLabel(settings.draft.rookie.orderMethod)}, {rounds} round{rounds === 1 ? "" : "s"}. Slots for the next draft are projected from
                    the current standings; later drafts are set by that season&apos;s standings.
                  </p>
                }
                noPad
              >
                {mine.length === 0 && gone.length === 0 ? (
                  <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No picks in the {season} draft.</p>
                ) : (
                  <ul className="divide-y divide-line/70 border-t border-line/70">
                    {Array.from({ length: rounds }, (_, i) => i + 1).flatMap((round) => [
                      ...mine.filter((p) => p.round === round).map((p) => <PickItem key={p.id} p={p} myTeamId={teamId} tz={tz} />),
                      ...gone.filter((p) => p.round === round).map((p) => <TradedItem key={p.id} p={p} />),
                    ])}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>

        <Panel title="Picks traded away" subtitle={data.tradedAway.length ? "Your original picks held by other teams" : undefined} noPad>
          {data.tradedAway.length === 0 ? (
            <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">You still own all of your picks</p>
          ) : (
            <ul className="divide-y divide-line/70 border-t border-line/70">
              {data.tradedAway.map((p) => (
                <li key={p.id}>
                  <Link href={`/teams/${p.owner.id}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70">
                    <TeamLogo team={p.owner} size={32} round />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm">
                        {p.season} {ordinal(p.round)}
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        {p.owner.name}
                        {p.acquiredAt ? ` · ${formatDate(p.acquiredAt, tz)}` : ""}
                      </span>
                    </span>
                    <span className="numeral shrink-0 text-right text-[13px] text-muted">{p.pickInRound ? `${p.round}.${String(p.pickInRound).padStart(2, "0")}` : "TBD"}</span>
                    <ChevronRight size={16} className="-mr-1 shrink-0 text-faint" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function PickSquare({ p, dim }: { p: PickRow; dim?: boolean }) {
  return (
    <span className={cn("flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg", dim ? "border border-dashed border-line text-muted" : "bg-sunken text-ink")}>
      <span className="numeral text-[17px] font-semibold leading-5">{p.pickInRound && !dim ? `${p.round}.${String(p.pickInRound).padStart(2, "0")}` : ordinal(p.round)}</span>
      <span className="text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">{dim ? "traded" : p.pickInRound ? (p.projected ? "proj" : "set") : "round"}</span>
    </span>
  );
}

function PickItem({ p, myTeamId, tz }: { p: PickRow; myTeamId: string; tz: string }) {
  const via = p.originalTeam.id !== myTeamId;
  return (
    <li className="flex min-h-[64px] items-center gap-3 px-4 py-2">
      <PickSquare p={p} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold text-ink sm:text-sm">{ordinal(p.round)} round</span>
          {via && <Badge tone="brand">via {p.originalTeam.abbrev}</Badge>}
        </span>
        <span className="block truncate text-[13px] text-muted">
          {p.pickInRound ? (
            <>
              {p.tier}
              {p.overall ? ` · #${p.overall} overall` : ""}
              {p.salary !== null ? ` · ${fmtMoney(p.salary)} scale` : ""}
            </>
          ) : (
            "Slot TBD"
          )}
        </span>
        {via && (
          <span className="block truncate text-[12px] text-muted" title={p.originalTeam.name}>
            From {p.originalTeam.name}
            {p.acquiredAt && <> · {formatDate(p.acquiredAt, tz)}</>}
          </span>
        )}
      </span>
    </li>
  );
}

function TradedItem({ p }: { p: PickRow }) {
  return (
    <li>
      <Link href={`/teams/${p.owner.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-2 text-muted transition-colors hover:bg-sunken/70">
        <PickSquare p={p} dim />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold sm:text-sm">{ordinal(p.round)} round</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="shrink-0">Owned by</span>
            <TeamLogo team={p.owner} size={16} />
            <span className="truncate font-medium text-ink">{p.owner.name}</span>
          </span>
        </span>
        <ChevronRight size={16} className="-mr-1 shrink-0 text-faint" aria-hidden />
      </Link>
    </li>
  );
}
