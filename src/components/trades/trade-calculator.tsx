"use client";
// Trade value calculator: two teams (or free mode with any players / picks), contender / rebuild weighting,
// live per-asset values with component breakdowns, fairness meter and cap impact, then "Propose this trade".
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Loader2, Plus, Search, Send, Trash2, X } from "lucide-react";
import { buttonClass, InjuryTag, PosBadge } from "@/components/ui/core";
import { Toggle } from "@/components/ui/client";
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

  return (
    <div className="space-y-3 pb-16 lg:pb-0">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 shadow-panel">
        <div role="radiogroup" aria-label="Valuation mode" className="flex overflow-hidden rounded-md border border-line">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("px-2.5 py-1.5 text-xs font-semibold", mode === m ? "bg-brand-700 text-white" : "bg-panel text-ink hover:bg-sunken")}
            >
              {m === "auto" ? "Auto" : MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="hidden text-[11px] text-muted md:inline">{mode === "auto" ? "Each team valued by its own outlook (contender / rebuild from standings)." : mode === "contender" ? "Weights this season's production; picks and youth count less." : mode === "rebuild" ? "Weights youth, long cheap contracts and picks." : "Even weighting of now and later."}</span>
        <div className="ml-auto flex items-center gap-3">
          <Toggle
            checked={free}
            onChange={(v) => {
              setFree(v);
              setPreview(null);
            }}
            label="Free mode"
          />
          <button type="button" className={buttonClass("ghost", "sm")} onClick={clearAll}>
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          {!free ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {(["A", "B"] as Side[]).map((side) => {
                const tid = side === "A" ? teamA : teamB;
                const other = side === "A" ? teamB : teamA;
                const t = teamById.get(tid);
                return (
                  <div key={side} className="min-w-0 space-y-2">
                    <label className="flex items-center gap-2">
                      <span className="label mb-0 shrink-0">Team {side} sends</span>
                      <select
                        className="input h-8 py-1 text-sm font-semibold"
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
              })}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(["A", "B"] as Side[]).map((side) => (
                <FreeSide
                  key={side}
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
          )}
        </div>
        <aside id="calc-result" className="scroll-mt-3 space-y-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:self-start lg:overflow-y-auto">
          <PreviewPanel preview={preview} loading={loading} capEnabled={rules.capEnabled && !free} emptyText={free ? "Add players, picks or FAB to each side." : "Check what each team sends to compare values."} />
          {!free && (
            <div className="rounded-lg border border-line bg-panel p-3 shadow-panel">
              {proposeHref ? (
                <Link href={proposeHref} className={buttonClass("primary", "md", "w-full")}>
                  <Send size={15} /> Propose this trade
                </Link>
              ) : (
                <p className="text-xs text-muted">
                  {myTeamId ? (
                    <>
                      Put your team on one side to turn this into an offer. <ArrowLeftRight size={12} className="inline" />
                    </>
                  ) : (
                    "Only managers with a team can propose trades."
                  )}
                </p>
              )}
            </div>
          )}
          {loading && !preview && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> Calculating…
            </p>
          )}
        </aside>
      </div>
      {payload.assets.length > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-line bg-panel/95 px-3 py-2 shadow-pop backdrop-blur md:bottom-0 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-bold text-ink">{preview?.evaluation.verdict ?? (loading ? "Calculating…" : "—")}</div>
              <div className="text-muted">
                {preview ? `Fairness ${Math.round(preview.evaluation.fairness * 100)}% · ` : ""}
                {payload.assets.length} asset{payload.assets.length === 1 ? "" : "s"}
              </div>
            </div>
            <a href="#calc-result" className={buttonClass("primary", "sm")}>
              See result
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function FreeSide({
  side,
  assets,
  picks,
  allowFaab,
  onAdd,
  onRemove,
  taken,
}: {
  side: Side;
  assets: FreeAsset[];
  picks: (AssetTeam["picks"][number] & { ownerName: string })[];
  allowFaab: boolean;
  onAdd: (a: FreeAsset) => void;
  onRemove: (key: string) => void;
  taken: Set<string>;
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
    <section className="flex min-w-0 flex-col rounded-lg border border-line bg-panel shadow-panel">
      <header className="border-b border-line bg-sunken/70 px-3 py-2 text-sm font-bold text-ink">Side {side} receives</header>
      <div className="relative border-b border-line p-2">
        <label className="relative block">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input h-9 pl-7 text-sm" placeholder="Search any player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Add a player to side ${side}`} />
          {searching && <Loader2 size={13} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
        </label>
        {hits.length > 0 && (
          <ul className="absolute inset-x-2 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-pop">
            {hits.map((h) => {
              const key = `P:${h.id}`;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    disabled={taken.has(key)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-sunken disabled:opacity-40"
                    onClick={() => {
                      onAdd({ key, type: "PLAYER", id: h.id, label: h.fullName, sub: `${h.position} ${h.team ?? "FA"}${h.salary !== null ? ` · $${h.salary}×${h.contractYears}` : ""}${h.fantasyTeam ? ` · ${h.fantasyTeam.abbrev}` : " · free agent"}` });
                      setQ("");
                      setHits([]);
                    }}
                  >
                    <PosBadge pos={h.position} className="h-4 min-w-[26px] text-[9px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-semibold text-ink">
                        {h.fullName} <InjuryTag status={h.injuryStatus} />
                      </span>
                      <span className="text-[10px] text-muted">
                        {h.team ?? "FA"} · {h.fantasyTeam ? h.fantasyTeam.name : "Free agent"}
                        {h.salary !== null ? ` · $${h.salary} × ${h.contractYears}y` : ""}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums">{fmtValue(h.value)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
        <select className="input h-8 min-w-0 flex-1 py-1 text-xs" value={pickId} onChange={(e) => setPickId(e.target.value)} aria-label="Draft pick">
          <option value="">Add a draft pick…</option>
          {picks.map((p) => (
            <option key={p.id} value={p.id} disabled={taken.has(`K:${p.id}`)}>
              {p.label} — owned by {p.ownerName} · {fmtValue(p.value)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!pickId}
          className={buttonClass("secondary", "sm")}
          onClick={() => {
            const p = picks.find((x) => x.id === pickId);
            if (p) onAdd({ key: `K:${p.id}`, type: "PICK", id: p.id, label: p.label, sub: `${p.pickInRound ? "Pick" : "Proj."} ${p.slotLabel}` });
            setPickId("");
          }}
        >
          <Plus size={14} /> Pick
        </button>
        {allowFaab && (
          <span className="flex items-center gap-1">
            <input type="number" min={0} className="input h-8 w-20 py-1 text-right text-xs" value={faab || ""} placeholder="$ FAB" onChange={(e) => setFaab(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="FAB amount" />
            <button
              type="button"
              disabled={!faab || taken.has(`F:${side}`)}
              className={buttonClass("secondary", "sm")}
              onClick={() => {
                onAdd({ key: `F:${side}`, type: "FAAB", amount: faab, label: `$${faab} FAB`, sub: "Free agent budget" });
                setFaab(0);
              }}
            >
              <Plus size={14} /> FAB
            </button>
          </span>
        )}
      </div>
      <ul className="min-h-[120px] divide-y divide-line/60">
        {assets.map((a) => (
          <li key={a.key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{a.label}</span>
              <span className="block text-[11px] text-muted">{a.sub}</span>
            </span>
            <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-loss" aria-label={`Remove ${a.label}`} onClick={() => onRemove(a.key)}>
              <X size={14} />
            </button>
          </li>
        ))}
        {!assets.length && <li className="px-3 py-6 text-center text-xs text-muted">Search players or add picks / FAB.</li>}
      </ul>
    </section>
  );
}
