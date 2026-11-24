"use client";
// My pending waiver claims: rank (up/down), edit bid, change drop, cancel. Own team only (server-enforced).
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InjuryTag, PosBadge, buttonClass } from "@/components/ui/core";
import { cancelWaiverClaimAction, moveClaimAction, updateClaimAction } from "@/lib/waivers/actions";
import { cn } from "@/lib/utils";

export interface ClaimItem {
  id: string;
  priority: number;
  player: { id: string; fullName: string; position: string; team: string | null; injuryStatus: string | null };
  dropPlayerId: string | null;
  bid: number;
  processAtLabel: string | null;
}

export interface DropOption {
  id: string;
  label: string;
  status: string;
}

export interface SalaryRule {
  equalsBid: boolean;
  multiplier: number;
  min: number;
  max: number | null;
}

function salaryFor(rule: SalaryRule, bid: number, fab: boolean) {
  let s = rule.equalsBid && fab ? Math.round(bid * (rule.multiplier || 1)) : rule.min;
  s = Math.max(rule.min, s);
  if (rule.max !== null) s = Math.min(rule.max, s);
  return s;
}

type Result = { ok: true; message?: string } | { ok: false; error: string };

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, success?: string) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error);
        else if (r.message || success) toast.success(r.message || success!);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

export function ClaimList({
  claims,
  fab,
  minBid,
  bidStep = 1,
  balance,
  dropOptions,
  salaryRule,
  contractYears,
}: {
  claims: ClaimItem[];
  fab: boolean;
  minBid: number;
  bidStep?: number;
  balance: number;
  dropOptions: DropOption[];
  salaryRule: SalaryRule;
  contractYears: number;
}) {
  const total = claims.reduce((a, c) => a + c.bid, 0);
  return (
    <div>
      {fab && (
        <div className={cn("mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs", total > balance ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100" : "border-line bg-sunken text-muted")}>
          <span>
            Pending bids <b className="tabular-nums text-ink">${total}</b> · FAB remaining <b className="tabular-nums text-ink">${balance}</b>
          </span>
          {total > balance && <span>Bids above your balance fail once earlier claims spend it — claims process in your order.</span>}
        </div>
      )}
      <ol className="divide-y divide-line overflow-hidden rounded-md border border-line">
        {claims.map((c, i) => (
          <ClaimRow key={c.id} claim={c} index={i} count={claims.length} fab={fab} minBid={minBid} bidStep={bidStep} balance={balance} dropOptions={dropOptions} salaryRule={salaryRule} contractYears={contractYears} />
        ))}
      </ol>
    </div>
  );
}

function ClaimRow({
  claim,
  index,
  count,
  fab,
  minBid,
  bidStep = 1,
  balance,
  dropOptions,
  salaryRule,
  contractYears,
}: {
  claim: ClaimItem;
  index: number;
  count: number;
  fab: boolean;
  minBid: number;
  bidStep?: number;
  balance: number;
  dropOptions: DropOption[];
  salaryRule: SalaryRule;
  contractYears: number;
}) {
  const [bid, setBid] = useState(String(claim.bid));
  const { pending, run } = useRun();
  const n = Number(bid);
  const valid = bid !== "" && Number.isInteger(n) && n >= minBid && n <= balance && n % bidStep === 0;
  const dirty = valid && n !== claim.bid;
  const salary = salaryFor(salaryRule, valid ? n : claim.bid, fab);
  const p = claim.player;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 bg-panel px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          aria-label={`Move ${p.fullName} up`}
          disabled={pending || index === 0}
          onClick={() => run(() => moveClaimAction({ claimId: claim.id, dir: "up" }))}
          className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
        >
          <ArrowUp size={14} />
        </button>
        <span className="font-display text-base font-bold tabular-nums text-ink" title="Your claim order">
          {index + 1}
        </span>
        <button
          type="button"
          aria-label={`Move ${p.fullName} down`}
          disabled={pending || index === count - 1}
          onClick={() => run(() => moveClaimAction({ claimId: claim.id, dir: "down" }))}
          className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
        >
          <ArrowDown size={14} />
        </button>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <PosBadge pos={p.position} />
          <Link href={`/players/${p.id}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {p.fullName}
          </Link>
          <InjuryTag status={p.injuryStatus} />
        </div>
        <div className="mt-0.5 text-[11px] text-muted">
          {p.team ?? "FA"} · signs ${salary} / {contractYears} yr{contractYears === 1 ? "" : "s"}
          {claim.processAtLabel && <> · processes {claim.processAtLabel}</>}
        </div>
      </div>

      <div className="row-start-1 col-start-3 flex items-center justify-end gap-1 sm:col-start-5">
        {pending && <Loader2 size={14} className="animate-spin text-muted" />}
        <button
          type="button"
          aria-label={`Cancel claim for ${p.fullName}`}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Cancel your claim for ${p.fullName}?`)) return;
            run(() => cancelWaiverClaimAction({ claimId: claim.id }));
          }}
          className={buttonClass("ghost", "sm", "text-loss hover:bg-red-50 dark:hover:bg-red-900/20")}
        >
          <Trash2 size={14} />
          <span className="hidden lg:inline">Cancel</span>
        </button>
      </div>

      {fab ? (
        <form
          className="col-span-3 flex items-center gap-1.5 sm:col-span-1 sm:col-start-3 sm:row-start-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) run(() => updateClaimAction({ claimId: claim.id, bid: n }));
          }}
        >
          <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
            <span>Bid</span>
            <span className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                type="number"
                inputMode="numeric"
                min={minBid}
                max={balance}
                step={bidStep}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                aria-label={`FAB bid for ${p.fullName}`}
                className={cn("input h-8 w-20 py-1 pl-5 text-right tabular-nums", !valid && "border-loss focus:border-loss")}
              />
            </span>
          </label>
          {dirty && (
            <button type="submit" disabled={pending} className={buttonClass("primary", "xs")}>
              Save
            </button>
          )}
          {!valid && bid !== "" && <span className="text-[11px] text-loss">${minBid}–${balance}</span>}
        </form>
      ) : (
        <div className="hidden sm:col-start-3 sm:row-start-1 sm:block" />
      )}

      <label className="col-span-3 flex min-w-0 items-center gap-1.5 sm:col-span-1 sm:col-start-4 sm:row-start-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Drop</span>
        <select
          value={claim.dropPlayerId ?? ""}
          disabled={pending}
          aria-label={`Player to drop if ${p.fullName} is claimed`}
          onChange={(e) => run(() => updateClaimAction({ claimId: claim.id, dropPlayerId: e.target.value || null }))}
          className="input h-8 min-w-0 flex-1 py-1 text-xs"
        >
          <option value="">No drop (roster room needed)</option>
          {dropOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}
