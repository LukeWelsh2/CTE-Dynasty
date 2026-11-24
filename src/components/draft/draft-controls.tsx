"use client";
// Commissioner draft controls: start / pause / resume / undo / end / delete, reschedule and order editing.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarClock, GripVertical, ListOrdered, Pause, Play, RotateCcw, Square, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/client";
import { Button, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { draftControlAction, rescheduleDraftAction, resetDraftOrderAction, setDraftOrderAction } from "@/lib/draft/actions";
import { moveItem } from "@/lib/draft/logic";
import type { RoomTeam } from "@/lib/draft/types";

type Op = "start" | "pause" | "resume" | "complete" | "delete" | "undo";

const CONFIRM: Partial<Record<Op, string>> = {
  start: "Start the draft now? Managers will be notified and the clock starts.",
  undo: "Undo the most recent pick / sale? The player is removed from that roster.",
  complete: "End the draft now? Remaining picks / nominations will not happen.",
  delete: "Delete this draft? This can't be undone.",
};

export function DraftControls({
  draftId,
  status,
  type,
  hasActivity,
  compact,
  onChanged,
  onBeforeAction,
  showDelete = false,
}: {
  draftId: string;
  status: string;
  type: "ROOKIE" | "AUCTION" | string;
  hasActivity: boolean;
  compact?: boolean;
  onChanged?: () => void;
  onBeforeAction?: () => void;
  showDelete?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Op | null>(null);
  const run = (op: Op) => {
    const c = CONFIRM[op];
    if (c && !window.confirm(c)) return;
    setBusy(op);
    onBeforeAction?.();
    start(async () => {
      const res = await draftControlAction({ draftId, op });
      setBusy(null);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Done");
        onChanged?.();
        router.refresh();
      }
    });
  };
  // phones get finger-sized buttons (sm = 36px) even in the compact list rows
  const size = compact ? "sm" : "md";
  const b = (op: Op) => pending && busy === op;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status === "SCHEDULED" && (
        <Button size={size} variant="success" onClick={() => run("start")} disabled={pending}>
          <Play size={13} /> {b("start") ? "Starting…" : "Start now"}
        </Button>
      )}
      {status === "LIVE" && (
        <Button size={size} variant="secondary" onClick={() => run("pause")} disabled={pending}>
          <Pause size={13} /> Pause
        </Button>
      )}
      {status === "PAUSED" && (
        <Button size={size} variant="success" onClick={() => run("resume")} disabled={pending}>
          <Play size={13} /> Resume
        </Button>
      )}
      {(status === "LIVE" || status === "PAUSED" || (status === "COMPLETE" && hasActivity)) && hasActivity && (
        <Button size={size} variant="secondary" onClick={() => run("undo")} disabled={pending} title={type === "AUCTION" ? "Undo the open nomination or the last sale" : "Undo the last pick"}>
          <Undo2 size={13} /> {type === "AUCTION" ? "Undo last lot" : "Undo last pick"}
        </Button>
      )}
      {(status === "LIVE" || status === "PAUSED") && (
        <Button size={size} variant="ghost" onClick={() => run("complete")} disabled={pending}>
          <Square size={13} /> End draft
        </Button>
      )}
      {showDelete && !hasActivity && !(status === "COMPLETE" && type === "AUCTION") && (
        <Button size={size} variant="ghost" className="text-loss" onClick={() => run("delete")} disabled={pending}>
          <Trash2 size={13} /> Delete
        </Button>
      )}
    </div>
  );
}

export function RescheduleButton({ draftId, current, timezone }: { draftId: string; current: string; timezone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const save = (v: string | null) =>
    start(async () => {
      const res = await rescheduleDraftAction({ draftId, startTime: v });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved");
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CalendarClock size={14} /> Schedule
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule start"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => save(null)} disabled={pending}>
              Clear time
            </Button>
            <Button size="md" onClick={() => save(value || null)} disabled={pending || !value}>
              Save
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="label">Start time ({timezone.replace("_", " ")})</span>
          <input type="datetime-local" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <p className="mt-2 text-[13px] text-muted">Starts automatically at this time and notifies every manager. You can still start it early.</p>
      </Modal>
    </>
  );
}

/** Manual order editor (round-1 slot order for rookie drafts; nomination order for auctions). */
export function OrderEditor({ draftId, teams, label = "Edit order", canReset = true }: { draftId: string; teams: RoomTeam[]; label?: string; canReset?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(teams);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await setDraftOrderAction({ draftId, teamIds: order.map((t) => t.id) });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved");
        setOpen(false);
        router.refresh();
      }
    });
  const reset = () =>
    start(async () => {
      if (!window.confirm("Recompute the order from the league settings? Manual changes are discarded.")) return;
      const res = await resetDraftOrderAction({ draftId });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Reset");
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setOrder(teams);
          setOpen(true);
        }}
      >
        <ListOrdered size={14} /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        footer={
          <>
            {canReset && (
              <Button variant="ghost" size="md" onClick={reset} disabled={pending}>
                <RotateCcw size={14} /> Reset
              </Button>
            )}
            <Button size="md" onClick={save} disabled={pending}>
              Save order
            </Button>
          </>
        }
      >
        <p className="mb-2 text-[13px] text-muted">Use the arrows (or drag on desktop). Slot 1 picks first.</p>
        <ol className="divide-y divide-line/70">
          {order.map((t, i) => (
            <li
              key={t.id}
              draggable
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) setOrder((o) => moveItem(o, drag, i));
                setDrag(null);
              }}
              className={cn("flex min-h-12 items-center gap-2 py-1", drag === i && "opacity-50")}
            >
              <GripVertical size={14} className="hidden cursor-grab text-muted sm:block" aria-hidden />
              <span className="numeral w-6 text-right text-[15px] font-semibold text-muted">{i + 1}</span>
              <TeamLogo team={t} size={28} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold sm:text-sm" title={t.name}>
                {t.name}
              </span>
              <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-sunken disabled:opacity-30 sm:h-8 sm:w-8" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => setOrder((o) => moveItem(o, i, i - 1))}>
                <ArrowUp size={16} />
              </button>
              <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-sunken disabled:opacity-30 sm:h-8 sm:w-8" aria-label={`Move ${t.name} down`} disabled={i === order.length - 1} onClick={() => setOrder((o) => moveItem(o, i, i + 1))}>
                <ArrowDown size={16} />
              </button>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  );
}
