"use client";
// Trade value calculator: two teams (or free mode with any players / picks), contender / rebuild weighting,
// live per-asset values with component breakdowns, fairness meter and cap impact, then "Propose this trade".
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Loader2, Plus, Search, Send, Trash2, X } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { SegmentedControl, Toggle } from "@/components/ui/client";
import { InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { MODE_LABEL, fmtValue, type ValueMode } from "@/lib/value/model";
import type { AssetTeam, TradeRulesSummary } from "@/lib/trades/assets";
import { TeamAssetsPanel } from "@/components/trades/team-assets-panel";
import { PreviewPanel, type PreviewResponse } from "@/components/trades/preview-panel";

type Side = "A" | "B";
interface FreeAsset {
  key: string;
  type: "PLAYER" | "PICK" | "FAAB";
  id?: string;
  amount?: number;
  label: string;
  sub: string;
}
interface SearchHit {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  age: number | null;
  salary: number | null;
  contractYears: number | null;
  fantasyTeam: { id: string; name: string; abbrev: string } | null;
  seasonPoints: number;
  value: number;
}

const MODES: ValueMode[] = ["auto", "balanced", "contender", "rebuild"];

export function TradeCalculator({ teams, myTeamId, rules }: { teams: AssetTeam[]; myTeamId: string | null; rules: TradeRulesSummary }) {
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const [mode, setMode] = useState<ValueMode>("auto");
  const [free, setFree] = useState(false);
  const [teamA, setTeamA] = useState<string>(myTeamId ?? teams[0]?.id ?? "");
  const [teamB, setTeamB] = useState<string>(teams.find((t) => t.id !== (myTeamId ?? teams[0]?.id))?.id ?? "");
  // team mode: what each team sends
  const [sendPlayers, setSendPlayers] = useState<Record<Side, Set<string>>>({ A: new Set(), B: new Set() });
  const [sendPicks, setSendPicks] = useState<Record<Side, Set<string>>>({ A: new Set(), B: new Set() });
  const [sendFaab, setSendFaab] = useState<Record<Side, number>>({ A: 0, B: 0 });
  // free mode: what each side receives
  const [freeAssets, setFreeAssets] = useState<Record<Side, FreeAsset[]>>({ A: [], B: [] });
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const resetTeamSide = (side: Side) => {
    setSendPlayers((p) => ({ ...p, [side]: new Set() }));
    setSendPicks((p) => ({ ...p, [side]: new Set() }));
    setSendFaab((p) => ({ ...p, [side]: 0 }));
  };

  const payload = useMemo(() => {
    if (free) {
      const assets = (["A", "B"] as Side[]).flatMap((side) =>
        freeAssets[side].map((a) => ({
          type: a.type,
          playerId: a.type === "PLAYER" ? a.id : null,
          pickId: a.type === "PICK" ? a.id : null,
          faabAmount: a.type === "FAAB" ? a.amount : null,
          fromTeamId: side === "A" ? "B" : "A",
          toTeamId: side,
        })),
      );
      return { free: true, mode, teamIds: ["A", "B"], assets, validate: false };
    }
    const assets = (["A", "B"] as Side[]).flatMap((side) => {
      const from = side === "A" ? teamA : teamB;
      const to = side === "A" ? teamB : teamA;
      return [
        ...[...sendPlayers[side]].map((id) => ({ type: "PLAYER" as const, playerId: id, fromTeamId: from, toTeamId: to })),
        ...[...sendPicks[side]].map((id) => ({ type: "PICK" as const, pickId: id, fromTeamId: from, toTeamId: to })),
        ...(sendFaab[side] > 0 ? [{ type: "FAAB" as const, faabAmount: sendFaab[side], fromTeamId: from, toTeamId: to }] : []),
      ];
    });
    return { free: false, mode, teamIds: [teamA, teamB], assets, validate: true };
  }, [free, mode, freeAssets, teamA, teamB, sendPlayers, sendPicks, sendFaab]);

  useEffect(() => {
    if (!payload.assets.length || (!payload.free && (!teamA || !teamB || teamA === teamB))) {
      setPreview(null);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const res = await fetch("/api/trades/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ac.signal });
        if (res.ok) setPreview((await res.json()) as PreviewResponse);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error(e);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [payload, teamA, teamB]);

  const toggleIn = (setter: typeof setSendPlayers, side: Side, id: string) =>
    setter((prev) => {
      const next = new Set(prev[side]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [side]: next };
    });

  const proposeHref = (() => {
    if (free || !myTeamId || payload.assets.length === 0) return null;
    if (teamA !== myTeamId && teamB !== myTeamId) return null;
    const mySide: Side = teamA === myTeamId ? "A" : "B";
    const other: Side = mySide === "A" ? "B" : "A";
    const partner = mySide === "A" ? teamB : teamA;
    const players = [...sendPlayers.A, ...sendPlayers.B];
    const picks = [...sendPicks.A, ...sendPicks.B];
    const q = new URLSearchParams({ team: partner });
    if (players.length) q.set("player", players.join(","));
    if (picks.length) q.set("pick", picks.join(","));
    if (sendFaab[mySide]) q.set("faabSend", String(sendFaab[mySide]));
    if (sendFaab[other]) q.set("faabGet", String(sendFaab[other]));
    return `/trades/new?${q.toString()}`;
  })();

  const allPicks = useMemo(() => teams.flatMap((t) => t.picks.map((p) => ({ ...p, ownerName: t.name }))), [teams]);
  const clearAll = () => {
    resetTeamSide("A");
    resetTeamSide("B");
    setFreeAssets({ A: [], B: [] });
  };

  const [seg, setSeg] = useState<"A" | "B" | "result">("A");
  const countSide = (side: Side) => (free ? freeAssets[side].length : sendPlayers[side].size + sendPicks[side].size + (sendFaab[side] > 0 ? 1 : 0));
  const sideLabel = (side: Side) => {
    const n = countSide(side);
    const name = free ? `Side ${side} gets` : `${teamById.get(side === "A" ? teamA : teamB)?.abbrev ?? side} sends`;
    return `${name}${n ? ` · ${n}` : ""}`;
  };
  const showResult = () => {
    setSeg("result");
    document.getElementById("calc-steps")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-3">
      <section className="card space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl ariaLabel="Valuation mode" value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: m === "auto" ? "Auto" : MODE_LABEL[m] }))} className="max-sm:w-full" full={false} />
          <div className="ml-auto flex items-center gap-1">
            <Toggle
              checked={free}
              onChange={(v) => {
                setFree(v);
                setPreview(null);
              }}
              label="Free mode"
            />
            <button type="button" className={buttonClass("ghost", "md", "text-muted")} onClick={clearAll}>
              <Trash2 size={15} /> Clear
            </button>
          </div>
        </div>
        <p className="text-[13px] text-muted">
          {mode === "auto" ? "Each team valued by its own outlook (contender / rebuild from standings)." : mode === "contender" ? "Weights this season's production; picks and youth count less." : mode === "rebuild" ? "Weights youth, long cheap contracts and picks." : "Even weighting of now and later."}
          {free ? " Free mode: any players or picks on either side, no cap checks." : ""}
        </p>
      </section>

      <div id="calc-steps" className="grid scroll-mt-3 gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <SegmentedControl
            full
            className="mb-3 lg:hidden"
            ariaLabel="Calculator side"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "A", label: sideLabel("A") },
              { value: "B", label: sideLabel("B") },
              { value: "result", label: "Result" },
            ]}
          />
          <div className={cn("grid gap-3 lg:grid-cols-2", seg === "result" && "hidden lg:grid")}>
            {!free
              ? (["A", "B"] as Side[]).map((side) => {
                  const tid = side === "A" ? teamA : teamB;
                  const other = side === "A" ? teamB : teamA;
                  const t = teamById.get(tid);
                  return (
                    <div key={side} className={cn("min-w-0 space-y-2", seg !== side && "hidden lg:block")}>
                      <label className="flex items-center gap-3 px-1">
                        <span className="shrink-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">Team {side}</span>
                        <select
                          className="input h-10 min-w-0 flex-1 font-semibold sm:h-9"
                          value={tid}
                          onChange={(e) => {
                            resetTeamSide(side);
                            if (side === "A") setTeamA(e.target.value);
                            else setTeamB(e.target.value);
                          }}
                        >
                          {teams
                            .filter((x) => x.id !== other)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                                {x.id === myTeamId ? " (you)" : ""} · {x.record}
                              </option>
                            ))}
                        </select>
                      </label>
                      {t && (
                        <TeamAssetsPanel
                          team={t}
                          isMe={t.id === myTeamId}
                          selectedPlayers={sendPlayers[side]}
                          selectedPicks={sendPicks[side]}
                          onTogglePlayer={(id) => toggleIn(setSendPlayers, side, id)}
                          onTogglePick={(id) => toggleIn(setSendPicks, side, id)}
                          faabAmount={sendFaab[side]}
                          onFaab={(n) => setSendFaab((p) => ({ ...p, [side]: n }))}
                          allowPicks={rules.picks}
                          allowFaab={rules.faab}
                          capEnabled={rules.capEnabled}
                        />
                      )}
                    </div>
                  );
                })
              : (["A", "B"] as Side[]).map((side) => (
                  <FreeSide
                    key={side}
                    className={cn(seg !== side && "hidden lg:flex")}
                    side={side}
                    assets={freeAssets[side]}
                    picks={allPicks}
                    allowFaab={rules.faab}
                    onAdd={(a) => setFreeAssets((p) => ({ ...p, [side]: p[side].some((x) => x.key === a.key) ? p[side] : [...p[side], a] }))}
                    onRemove={(key) => setFreeAssets((p) => ({ ...p, [side]: p[side].filter((x) => x.key !== key) }))}
                    taken={new Set([...freeAssets.A, ...freeAssets.B].map((a) => a.key))}
                  />
                ))}
          </div>
        </div>
        <aside id="calc-result" className={cn("scroll-mt-3 space-y-3 lg:sticky lg:top-3 lg:block lg:max-h-[calc(100vh-1.5rem)] lg:self-start lg:overflow-y-auto", seg !== "result" && "hidden")}>
          <PreviewPanel preview={preview} loading={loading} capEnabled={rules.capEnabled && !free} emptyText={free ? "Add players, picks or FAB to each side." : "Pick what each team sends to compare values."} />
          {!free && (
            <section className="card p-4">
              {proposeHref ? (
                <Link href={proposeHref} className={buttonClass("primary", "lg", "w-full")}>
                  <Send size={16} /> Propose this trade
                </Link>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  {myTeamId ? (
                    <>
                      <ArrowLeftRight size={14} className="shrink-0" aria-hidden /> Put your team on one side to turn this into an offer.
                    </>
                  ) : (
                    "Only managers with a team can propose trades."
                  )}
                </p>
              )}
            </section>
          )}
          {loading && !preview && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Calculating…
            </p>
          )}
        </aside>
      </div>
      {payload.assets.length > 0 && (
        <>
          <div aria-hidden className="h-20 lg:hidden" />
          <div
            role="region"
            aria-label="Calculator result"
            className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 animate-rise pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:hidden"
          >
            <div className="mx-auto flex max-w-[1400px] items-center gap-2 rounded-2xl bg-raised px-3 py-2.5 shadow-pop">
              <div className="min-w-0 flex-1">
                <div className={cn("truncate text-[14px] font-semibold leading-5", preview ? VERDICT_TEXT[preview.evaluation.verdictTone] : "text-ink")}>
                  {preview?.evaluation.verdict ?? (loading ? "Calculating…" : "—")}
                </div>
                <div className="truncate text-[12px] leading-4 text-muted">
                  {preview ? `Fairness ${Math.round(preview.evaluation.fairness * 100)}% · ` : ""}
                  {payload.assets.length} asset{payload.assets.length === 1 ? "" : "s"}
                </div>
              </div>
              {seg !== "result" ? (
                <button type="button" onClick={showResult} className={buttonClass("primary", "md")}>
                  See result
                </button>
              ) : proposeHref ? (
                <Link href={proposeHref} className={buttonClass("primary", "md")}>
                  <Send size={15} /> Propose
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const VERDICT_TEXT = { fair: "text-win", slight: "text-amber-700 dark:text-amber-300", lopsided: "text-loss" } as const;

function FreeSide({
  side,
  assets,
  picks,
  allowFaab,
  onAdd,
  onRemove,
  taken,
  className,
}: {
  side: Side;
  assets: FreeAsset[];
  picks: (AssetTeam["picks"][number] & { ownerName: string })[];
  allowFaab: boolean;
  onAdd: (a: FreeAsset) => void;
  onRemove: (key: string) => void;
  taken: Set<string>;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickId, setPickId] = useState("");
  const [faab, setFaab] = useState(0);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/trades/search?q=${encodeURIComponent(q.trim())}`, { signal: ac.signal });
        if (res.ok) setHits(((await res.json()) as { players: SearchHit[] }).players);
      } catch {
        /* aborted */
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);
  return (
    <section className={cn("card flex min-w-0 flex-col", className)}>
      <header className="px-4 pb-2 pt-3 text-[17px] font-bold tracking-[-0.01em] text-ink">Side {side} receives</header>
      <div className="relative px-4 pb-2">
        <label className="relative block">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input h-10 pl-8" placeholder="Search any player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Add a player to side ${side}`} />
          {searching && <Loader2 size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
        </label>
        {hits.length > 0 && (
          <ul className="absolute inset-x-4 top-full z-30 -mt-1 max-h-80 divide-y divide-line/70 overflow-y-auto rounded-xl bg-raised py-1 shadow-pop">
            {hits.map((h) => {
              const key = `P:${h.id}`;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={taken.has(key)}
                    className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken disabled:opacity-40"
                    onClick={() => {
                      onAdd({ key, type: "PLAYER", id: h.id, label: h.fullName, sub: `${h.position} ${h.team ?? "FA"}${h.salary !== null ? ` · $${h.salary}×${h.contractYears}` : ""}${h.fantasyTeam ? ` · ${h.fantasyTeam.abbrev}` : " · free agent"}` });
                      setQ("");
                      setHits([]);
                    }}
                  >
                    <PosPill pos={h.position} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-5 text-ink">
                        <span className="truncate">{h.fullName}</span> <InjuryLetter status={h.injuryStatus} className="text-[13px]" />
                      </span>
                      <span className="block truncate text-[13px] leading-[18px] text-muted">
                        {h.team ?? "FA"} · {h.fantasyTeam ? h.fantasyTeam.name : "Free agent"}
                        {h.salary !== null ? ` · $${h.salary} × ${h.contractYears}y` : ""}
                      </span>
                    </span>
                    <span className="numeral shrink-0 text-[15px] font-semibold text-ink">{fmtValue(h.value)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <select className="input h-10 min-w-0 flex-1 sm:h-9" value={pickId} onChange={(e) => setPickId(e.target.value)} aria-label="Draft pick">
          <option value="">Add a draft pick…</option>
          {picks.map((p) => (
            <option key={p.id} value={p.id} disabled={taken.has(`K:${p.id}`)}>
              {p.label} — {p.ownerName} · {fmtValue(p.value)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pickId}
          className={buttonClass("secondary", "md")}
          onClick={() => {
            const p = picks.find((x) => x.id === pickId);
            if (p) onAdd({ key: `K:${p.id}`, type: "PICK", id: p.id, label: p.label, sub: `${p.pickInRound ? "Pick" : "Proj."} ${p.slotLabel}` });
            setPickId("");
          }}
        >
          <Plus size={15} /> Pick
        </button>
        {allowFaab && (
          <span className="flex w-full items-center gap-2 sm:w-auto">
            <input type="number" inputMode="numeric" min={0} className="input h-10 min-w-0 flex-1 text-right sm:h-9 sm:w-24 sm:flex-none" value={faab || ""} placeholder="$ FAB" onChange={(e) => setFaab(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="FAB amount" />
            <button
              type="button"
              disabled={!faab || taken.has(`F:${side}`)}
              className={buttonClass("secondary", "md")}
              onClick={() => {
                onAdd({ key: `F:${side}`, type: "FAAB", amount: faab, label: `$${faab} FAB`, sub: "Free agent budget" });
                setFaab(0);
              }}
            >
              <Plus size={15} /> FAB
            </button>
          </span>
        )}
      </div>
      <ul className="min-h-[120px] divide-y divide-line/70 border-t border-line/70">
        {assets.map((a) => (
          <li key={a.key} className="flex min-h-[52px] items-center gap-3 px-4 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{a.label}</span>
              <span className="block truncate text-[13px] leading-[18px] text-muted">{a.sub}</span>
            </span>
            <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-loss" aria-label={`Remove ${a.label}`} onClick={() => onRemove(a.key)}>
              <X size={16} />
            </button>
          </li>
        ))}
        {!assets.length && <li className="px-4 py-6 text-center text-[13px] text-muted">Search players or add picks / FAB.</li>}
      </ul>
    </section>
  );
}
