"use client";
// Trade builder: pick partner team(s), select players / rookie picks / FAB on each side, live validation and
// valuation, required drops, message, then propose (or counter).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { fmtValue } from "@/lib/value/model";
import type { AssetTeam, TradeRulesSummary } from "@/lib/trades/assets";
import { proposeTradeAction } from "@/lib/trades/actions";
import { TeamAssetsPanel, TeamCapChips, TeamHeader } from "@/components/trades/team-assets-panel";
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

  return (
    <div className="space-y-3">
      {/* partner selection */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 shadow-panel">
        <ArrowLeftRight size={16} className="text-muted" />
        <span className="text-sm font-semibold text-ink">Trade with</span>
        {partners.map((p, i) => (
          <span key={p} className="inline-flex items-center gap-1">
            {lockPartners ? (
              <span className="chip font-semibold">{teamById.get(p)?.name}</span>
            ) : (
              <select
                className="input h-8 w-auto py-1 text-sm font-semibold"
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
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-loss" aria-label={`Remove ${teamById.get(p)?.name}`} onClick={() => setPartners((prev) => prev.filter((x) => x !== p))}>
                <X size={14} />
              </button>
            )}
          </span>
        ))}
        {!partners.length && (
          <select className="input h-8 w-auto py-1 text-sm" value="" aria-label="Choose a trade partner" onChange={(e) => e.target.value && setPartners([e.target.value])}>
            <option value="">Choose a team…</option>
            {otherTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.record})
              </option>
            ))}
          </select>
        )}
        {canAddTeam && partners.length > 0 && (
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setPartners((prev) => [...prev, otherTeams[0].id])}>
            <Plus size={14} /> Add a team
          </button>
        )}
        {assetList.length > 0 && (
          <button
            type="button"
            className={cn(buttonClass("ghost", "sm"), "ml-auto text-muted")}
            onClick={() => {
              setAssets(new Map());
              setFaab(new Map());
              setDrops([]);
            }}
          >
            <Trash2 size={14} /> Clear
          </button>
        )}
      </div>

      {!partners.length && (
        <div>
          <p className="mb-2 text-sm text-muted">Who do you want to deal with?</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {otherTeams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPartners([t.id])}
                className="rounded-lg border border-line bg-panel p-3 text-left shadow-panel transition-colors hover:border-brand-400 hover:bg-brand-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-brand-900/20"
              >
                <TeamHeader team={t} />
                <TeamCapChips team={t} capEnabled={rules.capEnabled} faab={rules.faab} />
                {t.players[0] && (
                  <p className="mt-2 truncate text-[11px] text-muted">
                    Top assets: {t.players.slice(0, 3).map((p) => p.fullName).join(", ")}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {partners.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0">
            {/* mobile team switcher */}
            <div className="scroll-thin mb-2 flex gap-1 overflow-x-auto lg:hidden" role="tablist">
              {teamIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mobileTeam === id}
                  onClick={() => setMobileTeam(id)}
                  className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", mobileTeam === id ? "border-brand-600 bg-brand-700 text-white" : "border-line bg-panel text-ink")}
                >
                  {id === myTeamId ? "You send" : `${teamById.get(id)?.abbrev} sends`}{selectedCount(id) ? ` (${selectedCount(id)})` : ""}
                </button>
              ))}
            </div>
            <div className={cn("grid gap-3", teamIds.length > 2 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
              {teamIds.map((id) => {
                const t = teamById.get(id)!;
                const sel = [...assets.values()].filter((a) => a.fromTeamId === id);
                return (
                  <TeamAssetsPanel
                    key={id}
                    className={cn(mobileTeam !== id && "hidden lg:flex")}
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

          <aside className="space-y-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:self-start lg:overflow-y-auto" id="trade-summary">
            <PreviewPanel preview={preview} loading={loading} capEnabled={rules.capEnabled} emptyText="Select what each team sends to see values, cap impact and validation." />
            {showDrops && (
              <div className="rounded-lg border border-line bg-panel p-3 shadow-panel">
                <div className="mb-1 text-sm font-bold text-ink">Players you'll drop</div>
                <p className="mb-2 text-xs text-muted">
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
                <div className="scroll-thin max-h-56 overflow-y-auto rounded border border-line">
                  {dropCandidates.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b border-line/60 px-2 py-1 text-xs last:border-b-0 hover:bg-sunken">
                      <input type="checkbox" className="h-4 w-4 accent-red-600" checked={drops.includes(p.id)} onChange={() => setDrops((d) => (d.includes(p.id) ? d.filter((x) => x !== p.id) : [...d, p.id]))} />
                      <span className="min-w-0 flex-1 truncate">
                        <b className="text-ink">{p.fullName}</b> <span className="text-muted">{p.position} · ${p.salary} · {p.contractYears}y</span>
                      </span>
                      <span className="tabular-nums text-muted">{fmtValue(p.value)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-lg border border-line bg-panel p-3 shadow-panel">
              <label className="block">
                <span className="label">Message (optional)</span>
                <textarea className="input min-h-[70px]" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Pitch your offer…" />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={!canSubmit || pending} onClick={submit} className={buttonClass("primary", "md", "flex-1")}>
                  {pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {counterOf ? "Send counter offer" : "Propose trade"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {!rules.windowOpen
                  ? rules.windowReason
                  : `Offer expires in ${rules.offerExpirationHours}h. ${rules.reviewType === "NONE" ? "Processes as soon as everyone accepts." : rules.reviewType === "COMMISSIONER" ? "Needs commissioner approval after acceptance." : `League vote for ${rules.reviewPeriodHours}h after acceptance.`}`}
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* mobile sticky summary bar */}
      {partners.length > 0 && assetList.length > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-line bg-panel/95 px-3 py-2 shadow-pop backdrop-blur md:bottom-0 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-bold text-ink">{preview?.evaluation.verdict ?? (loading ? "Evaluating…" : "—")}</div>
              <div className="text-muted">
                {assetList.length} asset{assetList.length === 1 ? "" : "s"} · {errors.length ? <span className="text-loss">{errors.length} issue{errors.length === 1 ? "" : "s"}</span> : "ready"}
              </div>
            </div>
            <a href="#trade-summary" className={buttonClass("secondary", "sm")}>
              Review
            </a>
            <button type="button" disabled={!canSubmit || pending} onClick={submit} className={buttonClass("primary", "sm")}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
