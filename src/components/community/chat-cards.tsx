// Rich cards for automated chat posts (trades, transactions, scoring plays).
import Link from "next/link";
import { ArrowRightLeft, Megaphone, PlusCircle, MinusCircle, Zap } from "lucide-react";
import { Badge, PlayerHeadshot, PosBadge, TeamLogo } from "@/components/ui/core";
import type { CardPlayer, ChatCard, ChatMessageDTO } from "@/lib/chat/format";
import { cn, fmtPts } from "@/lib/utils";

const STATUS_TONE: Record<string, "green" | "red" | "amber" | "neutral" | "brand"> = {
  COMPLETED: "green",
  ACCEPTED: "brand",
  PROPOSED: "amber",
  VETOED: "red",
  REVERSED: "red",
  REJECTED: "neutral",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

function PlayerChip({ p }: { p: CardPlayer }) {
  return (
    <Link href={`/players/${p.id}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-md py-0.5 hover:bg-sunken">
      <PlayerHeadshot player={p} size={22} />
      <span className="truncate text-[13px] font-semibold text-brand-700 dark:text-brand-300">{p.fullName}</span>
      <PosBadge pos={p.position} className="h-4 min-w-[24px] text-[9px]" />
      <span className="text-[11px] text-muted">{p.team ?? "FA"}</span>
    </Link>
  );
}

function TradeCard({ card, reversal }: { card: Extract<ChatCard, { type: "trade" }>; reversal: boolean }) {
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-sunken/70 px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
          <ArrowRightLeft size={13} /> {reversal ? "Trade reversed" : "Trade"}
        </span>
        <Badge tone={STATUS_TONE[card.status] ?? "neutral"}>{card.status.toLowerCase()}</Badge>
      </div>
      <div className={cn("grid gap-px bg-line", card.sides.length > 1 ? "sm:grid-cols-2" : "")}>
        {card.sides.map((s) => (
          <div key={s.team.id} className="min-w-0 bg-panel px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <TeamLogo team={s.team} size={20} />
              <Link href={`/teams/${s.team.id}`} className="truncate text-sm font-bold hover:underline">
                {s.team.name}
              </Link>
              <span className="text-[11px] uppercase tracking-wide text-muted">{reversal ? "gets back" : "gets"}</span>
            </div>
            {s.received.length === 0 ? (
              <div className="text-xs text-muted">Nothing</div>
            ) : (
              <ul className="space-y-0.5">
                {s.received.map((a, i) => (
                  <li key={i} className="min-w-0">
                    {a.player ? <PlayerChip p={a.player} /> : <span className="text-[13px] font-medium">{a.label}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <Link href={card.url} className="block border-t border-line px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-sunken dark:text-brand-300">
        View trade details →
      </Link>
    </div>
  );
}

function TransactionCard({ card, body }: { card: Extract<ChatCard, { type: "transaction" }>; body: string }) {
  return (
    <div className="mt-1 rounded-lg border border-line bg-panel px-3 py-2">
      {card.team && (
        <div className="mb-1 flex items-center gap-2">
          <TeamLogo team={card.team} size={20} />
          <Link href={`/teams/${card.team.id}`} className="truncate text-sm font-bold hover:underline">
            {card.team.name}
          </Link>
          {card.txType && <Badge>{card.txType.replace(/_/g, " ").toLowerCase()}</Badge>}
        </div>
      )}
      <div className="space-y-0.5">
        {card.added && (
          <div className="flex min-w-0 items-center gap-1.5">
            <PlusCircle size={14} className="shrink-0 text-win" aria-label="Added" />
            <PlayerChip p={card.added} />
          </div>
        )}
        {card.dropped && (
          <div className="flex min-w-0 items-center gap-1.5">
            <MinusCircle size={14} className="shrink-0 text-loss" aria-label="Dropped" />
            <PlayerChip p={card.dropped} />
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{body}</p>
    </div>
  );
}

function ScoreCard({ card, body }: { card: Extract<ChatCard, { type: "score" }>; body: string }) {
  return (
    <div className="mt-1 flex items-start gap-2 rounded-lg border border-gold-400/50 bg-gold-300/15 px-3 py-2">
      <Zap size={16} className="mt-0.5 shrink-0 text-gold-600" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {card.player && <PlayerChip p={card.player} />}
          {card.points !== null && <span className="font-display text-base font-bold tabular-nums text-win">+{fmtPts(card.points, 1)}</span>}
        </div>
        <p className="text-xs text-muted">{body}</p>
        {card.team && (
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <TeamLogo team={card.team} size={16} /> {card.team.name}
          </div>
        )}
      </div>
    </div>
  );
}

/** Body of a non-USER message. */
export function SystemMessageBody({ msg }: { msg: ChatMessageDTO }) {
  const card = msg.card;
  const url = typeof msg.data?.url === "string" && /^\/(?!\/)/.test(msg.data.url) ? (msg.data.url as string) : null;
  if (card?.type === "trade") return <TradeCard card={card} reversal={/^trade reversed/i.test(msg.body)} />;
  if (card?.type === "transaction") return <TransactionCard card={card} body={msg.body} />;
  if (card?.type === "score") return <ScoreCard card={card} body={msg.body} />;
  return (
    <div className="mt-0.5 flex items-start gap-2 rounded-lg border border-line bg-sunken/60 px-3 py-2 text-sm">
      <Megaphone size={15} className="mt-0.5 shrink-0 text-gold-600" />
      <div className="min-w-0">
        <span className="whitespace-pre-wrap break-words">{msg.body}</span>
        {url && (
          <Link href={url} className="ml-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
            Open →
          </Link>
        )}
      </div>
    </div>
  );
}
