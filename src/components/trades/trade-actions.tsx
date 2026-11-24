"use client";
// Trade action buttons (accept with drops, reject, cancel, vote, commissioner tools) + live refresh.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Gavel, Loader2, RotateCcw, ThumbsDown, ThumbsUp, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { Modal, Toggle } from "@/components/ui/client";
import { useLiveEvents } from "@/lib/realtime/client";
import { cn } from "@/lib/utils";
import {
  acceptTradeAction,
  cancelTradeAction,
  commishApproveTradeAction,
  commishCancelTradeAction,
  commishForceCompleteAction,
  commishReverseTradeAction,
  commishVetoTradeAction,
  rejectTradeAction,
  voteTradeAction,
  type ActionResult,
} from "@/lib/trades/actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error);
        else {
          toast.success(r.message ?? "Done");
          router.refresh();
        }
        after?.(r);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

/** Refresh the page when any trade in the league changes (offers, accepts, votes, completions). */
export function TradeLiveRefresh({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "trade.update" && e.type !== "transaction") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 600);
  });
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return null;
}

export interface DropCandidate {
  id: string;
  fullName: string;
  position: string;
  salary: number;
  deadMoney: number;
  status: string;
  value: number;
}

export function RespondButtons({
  tradeId,
  dropsNeeded,
  capOverBy,
  candidates,
  canCounter = true,
}: {
  tradeId: string;
  dropsNeeded: number;
  capOverBy: number;
  candidates: DropCandidate[];
  canCounter?: boolean;
}) {
  const { pending, run } = useRun();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [drops, setDrops] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const freed = candidates.filter((c) => drops.includes(c.id)).reduce((a, c) => a + c.salary - c.deadMoney, 0);
  const activeDrops = candidates.filter((c) => drops.includes(c.id) && c.status !== "IR" && c.status !== "TAXI").length;
  const needsModal = dropsNeeded > 0 || capOverBy > 0;
  const ready = activeDrops >= dropsNeeded && freed >= capOverBy;
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={buttonClass("success", "sm")}
        onClick={() => {
          if (needsModal) setAcceptOpen(true);
          else if (window.confirm("Accept this trade?")) run(() => acceptTradeAction(tradeId, []));
        }}
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Accept
      </button>
      <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => setRejectOpen(true)}>
        <X size={14} /> Reject
      </button>
      {canCounter && (
        <Link href={`/trades/new?counter=${tradeId}`} className={buttonClass("secondary", "sm")}>
          <RotateCcw size={14} /> Counter
        </Link>
      )}
      <Modal
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        title="Make room to accept"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setAcceptOpen(false)}>
              Back
            </button>
            <button type="button" disabled={!ready || pending} className={buttonClass("success", "sm")} onClick={() => run(() => acceptTradeAction(tradeId, drops), (r) => r.ok && setAcceptOpen(false))}>
              {pending && <Loader2 size={14} className="animate-spin" />} Accept & drop {drops.length || ""}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            {dropsNeeded > 0 && (
              <>
                Your active roster would be over the limit — choose <b className="text-ink">{dropsNeeded}</b> player{dropsNeeded === 1 ? "" : "s"} to drop.{" "}
              </>
            )}
            {capOverBy > 0 && (
              <>
                You'd be <b className="text-loss">${capOverBy}</b> over the cap — drops must free at least that much (dead money counts).
              </>
            )}
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-line">
            <table className="tbl tbl-compact">
              <thead className="sticky top-0">
                <tr>
                  <th className="w-8"></th>
                  <th>Player</th>
                  <th className="num">Salary</th>
                  <th className="num">Dead $</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => setDrops((d) => (d.includes(c.id) ? d.filter((x) => x !== c.id) : [...d, c.id]))}>
                    <td>
                      <input type="checkbox" aria-label={`Drop ${c.fullName}`} checked={drops.includes(c.id)} readOnly className="h-4 w-4 accent-red-600" />
                    </td>
                    <td>
                      <span className="font-semibold">{c.fullName}</span> <span className="text-xs text-muted">{c.position}{c.status !== "ACTIVE" ? ` · ${c.status}` : ""}</span>
                    </td>
                    <td className="num">${c.salary}</td>
                    <td className="num">{c.deadMoney ? `$${c.deadMoney}` : "—"}</td>
                    <td className="num">{c.value.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn("text-xs font-semibold", ready ? "text-win" : "text-muted")}>
            {activeDrops}/{dropsNeeded} roster spots cleared{capOverBy > 0 ? ` · $${freed}/$${capOverBy} cap freed` : ""}
          </p>
        </div>
      </Modal>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject trade"
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setRejectOpen(false)}>
              Back
            </button>
            <button type="button" disabled={pending} className={buttonClass("danger", "sm")} onClick={() => run(() => rejectTradeAction(tradeId, note), (r) => r.ok && setRejectOpen(false))}>
              {pending && <Loader2 size={14} className="animate-spin" />} Reject
            </button>
          </>
        }
      >
        <label className="block">
          <span className="label">Note to the other manager (optional)</span>
          <textarea className="input min-h-[80px]" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not enough for me — add a 2nd and we're close." />
        </label>
      </Modal>
    </>
  );
}

export function CancelOfferButton({ tradeId }: { tradeId: string }) {
  const { pending, run } = useRun();
  return (
    <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => window.confirm("Withdraw this trade offer?") && run(() => cancelTradeAction(tradeId))}>
      {pending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Withdraw offer
    </button>
  );
}

export function VoteButtons({ tradeId, mine, approve, veto, required, showCounts }: { tradeId: string; mine: string | null; approve: number; veto: number; required: number; showCounts: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} aria-pressed={mine === "APPROVE"} className={buttonClass(mine === "APPROVE" ? "success" : "secondary", "sm")} onClick={() => run(() => voteTradeAction(tradeId, "APPROVE"))}>
        <ThumbsUp size={14} /> Approve{showCounts ? ` (${approve})` : ""}
      </button>
      <button type="button" disabled={pending} aria-pressed={mine === "VETO"} className={buttonClass(mine === "VETO" ? "danger" : "secondary", "sm")} onClick={() => run(() => voteTradeAction(tradeId, "VETO"))}>
        <ThumbsDown size={14} /> Veto ({veto}/{required})
      </button>
      {mine && <span className="text-xs text-muted">You voted {mine === "VETO" ? "to veto" : "to approve"} — you can change it until review ends.</span>}
    </div>
  );
}

type CommishKind = "approve" | "veto" | "force" | "reverse" | "cancel";
const COMMISH_META: Record<CommishKind, { label: string; title: string; variant: Parameters<typeof buttonClass>[0]; icon: React.ReactNode; help: string; placeholder: string }> = {
  approve: { label: "Approve", title: "Approve trade", variant: "success", icon: <Check size={14} />, help: "The trade is processed immediately: players, picks and FAB move and the league is notified.", placeholder: "Looks fair to me." },
  veto: { label: "Veto", title: "Veto trade", variant: "danger", icon: <Gavel size={14} />, help: "The trade is blocked. Both managers are notified with your note.", placeholder: "Reason for the veto (shared with both managers)" },
  force: { label: "Force complete", title: "Force-complete trade", variant: "gold", icon: <Zap size={14} />, help: "Processes the trade now even if not every team accepted or the review is still open. Asset ownership is still verified.", placeholder: "Why this trade is being forced through" },
  reverse: { label: "Reverse", title: "Reverse completed trade", variant: "danger", icon: <RotateCcw size={14} />, help: "Every player and pick goes back to its original team, FAB is refunded and players dropped for the trade are restored if still unsigned.", placeholder: "Reason for the reversal" },
  cancel: { label: "Cancel", title: "Cancel trade", variant: "secondary", icon: <X size={14} />, help: "Closes the offer without processing it.", placeholder: "Reason (optional)" },
};

export function CommishTradeButton({ tradeId, kind, size = "sm" }: { tradeId: string; kind: CommishKind; size?: "xs" | "sm" }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [skip, setSkip] = useState(false);
  const m = COMMISH_META[kind];
  const go = () =>
    run(
      () =>
        kind === "approve"
          ? commishApproveTradeAction(tradeId, note)
          : kind === "veto"
            ? commishVetoTradeAction(tradeId, note)
            : kind === "force"
              ? commishForceCompleteAction(tradeId, note, skip)
              : kind === "reverse"
                ? commishReverseTradeAction(tradeId, note)
                : commishCancelTradeAction(tradeId, note),
      (r) => r.ok && setOpen(false),
    );
  return (
    <>
      <button type="button" disabled={pending} className={buttonClass(m.variant, size)} onClick={() => setOpen(true)}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : m.icon} {m.label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={m.title}
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOpen(false)}>
              Back
            </button>
            <button type="button" disabled={pending} className={buttonClass(m.variant, "sm")} onClick={go}>
              {pending && <Loader2 size={14} className="animate-spin" />} {m.label}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted">{m.help}</p>
          <label className="block">
            <span className="label">Commissioner note</span>
            <textarea className="input min-h-[72px]" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={m.placeholder} />
          </label>
          {kind === "force" && <Toggle checked={skip} onChange={setSkip} label="Ignore roster-limit and cap checks" />}
          <p className="text-[11px] text-muted">This action is recorded in the commissioner audit log.</p>
        </div>
      </Modal>
    </>
  );
}
