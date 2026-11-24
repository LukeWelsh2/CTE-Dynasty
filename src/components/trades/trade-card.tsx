// Trade card (CBS-style "module" with both sides side-by-side) + the asset line used across trade pages.
import Link from "next/link";
import { ArrowRight, Clock, DollarSign, MessageSquare, Ticket } from "lucide-react";
import { Badge, InjuryTag, PlayerHeadshot, PosBadge, TeamLogo } from "@/components/ui/core";
import { cn, fmtPts } from "@/lib/utils";
import type { TradeView, TradeAssetView } from "@/lib/trades/views";
import { STATUS_META, contractText, fmtWhen, timeLeft, type TradeStatusKey } from "@/lib/trades/format";
import { CapLine, FairnessMeter, ValueBar } from "@/components/trades/value-display";
import { fmtValue } from "@/lib/value/model";

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status as TradeStatusKey] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function AssetLine({
  asset,
  maxValue,
  showValue = true,
  fromName,
  dense,
  extra,
}: {
  asset: Pick<TradeAssetView, "type" | "label" | "player" | "salary" | "contractYears" | "seasonPoints" | "ppg" | "pick" | "faabAmount" | "value" | "components" | "isRookieContract" | "retainPercent">;
  maxValue: number;
  showValue?: boolean;
  fromName?: string;
  dense?: boolean;
  extra?: React.ReactNode;
}) {
  let icon: React.ReactNode;
  let title: React.ReactNode;
  let meta: React.ReactNode;
  if (asset.type === "PLAYER" && asset.player) {
    const p = asset.player;
    icon = <PlayerHeadshot player={p} size={dense ? 28 : 34} />;
    title = (
      <span className="flex min-w-0 items-center gap-1.5">
        <Link href={`/players/${p.id}`} className="truncate text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
          {p.fullName}
        </Link>
        <InjuryTag status={p.injuryStatus} />
      </span>
    );
    meta = (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <PosBadge pos={p.position} className="h-4 min-w-[26px] text-[9px]" />
        <span>{p.team ?? "FA"}</span>
        {p.age ? <span>· {p.age}y</span> : null}
        <span className="font-semibold text-ink">· {contractText(asset.salary, asset.contractYears)}</span>
        {asset.isRookieContract && <Badge tone="green">Rookie</Badge>}
        {asset.retainPercent ? (
          <span className="font-semibold text-gold-700 dark:text-gold-400" title="Share of the salary the sending team keeps paying as dead money">
            · {asset.retainPercent}% retained (${Math.round(((asset.salary ?? 0) * asset.retainPercent) / 100)})
          </span>
        ) : null}
        {asset.seasonPoints !== undefined && !dense && (
          <span>
            · {fmtPts(asset.seasonPoints, 1)} pts{asset.ppg ? ` (${asset.ppg} ppg)` : ""}
          </span>
        )}
      </span>
    );
  } else if (asset.type === "PICK") {
    icon = (
      <span className={cn("inline-flex shrink-0 flex-col items-center justify-center rounded-md bg-brand-900 font-display font-bold leading-none text-gold-400", dense ? "h-7 w-7 text-[10px]" : "h-[34px] w-[34px] text-[11px]")}>
        <Ticket size={dense ? 11 : 12} className="mb-0.5" />
        R{asset.pick?.round ?? "?"}
      </span>
    );
    title = <span className="block truncate text-sm font-semibold text-ink">{asset.label}</span>;
    meta = asset.pick?.usedBy ? (
      <span>
        Used{asset.pick.pickInRound ? ` at ${asset.pick.round}.${String(asset.pick.pickInRound).padStart(2, "0")}` : ""}:{" "}
        <Link href={`/players/${asset.pick.usedBy.id}`} className="link font-semibold">
          {asset.pick.usedBy.fullName}
        </Link>{" "}
        ({asset.pick.usedBy.position})
      </span>
    ) : (
      <span>{asset.pick ? (asset.pick.pickInRound ? `Pick ${asset.pick.slotLabel}` : `Projected ${asset.pick.slotLabel}`) : "Rookie draft pick"}</span>
    );
  } else {
    icon = (
      <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white", dense ? "h-7 w-7" : "h-[34px] w-[34px]")}>
        <DollarSign size={16} />
      </span>
    );
    title = <span className="text-sm font-semibold text-ink">${asset.faabAmount ?? 0} FAB</span>;
    meta = <span>Free agent budget</span>;
  }
  return (
    <div className={cn("flex gap-2.5", extra ? "items-start" : "items-center", dense ? "py-1" : "py-1.5")}>
      {icon}
      <div className="min-w-0 flex-1">
        {title}
        <div className="text-[11px] leading-tight text-muted">
          {meta}
          {fromName && <span className="ml-1">· from {fromName}</span>}
        </div>
        {extra}
      </div>
      {showValue && (
        <div className={cn("w-24 shrink-0 sm:w-28", extra && "pt-1.5")}>
          <ValueBar value={asset.value} max={maxValue} components={asset.components} label={asset.label} />
        </div>
      )}
    </div>
  );
}

export function TradeTimeline({ trade, tz }: { trade: TradeView; tz: string }) {
  const steps: { label: string; at: Date | null; state: "done" | "current" | "todo" | "bad" }[] = [{ label: "Proposed", at: trade.createdAt, state: "done" }];
  const allAccepted = trade.teams.every((t) => t.accepted);
  const s = trade.status;
  const bad = s === "REJECTED" || s === "CANCELLED" || s === "VETOED" || s === "EXPIRED" || s === "COUNTERED";
  if (s === "PROPOSED") steps.push({ label: allAccepted ? "Accepted" : `Waiting on ${trade.teams.filter((t) => !t.accepted).map((t) => t.abbrev).join(", ")}`, at: null, state: "current" });
  else if (bad && !trade.acceptedAt) steps.push({ label: STATUS_META[s as TradeStatusKey].label, at: trade.updatedAt, state: "bad" });
  else steps.push({ label: "Accepted", at: trade.acceptedAt ?? trade.completedAt, state: "done" });
  if (s === "ACCEPTED") steps.push({ label: trade.reviewEndsAt ? `League vote · ${timeLeft(trade.reviewEndsAt) ?? ""}` : "Commissioner review", at: null, state: "current" });
  else if (trade.acceptedAt && (s === "VETOED" || s === "CANCELLED")) steps.push({ label: STATUS_META[s as TradeStatusKey].label, at: trade.updatedAt, state: "bad" });
  if (s === "COMPLETED" || s === "REVERSED") steps.push({ label: "Completed", at: trade.completedAt, state: "done" });
  if (s === "REVERSED") steps.push({ label: "Reversed", at: trade.updatedAt, state: "bad" });
  if (!bad && s !== "COMPLETED" && s !== "REVERSED") steps.push({ label: "Processed", at: null, state: "todo" });
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]">
      {steps.map((st, i) => (
        <li key={i} className="flex items-center gap-1">
          {i > 0 && <span className="mx-0.5 h-px w-3 bg-line" />}
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              st.state === "done" && "bg-win",
              st.state === "current" && "animate-pulseDot bg-gold-500",
              st.state === "todo" && "bg-line",
              st.state === "bad" && "bg-loss",
            )}
          />
          <span className={cn("font-semibold", st.state === "todo" ? "text-muted" : "text-ink")}>{st.label}</span>
          {st.at && <span className="text-muted">{fmtWhen(st.at, tz)}</span>}
        </li>
      ))}
    </ol>
  );
}

export function TradeCard({
  trade,
  tz,
  viewerTeamId,
  actions,
  results,
  showValues = true,
  className,
}: {
  trade: TradeView;
  tz: string;
  viewerTeamId?: string | null;
  actions?: React.ReactNode;
  /** extra content under each team's assets (history "results so far"), keyed by team id */
  results?: Record<string, React.ReactNode>;
  showValues?: boolean;
  className?: string;
}) {
  const ev = trade.evaluation;
  const maxValue = Math.max(10, ...trade.assets.map((a) => a.value));
  const teamName = new Map(trade.teams.map((t) => [t.teamId, t.name]));
  const proposer = trade.teams.find((t) => t.teamId === trade.proposerTeamId);
  const multi = trade.teams.length > 2;
  const left = trade.status === "PROPOSED" ? timeLeft(trade.expiresAt) : trade.status === "ACCEPTED" ? timeLeft(trade.reviewEndsAt) : null;
  return (
    <article className={cn("overflow-hidden rounded-lg border border-line bg-panel shadow-panel", className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-sunken/70 px-3 py-2">
        <StatusBadge status={trade.status} />
        {trade.parentTradeId && <Badge tone="purple">Counter offer</Badge>}
        <span className="text-xs text-muted">
          {proposer && (
            <>
              <span className="font-semibold text-ink">{proposer.teamId === viewerTeamId ? "You" : proposer.name}</span> proposed ·{" "}
            </>
          )}
          {trade.season} week {trade.week} · {fmtWhen(trade.completedAt ?? trade.createdAt, tz)}
        </span>
        {left && left !== "ended" && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <Clock size={12} /> {trade.status === "ACCEPTED" ? "Review" : "Expires"}: {left}
          </span>
        )}
        <Link href={`/trades/${trade.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Details <ArrowRight size={12} />
        </Link>
      </header>
      <div className={cn("grid divide-y divide-line md:divide-x md:divide-y-0", multi ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {trade.teams.map((t) => {
          const incoming = trade.assets.filter((a) => a.toTeamId === t.teamId);
          const evT = ev?.teams.find((x) => x.teamId === t.teamId);
          return (
            <section key={t.teamId} className="min-w-0 p-3">
              <div className="mb-1 flex items-center gap-2">
                <TeamLogo team={t} size={28} />
                <div className="min-w-0 flex-1">
                  <Link href={`/teams/${t.teamId}`} className="block truncate text-sm font-bold text-ink hover:underline">
                    {t.name}
                    {t.teamId === viewerTeamId && <span className="ml-1 text-[11px] font-semibold text-gold-600 dark:text-gold-400">(you)</span>}
                  </Link>
                  <div className="text-[11px] text-muted">
                    {t.record ? `${t.record} · ` : ""}receives
                    {trade.status === "PROPOSED" && (t.accepted ? <span className="ml-1 font-semibold text-win">· accepted</span> : <span className="ml-1 font-semibold text-amber-600">· pending</span>)}
                  </div>
                </div>
                {showValues && evT && (
                  <div className="text-right">
                    <div className="font-display text-lg font-bold tabular-nums leading-none text-ink">{fmtValue(evT.received)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted">value</div>
                  </div>
                )}
              </div>
              {incoming.length ? (
                <div className="divide-y divide-line/60">
                  {incoming.map((a) => (
                    <AssetLine key={a.id} asset={a} maxValue={maxValue} showValue={showValues} fromName={multi ? teamName.get(a.fromTeamId) : undefined} />
                  ))}
                </div>
              ) : (
                <p className="py-2 text-xs text-muted">Nothing — roster relief only.</p>
              )}
              {t.drops.length > 0 && (
                <p className="mt-1 text-[11px] text-muted">
                  Drops: <span className="font-semibold text-ink">{t.drops.map((d) => `${d.fullName} (${d.position})`).join(", ")}</span>
                </p>
              )}
              {evT?.cap && trade.status !== "COMPLETED" && trade.status !== "REVERSED" && (
                <div className="mt-1.5">
                  <CapLine before={evT.cap.before} after={evT.cap.after} cap={evT.cap.cap} />
                </div>
              )}
              {results?.[t.teamId]}
            </section>
          );
        })}
      </div>
      <footer className="space-y-2 border-t border-line px-3 py-2.5">
          <TradeTimeline trade={trade} tz={tz} />
          {showValues && ev && (
            <FairnessMeter compact teams={ev.teams.map((t) => ({ teamId: t.teamId, name: t.name, received: t.received, net: t.net }))} fairness={ev.fairness} verdict={ev.verdict} tone={ev.verdictTone} />
          )}
          {trade.message && (
            <p className="flex items-start gap-1.5 rounded-md bg-sunken px-2 py-1.5 text-xs text-ink">
              <MessageSquare size={13} className="mt-0.5 shrink-0 text-muted" />
              <span className="italic">“{trade.message}”</span>
            </p>
          )}
          {trade.resolutionNote && !["PROPOSED", "ACCEPTED"].includes(trade.status) && <p className="text-xs text-muted">{trade.resolutionNote}</p>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </footer>
    </article>
  );
}
