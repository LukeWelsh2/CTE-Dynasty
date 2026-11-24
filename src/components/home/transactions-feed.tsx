// Latest league transactions: trades grouped into one entry per deal, add/drop pairs merged.
import Link from "next/link";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import { Badge, Panel, TeamLogo } from "@/components/ui/core";
import { timeAgo } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
import { txLabel, txTone } from "./logic";
import type { FeedEntry, FeedMove, FeedTrade } from "./types";

const TRADE_STATUS: Record<string, { label: string; tone: "red" | "amber" | "neutral" | "green" } | undefined> = {
  REVERSED: { label: "Reversed", tone: "red" },
  VETOED: { label: "Vetoed", tone: "red" },
  ACCEPTED: { label: "In review", tone: "amber" },
};

function TradeEntry({ e }: { e: FeedTrade }) {
  const status = TRADE_STATUS[e.status];
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
          <ArrowLeftRight size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-ink">Trade</span>
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
            <span className="ml-auto text-[11px] text-muted" suppressHydrationWarning>
              {timeAgo(e.at)}
            </span>
          </div>
          <ul className="mt-1 space-y-1">
            {e.sides.map((s, i) => (
              <li key={s.team?.id ?? i} className="flex min-w-0 items-start gap-1.5 text-[13px]">
                {s.team && <TeamLogo team={s.team} size={18} className="mt-px" />}
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{s.team?.name ?? "Team"}</span>
                  <span className="text-muted"> {s.items.length ? "gets" : "—"} </span>
                  <span className="text-ink/90">{s.items.join(", ")}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/trades/${e.tradeId}`} className="mt-1 inline-flex items-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Trade details <ChevronRight size={12} aria-hidden />
          </Link>
        </div>
      </div>
    </li>
  );
}

/** Transaction description with the player's name turned into a profile link */
function LinkedText({ text, player }: { text: string; player: FeedMove["lines"][number]["player"] }) {
  const i = player ? text.indexOf(player.fullName) : -1;
  if (!player || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Link href={`/players/${player.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
        {player.fullName}
      </Link>
      {text.slice(i + player.fullName.length)}
    </>
  );
}

function MoveEntry({ e }: { e: FeedMove }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        {e.team ? <TeamLogo team={e.team} size={28} /> : <span className="h-7 w-7 shrink-0 rounded-md bg-sunken" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {e.team ? (
              <Link href={`/teams/${e.team.id}`} className="truncate text-sm font-semibold text-ink hover:underline">
                {e.team.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-ink">League</span>
            )}
            <span className="ml-auto text-[11px] text-muted" suppressHydrationWarning>
              {timeAgo(e.at)}
            </span>
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {e.lines.map((l, i) => (
              <li key={i} className="flex min-w-0 items-start gap-1.5 text-[13px]">
                <Badge tone={txTone(l.type)} className="mt-px shrink-0">
                  {txLabel(l.type)}
                </Badge>
                <span className="min-w-0 text-ink/90">
                  <LinkedText text={l.text} player={l.player} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

export function TransactionsFeed({ entries, className }: { entries: FeedEntry[]; className?: string }) {
  return (
    <Panel
      title="Latest Transactions"
      className={className}
      actions={
        <div className="flex items-center gap-3">
          <MoreLink href="/trades/history" className="hidden sm:inline-flex">
            Trades
          </MoreLink>
          <MoreLink href="/transactions">All moves</MoreLink>
        </div>
      }
    >
      {entries.length ? (
        <ul className="divide-y divide-line/70">{entries.map((e) => (e.kind === "trade" ? <TradeEntry key={e.key} e={e} /> : <MoveEntry key={e.key} e={e} />))}</ul>
      ) : (
        <PanelEmpty action={<MoreLink href="/players?status=available">Browse free agents</MoreLink>}>No transactions yet. Adds, drops, waiver claims and trades will show up here.</PanelEmpty>
      )}
    </Panel>
  );
}
