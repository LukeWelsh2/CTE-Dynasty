"use client";
// Per-player roster actions (IR, taxi, activate, promote, drop) with a dead-money preview before dropping.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, HeartPulse, Loader2, MoreHorizontal, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/core";
import { Dropdown, Modal } from "@/components/ui/client";
import { activateFromIrAction, dropPlayerAction, moveToIrAction, moveToTaxiAction, promoteFromTaxiAction } from "@/lib/team/actions";
import type { RosterRow } from "@/lib/team/types";
import { cn, fmtMoney } from "@/lib/utils";

type ActionFn = (i: { teamId: string; playerId: string }) => Promise<{ ok: boolean; message?: string; error?: string }>;

export function RosterActionsMenu({ teamId, row, salaryCapOn }: { teamId: string; row: RosterRow; salaryCapOn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dropOpen, setDropOpen] = useState(false);
  const a = row.actions;
  if (!a || row.rosterStatus === "GONE") return null;

  const run = (fn: ActionFn, after?: () => void) =>
    start(async () => {
      try {
        const res = await fn({ teamId, playerId: row.playerId });
        if (!res.ok) toast.error(res.error ?? "Something went wrong");
        else {
          toast.success(res.message ?? "Done");
          after?.();
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  const items: { key: string; label: string; icon: React.ReactNode; ok: boolean; reason?: string; onClick: () => void; danger?: boolean }[] = [];
  if (row.rosterStatus === "ACTIVE") {
    items.push({ key: "ir", label: "Move to IR", icon: <HeartPulse size={14} />, ok: a.ir.ok, reason: a.ir.reason, onClick: () => run(moveToIrAction) });
    items.push({ key: "taxi", label: "Move to taxi squad", icon: <Truck size={14} />, ok: a.taxi.ok, reason: a.taxi.reason, onClick: () => run(moveToTaxiAction) });
  }
  if (row.rosterStatus === "IR") items.push({ key: "act", label: "Activate from IR", icon: <ArrowUpFromLine size={14} />, ok: a.activate.ok, reason: a.activate.reason, onClick: () => run(activateFromIrAction) });
  if (row.rosterStatus === "TAXI") items.push({ key: "pro", label: "Promote to active roster", icon: <ArrowUpFromLine size={14} />, ok: a.promote.ok, reason: a.promote.reason, onClick: () => run(promoteFromTaxiAction) });
  items.push({ key: "drop", label: "Drop player…", icon: <Trash2 size={14} />, ok: a.drop.ok, reason: a.drop.reason, onClick: () => setDropOpen(true), danger: true });

  const deadNow = a.drop.dead.filter((d) => d.season === a.drop.dead[0]?.season).reduce((x, d) => x + d.amount, 0);
  const future = a.drop.dead.slice(1);

  return (
    <>
      <Dropdown
        align="right"
        className="min-w-[230px]"
        trigger={
          <button type="button" className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label={`Roster actions for ${row.name}`} disabled={pending}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : <MoreHorizontal size={16} />}
          </button>
        }
      >
        <div className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">{row.name}</div>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            disabled={!it.ok}
            title={it.ok ? undefined : it.reason}
            onClick={it.onClick}
            className={cn(
              "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-sunken disabled:cursor-not-allowed disabled:hover:bg-transparent",
              it.danger && it.ok && "text-loss",
              !it.ok && "text-muted",
            )}
          >
            <span className="mt-0.5">{it.icon}</span>
            <span className="min-w-0">
              <span className="block font-medium">{it.label}</span>
              {!it.ok && it.reason && <span className="block text-[11px] leading-snug">{it.reason}</span>}
            </span>
          </button>
        ))}
      </Dropdown>
      <Modal
        open={dropOpen}
        onClose={() => setDropOpen(false)}
        title={`Drop ${row.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDropOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => run(dropPlayerAction, () => setDropOpen(false))}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />} Drop player
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            <b>{row.name}</b> ({row.position}
            {row.nflTeam ? ` · ${row.nflTeam}` : ""}) will be released
            {a.drop.waiverHours !== null ? (
              <>
                {" "}and placed on waivers for <b>{a.drop.waiverHours} hours</b>.
              </>
            ) : (
              " to free agency."
            )}
          </p>
          {salaryCapOn && row.salary !== null && (
            <div className="rounded-md border border-line bg-sunken/60 p-3">
              <div className="flex justify-between">
                <span className="text-muted">Contract</span>
                <span className="font-semibold tabular-nums">
                  {fmtMoney(row.salary)} · {row.contractYears} yr{row.contractYears === 1 ? "" : "s"} left
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted">Dead money this season</span>
                <span className={cn("font-semibold tabular-nums", deadNow > 0 ? "text-loss" : "text-win")}>{fmtMoney(deadNow)}</span>
              </div>
              {future.length > 0 && (
                <div className="mt-1 flex justify-between">
                  <span className="text-muted">Future dead money</span>
                  <span className="text-right font-semibold tabular-nums text-loss">{future.map((d) => `${fmtMoney(d.amount)} (${d.season})`).join(", ")}</span>
                </div>
              )}
              {a.drop.capAfter !== null && (
                <div className="mt-2 flex justify-between border-t border-line pt-2">
                  <span className="text-muted">Cap space after drop</span>
                  <span className="font-bold tabular-nums text-ink">{fmtMoney(a.drop.capAfter)}</span>
                </div>
              )}
            </div>
          )}
          {deadNow > 0 && (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Dead money counts against your cap for every season listed above.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
