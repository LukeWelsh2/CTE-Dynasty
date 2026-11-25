"use client";
// My big board — "How do I rank this class?" One line of counts + save state, position chips, import, then the board
// as roster-style rows: rank · player (league rank, ADP, college, note) · ↑ ↓ (40px) · ⋯ (note, new tier, remove).
// Tiers are grey section bars. Drag to reorder on desktop. "Add players" below (beside on lg).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Import, Layers, MessageSquare, MoreHorizontal, Plus, Search, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Panel, buttonClass } from "@/components/ui/core";
import { PosPill, SectionBar } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { moveItem } from "@/lib/draft/logic";
import { importRankingsAction, saveBigBoardAction } from "@/lib/draft/actions";
import { PlayerCell } from "./bits";
import { PosChips } from "./room-bits";

export interface BoardPlayer {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  college: string | null;
  age: number | null;
  injuryStatus: string | null;
  adp: number | null;
  leagueRank: number | null;
  rosteredBy: string | null;
}

export interface BoardRow extends BoardPlayer {
  note: string | null;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function BigBoard({
  classYear,
  initialRows,
  initialBreaks,
  pool,
  positions,
  rankingsCount,
  usedForAutopick = true,
}: {
  classYear: number;
  initialRows: BoardRow[];
  initialBreaks: string[];
  pool: BoardPlayer[];
  positions: string[];
  rankingsCount: number;
  /** settings.draft.rookie.autopickSource === BIG_BOARD */
  usedForAutopick?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [breaks, setBreaks] = useState(() => new Set(initialBreaks));
  const [pos, setPos] = useState("ALL");
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [importing, startImport] = useTransition();
  const keyOf = (rs: BoardRow[], bs: Set<string>) => JSON.stringify([rs.map((r) => [r.id, r.note ?? ""]), [...bs].sort()]);
  const savedKey = useRef(keyOf(initialRows, new Set(initialBreaks)));

  useEffect(() => {
    savedKey.current = keyOf(initialRows, new Set(initialBreaks));
    setRows(initialRows);
    setBreaks(new Set(initialBreaks));
  }, [initialRows, initialBreaks]);

  // autosave shortly after the last change
  useEffect(() => {
    const k = keyOf(rows, breaks);
    if (k === savedKey.current) return;
    setSave("dirty");
    const t = setTimeout(async () => {
      setSave("saving");
      const res = await saveBigBoardAction({ classYear, entries: rows.map((r) => ({ playerId: r.id, note: r.note })), tierBreaks: [...breaks] });
      if (res.ok) {
        savedKey.current = k;
        setSave("saved");
      } else {
        setSave("error");
        toast.error(res.error);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [rows, breaks, classYear]);

  const onBoard = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => pos === "ALL" || r.position === pos);
  const tierOf = useMemo(() => {
    const m = new Map<string, number>();
    let t = 1;
    rows.forEach((r, i) => {
      if (i > 0 && breaks.has(r.id)) t++;
      m.set(r.id, t);
    });
    return m;
  }, [rows, breaks]);
  const term = q.trim().toLowerCase();
  const candidates = pool.filter((p) => !onBoard.has(p.id) && (pos === "ALL" || p.position === pos) && (!term || p.fullName.toLowerCase().includes(term) || (p.college ?? "").toLowerCase().includes(term))).slice(0, 80);

  const moveVisible = (vi: number, dir: -1 | 1) => {
    const a = visible[vi];
    const b = visible[vi + dir];
    if (!a || !b) return;
    setRows((rs) => moveItem(rs, a.i, b.i));
  };
  const toggleBreak = (id: string) =>
    setBreaks((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const doImport = (mode: "replace" | "append") => {
    if (mode === "replace" && rows.length && !window.confirm("Replace your board order with the league rookie rankings? Your notes are kept.")) return;
    startImport(async () => {
      const res = await importRankingsAction({ classYear, mode });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Imported");
        router.refresh();
      }
    });
  };

  const tiers = tierOf.size ? Math.max(...tierOf.values()) : 0;
  const iconBtn = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-sunken disabled:opacity-30 sm:h-8 sm:w-8";
  const saveLabel =
    save === "saving" ? (
      <>
        <Loader2 size={13} className="animate-spin" /> Saving
      </>
    ) : save === "saved" ? (
      <>
        <Check size={13} className="text-win" /> Saved
      </>
    ) : save === "dirty" ? (
      "Unsaved"
    ) : save === "error" ? (
      <span className="text-loss">Not saved</span>
    ) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label={`My ${classYear} board`} className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
          <span className="truncate">
            <span className="numeral font-semibold text-ink">{rows.length}</span> player{rows.length === 1 ? "" : "s"} · <span className="numeral font-semibold text-ink">{tiers}</span> tier{tiers === 1 ? "" : "s"}
            {usedForAutopick ? " · used for autopick" : ""}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1" aria-live="polite">
            {saveLabel}
          </span>
        </div>
        <PosChips positions={positions} value={pos} onChange={setPos} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="md" variant="secondary" onClick={() => doImport("replace")} disabled={importing || !rankingsCount} title={rankingsCount ? "Use the league rookie rankings as your board" : "No league rankings for this class yet"}>
            <Import size={15} /> Import rankings
          </Button>
          {rows.length > 0 && (
            <Button size="md" variant="ghost" onClick={() => doImport("append")} disabled={importing || !rankingsCount}>
              Add missing
            </Button>
          )}
          <a href="#add-players" className={buttonClass("tinted", "md", "lg:hidden")}>
            <Plus size={15} /> Add players
          </a>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Your board is empty" icon={<Layers />}>
            Add players below{rankingsCount ? " or import the league rookie rankings" : ""}. Use the arrows to reorder (drag on desktop).
          </EmptyState>
        ) : visible.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">No {pos}s on your board.</p>
        ) : (
          <ol className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:px-4 sm:shadow-card">
            {visible.map(({ r, i }, vi) => {
              const tier = tierOf.get(r.id)!;
              const newTier = i === 0 || breaks.has(r.id);
              const open = noteOpen === r.id || menuOpen === r.id;
              return (
                <li key={r.id}>
                  {newTier && pos === "ALL" && <SectionBar as="div" title={`Tier ${tier}`} className="my-2" />}
                  <div
                    draggable={pos === "ALL"}
                    onDragStart={() => setDrag(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (drag !== null && drag !== i) setRows((rs) => moveItem(rs, drag, i));
                      setDrag(null);
                    }}
                    className={cn("border-b border-line/70 py-2", drag === i && "opacity-40", r.rosteredBy && "opacity-70")}
                  >
                    <div className="flex min-h-[56px] items-center gap-1.5">
                      <GripVertical size={14} className={cn("hidden shrink-0 text-faint lg:block", pos === "ALL" ? "cursor-grab" : "opacity-30")} aria-hidden />
                      <span className="numeral w-7 shrink-0 text-center text-[17px] font-semibold text-ink">{i + 1}</span>
                      <div className="min-w-0 flex-1 pl-1">
                        <PlayerCell
                          player={r}
                          size={40}
                          short
                          sub={
                            <span className="min-w-0 truncate text-muted">
                              {[r.leagueRank ? `League #${r.leagueRank}` : null, r.adp ? `ADP ${Math.round(r.adp)}` : null].filter(Boolean).join(" · ") || r.college}
                            </span>
                          }
                        />
                        {r.rosteredBy && <span className="ml-[50px] mt-0.5 block text-[12px] font-semibold text-muted">Rostered by {r.rosteredBy}</span>}
                        {r.note && noteOpen !== r.id && <p className="ml-[50px] mt-0.5 line-clamp-2 text-[13px] italic text-muted">{r.note}</p>}
                      </div>
                      <button type="button" className={iconBtn} aria-label={`Move ${r.fullName} up`} disabled={vi === 0} onClick={() => moveVisible(vi, -1)}>
                        <ArrowUp size={17} />
                      </button>
                      <button type="button" className={iconBtn} aria-label={`Move ${r.fullName} down`} disabled={vi === visible.length - 1} onClick={() => moveVisible(vi, 1)}>
                        <ArrowDown size={17} />
                      </button>
                      <button
                        type="button"
                        className={cn(iconBtn, open && "bg-sunken text-ink")}
                        aria-label={`More for ${r.fullName}`}
                        aria-expanded={open}
                        onClick={() => {
                          setMenuOpen(open ? null : r.id);
                          if (open) setNoteOpen(null);
                        }}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </div>
                    {open && (
                      <div className="mb-1 ml-8 mt-1 space-y-2 rounded-lg bg-sunken p-2">
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setNoteOpen(noteOpen === r.id ? null : r.id)}>
                            <MessageSquare size={14} /> {r.note ? "Edit note" : "Add note"}
                          </Button>
                          {i > 0 && (
                            <Button size="sm" variant="secondary" onClick={() => toggleBreak(r.id)} aria-label={breaks.has(r.id) ? `Remove tier break above ${r.fullName}` : `Start a new tier at ${r.fullName}`}>
                              <Layers size={14} /> {breaks.has(r.id) ? "Join tier above" : "New tier here"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-loss"
                            onClick={() => {
                              setRows((rs) => rs.filter((x) => x.id !== r.id));
                              setBreaks((s) => {
                                const n = new Set(s);
                                n.delete(r.id);
                                return n;
                              });
                              setMenuOpen(null);
                            }}
                            aria-label={`Remove ${r.fullName}`}
                          >
                            <X size={14} /> Remove
                          </Button>
                        </div>
                        {noteOpen === r.id && (
                          <textarea
                            autoFocus
                            className="input h-20"
                            maxLength={280}
                            defaultValue={r.note ?? ""}
                            aria-label={`Note for ${r.fullName}`}
                            placeholder="Why you like him, landing spot, injury notes…"
                            onBlur={(e) => {
                              const v = e.target.value.trim() || null;
                              setNoteOpen(null);
                              if (v !== r.note) setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, note: v } : x)));
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <Panel id="add-players" className="scroll-mt-4 self-start" noPad title="Add players" subtitle={`${classYear} rookies by league rank`}>
        <div className="border-t border-line/70 px-4 py-3">
          <label className="relative block">
            <span className="sr-only">Search rookies</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-10 rounded-full pl-9" type="search" placeholder="Name or college" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {candidates.length === 0 ? (
          <p className="border-t border-line/70 px-4 py-6 text-center text-[13px] text-muted">{pool.length ? "Everyone matching is already on your board." : "No draft-eligible rookies for this class are in the player database yet."}</p>
        ) : (
          <ul className="scroll-thin divide-y divide-line/70 border-t border-line/70 lg:max-h-[70vh] lg:overflow-y-auto">
            {candidates.map((p) => (
              <li key={p.id} className="flex min-h-[56px] items-center gap-2.5 px-4 py-1.5">
                <span className="numeral w-7 shrink-0 text-center text-[13px] font-semibold text-muted">{p.leagueRank ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink sm:text-sm" title={p.fullName}>
                    {p.fullName}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                    <PosPill pos={p.position} />
                    <span className="truncate">{[p.team, p.college].filter(Boolean).join(" · ")}</span>
                  </span>
                </span>
                <Button size="sm" variant="tinted" className="shrink-0" onClick={() => setRows((rs) => [...rs, { ...p, note: null }])} aria-label={`Add ${p.fullName} to board`}>
                  <Plus size={14} /> Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
