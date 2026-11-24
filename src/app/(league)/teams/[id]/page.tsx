// Read-only team page: header, full roster (grouped), contract summary, draft picks and recent transactions.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Repeat, Shield, UserRound } from "lucide-react";
import { Badge, ButtonLink, EmptyState, Panel, TeamLogo } from "@/components/ui/core";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { loadPicks, loadTeamPage, recentTransactions } from "@/lib/team/data";
import { formatDate } from "@/lib/team/format";
import { cn, fmtMoney, ordinal, timeAgo } from "@/lib/utils";
import { LineupEditor } from "@/components/team/lineup-editor";
import { TeamHeader } from "@/components/team/team-header";
import { TeamTabs } from "@/components/team/team-tabs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const team = await db.team.findUnique({ where: { id }, select: { name: true } });
  return { title: team?.name ?? "Team" };
}

const TX_TONE: Record<string, "green" | "red" | "brand" | "amber" | "purple" | "neutral"> = {
  ADD: "green",
  WAIVER: "green",
  DROP: "red",
  TRADE: "purple",
  IR: "amber",
  TAXI: "amber",
  ACTIVATE: "brand",
  CONTRACT: "brand",
};

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getLeagueContext();
  const { id } = await params;
  const team = await db.team.findFirst({ where: { id, leagueId: ctx.league.id }, select: { id: true, ownerId: true } });
  if (!team) notFound();
  const { settings } = ctx;
  const mine = ctx.myTeam?.id === team.id;
  const [data, picks, txs] = await Promise.all([loadTeamPage(ctx, team.id, ctx.week, { manage: false, commishEdit: false }), loadPicks(ctx, team.id), recentTransactions(ctx.league.id, team.id, 12)]);
  const cap = data.header.cap;
  const rows = data.editor.rows.filter((r) => r.rosterStatus !== "GONE");
  const expiring = rows.filter((r) => (r.contractYears ?? 0) <= 1);
  const tz = settings.general.timezone;
  const canTrade = settings.trades.enabled && !mine && !!ctx.myTeam;
  const commishManage = ctx.isCommish && settings.commissioner.canEditLineups && !mine;

  return (
    <div>
      {ctx.myTeam && <TeamTabs active="teams" keepers={settings.keepers.enabled} />}
      <TeamHeader
        data={data.header}
        actions={
          <>
            {team.ownerId && (
              <ButtonLink href={`/managers/${team.ownerId}`} variant="secondary" size="sm">
                <UserRound size={14} /> Manager
              </ButtonLink>
            )}
            {canTrade && (
              <ButtonLink href={`/trades/new?team=${team.id}`} size="sm">
                <Repeat size={14} /> Propose trade
              </ButtonLink>
            )}
            {mine && (
              <ButtonLink href="/team" size="sm">
                Manage my team
              </ButtonLink>
            )}
            {commishManage && (
              <ButtonLink href={`/team?team=${team.id}`} variant="gold" size="sm">
                <Shield size={14} /> Manage
              </ButtonLink>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wide">Week {ctx.week} roster</h2>
          <LineupEditor data={data.editor} deadCap={data.deadCap} />
        </div>
        <div className="space-y-4">
          {cap && (
            <Panel title="Contracts" subtitle={`${rows.length} players · ${expiring.length} expiring`}>
              <ul className="space-y-1.5 text-sm">
                {cap.bySeason.map((s, i) => {
                  const total = i === 0 ? cap.committed : s.committed;
                  const capY = settings.salaryCap.cap + i * (settings.salaryCap.annualCapIncrease ?? 0);
                  return (
                    <li key={s.season} className="grid grid-cols-[44px_1fr_auto] items-center gap-2">
                      <span className="font-semibold">{s.season}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-sunken ring-1 ring-inset ring-line">
                        <span className={cn("block h-full", total > capY ? "bg-loss" : "bg-brand-600 dark:bg-brand-500")} style={{ width: `${Math.min(100, (total / Math.max(1, capY)) * 100)}%` }} />
                      </span>
                      <span className="text-right text-xs tabular-nums">
                        <b>{fmtMoney(total)}</b> <span className="text-muted">/ {fmtMoney(capY)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {expiring.length > 0 && (
                <div className="mt-3 border-t border-line pt-2">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Top expiring</div>
                  <ul className="space-y-0.5 text-sm">
                    {expiring
                      .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0))
                      .slice(0, 5)
                      .map((r) => (
                        <li key={r.playerId} className="flex justify-between gap-2">
                          <Link href={`/players/${r.playerId}`} className="truncate hover:underline">
                            {r.name} <span className="text-[11px] text-muted">{r.position}</span>
                          </Link>
                          <span className="tabular-nums">{fmtMoney(r.salary)}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Draft picks" subtitle={`${picks.owned.length} owned · ${picks.seasons[0]}–${picks.seasons[picks.seasons.length - 1]}`} noPad>
            {picks.owned.length === 0 ? (
              <div className="p-3 text-sm text-muted">No rookie picks owned.</div>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {picks.owned.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="font-semibold">
                      {p.season} {ordinal(p.round)}
                      {p.pickInRound && <span className="ml-1 text-xs font-normal text-muted">({p.round}.{String(p.pickInRound).padStart(2, "0")}{p.projected ? " proj" : ""})</span>}
                    </span>
                    {p.originalTeam.id !== team.id ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        via <TeamLogo team={p.originalTeam} size={16} /> {p.originalTeam.abbrev}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">own</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {picks.tradedAway.length > 0 && (
              <div className="border-t border-line px-3 py-2 text-xs text-muted">
                Traded away: {picks.tradedAway.map((p) => `${p.season} ${ordinal(p.round)} (${p.owner.abbrev})`).join(", ")}
              </div>
            )}
          </Panel>

          <Panel title="Recent transactions" noPad actions={<Link href="/transactions" className="link text-xs font-semibold">League log</Link>}>
            {txs.length === 0 ? (
              <div className="p-3">
                <EmptyState title="No transactions yet" />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {txs.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <Badge tone={TX_TONE[t.type] ?? "neutral"} className="mt-0.5 shrink-0">
                      {t.type === "WAIVER" ? "Claim" : t.type === "ROOKIE_DRAFT" ? "Draft" : t.type.toLowerCase()}
                    </Badge>
                    <div className="min-w-0">
                      <div className="leading-snug">{t.description}</div>
                      <div className="text-[11px] text-muted" title={formatDate(t.createdAt, tz)}>
                        {t.week > 0 ? `Week ${t.week} · ` : ""}
                        {timeAgo(t.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
