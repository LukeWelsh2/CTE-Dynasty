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
  const size = compact ? "xs" : "sm";
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
      <Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
        <CalendarClock size={13} /> Schedule
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Schedule start"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => save(null)} disabled={pending}>
              Clear time
            </Button>
            <Button size="sm" onClick={() => save(value || null)} disabled={pending || !value}>
              Save
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="label">Start time ({timezone.replace("_", " ")})</span>
          <input type="datetime-local" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <p className="mt-2 text-xs text-muted">The draft starts automatically at this time and every manager is notified. You can still start it early.</p>
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
        size="xs"
        variant="secondary"
        onClick={() => {
          setOrder(teams);
          setOpen(true);
        }}
      >
        <ListOrdered size={13} /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        footer={
          <>
            {canReset && (
              <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
                <RotateCcw size={13} /> Reset from settings
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={pending}>
              Save order
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-muted">Drag teams (or use the arrows). Slot 1 picks first.</p>
        <ol className="space-y-1">
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
              className={cn("flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5", drag === i && "opacity-50")}
            >
              <GripVertical size={14} className="hidden cursor-grab text-muted sm:block" aria-hidden />
              <span className="w-6 text-right font-display text-lg font-bold tabular-nums text-muted">{i + 1}</span>
              <TeamLogo team={t} size={24} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.name}</span>
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => setOrder((o) => moveItem(o, i, i - 1))}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move ${t.name} down`} disabled={i === order.length - 1} onClick={() => setOrder((o) => moveItem(o, i, i + 1))}>
                <ArrowDown size={14} />
              </button>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  );
}
