"use client";
// League rookie rankings — "Who are the best rookies in this class?"
// Phones: position chips + search, then one white sheet per tier (grey tier bars) of rows: rank + movement · player ·
// ADP · score; tap a row for age, NFL draft slot, rank history, notes and who rosters him. md+: the dense table.
// Commissioner editor: two-line rows (arrows / remove, then tier + note) with a floating Save bar above the tab bar.
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Minus, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Collapsible, EmptyState, Panel, StatGrid, StickyActionBar } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, PosPill, SectionBar } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { moveItem } from "@/lib/draft/logic";
import { refreshRookieRankingsAction, restoreExcludedAction, saveRookieRankingsAction, unpinRankingAction } from "@/lib/rookies/actions";
import type { RankingRowView } from "@/lib/rookies/queries";
import { RankSparkline } from "./sparkline";
import { PosChips } from "./room-bits";
import { shortName } from "./bits";

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

  const tiers = [...new Set(list.map((r) => r.tier))];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PosChips positions={positions} value={pos} onChange={setPos} />
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search rankings</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input h-10 rounded-full pl-9" type="search" placeholder="Name, college or team" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {isCommish && (
            <>
              <Button size="md" variant="secondary" className="shrink-0" onClick={() => setEditing(true)} aria-label="Edit rankings">
                <Pencil size={15} /> <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button size="md" variant="ghost" className="shrink-0" onClick={refresh} disabled={pending} title="Recompute the automatic rankings now" aria-label="Refresh automatic rankings">
                <RefreshCw size={15} className={cn(pending && "animate-spin")} /> <span className="hidden sm:inline">Refresh</span>
              </Button>
            </>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={`No ${classYear} rookies ranked yet`}>
          {isCommish ? "Prospects appear automatically once they're in the NFL player database; until then add them with Edit." : "The commissioner will add prospects as the class takes shape. Rankings update every day."}
        </EmptyState>
      ) : list.length === 0 ? (
        <p className="card px-4 py-8 text-center text-[13px] text-muted">Nobody matches those filters.</p>
      ) : (
        <>
          {/* phones: tier sections of rows; tap a row for the details */}
          <div className="space-y-4 md:hidden">
            {tiers.map((t) => {
              const inTier = list.filter((r) => r.tier === t);
              return (
                <section key={t}>
                  <SectionBar as="h2" title={`Tier ${t}`} right={`${inTier.length} player${inTier.length === 1 ? "" : "s"}`} className="mb-1" />
                  <ul className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card">
                    {inTier.map((r) => (
                      <RankingRow key={r.id} r={r} isCommish={isCommish} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
          {/* md+: the table */}
          <div className="card hidden md:block">
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
                    {hasCapital && <th className="hidden lg:table-cell">NFL draft</th>}
                    <th className="num">Age</th>
                    <th className="num">ADP</th>
                    <th className="num" title="Auto score from search rank, ADP, draft capital, position value and age">
                      Score
                    </th>
                    <th>Trend</th>
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
                          <td className="num text-[15px] font-semibold">{r.rank}</td>
                          <td className="text-center">
                            <Movement row={r} />
                          </td>
                          <td className="max-w-[280px]">
                            <RankingPlayer r={r} size={32} />
                          </td>
                          <td className="hidden text-muted lg:table-cell">{r.college ?? "—"}</td>
                          {hasCapital && <td className="hidden lg:table-cell">{r.draftRound ? `Rd ${r.draftRound}${r.draftPick ? `, #${r.draftPick}` : ""}` : <span className="text-faint">—</span>}</td>}
                          <td className="num">{r.age ?? "—"}</td>
                          <td className="num">{r.adp ? Math.round(r.adp) : "—"}</td>
                          <td className="num">{r.autoScore !== null ? r.autoScore.toFixed(1) : "—"}</td>
                          <td>
                            <RankSparkline values={r.history} label={`${r.name} rank history`} />
                          </td>
                          <td className="hidden max-w-[260px] text-muted xl:table-cell">
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
          </div>
        </>
      )}
      {isCommish && excluded.length > 0 && (
        <Panel title="Removed from the rankings" subtitle="Won't return on refreshes until restored" noPad>
          <ul className="divide-y divide-line/70 border-t border-line/70">
            {excluded.map((p) => (
              <li key={p.id} className="flex min-h-[52px] items-center gap-2 px-4 py-2">
                <PosPill pos={p.position} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold sm:text-sm">{p.fullName}</span>
                <Button
                  size="sm"
                  variant="tinted"
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
                  <Undo2 size={14} /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** Headshot (or the prospect's initials) + name + position / NFL team / injury (+ commissioner pin, rostered-by). */
function RankingPlayer({ r, size, short }: { r: RankingRowView; size: number; short?: boolean }) {
  const name = short ? shortName(r.name, r.position) : r.name;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {r.playerId ? (
        <HeadshotBadge player={{ id: r.playerId, fullName: r.name, position: r.position }} nflTeam={r.nflTeam} size={size} />
      ) : (
        <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-sunken text-[12px] font-bold text-muted ring-1 ring-line" style={{ width: size, height: size }} title="Pre-draft prospect" aria-hidden>
          {r.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")}
        </span>
      )}
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          {r.playerId ? (
            <Link href={`/players/${r.playerId}`} title={r.name} className="truncate text-[15px] font-bold leading-5 text-ink hover:underline sm:text-sm" onClick={(e) => e.stopPropagation()}>
              {name}
            </Link>
          ) : (
            <span title={r.name} className="truncate text-[15px] font-bold leading-5 text-ink sm:text-sm">
              {name}
            </span>
          )}
          {r.source === "COMMISSIONER" && (
            <span title="Ranked by the commissioner — keeps its spot when the auto rankings refresh" className="shrink-0 text-brand-600 dark:text-brand-400">
              <Pin size={13} aria-label="Commissioner-ranked" />
            </span>
          )}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-ink">
          <PosPill pos={r.position} />
          <span className="shrink-0 font-medium">{r.nflTeam ?? (r.playerId ? "FA" : "Pre-draft")}</span>
          <InjuryLetter status={r.injuryStatus} />
          {r.rosteredBy && (
            <span className="shrink-0 font-semibold text-muted" title={`On ${r.rosteredBy.name}`}>
              · {r.rosteredBy.abbrev}
            </span>
          )}
          {r.college && <span className="min-w-0 truncate text-muted">· {r.college}</span>}
        </span>
      </span>
    </span>
  );
}

/** Phone row: rank + movement · player · ADP · score; expands to the details. */
function RankingRow({ r, isCommish }: { r: RankingRowView; isCommish: boolean }) {
  return (
    <li className="border-b border-line/70 last:border-b-0">
      <details className="group">
        <summary className="flex min-h-[68px] cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
          <span className="w-8 shrink-0 text-center leading-tight">
            <span className="numeral block text-[17px] font-semibold text-ink">{r.rank}</span>
            <span className="block">
              <Movement row={r} compact />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <RankingPlayer r={r} size={40} short />
          </span>
          <span className="w-10 shrink-0 text-right leading-tight" title="Dynasty ADP">
            <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-muted">ADP</span>
            <span className="numeral block text-[15px] font-semibold text-ink">{r.adp ? Math.round(r.adp) : "—"}</span>
          </span>
          <span className="w-10 shrink-0 text-right leading-tight" title="Auto score">
            <span className="block text-[11px] font-medium uppercase tracking-[0.04em] text-muted">Score</span>
            <span className="numeral block text-[15px] font-semibold text-ink">{r.autoScore !== null ? r.autoScore.toFixed(0) : "—"}</span>
          </span>
          <ChevronDown size={16} className="shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <div className="-mx-3 space-y-3 border-t border-line/70 bg-sunken px-4 py-3 sm:mx-0">
          <StatGrid
            cols={3}
            items={[
              { label: "Age", value: r.age ?? "—" },
              { label: "NFL draft", value: r.draftRound ? `Rd ${r.draftRound}${r.draftPick ? `.${r.draftPick}` : ""}` : "—" },
              { label: "Score", value: r.autoScore !== null ? r.autoScore.toFixed(1) : "—" },
              { label: "ADP", value: r.adp ? Math.round(r.adp) : "—" },
              { label: "Was", value: r.previousRank ? `#${r.previousRank}` : r.isNew ? "New" : "—" },
              { label: "Tier", value: r.tier },
            ]}
          />
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span className="eyebrow">Trend</span>
            <RankSparkline values={r.history} label={`${r.name} rank history`} width={120} height={24} />
          </div>
          {r.rosteredBy && <p className="text-[13px] text-muted">On {r.rosteredBy.name}</p>}
          {r.notes && <p className="text-[14px] text-ink">{r.notes}</p>}
          {isCommish && r.source === "COMMISSIONER" && r.playerId && <UnpinButton id={r.id} />}
        </div>
      </details>
    </li>
  );
}

function Movement({ row, compact }: { row: RankingRowView; compact?: boolean }) {
  if (row.isNew) return compact ? <span className="text-[12px] font-semibold text-brand-600 dark:text-brand-400">New</span> : <Badge tone="brand">New</Badge>;
  if (!row.movement) return <Minus size={12} className="mx-auto inline text-faint" aria-label="No change" />;
  const up = row.movement > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-semibold", up ? "text-win" : "text-loss")} title={`Was #${row.previousRank}`}>
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
      className="mt-0.5 inline-flex min-h-8 items-center gap-1 text-[13px] font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
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
      <PinOff size={13} /> Return to auto
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold">Editing {classYear} rankings</h2>
        <span className="text-[13px] text-muted">
          {rows.length} players{removed > 0 ? ` · ${removed} removed` : ""}
        </span>
      </div>
      <p className="text-[13px] text-muted">Players you move or re-tier become commissioner-ranked and keep their spot when the auto rankings refresh.</p>
      <Panel noPad>
        <div className="px-4">
          <Collapsible summary="Add a prospect" meta="not in the database yet">
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
              <label>
                <span className="label">NFL team</span>
                <input className="input uppercase" value={form.nflTeam} onChange={(e) => setForm({ ...form, nflTeam: e.target.value })} maxLength={3} placeholder="—" />
              </label>
              <label className="col-span-2 lg:col-span-2">
                <span className="label">College</span>
                <input className="input" value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} maxLength={80} />
              </label>
              <label>
                <span className="label">Rd / pick</span>
                <span className="flex gap-1">
                  <input className="input px-2" inputMode="numeric" value={form.draftRound} onChange={(e) => setForm({ ...form, draftRound: e.target.value.replace(/\D/g, "") })} placeholder="Rd" aria-label="NFL draft round" />
                  <input className="input px-2" inputMode="numeric" value={form.draftPick} onChange={(e) => setForm({ ...form, draftPick: e.target.value.replace(/\D/g, "") })} placeholder="#" aria-label="Pick in round" />
                </span>
              </label>
              <label>
                <span className="label">Insert at</span>
                <input className="input px-2" inputMode="numeric" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value.replace(/\D/g, "") })} placeholder={String(rows.length + 1)} aria-label="Insert at rank" />
              </label>
              <div className="col-span-2 flex items-end sm:col-span-4 lg:col-span-8">
                <Button size="md" variant="secondary" onClick={addProspect}>
                  <Plus size={15} /> Add prospect
                </Button>
              </div>
            </div>
          </Collapsible>
        </div>
      </Panel>
      <ol className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:px-4 sm:shadow-card">
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
            className={cn("border-b border-line/70 py-2 last:border-b-0", drag === i && "opacity-40", i > 0 && rows[i - 1].tier !== r.tier && "border-t-2 border-t-brand-600")}
          >
            <div className="flex min-h-11 items-center gap-2">
              <GripVertical size={14} className="hidden shrink-0 cursor-grab text-faint lg:block" aria-hidden />
              <span className="numeral w-8 shrink-0 text-center text-[17px] font-semibold">{i + 1}</span>
              <PosPill pos={r.position} />
              <span className="min-w-0 flex-1 truncate text-[15px] sm:text-sm">
                <span className="font-semibold" title={r.name}>
                  {r.name}
                </span>{" "}
                <span className="text-[13px] text-muted">{r.nflTeam ?? r.college ?? ""}</span>
                {r.source === "COMMISSIONER" && <Pin size={12} className="ml-1 inline text-brand-600 dark:text-brand-400" aria-label="Commissioner-ranked" />}
              </span>
              <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken disabled:opacity-30 sm:h-8 sm:w-8" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => setRows((rs) => moveItem(rs, i, i - 1))}>
                <ArrowUp size={16} />
              </button>
              <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken disabled:opacity-30 sm:h-8 sm:w-8" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => setRows((rs) => moveItem(rs, i, i + 1))}>
                <ArrowDown size={16} />
              </button>
              <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-loss sm:h-8 sm:w-8" aria-label={`Remove ${r.name}`} onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}>
                <X size={16} />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2 pl-10 lg:pl-14">
              <label className="inline-flex shrink-0 items-center gap-1.5 text-[13px]">
                <span className="text-muted">Tier</span>
                <select className="input h-10 w-[72px] py-0 sm:h-8" value={r.tier} onChange={(e) => update(r.uid, { tier: Number(e.target.value) })} aria-label={`Tier for ${r.name}`}>
                  {Array.from({ length: Math.min(30, maxTier) }, (_, k) => k + 1).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <input className="input h-10 min-w-0 flex-1 sm:h-8" placeholder="Note" defaultValue={r.notes ?? ""} maxLength={400} onBlur={(e) => update(r.uid, { notes: e.target.value.trim() || null })} aria-label={`Note for ${r.name}`} />
            </div>
          </li>
        ))}
      </ol>
      <StickyActionBar label="Save rankings">
        <span className="mr-auto min-w-0 truncate text-[13px] text-muted">
          {rows.length} players{removed > 0 ? ` · ${removed} removed` : ""}
        </span>
        <Button size="md" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button size="md" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save rankings"}
        </Button>
      </StickyActionBar>
    </div>
  );
}
