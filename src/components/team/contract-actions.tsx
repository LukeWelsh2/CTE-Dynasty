"use client";
// Contract actions on /team/contracts: extend, franchise tag, rookie option — each with a cost/cap preview.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Loader2, Star, Tag } from "lucide-react";
import { Button } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { exerciseRookieOptionAction, extendContractAction, franchiseTagAction } from "@/lib/team/actions";
import type { ContractRow } from "@/lib/team/data";
import { cn, fmtMoney } from "@/lib/utils";

type Mode = "extend" | "tag" | "option" | null;

export function ContractActions({ teamId, row, enforced }: { teamId: string; row: ContractRow; enforced: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [years, setYears] = useState(1);
  const [pending, start] = useTransition();
  const ext = row.extension;
  const tag = row.tag;
  const opt = row.option;
  if (!ext && !tag && !opt) return null;

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) toast.error(res.error ?? "Something went wrong");
        else {
          toast.success(res.message ?? "Contract updated");
          setMode(null);
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });

  const chosen = ext?.options.find((o) => o.years === years) ?? ext?.options[0];
  const btn = "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <>
      <div className="flex justify-end gap-1">
        {ext && (
          <button type="button" className={cn(btn, "border-line bg-panel hover:bg-sunken")} disabled={!ext.ok} title={ext.ok ? "Add years to this contract" : ext.reason} onClick={() => { setYears(ext.options.find((o) => !enforced || o.capAfter >= 0)?.years ?? 1); setMode("extend"); }}>
            <CalendarPlus size={12} aria-hidden /><span className="hidden sm:inline">Extend</span><span className="sr-only sm:hidden">Extend {row.name}</span>
          </button>
        )}
        {tag && (
          <button type="button" className={cn(btn, "border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-200")} disabled={!tag.ok} title={tag.ok ? `Tag for ${fmtMoney(tag.salary)}` : tag.reason} onClick={() => setMode("tag")}>
            <Tag size={12} aria-hidden /><span className="hidden sm:inline">Tag</span><span className="sr-only sm:hidden">Franchise tag {row.name}</span>
          </button>
        )}
        {opt && (
          <button type="button" className={cn(btn, "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-200")} disabled={!opt.ok} title={opt.ok ? `Option year at ${fmtMoney(opt.salary)}` : opt.reason} onClick={() => setMode("option")}>
            <Star size={12} aria-hidden /><span className="hidden sm:inline">Option</span><span className="sr-only sm:hidden">Rookie option for {row.name}</span>
          </button>
        )}
      </div>

      <Modal
        open={mode === "extend" && !!ext}
        onClose={() => setMode(null)}
        title={`Extend ${row.name}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending || !chosen || (enforced && chosen.capAfter < 0)} onClick={() => run(() => extendContractAction({ teamId, playerId: row.playerId, years }))}>
              {pending && <Loader2 size={14} className="animate-spin" />} Extend {years} yr{years === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">
          Currently {fmtMoney(row.salary)} through {row.contractEnd}. The new salary applies immediately and to every added year.
        </p>
        <fieldset className="space-y-1.5">
          <legend className="label">Years to add</legend>
          {ext?.options.map((o) => {
            const blocked = enforced && o.capAfter < 0;
            return (
              <label key={o.years} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm", years === o.years ? "border-brand-500 bg-brand-50 dark:bg-brand-900/30" : "border-line", blocked && "cursor-not-allowed opacity-50")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="years" value={o.years} checked={years === o.years} disabled={blocked} onChange={() => setYears(o.years)} />
                  +{o.years} yr{o.years === 1 ? "" : "s"} <span className="text-muted">(through {row.contractEnd + o.years})</span>
                </span>
                <span className="text-right tabular-nums">
                  <b>{fmtMoney(o.salary)}</b>/yr
                  <span className={cn("block text-[11px]", o.capAfter < 0 ? "text-loss" : "text-muted")}>space after {fmtMoney(o.capAfter)}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </Modal>

      <Modal
        open={mode === "tag" && !!tag}
        onClose={() => setMode(null)}
        title={`Franchise tag ${row.name}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => run(() => franchiseTagAction({ teamId, playerId: row.playerId }))}>
              {pending && <Loader2 size={14} className="animate-spin" />} Apply tag
            </Button>
          </>
        }
      >
        {tag && <CostPreview from={row.salary} to={tag.salary} capAfter={tag.capAfter} note={`Keeps ${row.name} one more season (through ${row.contractEnd + 1}). Tagged players can't be extended.`} />}
      </Modal>

      <Modal
        open={mode === "option" && !!opt}
        onClose={() => setMode(null)}
        title={`Exercise ${row.name}'s rookie option?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => run(() => exerciseRookieOptionAction({ teamId, playerId: row.playerId }))}>
              {pending && <Loader2 size={14} className="animate-spin" />} Exercise option
            </Button>
          </>
        }
      >
        {opt && <CostPreview from={row.salary} to={opt.salary} capAfter={opt.capAfter} note={`Adds a final option year through ${row.contractEnd + 1}. It can only be exercised once.`} />}
      </Modal>
    </>
  );
}

function CostPreview({ from, to, capAfter, note }: { from: number; to: number; capAfter: number; note: string }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{note}</p>
      <div className="rounded-md border border-line bg-sunken/60 p-3">
        <div className="flex justify-between">
          <span className="text-muted">Salary</span>
          <span className="tabular-nums">
            {fmtMoney(from)} → <b>{fmtMoney(to)}</b>
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-muted">Cap space after</span>
          <span className={cn("font-bold tabular-nums", capAfter < 0 ? "text-loss" : "text-ink")}>{fmtMoney(capAfter)}</span>
        </div>
      </div>
    </div>
  );
}
