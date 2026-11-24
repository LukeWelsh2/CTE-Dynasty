"use client";
// League rookie rankings table with filters, plus the commissioner editor (reorder, tiers, notes, prospects).
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, GripVertical, Minus, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Panel, PlayerHeadshot, PosBadge, InjuryTag } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { moveItem } from "@/lib/draft/logic";
import { refreshRookieRankingsAction, restoreExcludedAction, saveRookieRankingsAction, unpinRankingAction } from "@/lib/rookies/actions";
import type { RankingRowView } from "@/lib/rookies/queries";
import { RankSparkline } from "./sparkline";

interface EditRow {
  uid: string;
  id: string | null;
  playerId: string | null;
  prospectName: string | null;
  name: string;
  position: string;
  college: string | null;
  nflTeam: string | null;
  draftRound: number | null;
  draftPick: number | null;
  tier: number;
  notes: string | null;
  source: "AUTO" | "COMMISSIONER";
}

const toEdit = (r: RankingRowView): EditRow => ({
  uid: r.id,
  id: r.id,
  playerId: r.playerId,
  prospectName: r.playerId ? null : r.name,
  name: r.name,
  position: r.position,
  college: r.college,
  nflTeam: r.nflTeam,
  draftRound: r.draftRound,
  draftPick: r.draftPick,
  tier: r.tier,
  notes: r.notes,
  source: r.source,
});

export function RookieRankings({
  classYear,
  rows,
  isCommish,
  positions,
  excluded,
}: {
  classYear: number;
  rows: RankingRowView[];
  isCommish: boolean;
  positions: string[];
  excluded: { id: string; fullName: string; position: string; team: string | null }[];
}) {
  const router = useRouter();
  const [pos, setPos] = useState("ALL");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const term = q.trim().toLowerCase();
  const hasCapital = rows.some((r) => r.draftRound);
  const list = rows.filter((r) => (pos === "ALL" || r.position === pos) && (!term || r.name.toLowerCase().includes(term) || (r.college ?? "").toLowerCase().includes(term) || (r.nflTeam ?? "").toLowerCase() === term));

  const refresh = () =>
    start(async () => {
      const res = await refreshRookieRankingsAction({ classYear });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Refreshed");
        router.refresh();
      }
    });

  if (editing) return <RankingsEditor classYear={classYear} rows={rows} onDone={() => setEditing(false)} />;

  return (
    <div className="space-y-3">
      <Panel noPad>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by position">
            {["ALL", ...positions].map((p) => (
              <button key={p} type="button" onClick={() => setPos(p)} className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", pos === p ? "border-brand-600 bg-brand-700 text-white" : "border-line bg-panel text-muted hover:text-ink")}>
                {p === "ALL" ? "All" : p}
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-56">
            <span className="sr-only">Search rankings</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-8 py-1 pl-8 text-xs" placeholder="Name, college or NFL team" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {isCommish && (
            <div className="flex gap-1.5">
              <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit rankings
              </Button>
              <Button size="xs" variant="ghost" onClick={refresh} disabled={pending} title="Recompute the automatic rankings now">
                <RefreshCw size={13} className={cn(pending && "animate-spin")} /> Refresh
              </Button>
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="p-3">
            <EmptyState title={`No ${classYear} rookies ranked yet`}>
              {isCommish ? "Prospects appear automatically once they're in the NFL player database; until then add them by hand with Edit rankings." : "The commissioner will add prospects as the class takes shape. Rankings update every day."}
            </EmptyState>
          </div>
        ) : list.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Nobody matches those filters.</p>
        ) : (
          <div className="scroll-thin max-h-[78vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="num w-10">Rk</th>
                  <th className="w-12 text-center">
                    <span className="sr-only">Movement</span>±
                  </th>
                  <th>Player</th>
                  <th className="hidden lg:table-cell">College</th>
                  {hasCapital && <th className="hidden md:table-cell">NFL draft</th>}
                  <th className="num hidden sm:table-cell">Age</th>
                  <th className="num">ADP</th>
                  <th className="num hidden sm:table-cell" title="Auto score from search rank, ADP, draft capital, position value and age">
                    Score
                  </th>
                  <th className="hidden md:table-cell">Trend</th>
                  <th className="hidden xl:table-cell">Notes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const newTier = i === 0 || list[i - 1].tier !== r.tier;
                  return (
                    <Fragment key={r.id}>
                      {newTier && (
                        <tr className="group-row">
                          <td colSpan={10}>Tier {r.tier}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="num font-display text-lg font-bold">{r.rank}</td>
                        <td className="text-center">
                          <Movement row={r} />
                        </td>
                        <td className="max-w-[170px] sm:max-w-[260px]">
                          <span className="flex min-w-0 items-center gap-2">
                            {r.playerId ? <PlayerHeadshot player={{ id: r.playerId, fullName: r.name, position: r.position }} size={32} /> : <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken text-[10px] font-bold text-muted ring-1 ring-line">PROS</span>}
                            <span className="min-w-0">
                              <span className="flex items-center gap-1">
                                {r.playerId ? (
                                  <Link href={`/players/${r.playerId}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                    {r.name}
                                  </Link>
                                ) : (
                                  <span className="truncate font-semibold">{r.name}</span>
                                )}
                                <InjuryTag status={r.injuryStatus} />
                                {r.source === "COMMISSIONER" && (
                                  <span title="Ranked by the commissioner — stays put when the auto rankings refresh" className="text-gold-600 dark:text-gold-300">
                                    <Pin size={11} />
                                  </span>
                                )}
                              </span>
                              <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                                <PosBadge pos={r.position} className="h-4 min-w-[24px] text-[9px]" />
                                {r.nflTeam ?? (r.playerId ? "FA" : "Pre-draft")}
                                <span className="lg:hidden">{r.college ? `· ${r.college}` : ""}</span>
                                {r.rosteredBy && <Badge className="ml-1" title={`On ${r.rosteredBy.name}`}>{r.rosteredBy.abbrev}</Badge>}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="hidden text-xs lg:table-cell">{r.college ?? "—"}</td>
                        {hasCapital && <td className="hidden text-xs md:table-cell">{r.draftRound ? `Rd ${r.draftRound}${r.draftPick ? `, #${r.draftPick}` : ""}` : <span className="text-muted">—</span>}</td>}
                        <td className="num hidden text-xs sm:table-cell">{r.age ?? "—"}</td>
                        <td className="num text-xs">{r.adp ? Math.round(r.adp) : "—"}</td>
                        <td className="num hidden text-xs sm:table-cell">{r.autoScore !== null ? r.autoScore.toFixed(1) : "—"}</td>
                        <td className="hidden md:table-cell">
                          <RankSparkline values={r.history} label={`${r.name} rank history`} />
                        </td>
                        <td className="hidden max-w-[260px] text-xs text-muted xl:table-cell">
                          <span className="line-clamp-2">{r.notes ?? ""}</span>
                          {isCommish && r.source === "COMMISSIONER" && r.playerId && <UnpinButton id={r.id} />}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {isCommish && excluded.length > 0 && (
        <Panel title="Removed from the rankings" subtitle="These players won't come back on automatic refreshes until restored">
          <ul className="flex flex-wrap gap-2">
            {excluded.map((p) => (
              <li key={p.id} className="chip">
                <PosBadge pos={p.position} className="h-4 min-w-[24px] text-[9px]" /> {p.fullName}
                <button
                  type="button"
                  className="ml-1 text-brand-600 hover:underline"
                  onClick={() =>
                    start(async () => {
                      const res = await restoreExcludedAction({ classYear, playerId: p.id });
                      if (!res.ok) toast.error(res.error);
                      else {
                        toast.success(res.message ?? "Restored");
                        router.refresh();
                      }
                    })
                  }
                >
                  <Undo2 size={12} className="inline" /> Restore
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Movement({ row }: { row: RankingRowView }) {
  if (row.isNew) return <Badge tone="brand">New</Badge>;
  if (!row.movement) return <Minus size={12} className="mx-auto text-muted" aria-label="No change" />;
  const up = row.movement > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-bold", up ? "text-win" : "text-loss")} title={`Was #${row.previousRank}`}>
      {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {Math.abs(row.movement)}
    </span>
  );
}

function UnpinButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline disabled:opacity-50"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await unpinRankingAction({ id });
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(res.message ?? "Done");
            router.refresh();
          }
        })
      }
    >
      <PinOff size={11} /> Return to auto
    </button>
  );
}

function RankingsEditor({ classYear, rows: initial, onDone }: { classYear: number; rows: RankingRowView[]; onDone: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<EditRow[]>(() => initial.map(toEdit));
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", position: "WR", college: "", nflTeam: "", draftRound: "", draftPick: "", at: "" });
  const maxTier = useMemo(() => Math.max(1, ...rows.map((r) => r.tier)) + 1, [rows]);
  const removed = initial.length - rows.filter((r) => r.id).length;

  const update = (uid: string, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const addProspect = () => {
    if (!form.name.trim()) return toast.error("Enter the prospect's name");
    const at = Math.max(1, Math.min(rows.length + 1, Number(form.at) || rows.length + 1));
    const neighbor = rows[at - 2] ?? rows[at - 1];
    const row: EditRow = {
      uid: `new-${Date.now()}`,
      id: null,
      playerId: null,
      prospectName: form.name.trim(),
      name: form.name.trim(),
      position: form.position,
      college: form.college.trim() || null,
      nflTeam: form.nflTeam.trim().toUpperCase() || null,
      draftRound: Number(form.draftRound) || null,
      draftPick: Number(form.draftPick) || null,
      tier: neighbor?.tier ?? 1,
      notes: null,
      source: "COMMISSIONER",
    };
    setRows((rs) => [...rs.slice(0, at - 1), row, ...rs.slice(at - 1)]);
    setForm({ name: "", position: form.position, college: "", nflTeam: "", draftRound: "", draftPick: "", at: "" });
  };
  const save = () =>
    start(async () => {
      const res = await saveRookieRankingsAction({
        classYear,
        rows: rows.map((r) => ({ id: r.id, playerId: r.playerId, prospectName: r.prospectName, position: r.position, college: r.college, nflTeam: r.nflTeam, draftRound: r.draftRound, draftPick: r.draftPick, tier: r.tier, notes: r.notes })),
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved");
        onDone();
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-gold-400/60 bg-panel px-3 py-2 shadow-panel">
        <span className="text-sm font-semibold">Editing {classYear} rankings</span>
        <span className="text-xs text-muted">
          {rows.length} players{removed > 0 ? ` · ${removed} removed` : ""} · players you move or re-tier become commissioner-ranked and keep their spot on refresh
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save rankings"}
          </Button>
        </div>
      </div>
      <Panel title="Add a prospect" subtitle="For pre-NFL-draft prospects not in the player database yet — they're linked automatically once they are">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <label className="col-span-2">
            <span className="label">Name</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          </label>
          <label>
            <span className="label">Pos</span>
            <select className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
              {["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 sm:col-span-1 lg:col-span-2">
            <span className="label">College</span>
            <input className="input" value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} maxLength={80} />
          </label>
          <label>
            <span className="label">NFL team</span>
            <input className="input uppercase" value={form.nflTeam} onChange={(e) => setForm({ ...form, nflTeam: e.target.value })} maxLength={3} placeholder="—" />
          </label>
          <label>
            <span className="label">Rd / Pick</span>
            <span className="flex gap-1">
              <input className="input px-2" inputMode="numeric" value={form.draftRound} onChange={(e) => setForm({ ...form, draftRound: e.target.value.replace(/\D/g, "") })} placeholder="Rd" aria-label="NFL draft round" />
              <input className="input px-2" inputMode="numeric" value={form.draftPick} onChange={(e) => setForm({ ...form, draftPick: e.target.value.replace(/\D/g, "") })} placeholder="#" aria-label="Pick in round" />
            </span>
          </label>
          <label>
            <span className="label">Insert at</span>
            <span className="flex gap-1">
              <input className="input px-2" inputMode="numeric" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value.replace(/\D/g, "") })} placeholder={String(rows.length + 1)} aria-label="Insert at rank" />
              <Button size="sm" variant="secondary" onClick={addProspect} aria-label="Add prospect">
                <Plus size={14} />
              </Button>
            </span>
          </label>
        </div>
      </Panel>
      <Panel noPad>
        <ol className="divide-y divide-line">
          {rows.map((r, i) => (
            <li
              key={r.uid}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null && drag !== i) setRows((rs) => moveItem(rs, drag, i));
                setDrag(null);
              }}
              className={cn("flex flex-wrap items-center gap-2 px-2 py-1.5 sm:flex-nowrap", drag === i && "opacity-40", i > 0 && rows[i - 1].tier !== r.tier && "border-t-2 border-t-brand-700")}
            >
              <GripVertical size={14} className="hidden shrink-0 cursor-grab text-muted sm:block" aria-hidden />
              <span className="w-8 text-right font-display text-lg font-bold tabular-nums">{i + 1}</span>
              <PosBadge pos={r.position} />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold">{r.name}</span> <span className="text-[11px] text-muted">{r.nflTeam ?? r.college ?? ""}</span>
                {r.source === "COMMISSIONER" && <Pin size={11} className="ml-1 inline text-gold-600" />}
              </span>
              <label className="inline-flex items-center gap-1 text-xs">
                <span className="text-muted">Tier</span>
                <select className="input h-7 w-14 px-1 py-0 text-xs" value={r.tier} onChange={(e) => update(r.uid, { tier: Number(e.target.value) })} aria-label={`Tier for ${r.name}`}>
                  {Array.from({ length: Math.min(30, maxTier) }, (_, k) => k + 1).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <input className="input h-7 w-full text-xs sm:w-56" placeholder="Note" defaultValue={r.notes ?? ""} maxLength={400} onBlur={(e) => update(r.uid, { notes: e.target.value.trim() || null })} aria-label={`Note for ${r.name}`} />
              <span className="flex items-center">
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => setRows((rs) => moveItem(rs, i, i - 1))}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => setRows((rs) => moveItem(rs, i, i + 1))}>
                  <ArrowDown size={14} />
                </button>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken hover:text-loss" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>
                  <X size={14} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
