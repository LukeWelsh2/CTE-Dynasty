// FAB ledger for one team: every credit and debit by season with a running balance.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, EmptyState, PageHeader, Panel, StatTile, TeamLogo } from "@/components/ui/core";
import { TxNav } from "@/components/waivers/bits";
import { loadFabLedger } from "@/lib/waivers/data";
import { fmtDateTime } from "@/lib/waivers/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "FAB Ledger" };

const REASON: Record<string, { label: string; tone: "green" | "red" | "brand" | "amber" | "neutral" }> = {
  SEASON_START: { label: "Season budget", tone: "green" },
  WAIVER: { label: "Waiver claim", tone: "red" },
  TRADE: { label: "Trade", tone: "brand" },
  COMMISSIONER: { label: "Commissioner", tone: "amber" },
  ALLOWANCE: { label: "Weekly allowance", tone: "green" },
};

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
  // settings.waivers.revealBids NONE: other managers see season totals, never individual winning bids
  const privateBids = (ctx.settings.waivers.revealBids ?? "ALL_BIDS") === "NONE" && !ctx.isCommish && ctx.myTeam?.id !== team.id;

  return (
    <div>
      <PageHeader
        kicker={
          <Link href="/waivers" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={12} /> Waivers & FAB
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <TeamLogo team={team} size={40} />
            <span className="min-w-0 break-words">{team.name}</span>
          </span>
        }
        subtitle={privateBids ? "FAB ledger — every credit and debit (individual bids are private in this league)" : "FAB ledger — every credit and debit, with the running balance"}
      />
      <TxNav active="waivers" />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={`${ctx.season} balance`} value={`$${current?.balance ?? 0}`} sub={current?.balance !== team.faabBalance ? `Cached: $${team.faabBalance}` : undefined} />
        <StatTile label="Spent on waivers" value={`$${spent}`} />
        <StatTile label="Net from trades" value={`${traded > 0 ? "+" : traded < 0 ? "−" : ""}$${Math.abs(traded)}`} tone={traded > 0 ? "good" : traded < 0 ? "bad" : undefined} />
        <StatTile label="Waiver priority" value={`#${team.waiverPriority}`} />
      </div>
      {seasons.length ? (
        <div className="space-y-4">
          {seasons.map((s) => (
            <Panel key={s.season} title={`${s.season} season`} subtitle={`Ending balance $${s.balance}`} noPad>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Details</th>
                      <th className="num">Amount</th>
                      {!privateBids && <th className="num">Balance</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {s.entries.map((e) => {
                      const r = REASON[e.reason] ?? { label: e.reason, tone: "neutral" as const };
                      return (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(e.at, tz, { year: true })}</td>
                          <td>
                            <Badge tone={r.tone}>{e.carryover ? "Carryover" : r.label}</Badge>
                          </td>
                          <td className="min-w-[160px] text-sm">
                            {e.player ? (
                              <Link href={`/players/${e.player.id}`} className="link">
                                {e.player.fullName}
                              </Link>
                            ) : e.trade ? (
                              <Link href={`/trades/${e.trade.id}`} className="link">
                                {e.trade.reversal ? "Reversed trade with " : "Trade with "}
                                {e.trade.partners.join(", ") || "another team"}
                              </Link>
                            ) : e.reason === "SEASON_START" ? (
                              <span className="text-muted">{e.carryover ? "Unused FAB carried over" : "Season budget"}</span>
                            ) : e.reason === "ALLOWANCE" && e.refType === "week" ? (
                              <span className="text-muted">Weekly FAB allowance</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          {privateBids && e.reason === "WAIVER" ? (
                            <td className="num text-xs text-muted" title="Bids are private in this league">
                              Private
                            </td>
                          ) : (
                            <td className={cn("num font-semibold", e.amount > 0 ? "text-win" : e.amount < 0 ? "text-loss" : "")}>
                              {e.amount > 0 ? "+" : e.amount < 0 ? "−" : ""}${Math.abs(e.amount)}
                            </td>
                          )}
                          {!privateBids && <td className={cn("num font-bold", e.balance < 0 && "text-loss")}>{e.balance < 0 ? `−$${Math.abs(e.balance)}` : `$${e.balance}`}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No FAB activity yet">This team&apos;s FAB ledger is empty. Budgets are credited at the start of each season.</EmptyState>
      )}
    </div>
  );
}
