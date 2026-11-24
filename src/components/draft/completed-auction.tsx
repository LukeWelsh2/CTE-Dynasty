// Summary shown in the auction room once an auction is complete (server component).
import Link from "next/link";
import type { Draft } from "@prisma/client";
import { Check } from "lucide-react";
import { ButtonLink, Panel, PosBadge, StatTile, TeamLogo } from "@/components/ui/core";
import type { auctionResults } from "@/lib/draft/results";
import { spendingByPosition } from "@/lib/draft/results";
import { fmtDateTime } from "@/lib/draft/time";
import { DraftControls } from "./draft-controls";

export function CompletedAuction({ draft, results, isCommish, timezone }: { draft: Draft; results: Awaited<ReturnType<typeof auctionResults>>; isCommish: boolean; timezone: string }) {
  const rows = [...results.rows].sort((a, b) => b.price - a.price);
  const total = rows.reduce((a, r) => a + r.price, 0);
  const spend = spendingByPosition(rows);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-800 bg-gradient-to-r from-brand-950 via-brand-900 to-brand-800 px-4 py-4 text-white shadow-panel">
        <div className="flex items-center gap-3">
          <Check className="text-gold-400" size={28} />
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-300">Auction complete</div>
            <h1 className="font-display text-2xl font-extrabold uppercase sm:text-3xl">{draft.name}</h1>
            <div className="text-sm text-white/75">
              {rows.length} players sold · ${total.toLocaleString()} spent{draft.completedAt ? ` · finished ${fmtDateTime(draft.completedAt, timezone)}` : ""}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/draft/results?id=${draft.id}`} variant="gold" size="sm">
            Full results
          </ButtonLink>
          <ButtonLink href="/draft" variant="secondary" size="sm">
            Draft Center
          </ButtonLink>
        </div>
      </div>
      {isCommish && results.source === "LOTS" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gold-400/60 bg-gold-300/10 px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-gold-600 dark:text-gold-300">Commissioner</span>
          <DraftControls draftId={draft.id} status={draft.status} type="AUCTION" hasActivity={rows.length > 0} />
          <span className="text-xs text-muted">Undoing a sale re-opens the auction (paused).</span>
        </div>
      )}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Players sold" value={rows.length} />
          <StatTile label="Total spent" value={`$${total.toLocaleString()}`} />
          <StatTile label="Top sale" value={`$${rows[0].price}`} sub={`${rows[0].player.fullName} · ${rows[0].team.abbrev}`} />
          <StatTile label="Biggest spender" value={spend[0] ? `$${spend[0].total}` : "—"} sub={spend[0]?.team.name} />
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Top sales" noPad>
          <table className="tbl tbl-compact">
            <tbody>
              {rows.slice(0, 12).map((r, i) => (
                <tr key={r.key}>
                  <td className="num w-8 text-xs text-muted">{i + 1}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <PosBadge pos={r.position} />
                      <Link href={`/players/${r.player.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                        {r.player.fullName}
                      </Link>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5 text-xs">
                      <TeamLogo team={r.team} size={18} /> {r.team.abbrev}
                    </span>
                  </td>
                  <td className="num font-bold">${r.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Spending by team" noPad>
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Team</th>
                <th className="num">Players</th>
                <th className="num">Spent</th>
              </tr>
            </thead>
            <tbody>
              {spend.map((s) => (
                <tr key={s.team.id}>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <TeamLogo team={s.team} size={18} /> <span className="font-semibold">{s.team.name}</span>
                    </span>
                  </td>
                  <td className="num">{s.count}</td>
                  <td className="num font-semibold">${s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
