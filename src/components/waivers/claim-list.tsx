"use client";
// My pending waiver claims: rank (up/down), edit bid, change drop, cancel. Own team only (server-enforced).
// v3 / phones: one block per claim — order number with 32px up/down buttons, the player (position pill, name, team),
// what he signs for, then a 40px bid field + Save and a full-width drop picker; cancel is a labelled 40px icon button.
import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { InjuryLetter, PosPill } from "@/components/ui/fantasy";
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
  const over = total > balance;
  return (
    <div>
      {fab && (
        <div
          className={cn(
            "mx-4 mb-2 rounded-xl px-3 py-2 text-[13px] leading-[18px]",
            over ? "bg-amber-400/15 text-amber-900 dark:text-amber-200" : "bg-sunken text-muted",
          )}
        >
          <span className="numeral">
            Pending bids <b className="text-ink">${total}</b> · FAB left <b className="text-ink">${balance}</b>
          </span>
          {over && <span className="mt-0.5 block">Bids above your balance fail once earlier claims spend it — claims process in your order.</span>}
        </div>
      )}
      <ol className="divide-y divide-line/70 border-t border-line/70">
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
  const arrow = "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30";
  return (
    <li className="flex gap-3 px-4 py-3">
      {/* claim order */}
      <div className="flex w-8 shrink-0 flex-col items-center">
        <button type="button" aria-label={`Move ${p.fullName} up`} disabled={pending || index === 0} onClick={() => run(() => moveClaimAction({ claimId: claim.id, dir: "up" }))} className={arrow}>
          <ArrowUp size={16} />
        </button>
        <span className="numeral py-0.5 text-[17px] font-semibold leading-6 text-ink" title="Your claim order">
          {index + 1}
        </span>
        <button type="button" aria-label={`Move ${p.fullName} down`} disabled={pending || index === count - 1} onClick={() => run(() => moveClaimAction({ claimId: claim.id, dir: "down" }))} className={arrow}>
          <ArrowDown size={16} />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link href={`/players/${p.id}`} title={p.fullName} className="truncate text-[15px] font-semibold leading-5 text-ink hover:underline">
                {p.fullName}
              </Link>
              <InjuryLetter status={p.injuryStatus} className="text-[13px]" />
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
              <PosPill pos={p.position} />
              <span className="numeral min-w-0 truncate">
                {p.position === "DEF" ? "" : `${p.team ?? "FA"} · `}signs ${salary} / {contractYears} yr{contractYears === 1 ? "" : "s"}
              </span>
            </div>
            {claim.processAtLabel && <div className="mt-0.5 truncate text-[12px] leading-4 text-muted">Processes {claim.processAtLabel}</div>}
          </div>
          {pending && <Loader2 size={16} className="mt-2 shrink-0 animate-spin text-muted" aria-hidden />}
          <button
            type="button"
            aria-label={`Cancel claim for ${p.fullName}`}
            title="Cancel claim"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Cancel your claim for ${p.fullName}?`)) return;
              run(() => cancelWaiverClaimAction({ claimId: claim.id }));
            }}
            className="-mr-2 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-loss transition-colors hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 size={17} />
          </button>
        </div>

        <div className="mt-2.5 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3">
          {fab && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty) run(() => updateClaimAction({ claimId: claim.id, bid: n }));
              }}
            >
              <label className="flex items-center gap-2">
                <span className="w-9 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted sm:w-auto">Bid</span>
                <span className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={minBid}
                    max={balance}
                    step={bidStep}
                    value={bid}
                    onChange={(e) => setBid(e.target.value)}
                    aria-label={`FAB bid for ${p.fullName}`}
                    aria-invalid={!valid}
                    className={cn("input numeral h-10 w-24 pl-6 text-right sm:h-9", !valid && "border-loss focus:border-loss")}
                  />
                </span>
              </label>
              {dirty && (
                <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
                  Save
                </button>
              )}
              {!valid && bid !== "" && <span className="numeral text-[13px] text-loss">${minBid}–${balance}</span>}
            </form>
          )}
          <label className="flex min-w-0 items-center gap-2">
            <span className="w-9 shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted sm:w-auto">Drop</span>
            <select
              value={claim.dropPlayerId ?? ""}
              disabled={pending}
              aria-label={`Player to drop if ${p.fullName} is claimed`}
              onChange={(e) => run(() => updateClaimAction({ claimId: claim.id, dropPlayerId: e.target.value || null }))}
              className="input h-10 min-w-0 flex-1 sm:h-9"
            >
              <option value="">No drop (roster room needed)</option>
              {dropOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </li>
  );
}
