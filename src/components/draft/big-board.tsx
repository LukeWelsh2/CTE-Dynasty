"use client";
// My big board: drag (desktop) / arrows (mobile) to rank a rookie class, tiers, notes, import league rankings.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Import, Layers, MessageSquare, Plus, Search, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Panel, PosBadge } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { moveItem } from "@/lib/draft/logic";
import { importRankingsAction, saveBigBoardAction } from "@/lib/draft/actions";
import { PlayerCell } from "./bits";

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

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel
        noPad
        title={`My ${classYear} board`}
        subtitle={`${rows.length} player${rows.length === 1 ? "" : "s"} · ${tierOf.size ? Math.max(...tierOf.values()) : 0} tiers${usedForAutopick ? " · used for autopick when your queue is empty" : ""}`}
        actions={
          <span className="inline-flex items-center gap-1 text-xs text-muted" aria-live="polite">
            {save === "saving" && (
              <>
                <Loader2 size={12} className="animate-spin" /> Saving
              </>
            )}
            {save === "saved" && (
              <>
                <Check size={12} className="text-win" /> Saved
              </>
            )}
            {save === "dirty" && "Unsaved changes"}
            {save === "error" && <span className="text-loss">Not saved</span>}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by position">
            {["ALL", ...positions].map((p) => (
              <button key={p} type="button" onClick={() => setPos(p)} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", pos === p ? "border-brand-600 bg-brand-700 text-white" : "border-line bg-panel text-muted hover:text-ink")}>
                {p === "ALL" ? "All" : p}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1.5">
            <Button size="xs" variant="secondary" onClick={() => doImport("replace")} disabled={importing || !rankingsCount} title={rankingsCount ? "Use the league rookie rankings as your board" : "No league rankings for this class yet"}>
              <Import size={13} /> Import league rankings
            </Button>
            {rows.length > 0 && (
              <Button size="xs" variant="ghost" onClick={() => doImport("append")} disabled={importing || !rankingsCount}>
                Add missing
              </Button>
            )}
            <a href="#add-players" className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold lg:hidden">
              <Plus size={12} /> Add players
            </a>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-3">
            <EmptyState title="Your board is empty" icon={<Layers />}>
              Add players from the list{rankingsCount ? ", or import the league rookie rankings as a starting point" : ""}. Drag to reorder on desktop, use the arrows on your phone.
            </EmptyState>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">No {pos}s on your board.</p>
        ) : (
          <ol>
            {visible.map(({ r, i }, vi) => {
              const tier = tierOf.get(r.id)!;
              const newTier = i === 0 || breaks.has(r.id);
              return (
                <li key={r.id}>
                  {newTier && pos === "ALL" && (
                    <div className="flex items-center gap-2 border-y border-line bg-brand-900 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white dark:bg-brand-950">
                      <Layers size={12} /> Tier {tier}
                    </div>
                  )}
                  <div
                    draggable={pos === "ALL"}
                    onDragStart={() => setDrag(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (drag !== null && drag !== i) setRows((rs) => moveItem(rs, drag, i));
                      setDrag(null);
                    }}
                    className={cn("flex items-center gap-1.5 border-b border-line/70 px-2 py-1.5", drag === i && "opacity-40", r.rosteredBy && "opacity-60")}
                  >
                    <GripVertical size={14} className={cn("hidden shrink-0 text-muted sm:block", pos === "ALL" ? "cursor-grab" : "opacity-30")} aria-hidden />
                    <span className="w-7 shrink-0 text-right font-display text-lg font-bold tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <PlayerCell
                        player={r}
                        size={28}
                        sub={
                          <>
                            {r.college ? <span className="hidden sm:inline">· {r.college}</span> : null}
                            {r.adp ? <span>· ADP {Math.round(r.adp)}</span> : null}
                            {r.leagueRank ? <span>· League #{r.leagueRank}</span> : null}
                            {r.rosteredBy ? <Badge className="ml-1">{r.rosteredBy}</Badge> : null}
                          </>
                        }
                      />
                      {r.note && noteOpen !== r.id && <p className="ml-9 mt-0.5 line-clamp-2 text-xs italic text-muted">{r.note}</p>}
                      {noteOpen === r.id && (
                        <textarea
                          autoFocus
                          className="input ml-9 mt-1 h-16 w-[calc(100%-2.25rem)] text-xs"
                          maxLength={280}
                          defaultValue={r.note ?? ""}
                          placeholder="Why you like him, landing spot, injury notes…"
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null;
                            setNoteOpen(null);
                            if (v !== r.note) setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, note: v } : x)));
                          }}
                        />
                      )}
                    </div>
                    <button type="button" title="Note" aria-label={`Note for ${r.fullName}`} className={cn("rounded p-1 hover:bg-sunken", r.note ? "text-brand-600" : "text-muted")} onClick={() => setNoteOpen(noteOpen === r.id ? null : r.id)}>
                      <MessageSquare size={14} />
                    </button>
                    {i > 0 && (
                      <button
                        type="button"
                        title={breaks.has(r.id) ? "Remove tier break" : "Start a new tier here"}
                        aria-label={breaks.has(r.id) ? `Remove tier break above ${r.fullName}` : `Start a new tier at ${r.fullName}`}
                        className={cn("rounded p-1 hover:bg-sunken", breaks.has(r.id) ? "text-gold-600" : "text-muted")}
                        onClick={() => toggleBreak(r.id)}
                      >
                        <Layers size={14} />
                      </button>
                    )}
                    <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${r.fullName} up`} disabled={vi === 0} onClick={() => moveVisible(vi, -1)}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${r.fullName} down`} disabled={vi === visible.length - 1} onClick={() => moveVisible(vi, 1)}>
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted hover:bg-sunken hover:text-loss"
                      aria-label={`Remove ${r.fullName}`}
                      onClick={() => {
                        setRows((rs) => rs.filter((x) => x.id !== r.id));
                        setBreaks((s) => {
                          const n = new Set(s);
                          n.delete(r.id);
                          return n;
                        });
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      <Panel id="add-players" noPad title="Add players" subtitle={`${classYear} draft-eligible rookies, by league rank`}>
        <div className="border-b border-line px-3 py-2">
          <label className="relative block">
            <span className="sr-only">Search rookies</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-8 py-1 pl-8 text-xs" placeholder="Name or college" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {candidates.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{pool.length ? "Everyone matching is already on your board." : "No draft-eligible rookies for this class are in the player database yet."}</p>
        ) : (
          <ul className="scroll-thin max-h-[70vh] divide-y divide-line overflow-y-auto">
            {candidates.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-7 text-right text-xs font-bold tabular-nums text-muted">{p.leagueRank ?? "—"}</span>
                <PosBadge pos={p.position} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-semibold">{p.fullName}</span> <span className="text-[11px] text-muted">{p.team ?? p.college ?? ""}</span>
                </span>
                <Button size="xs" variant="secondary" onClick={() => setRows((rs) => [...rs, { ...p, note: null }])} aria-label={`Add ${p.fullName} to board`}>
                  <Plus size={12} /> Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
