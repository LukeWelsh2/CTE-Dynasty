// The auction room once an auction is complete (server component) — "Who spent what, and on whom?"
// Title + one grey line, the 4-number summary (sold · spent · top sale · top spender), the top sales (5 + show more)
// and spending by team as ranked bars. Everything else (every sale, by team, by position) is one tap away in Results.
import Link from "next/link";
import type { Draft } from "@prisma/client";
import { ButtonLink, Panel, RankBar, RankList, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import type { auctionResults } from "@/lib/draft/results";
import { spendingByPosition } from "@/lib/draft/results";
import { fmtDateTime } from "@/lib/draft/time";
import { DraftControls } from "./draft-controls";
import { PlayerCell } from "./bits";

export function CompletedAuction({ draft, results, isCommish, timezone, myTeamId = null }: { draft: Draft; results: Awaited<ReturnType<typeof auctionResults>>; isCommish: boolean; timezone: string; myTeamId?: string | null }) {
  const rows = [...results.rows].sort((a, b) => b.price - a.price);
  const total = rows.reduce((a, r) => a + r.price, 0);
  const spend = spendingByPosition(rows);
  const topSpend = spend[0]?.total ?? 1;
  const kind = ((draft.settings ?? {}) as Record<string, unknown>).kind === "FREE_AGENT" ? "Free-agent auction" : "Salary auction";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow mb-1 flex items-center gap-1.5">
            {kind} · <span className="text-win">Complete</span>
          </div>
          <h1 className="break-words text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[30px]">{draft.name}</h1>
          {draft.completedAt && <p className="mt-1 text-[15px] text-muted">Finished {fmtDateTime(draft.completedAt, timezone)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/draft/results?id=${draft.id}`} size="md">
            All results
          </ButtonLink>
          <ButtonLink href="/draft" variant="secondary" size="md">
            Draft center
          </ButtonLink>
        </div>
      </div>

      {isCommish && results.source === "LOTS" && (
        <section className="card px-4 py-3" aria-label="Commissioner controls">
          <div className="eyebrow mb-2">Commissioner</div>
          <DraftControls draftId={draft.id} status={draft.status} type="AUCTION" hasActivity={rows.length > 0} compact />
          <p className="mt-2 text-[13px] text-muted">Undoing a sale re-opens the auction (paused).</p>
        </section>
      )}

      {rows.length > 0 && (
        <SummaryStrip
          items={[
            { label: "Sold", value: rows.length, sub: results.passed ? `${results.passed} passed` : "players" },
            { label: "Spent", value: `$${total.toLocaleString()}`, sub: `$${(total / rows.length).toFixed(1)} avg` },
            { label: "Top sale", value: `$${rows[0].price}`, sub: rows[0].player.fullName, title: `${rows[0].player.fullName} · ${rows[0].team.name}` },
            { label: "Top spend", value: spend[0] ? `$${spend[0].total}` : "—", sub: spend[0]?.team.abbrev, title: spend[0]?.team.name },
          ]}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top sales" noPad actions={<Link href={`/draft/results?id=${draft.id}`} className="inline-flex min-h-8 items-center text-[13px] font-semibold text-brand-600 dark:text-brand-400">All {rows.length}</Link>}>
          <ShowMore as="ol" initial={5} className="divide-y divide-line/70 border-t border-line/70" moreLabel={`Show ${Math.min(12, rows.length) - 5} more`}>
            {rows.slice(0, 12).map((r, i) => (
              <li key={r.key} className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <PlayerCell player={{ ...r.player, position: r.position }} size={36} short />
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ink" title={r.team.name}>
                  <TeamLogo team={r.team} size={20} /> {r.team.abbrev}
                </span>
                <span className="numeral w-11 shrink-0 text-right text-[17px] font-semibold text-ink">${r.price}</span>
              </li>
            ))}
          </ShowMore>
        </Panel>
        <Panel title="Spending by team" subtitle={`${spend.length} teams · $${total.toLocaleString()}`} noPad>
          <div className="border-t border-line/70">
            <RankList>
              {spend.map((s, i) => (
                <RankBar
                  key={s.team.id}
                  rank={i + 1}
                  leading={<TeamLogo team={s.team} size={28} />}
                  title={s.team.name}
                  sub={`${s.count} players`}
                  value={s.total}
                  max={topSpend}
                  display={`$${s.total}`}
                  mine={s.team.id === myTeamId}
                />
              ))}
            </RankList>
          </div>
        </Panel>
      </div>
    </div>
  );
}
