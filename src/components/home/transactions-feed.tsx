// Latest league transactions: trades grouped into one entry per deal, add/drop pairs merged.
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { Badge, Panel, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
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
    <li>
      <Link href={`/trades/${e.tradeId}`} className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/70">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink/70">
          <ArrowLeftRight size={14} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold leading-5 text-ink sm:text-sm">Trade</span>
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
            <span className="ml-auto shrink-0 text-[12px] text-muted" suppressHydrationWarning>
              {timeAgo(e.at)}
            </span>
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {e.sides.map((s, i) => (
              <li key={s.team?.id ?? i} className="flex min-w-0 items-start gap-1.5 text-[13px] leading-[18px]">
                {s.team && <TeamLogo team={s.team} size={16} className="mt-px" />}
                <span className="line-clamp-2 min-w-0">
                  <span className="font-semibold text-ink">{s.team?.abbrev ?? s.team?.name ?? "Team"}</span>
                  <span className="text-muted"> {s.items.length ? "gets" : "—"} </span>
                  <span className="text-ink/85">{s.items.join(", ")}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Link>
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
      <Link href={`/players/${player.id}`} className="font-semibold text-ink hover:text-brand-600 hover:underline dark:hover:text-brand-400">
        {player.fullName}
      </Link>
      {text.slice(i + player.fullName.length)}
    </>
  );
}

function MoveEntry({ e }: { e: FeedMove }) {
  return (
    <li className="flex gap-3 px-4 py-2.5">
      {e.team ? <TeamLogo team={e.team} size={28} /> : <span className="h-7 w-7 shrink-0 rounded-full bg-sunken" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {e.team ? (
            <Link href={`/teams/${e.team.id}`} title={e.team.name} className="min-w-0 truncate text-[15px] font-semibold leading-5 text-ink hover:underline sm:text-sm">
              {e.team.name}
            </Link>
          ) : (
            <span className="text-[15px] font-semibold leading-5 text-ink sm:text-sm">League</span>
          )}
          <span className="ml-auto shrink-0 text-[12px] text-muted" suppressHydrationWarning>
            {timeAgo(e.at)}
          </span>
        </div>
        <ul className="mt-0.5 space-y-1">
          {e.lines.map((l, i) => (
            <li key={i} className="flex min-w-0 items-start gap-1.5 text-[13px] leading-[18px]">
              <Badge tone={txTone(l.type)} className="mt-px shrink-0">
                {txLabel(l.type)}
              </Badge>
              <span className="line-clamp-2 min-w-0 text-ink/85">
                <LinkedText text={l.text} player={l.player} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function TransactionsFeed({ entries, className }: { entries: FeedEntry[]; className?: string }) {
  return (
    <Panel
      title="Transactions"
      className={className}
      noPad
      actions={
        <div className="flex items-center gap-3">
          <MoreLink href="/trades/history" className="hidden sm:inline-flex">
            Trades
          </MoreLink>
          <MoreLink href="/transactions">All</MoreLink>
        </div>
      }
    >
      {entries.length ? (
        <div className="border-t border-line/70">
          <ShowMore as="ul" initial={3} className="divide-y divide-line/70">
            {entries.map((e) => (e.kind === "trade" ? <TradeEntry key={e.key} e={e} /> : <MoveEntry key={e.key} e={e} />))}
          </ShowMore>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <PanelEmpty action={<MoreLink href="/players?status=available">Browse free agents</MoreLink>}>No transactions yet.</PanelEmpty>
        </div>
      )}
    </Panel>
  );
}
