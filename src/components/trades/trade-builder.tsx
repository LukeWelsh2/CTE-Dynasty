"use client";
// Trade builder: pick partner team(s), select players / rookie picks / FAB on each side, live validation and
// valuation, required drops, message, then propose (or counter).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronRight, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, TeamLogo, buttonClass } from "@/components/ui/core";
import { SegmentedControl } from "@/components/ui/client";
import { cn, fmtMoney } from "@/lib/utils";
import { OUTLOOK_LABEL, fmtValue } from "@/lib/value/model";
import type { AssetTeam, TradeRulesSummary } from "@/lib/trades/assets";
import { proposeTradeAction } from "@/lib/trades/actions";
import { TeamAssetsPanel } from "@/components/trades/team-assets-panel";
import { PreviewPanel, type PreviewResponse } from "@/components/trades/preview-panel";

export interface BuilderAsset {
  type: "PLAYER" | "PICK";
  id: string;
  fromTeamId: string;
  toTeamId: string;
}

export interface BuilderInitial {
  partners: string[];
  assets: BuilderAsset[];
  faab: { fromTeamId: string; toTeamId: string; amount: number }[];
  message?: string;
  /** playerId -> % of salary the sending team keeps paying */
  retention?: Record<string, number>;
}

const keyOf = (a: { type: string; id: string }) => (a.type === "PLAYER" ? `P:${a.id}` : `K:${a.id}`);

export function TradeBuilder({
  myTeamId,
  teams,
  rules,
  initial,
  counterOf,
  lockPartners,
}: {
  myTeamId: string;
  teams: AssetTeam[];
  rules: TradeRulesSummary;
  initial: BuilderInitial;
  counterOf?: string | null;
  lockPartners?: boolean;
}) {
  const router = useRouter();
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const [partners, setPartners] = useState<string[]>(initial.partners.filter((p) => teamById.has(p) && p !== myTeamId));
  const [assets, setAssets] = useState<Map<string, BuilderAsset>>(() => new Map(initial.assets.map((a) => [keyOf(a), a])));
  const [faab, setFaab] = useState<Map<string, { toTeamId: string; amount: number }>>(() => new Map(initial.faab.map((f) => [f.fromTeamId, { toTeamId: f.toTeamId, amount: f.amount }])));
  const [drops, setDrops] = useState<string[]>([]);
  const [retain, setRetain] = useState<Record<string, number>>(() => ({ ...(initial.retention ?? {}) }));
  const [message, setMessage] = useState(initial.message ?? "");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileTeam, setMobileTeam] = useState<string>(myTeamId);
  const [pending, start] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  const teamIds = useMemo(() => [myTeamId, ...partners], [myTeamId, partners]);
  const otherTeams = teams.filter((t) => t.id !== myTeamId && !partners.includes(t.id));
  const canAddTeam = !lockPartners && partners.length + 1 < rules.maxTeams && otherTeams.length > 0;

  // drop assets of teams no longer in the trade
  useEffect(() => {
    setAssets((prev) => {
      const next = new Map([...prev].filter(([, a]) => teamIds.includes(a.fromTeamId)).map(([k, a]) => [k, teamIds.includes(a.toTeamId) ? a : { ...a, toTeamId: defaultDest(a.fromTeamId) }]));
      return next.size === prev.size && [...next].every(([k, a]) => prev.get(k)?.toTeamId === a.toTeamId) ? prev : next;
    });
    setFaab((prev) => new Map([...prev].filter(([from]) => teamIds.includes(from)).map(([from, f]) => [from, teamIds.includes(f.toTeamId) ? f : { ...f, toTeamId: defaultDest(from) }])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamIds.join(",")]);

  function defaultDest(fromTeamId: string): string {
    if (fromTeamId !== myTeamId) return myTeamId;
    return partners[0] ?? myTeamId;
  }

  const assetList = useMemo(() => {
    const list: { type: "PLAYER" | "PICK" | "FAAB"; playerId?: string; pickId?: string; faabAmount?: number; retainPercent?: number; fromTeamId: string; toTeamId: string }[] = [];
    for (const a of assets.values())
      list.push({
        type: a.type,
        ...(a.type === "PLAYER" ? { playerId: a.id, ...(rules.retainMax > 0 && retain[a.id] ? { retainPercent: retain[a.id] } : {}) } : { pickId: a.id }),
        fromTeamId: a.fromTeamId,
        toTeamId: a.toTeamId,
      });
    for (const [from, f] of faab) if (f.amount > 0 && f.toTeamId !== from) list.push({ type: "FAAB", faabAmount: f.amount, fromTeamId: from, toTeamId: f.toTeamId });
    return list;
  }, [assets, faab, retain, rules.retainMax]);

  // live preview (debounced)
  useEffect(() => {
    if (!partners.length || !assetList.length) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const res = await fetch("/api/trades/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "auto", teamIds, assets: assetList, drops: { [myTeamId]: drops }, strictTeamId: myTeamId }),
          signal: ac.signal,
        });
        if (res.ok) setPreview((await res.json()) as PreviewResponse);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error(e);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [assetList, drops, teamIds, partners.length, myTeamId]);

  const toggle = (type: "PLAYER" | "PICK", id: string, fromTeamId: string) =>
    setAssets((prev) => {
      const next = new Map(prev);
      const k = keyOf({ type, id });
      if (next.has(k)) next.delete(k);
      else next.set(k, { type, id, fromTeamId, toTeamId: defaultDest(fromTeamId) });
      return next;
    });

  const myImpact = preview?.validation?.impacts.find((i) => i.teamId === myTeamId);
  const dropsNeeded = myImpact?.dropsNeeded ?? 0;
  // what the trade rules say I must clear (TeamImpact.capOverBy: capLimit ceiling, capEnforcement BLOCK only)
  const capOver = myImpact?.capOverBy ?? 0;
  const me = teamById.get(myTeamId)!;
  const outgoingMine = new Set([...assets.values()].filter((a) => a.type === "PLAYER" && a.fromTeamId === myTeamId).map((a) => a.id));
  const dropCandidates = me.players.filter((p) => !outgoingMine.has(p.id)).sort((a, b) => a.value - b.value);
  const showDrops = dropsNeeded > 0 || capOver > 0 || drops.length > 0;
  const errors = preview?.validation?.errors ?? [];
  const canSubmit = rules.windowOpen && partners.length > 0 && assetList.length > 0 && !loading && !!preview && errors.length === 0;

  const submit = () =>
    start(async () => {
      const res = await proposeTradeAction({
        proposerTeamId: myTeamId,
        teamIds,
        assets: assetList.map((a) => ({ type: a.type, playerId: a.playerId ?? null, pickId: a.pickId ?? null, faabAmount: a.faabAmount ?? null, retainPercent: a.retainPercent ?? null, fromTeamId: a.fromTeamId, toTeamId: a.toTeamId })),
        drops,
        message: message.trim() || undefined,
        counterOf: counterOf ?? null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Trade offer sent");
      router.push(res.tradeId ? `/trades/${res.tradeId}` : "/trades?tab=sent");
    });

  const destinations = teamIds.map((id) => ({ id, name: teamById.get(id)?.name ?? id }));
  const destFor = (fromTeamId: string) => destinations.filter((d) => d.id !== fromTeamId);
  const selectedCount = (teamId: string) => [...assets.values()].filter((a) => a.fromTeamId === teamId).length + ((faab.get(teamId)?.amount ?? 0) > 0 ? 1 : 0);

  // a partner removed / swapped while its side was showing: fall back to my side
  const seg = mobileTeam === "review" || teamIds.includes(mobileTeam) ? mobileTeam : myTeamId;
  const sendSeg = (id: string) => {
    const n = selectedCount(id);
    return `${id === myTeamId ? "You send" : `${teamById.get(id)?.abbrev ?? "?"} sends`}${n ? ` · ${n}` : ""}`;
  };
  const showSeg = (id: string) => (seg === id ? "" : "hidden lg:flex");
  const goReview = () => {
    setMobileTeam("review");
    document.getElementById("trade-steps")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-3">
      {/* partner selection */}
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink">
          <ArrowLeftRight size={16} className="text-muted" aria-hidden /> Trade with
        </span>
        {partners.map((p, i) => (
          <span key={p} className="flex min-w-0 max-w-full flex-1 items-center gap-1 sm:flex-none">
            {lockPartners ? (
              <span className="truncate text-[15px] font-semibold text-ink">{teamById.get(p)?.name}</span>
            ) : (
              <select
                className="input h-10 min-w-0 flex-1 font-semibold sm:h-9 sm:w-auto"
                value={p}
                aria-label={`Trade partner ${i + 1}`}
                onChange={(e) => setPartners((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              >
                {[teamById.get(p)!, ...otherTeams].map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.record})
                  </option>
                ))}
              </select>
            )}
            {!lockPartners && partners.length > 1 && (
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-loss"
                aria-label={`Remove ${teamById.get(p)?.name}`}
                onClick={() => setPartners((prev) => prev.filter((x) => x !== p))}
              >
                <X size={16} />
              </button>
            )}
          </span>
        ))}
        {(canAddTeam && partners.length > 0) || assetList.length > 0 ? (
          <span className="ml-auto flex items-center gap-1">
            {canAddTeam && partners.length > 0 && (
              <button type="button" className={buttonClass("plain", "md")} onClick={() => setPartners((prev) => [...prev, otherTeams[0]!.id])}>
                <Plus size={15} /> Add team
              </button>
            )}
            {assetList.length > 0 && (
              <button
                type="button"
                className={buttonClass("ghost", "md", "text-muted")}
                onClick={() => {
                  setAssets(new Map());
                  setFaab(new Map());
                  setDrops([]);
                }}
              >
                <Trash2 size={15} /> Clear
              </button>
            )}
          </span>
        ) : null}
      </div>

      {!partners.length && (
        <section>
          <h2 className="mb-2 px-1 text-[17px] font-bold tracking-[-0.01em] text-ink">Choose a partner</h2>
          <ul className="card divide-y divide-line/70 overflow-hidden lg:grid lg:grid-cols-2 lg:divide-y-0">
            {otherTeams.map((t) => (
              <li key={t.id} className="lg:border-b lg:border-line/70 lg:odd:border-r">
                <button
                  type="button"
                  onClick={() => setPartners([t.id])}
                  className="flex min-h-[68px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-sunken/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/50"
                >
                  <TeamLogo team={t} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-5 text-ink" title={t.name}>
                      {t.name}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                      <span className="numeral shrink-0">{t.record}</span>
                      <Badge tone={t.outlook === "contender" ? "green" : t.outlook === "rebuild" ? "purple" : "neutral"}>{OUTLOOK_LABEL[t.outlook]}</Badge>
                      <span className="numeral shrink-0">
                        {t.roster.active}/{t.roster.max}
                        {rules.faab ? ` · $${t.faabBalance} FAB` : ""}
                      </span>
                    </span>
                    {t.players[0] && (
                      <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted" title={t.players.slice(0, 3).map((p) => p.fullName).join(", ")}>
                        Top: {t.players.slice(0, 3).map((p) => p.fullName).join(", ")}
                      </span>
                    )}
                  </span>
                  {rules.capEnabled && (
                    <span className="shrink-0 text-right">
                      <span className={cn("numeral block text-[15px] font-semibold leading-5", t.cap.space < 0 ? "text-loss" : "text-ink")}>{fmtMoney(t.cap.space)}</span>
                      <span className="block text-[12px] leading-4 text-muted">cap room</span>
                    </span>
                  )}
                  <ChevronRight size={16} className="-mr-1 shrink-0 text-faint" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {partners.length > 0 && (
        <div id="trade-steps" className="grid scroll-mt-3 gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            {/* phones / tablets: one side at a time, then the review */}
            <SegmentedControl
              full
              className="mb-3 lg:hidden"
              ariaLabel="Trade side"
              value={seg}
              onChange={setMobileTeam}
              options={[...teamIds.map((id) => ({ value: id, label: sendSeg(id) })), { value: "review", label: errors.length ? `Review · ${errors.length}!` : "Review" }]}
            />
            <div className={cn("grid gap-3", teamIds.length > 2 ? "lg:grid-cols-3" : "lg:grid-cols-2", seg === "review" && "hidden lg:grid")}>
              {teamIds.map((id) => {
                const t = teamById.get(id)!;
                const sel = [...assets.values()].filter((a) => a.fromTeamId === id);
                return (
                  <TeamAssetsPanel
                    key={id}
                    className={showSeg(id)}
                    team={t}
                    isMe={id === myTeamId}
                    selectedPlayers={new Set(sel.filter((a) => a.type === "PLAYER").map((a) => a.id))}
                    selectedPicks={new Set(sel.filter((a) => a.type === "PICK").map((a) => a.id))}
                    onTogglePlayer={(pid) => toggle("PLAYER", pid, id)}
                    onTogglePick={(pk) => toggle("PICK", pk, id)}
                    faabAmount={faab.get(id)?.amount ?? 0}
                    onFaab={(amount) =>
                      setFaab((prev) => {
                        const next = new Map(prev);
                        if (amount > 0) next.set(id, { toTeamId: prev.get(id)?.toTeamId ?? defaultDest(id), amount });
                        else next.delete(id);
                        return next;
                      })
                    }
                    destinations={teamIds.length > 2 ? destFor(id) : undefined}
                    destinationOf={(k) => (k.startsWith("F:") ? faab.get(id)?.toTeamId : assets.get(k)?.toTeamId)}
                    onDestination={(k, to) => {
                      if (k.startsWith("F:")) setFaab((prev) => new Map(prev).set(id, { ...(prev.get(id) ?? { amount: 0 }), toTeamId: to }));
                      else setAssets((prev) => new Map(prev).set(k, { ...prev.get(k)!, toTeamId: to }));
                    }}
                    allowPicks={rules.picks}
                    allowFaab={rules.faab}
                    capEnabled={rules.capEnabled}
                    compact={teamIds.length > 2}
                    retainMax={rules.retainMax}
                    retainOf={(pid) => retain[pid] ?? 0}
                    onRetain={(pid, pct) => setRetain((prev) => ({ ...prev, [pid]: pct }))}
                    lockedPickSeasons={rules.lockedPickSeasons}
                  />
                );
              })}
            </div>
          </div>

          <aside className={cn("space-y-3 lg:sticky lg:top-3 lg:block lg:max-h-[calc(100vh-1.5rem)] lg:self-start lg:overflow-y-auto", seg !== "review" && "hidden")} id="trade-summary">
            <PreviewPanel preview={preview} loading={loading} capEnabled={rules.capEnabled} emptyText="Pick what each team sends to see values, cap impact and any rule problems." />
            {showDrops && (
              <section className="card overflow-hidden">
                <div className="px-4 pb-2 pt-3">
                  <h3 className="text-[17px] font-bold tracking-[-0.01em] text-ink">Players you&apos;ll drop</h3>
                  <p className="mt-1 text-[13px] text-muted">
                    {/* the preview already counts the drops picked so far: both figures are what's still missing */}
                    {dropsNeeded > 0 && `Your roster would be over the ${myImpact?.maxActive ?? rules.maxActive}-player limit — choose ${dropsNeeded} more to drop when the trade processes. `}
                    {capOver > 0 &&
                      `${
                        myImpact && myImpact.capLimit !== null && myImpact.capBefore > myImpact.capLimit
                          ? `You're already over the $${myImpact.capLimit} ${rules.capLimitLabel}, so the trade can't add to your payroll`
                          : `You'd be over the $${myImpact?.capLimit ?? rules.capLimit} ${rules.capLimitLabel}`
                      } — drops must free at least $${capOver}${drops.length ? " more" : ""} (dead money counts), or rework the deal.`}
                    {dropsNeeded <= 0 && capOver <= 0 && "These players are released when the trade completes."}
                  </p>
                </div>
                <ul className="scroll-thin max-h-72 divide-y divide-line/70 overflow-y-auto border-t border-line/70">
                  {dropCandidates.map((p) => {
                    const on = drops.includes(p.id);
                    return (
                      <li key={p.id}>
                        <label className={cn("flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2", on && "bg-red-500/[0.06] dark:bg-red-400/10")}>
                          <input type="checkbox" className="h-5 w-5 shrink-0 accent-red-600" checked={on} onChange={() => setDrops((d) => (d.includes(p.id) ? d.filter((x) => x !== p.id) : [...d, p.id]))} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{p.fullName}</span>
                            <span className="numeral block truncate text-[13px] leading-[18px] text-muted">
                              {p.position} · ${p.salary} · {p.contractYears}y
                            </span>
                          </span>
                          <span className="numeral shrink-0 text-[15px] font-semibold text-ink">{fmtValue(p.value)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <section className="card p-4">
              <label className="block">
                <span className="label">Message (optional)</span>
                <textarea className="input min-h-[80px]" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Pitch your offer…" />
              </label>
              <button type="button" disabled={!canSubmit || pending} onClick={submit} className={buttonClass("primary", "lg", "mt-3 w-full")}>
                {pending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {counterOf ? "Send counter offer" : "Propose trade"}
              </button>
              <p className="mt-2 text-[13px] text-muted">
                {!rules.windowOpen
                  ? rules.windowReason
                  : `Expires in ${rules.offerExpirationHours}h · ${rules.reviewType === "NONE" ? "processes once everyone accepts" : rules.reviewType === "COMMISSIONER" ? "then commissioner approval" : `then a ${rules.reviewPeriodHours}h league vote`}`}
              </p>
            </section>
          </aside>
        </div>
      )}

      {/* phones / tablets: floating summary bar above the tab bar */}
      {partners.length > 0 && assetList.length > 0 && (
        <>
          <div aria-hidden className="h-20 lg:hidden" />
          <div
            role="region"
            aria-label="Trade summary"
            className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 animate-rise pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:hidden"
          >
            <div className="mx-auto flex max-w-[1400px] items-center gap-2 rounded-2xl bg-raised px-3 py-2.5 shadow-pop">
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-[14px] font-semibold leading-5", preview ? VERDICT_TEXT[preview.evaluation.verdictTone] : "text-ink")}>
                  {preview?.evaluation.verdict ?? (loading ? "Evaluating…" : "—")}
                </div>
                <div className="truncate text-[12px] leading-4 text-muted">
                  {assetList.length} asset{assetList.length === 1 ? "" : "s"} ·{" "}
                  {errors.length ? (
                    <span className="font-semibold text-loss">
                      {errors.length} issue{errors.length === 1 ? "" : "s"}
                    </span>
                  ) : preview ? (
                    `Fairness ${Math.round(preview.evaluation.fairness * 100)}%`
                  ) : (
                    "…"
                  )}
                </div>
              </div>
              {seg !== "review" ? (
                <button type="button" onClick={goReview} className={buttonClass("primary", "md")}>
                  Review
                </button>
              ) : (
                <button type="button" disabled={!canSubmit || pending} onClick={submit} className={buttonClass("primary", "md")}>
                  {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const VERDICT_TEXT = { fair: "text-win", slight: "text-amber-700 dark:text-amber-300", lopsided: "text-loss" } as const;
