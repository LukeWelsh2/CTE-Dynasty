// Trade card (both sides with what each receives, the fairness verdict, message and actions) + the asset row used
// across trade pages. v3: flat white card, hairline rows, headshot rows like the Roster pattern (docs/DESIGN.md §6.2),
// value number + bar on the right; the full step-by-step timeline lives on the trade page.
import Link from "next/link";
import { Clock, DollarSign, MessageSquare, Ticket } from "lucide-react";
import { Badge, MoreLink, TeamLogo } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { cn, fmtPts } from "@/lib/utils";
import type { TradeView, TradeAssetView } from "@/lib/trades/views";
import { STATUS_META, contractText, fmtWhen, timeLeft, type TradeStatusKey } from "@/lib/trades/format";
import { CapLine, FairnessMeter, ValueBar } from "@/components/trades/value-display";
import { fmtValue } from "@/lib/value/model";

/** "Nov 12" in the league timezone (the full time is on the trade page). */
function shortDay(d: Date, tz: string) {
  return new Date(d).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status as TradeStatusKey] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** Round icon for a draft pick ("R2") — same footprint as a headshot so rows line up. */
export function PickIcon({ round, size = 40 }: { round: number | string | null | undefined; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 flex-col items-center justify-center rounded-full bg-sunken font-semibold leading-none text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))]"
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.3)) }}
      aria-hidden
    >
      <Ticket size={Math.round(size * 0.3)} className="mb-0.5 text-muted" />R{round ?? "?"}
    </span>
  );
}

/** Round icon for FAB dollars. */
export function FabIcon({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-green-500/10 text-win dark:bg-green-400/15" style={{ width: size, height: size }} aria-hidden>
      <DollarSign size={Math.round(size * 0.45)} />
    </span>
  );
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
  const size = dense ? 36 : 40;
  let icon: React.ReactNode;
  let title: React.ReactNode;
  let meta: React.ReactNode;
  let note: React.ReactNode = null;
  if (asset.type === "PLAYER" && asset.player) {
    const p = asset.player;
    icon = <HeadshotBadge player={{ id: p.id, fullName: p.fullName, position: p.position }} nflTeam={p.team} size={size} />;
    title = (
      <span className="flex min-w-0 items-center gap-1.5">
        <Link href={`/players/${p.id}`} title={p.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
          {p.fullName}
        </Link>
        <InjuryLetter status={p.injuryStatus} className="text-[13px]" />
      </span>
    );
    meta = (
      <>
        <PosPill pos={p.position} />
        <span className="min-w-0 truncate">
          {p.position === "DEF" ? "" : (p.team ?? "FA")}
          {p.age ? ` · ${p.age}y` : ""}
          <span className="numeral font-medium text-ink"> · {contractText(asset.salary, asset.contractYears)}</span>
        </span>
        {asset.isRookieContract && <Badge tone="green">Rookie</Badge>}
      </>
    );
    const bits = [
      asset.seasonPoints !== undefined && !dense ? `${fmtPts(asset.seasonPoints, 1)} pts${asset.ppg ? ` · ${asset.ppg} ppg` : ""}` : null,
      asset.retainPercent ? `${asset.retainPercent}% retained ($${Math.round(((asset.salary ?? 0) * asset.retainPercent) / 100)})` : null,
      fromName ? `from ${fromName}` : null,
    ].filter(Boolean);
    if (bits.length)
      note = (
        <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted" title={asset.retainPercent ? "Share of the salary the sending team keeps paying as dead money" : undefined}>
          {bits.join(" · ")}
        </span>
      );
  } else if (asset.type === "PICK") {
    icon = <PickIcon round={asset.pick?.round} size={size} />;
    title = (
      <span className="line-clamp-2 text-[15px] font-semibold leading-5 text-ink" title={asset.label}>
        {asset.label}
      </span>
    );
    meta = asset.pick?.usedBy ? (
      <span className="min-w-0 truncate">
        Used{asset.pick.pickInRound ? ` at ${asset.pick.round}.${String(asset.pick.pickInRound).padStart(2, "0")}` : ""}:{" "}
        <Link href={`/players/${asset.pick.usedBy.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          {asset.pick.usedBy.fullName}
        </Link>{" "}
        ({asset.pick.usedBy.position})
      </span>
    ) : (
      <span className="min-w-0 truncate">{asset.pick ? (asset.pick.pickInRound ? `Pick ${asset.pick.slotLabel}` : `Projected ${asset.pick.slotLabel}`) : "Rookie draft pick"}</span>
    );
    if (fromName) note = <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">from {fromName}</span>;
  } else {
    icon = <FabIcon size={size} />;
    title = <span className="numeral text-[15px] font-semibold leading-5 text-ink">${asset.faabAmount ?? 0} FAB</span>;
    meta = <span>Free agent budget</span>;
    if (fromName) note = <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted">from {fromName}</span>;
  }
  return (
    <div className={cn("flex gap-3", extra ? "items-start" : "items-center", dense ? "min-h-[52px] py-2" : "min-h-[60px] py-2.5")}>
      {icon}
      <div className="min-w-0 flex-1">
        {title}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">{meta}</div>
        {note}
        {extra}
      </div>
      {showValue && <ValueBar value={asset.value} max={maxValue} components={asset.components} label={asset.label} className={cn("shrink-0", extra && "pt-0.5")} />}
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
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4">
      {steps.map((st, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-3 bg-line" aria-hidden />}
          <span
            aria-hidden
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              st.state === "done" && "bg-win",
              st.state === "current" && "animate-pulseDot bg-amber-500",
              st.state === "todo" && "bg-ink/15 dark:bg-white/20",
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
    <article className={cn("card overflow-hidden", className)}>
      <header className="flex min-h-12 items-center gap-2 px-4 pt-2">
        <StatusBadge status={trade.status} />
        {trade.parentTradeId && <Badge tone="purple">Counter</Badge>}
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
          {proposer && (
            <>
              <span className="font-semibold text-ink">{proposer.teamId === viewerTeamId ? "You" : proposer.abbrev || proposer.name}</span> proposed ·{" "}
            </>
          )}
          <span className="hidden min-[400px]:inline">Wk {trade.week} · </span>
          {shortDay(trade.completedAt ?? trade.createdAt, tz)}
        </span>
        <MoreLink href={`/trades/${trade.id}`}>Details</MoreLink>
      </header>
      {left && left !== "ended" && (
        <p className="flex items-center gap-1 px-4 text-[13px] font-semibold text-amber-700 dark:text-amber-300">
          <Clock size={13} aria-hidden /> {trade.status === "ACCEPTED" ? "Review" : "Expires"}: {left}
        </p>
      )}
      <div className={cn("grid md:divide-x md:divide-line/70", multi ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {trade.teams.map((t, i) => {
          const incoming = trade.assets.filter((a) => a.toTeamId === t.teamId);
          const evT = ev?.teams.find((x) => x.teamId === t.teamId);
          const mine = t.teamId === viewerTeamId;
          return (
            <section key={t.teamId} className={cn("min-w-0 px-4 pb-1 pt-3", i > 0 && "border-t border-line/70 md:border-t-0")}>
              <div className="flex items-center gap-3">
                <TeamLogo team={t} size={32} />
                <div className="min-w-0 flex-1">
                  <Link href={`/teams/${t.teamId}`} title={t.name} className={cn("block truncate text-[15px] font-semibold leading-5 hover:underline", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                    {t.name}
                  </Link>
                  <div className="truncate text-[13px] leading-[18px] text-muted">
                    {t.record ? `${t.record} · ` : ""}
                    {mine ? "you receive" : "receives"}
                    {trade.status === "PROPOSED" && (t.accepted ? <span className="font-semibold text-win"> · accepted</span> : <span className="font-semibold text-amber-700 dark:text-amber-300"> · pending</span>)}
                  </div>
                </div>
                {showValues && evT && (
                  <div className="shrink-0 text-right">
                    <div className="numeral text-[20px] font-semibold leading-6 text-ink">{fmtValue(evT.received)}</div>
                    <div className="text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">Value</div>
                  </div>
                )}
              </div>
              {incoming.length ? (
                <div className="mt-1 divide-y divide-line/70">
                  {incoming.map((a) => (
                    <AssetLine key={a.id} asset={a} maxValue={maxValue} showValue={showValues} fromName={multi ? teamName.get(a.fromTeamId) : undefined} />
                  ))}
                </div>
              ) : (
                <p className="py-3 text-[13px] text-muted">Nothing — roster relief only.</p>
              )}
              {t.drops.length > 0 && (
                <p className="mb-2 text-[13px] text-muted">
                  Drops <span className="font-semibold text-ink">{t.drops.map((d) => `${d.fullName} (${d.position})`).join(", ")}</span>
                </p>
              )}
              {evT?.cap && trade.status !== "COMPLETED" && trade.status !== "REVERSED" && (
                <div className="mb-2">
                  <CapLine before={evT.cap.before} after={evT.cap.after} cap={evT.cap.cap} />
                </div>
              )}
              {results?.[t.teamId]}
            </section>
          );
        })}
      </div>
      {((showValues && ev) || trade.message || (trade.resolutionNote && !["PROPOSED", "ACCEPTED"].includes(trade.status)) || actions) && (
        <footer className="space-y-3 border-t border-line/70 px-4 py-3">
          {showValues && ev && (
            <FairnessMeter compact teams={ev.teams.map((t) => ({ teamId: t.teamId, name: t.name, received: t.received, net: t.net }))} fairness={ev.fairness} verdict={ev.verdict} tone={ev.verdictTone} />
          )}
          {trade.message && (
            <p className="flex items-start gap-2 text-[13px] leading-5 text-ink">
              <MessageSquare size={14} className="mt-[3px] shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 break-words italic">“{trade.message}”</span>
            </p>
          )}
          {trade.resolutionNote && !["PROPOSED", "ACCEPTED"].includes(trade.status) && <p className="text-[13px] text-muted">{trade.resolutionNote}</p>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </footer>
      )}
    </article>
  );
}
