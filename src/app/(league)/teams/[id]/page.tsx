// Any team's page — "Who's on this team and how are they doing?" The Roster pattern (docs/DESIGN.md §6.2): identity
// header (logo, name ▾ to switch teams, owner, record) with trade / manager / manage actions, a summary strip (record,
// PF, cap room, FAB), this week's matchup as one row, the roster in slot-pill rows (read-only), then contracts by
// season, draft picks and recent transactions — each cut to its top rows.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Repeat, Shield, UserRound } from "lucide-react";
import { Badge, ButtonLink, Meter, MatchupRow, MoreLink, Panel, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { PosPill } from "@/components/ui/fantasy";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { loadPicks, loadTeamPage, recentTransactions } from "@/lib/team/data";
import { formatDate } from "@/lib/team/format";
import { fmtMoney, fmtPts, ordinal, timeAgo } from "@/lib/utils";
import { LineupEditor } from "@/components/team/lineup-editor";
import { TeamPageHeader } from "@/components/team/team-page-header";
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
  const [data, picks, txs, allTeams] = await Promise.all([
    loadTeamPage(ctx, team.id, ctx.week, { manage: false, commishEdit: false }),
    loadPicks(ctx, team.id),
    recentTransactions(ctx.league.id, team.id, 12),
    db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const h = data.header;
  const cap = h.cap;
  const rows = data.editor.rows.filter((r) => r.rosterStatus !== "GONE");
  const expiring = rows.filter((r) => (r.contractYears ?? 0) <= 1).sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0));
  const tz = settings.general.timezone;
  const canTrade = settings.trades.enabled && !mine && !!ctx.myTeam;
  const commishManage = ctx.isCommish && settings.commissioner.canEditLineups && !mine;
  const m = h.matchup;

  return (
    <div>
      {ctx.myTeam && <TeamTabs active="teams" keepers={settings.keepers.enabled} />}
      <TeamPageHeader
        data={h}
        teams={allTeams}
        myTeamId={ctx.myTeam?.id ?? null}
        actions={
          canTrade || team.ownerId || mine || commishManage ? (
            <>
              {canTrade && (
                <ButtonLink href={`/trades/new?team=${team.id}`} size="md" title="Propose a trade">
                  <Repeat size={15} /> Trade
                </ButtonLink>
              )}
              {mine && (
                <ButtonLink href="/team" size="md">
                  Manage my team
                </ButtonLink>
              )}
              {team.ownerId && (
                <ButtonLink href={`/managers/${team.ownerId}`} variant="secondary" size="md">
                  <UserRound size={15} /> Manager
                </ButtonLink>
              )}
              {commishManage && (
                <ButtonLink href={`/team?team=${team.id}`} variant="secondary" size="md">
                  <Shield size={15} /> Manage
                </ButtonLink>
              )}
            </>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-6">
        <div className="min-w-0 space-y-4">
          <SummaryStrip
            items={[
              // record / rank / streak are in the header line above; the strip carries the other numbers
              { label: "PF", value: fmtPts(h.pointsFor, 0), sub: "points for", title: `Points for · ${fmtPts(h.pointsFor, 2)}` },
              { label: "PA", value: fmtPts(h.pointsAgainst, 0), sub: "against", title: `Points against · ${fmtPts(h.pointsAgainst, 2)}` },
              cap
                ? { label: "Room", value: fmtMoney(cap.space), tone: cap.space < 0 ? "bad" : undefined, sub: `of ${fmtMoney(cap.cap)}`, title: "Cap room" }
                : { label: "Active", value: `${h.limits.active}`, sub: `of ${h.limits.maxActive ?? "—"}` },
              h.faab !== null
                ? { label: "FAB", value: fmtMoney(h.faab), sub: "left" }
                : { label: "Roster", value: `${h.limits.active}/${h.limits.maxActive ?? "—"}`, sub: "active" },
            ]}
          />

          {m && (
            <ul className="card overflow-hidden">
              <li>
                <MatchupRow
                  away={{ team: m.me, score: m.me.score, projected: m.me.projected, record: m.me.record }}
                  home={m.opp ? { team: m.opp, score: m.opp.score, projected: m.opp.projected, record: m.opp.record } : null}
                  status={m.status}
                  homeWinProb={m.opp ? 1 - m.myWinProb : null}
                  href={`/scoring/${m.id}`}
                  myTeamId={ctx.myTeam?.id ?? null}
                  label={m.label ?? (m.isPlayoff ? "Playoffs" : `Week ${m.week}`)}
                  logo={(t) => <TeamLogo team={t} size={24} />}
                />
              </li>
            </ul>
          )}

          <LineupEditor data={data.editor} deadCap={data.deadCap} />
        </div>

        <aside className="min-w-0 space-y-4">
          {cap && (
            <Panel title="Contracts" subtitle={`${rows.length} players · ${expiring.length} expiring`} noPad>
              <div className="space-y-3 px-4 pb-4">
                {cap.bySeason.map((s, i) => {
                  const total = i === 0 ? cap.committed : s.committed;
                  const capY = settings.salaryCap.cap + i * (settings.salaryCap.annualCapIncrease ?? 0);
                  return <Meter key={s.season} value={total} max={capY} tone={total > capY ? "bad" : "brand"} caption={String(s.season)} valueText={`${fmtMoney(total)} / ${fmtMoney(capY)}`} />;
                })}
              </div>
              {expiring.length > 0 && (
                <div className="border-t border-line/70">
                  <h3 className="eyebrow px-4 pb-1 pt-3">Expiring</h3>
                  <ShowMore as="ul" initial={3} className="divide-y divide-line/70">
                    {expiring.map((r) => (
                      <li key={r.playerId} className="flex min-h-11 items-center gap-2 px-4">
                        <PosPill pos={r.pos} />
                        <Link href={`/players/${r.playerId}`} title={r.name} className="min-w-0 truncate text-[15px] font-medium text-ink hover:underline sm:text-sm">
                          {r.name}
                        </Link>
                        <span className="numeral ml-auto shrink-0 text-[15px] font-semibold text-ink sm:text-sm">{fmtMoney(r.salary)}</span>
                      </li>
                    ))}
                  </ShowMore>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Draft picks" subtitle={`${picks.owned.length} owned · ${picks.seasons[0]}–${picks.seasons[picks.seasons.length - 1]}`} noPad>
            {picks.owned.length === 0 ? (
              <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No rookie picks owned.</p>
            ) : (
              <ShowMore as="ul" initial={4} className="divide-y divide-line/70 border-t border-line/70">
                {picks.owned.map((p) => (
                  <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 px-4">
                    <span className="text-[15px] font-semibold text-ink sm:text-sm">
                      {p.season} {ordinal(p.round)}
                      {p.pickInRound && (
                        <span className="numeral ml-1.5 text-[13px] font-normal text-muted">
                          {p.round}.{String(p.pickInRound).padStart(2, "0")}
                          {p.projected ? " proj" : ""}
                        </span>
                      )}
                    </span>
                    {p.originalTeam.id !== team.id ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                        via <TeamLogo team={p.originalTeam} size={18} /> {p.originalTeam.abbrev}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted">own</span>
                    )}
                  </li>
                ))}
              </ShowMore>
            )}
            {picks.tradedAway.length > 0 && (
              <p className="border-t border-line/70 px-4 py-2.5 text-[13px] text-muted">
                Traded away: {picks.tradedAway.map((p) => `${p.season} ${ordinal(p.round)} (${p.owner.abbrev})`).join(", ")}
              </p>
            )}
          </Panel>

          <Panel title="Transactions" noPad actions={<MoreLink href={`/transactions?team=${team.id}`}>All</MoreLink>}>
            {txs.length === 0 ? (
              <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No transactions yet.</p>
            ) : (
              <ShowMore as="ul" initial={3} className="divide-y divide-line/70 border-t border-line/70">
                {txs.map((t) => (
                  <li key={t.id} className="px-4 py-2.5">
                    <div className="line-clamp-2 text-[15px] leading-5 text-ink sm:text-sm">{t.description}</div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-muted" title={formatDate(t.createdAt, tz)}>
                      <Badge tone={TX_TONE[t.type] ?? "neutral"}>{t.type === "WAIVER" ? "Claim" : t.type === "ROOKIE_DRAFT" ? "Draft" : t.type.toLowerCase()}</Badge>
                      <span>
                        {t.week > 0 ? `Week ${t.week} · ` : ""}
                        {timeAgo(t.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ShowMore>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
