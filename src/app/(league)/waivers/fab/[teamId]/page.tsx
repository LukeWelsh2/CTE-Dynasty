// FAB ledger — "How much FAB does this team have, and where did it go?"
// Summary strip (balance · spent on waivers · net from trades · waiver priority) + a FAB-left meter, then every credit
// and debit by season as list rows (what · when on the left, amount + running balance on the right).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, EmptyState, Meter, PageHeader, Panel, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { TxNav } from "@/components/waivers/bits";
import { loadFabLedger } from "@/lib/waivers/data";
import { fmtDateTime } from "@/lib/waivers/format";
import { cn, fmtMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "FAB Ledger" };

const REASON: Record<string, { label: string; tone: "green" | "red" | "brand" | "amber" | "neutral" }> = {
  SEASON_START: { label: "Season budget", tone: "green" },
  WAIVER: { label: "Waiver claim", tone: "red" },
  TRADE: { label: "Trade", tone: "brand" },
  COMMISSIONER: { label: "Commissioner", tone: "amber" },
  ALLOWANCE: { label: "Weekly allowance", tone: "green" },
};

const signedMoney = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n)}`;

export default async function FabLedgerPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const ctx = await getLeagueContext();
  const team = await db.team.findFirst({ where: { id: teamId, leagueId: ctx.league.id } });
  if (!team) notFound();
  const tz = ctx.settings.general.timezone;
  const seasons = await loadFabLedger(ctx.league.id, team.id);
  const current = seasons.find((s) => s.season === ctx.season);
  const spent = current ? -current.entries.filter((e) => e.reason === "WAIVER").reduce((a, e) => a + e.amount, 0) : 0;
  const traded = current ? current.entries.filter((e) => e.reason === "TRADE").reduce((a, e) => a + e.amount, 0) : 0;
  const credited = current ? current.entries.filter((e) => (e.reason === "SEASON_START" || e.reason === "ALLOWANCE") && e.amount > 0).reduce((a, e) => a + e.amount, 0) : 0;
  // settings.waivers.revealBids NONE: other managers see season totals, never individual winning bids
  const privateBids = (ctx.settings.waivers.revealBids ?? "ALL_BIDS") === "NONE" && !ctx.isCommish && ctx.myTeam?.id !== team.id;
  const balance = current?.balance ?? 0;
  const mine = ctx.myTeam?.id === team.id;

  return (
    <div>
      <PageHeader
        kicker={
          <Link href="/waivers" className="-my-2 inline-flex min-h-8 items-center gap-1 hover:underline">
            <ArrowLeft size={13} /> Waivers & FAB
          </Link>
        }
        title={
          <span className="flex min-w-0 items-center gap-3">
            <TeamLogo team={team} size={36} />
            <span className={cn("min-w-0 break-words", mine && "text-brand-600 dark:text-brand-400")}>{team.name}</span>
          </span>
        }
        subtitle={privateBids ? "FAB ledger · individual bids are private in this league" : "FAB ledger"}
      />
      <TxNav active="waivers" />
      <SummaryStrip
        className="mb-3"
        items={[
          { label: "Balance", value: fmtMoney(balance), sub: current?.balance !== team.faabBalance ? `cached ${fmtMoney(team.faabBalance)}` : `${ctx.season}`, tone: balance <= 0 ? "bad" : undefined },
          { label: "Spent", value: `$${spent}`, sub: "on waivers" },
          { label: "Trades", value: signedMoney(traded), sub: "net", tone: traded > 0 ? "good" : traded < 0 ? "bad" : undefined },
          { label: "Priority", value: `#${team.waiverPriority}`, sub: "waivers" },
        ]}
      />
      {credited > 0 && (
        <div className="card mb-4 px-4 py-3">
          <Meter value={Math.max(0, balance)} max={Math.max(credited, balance)} tone={balance <= 0 ? "bad" : "good"} caption={`${ctx.season} FAB left`} valueText={`${fmtMoney(balance)} / ${fmtMoney(Math.max(credited, balance))}`} />
        </div>
      )}
      {seasons.length ? (
        <div className="space-y-4">
          {seasons.map((s) => (
            <Panel key={s.season} title={`${s.season} season`} subtitle={`Ending balance ${fmtMoney(s.balance)} · ${s.entries.length} entr${s.entries.length === 1 ? "y" : "ies"}`} noPad>
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {s.entries.map((e) => {
                  const r = REASON[e.reason] ?? { label: e.reason, tone: "neutral" as const };
                  const hideAmount = privateBids && e.reason === "WAIVER";
                  return (
                    <li key={e.id} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge tone={r.tone}>{e.carryover ? "Carryover" : r.label}</Badge>
                        </div>
                        <div className="mt-1 truncate text-[15px] leading-5 sm:text-sm">
                          {e.player ? (
                            <Link href={`/players/${e.player.id}`} className="font-semibold text-ink hover:underline">
                              {e.player.fullName}
                            </Link>
                          ) : e.trade ? (
                            <Link href={`/trades/${e.trade.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                              {e.trade.reversal ? "Reversed trade with " : "Trade with "}
                              {e.trade.partners.join(", ") || "another team"}
                            </Link>
                          ) : e.reason === "SEASON_START" ? (
                            <span className="text-ink">{e.carryover ? "Unused FAB carried over" : `${s.season} budget credited`}</span>
                          ) : e.reason === "ALLOWANCE" && e.refType === "week" ? (
                            <span className="text-ink">Weekly FAB allowance</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </div>
                        <div className="numeral mt-0.5 text-[12px] leading-4 text-muted">{fmtDateTime(e.at, tz, { year: true })}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        {hideAmount ? (
                          <span className="block text-[13px] text-muted" title="Bids are private in this league">
                            Private
                          </span>
                        ) : (
                          <span className={cn("numeral block text-[17px] font-semibold leading-6", e.amount > 0 ? "text-win" : e.amount < 0 ? "text-loss" : "text-ink")}>{signedMoney(e.amount)}</span>
                        )}
                        {!privateBids && <span className={cn("numeral block text-[12px] leading-4", e.balance < 0 ? "text-loss" : "text-muted")}>bal {e.balance < 0 ? `−$${Math.abs(e.balance)}` : `$${e.balance}`}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No FAB activity yet">Budgets are credited at the start of each season.</EmptyState>
      )}
    </div>
  );
}
