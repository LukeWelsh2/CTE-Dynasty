"use client";
// Free-agency actions for any player row / card: Add, Claim (FAB bid), Drop (dead money preview), Trade, Watch.
// Dialogs load a fresh quote from /api/players/[id]/quote so cap, roster and FAB numbers are always current.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeftRight, Clock, Loader2, Lock, Minus, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/client";
import { Alert, Badge, InjuryTag, PlayerHeadshot, PosBadge, buttonClass } from "@/components/ui/core";
import { acquirePlayerAction, cancelClaimAction, dropPlayerAction, toggleWatchAction } from "@/lib/players/actions";
import type { PlayerQuote } from "@/lib/players/acquire";
import { cn } from "@/lib/utils";

type ActionKind = "add" | "claim" | "blocked" | "drop" | "trade" | null;

export interface PlayerActionProps {
  playerId: string;
  playerName: string;
  action: ActionKind;
  blockedReason?: string | null;
  pendingClaim?: { id: string; bid: number } | null;
  ownerTeamId?: string | null;
  size?: "xs" | "sm";
  className?: string;
  /** called after a successful add / claim / drop */
  onDone?: () => void;
}

/** Primary action button for a player (table cell, card or profile header) */
export function PlayerActionButton({ playerId, playerName, action, blockedReason, pendingClaim, ownerTeamId, size = "xs", className, onDone }: PlayerActionProps) {
  const [open, setOpen] = useState<"acquire" | "drop" | null>(null);
  if (!action) return null;
  const sz = size === "xs" ? "h-7 px-2 text-[11px]" : "";
  if (action === "trade")
    return (
      <Link href={`/trades/new?team=${ownerTeamId}&player=${playerId}`} className={buttonClass("secondary", size, cn(sz, className))} aria-label={`Propose a trade for ${playerName}`}>
        <ArrowLeftRight size={12} /> Trade
      </Link>
    );
  if (action === "blocked")
    return (
      <span title={blockedReason ?? "Unavailable"} className={buttonClass("secondary", size, cn(sz, "cursor-not-allowed opacity-60", className))} aria-label={`${playerName} is locked: ${blockedReason ?? ""}`}>
        <Lock size={12} /> Locked
      </span>
    );
  return (
    <>
      {action === "drop" ? (
        <button type="button" onClick={() => setOpen("drop")} className={buttonClass("secondary", size, cn(sz, "text-loss", className))} aria-label={`Drop ${playerName}`}>
          <Minus size={12} /> Drop
        </button>
      ) : action === "claim" ? (
        <button type="button" onClick={() => setOpen("acquire")} className={buttonClass("gold", size, cn(sz, className))} aria-label={`Claim ${playerName}`}>
          <Clock size={12} /> {pendingClaim ? (pendingClaim.bid > 0 ? `Claim $${pendingClaim.bid}` : "Claim placed") : "Claim"}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen("acquire")} className={buttonClass("success", size, cn(sz, className))} aria-label={`Add ${playerName}`}>
          <Plus size={12} /> Add
        </button>
      )}
      {open === "acquire" && <AcquireDialog playerId={playerId} onClose={() => setOpen(null)} onDone={onDone} />}
      {open === "drop" && <DropDialog playerId={playerId} onClose={() => setOpen(null)} onDone={onDone} />}
    </>
  );
}

function useQuote(playerId: string) {
  const [quote, setQuote] = useState<PlayerQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/players/${encodeURIComponent(playerId)}/quote`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load player");
        if (alive) setQuote(j as PlayerQuote);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [playerId]);
  return { quote, error };
}

function money(n: number) {
  return `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n))}`;
}

function DialogHeader({ q }: { q: PlayerQuote }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <PlayerHeadshot player={q.player} size={48} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-display text-lg font-bold">{q.player.fullName}</span>
          <InjuryTag status={q.player.injuryStatus} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <PosBadge pos={q.player.position} /> {q.player.team ?? "Free agent (NFL)"}
        </div>
      </div>
    </div>
  );
}

export function AcquireDialog({ playerId, onClose, onDone }: { playerId: string; onClose: () => void; onDone?: () => void }) {
  const { quote: q, error } = useQuote(playerId);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [bid, setBid] = useState<string>("");
  const [dropId, setDropId] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  useEffect(() => {
    if (!q || inited) return;
    setInited(true);
    if (q.existingClaim) {
      setBid(String(q.existingClaim.bid));
      setDropId(q.existingClaim.dropPlayerId);
    } else setBid(String(q.fab.min));
  }, [q, inited]);

  const isClaim = q?.mode === "claim";
  const usesFab = !!q && isClaim && q.fab.enabled;
  const bidNum = usesFab ? Number(bid) : 0;
  const step = q?.fab.step ?? 1;
  const bidValid = !usesFab || (bid.trim() !== "" && Number.isInteger(bidNum) && bidNum >= (q?.fab.min ?? 0) && bidNum <= (q?.fab.balance ?? 0) && bidNum % step === 0);
  const pendingTotal = usesFab && q ? q.fab.pendingBids + (Number.isFinite(bidNum) ? bidNum : 0) : 0;
  const salary = useMemo(() => {
    if (!q) return 0;
    const r = q.salaryRule;
    let s = r.equalsBid ? Math.round((Number.isFinite(bidNum) ? bidNum : 0) * r.multiplier) : r.min;
    s = Math.max(r.min, s);
    if (r.max !== null) s = Math.min(r.max, s);
    return s;
  }, [q, bidNum]);
  const drop = q?.dropCandidates.find((d) => d.id === dropId) ?? null;
  const dropDeadNow = drop ? drop.deadMoney.filter((d) => d.season === q!.season).reduce((a, d) => a + d.amount, 0) : 0;
  const capAfter = q ? q.cap.space - salary + (drop?.capHit ?? 0) - dropDeadNow : 0;
  const activeAfter = q ? q.roster.active + 1 - (drop?.status === "ACTIVE" ? 1 : 0) : 0;
  const needsDrop = !!q && activeAfter > q.roster.max;
  const overCap = !!q && q.cap.enforced && capAfter < 0;
  const canSubmit = !!q && (q.mode === "add" || q.mode === "claim") && !q.blockers.length && bidValid && !needsDrop && !overCap && !drop?.locked;

  const submit = () =>
    start(async () => {
      const res = await acquirePlayerAction({ playerId, dropPlayerId: dropId, bid: usesFab ? bidNum : undefined });
      if (res.ok) {
        toast.success(res.message ?? "Done");
        onClose();
        onDone?.();
        router.refresh();
      } else toast.error(res.error);
    });

  const cancel = () =>
    start(async () => {
      if (!q?.existingClaim) return;
      const res = await cancelClaimAction({ claimId: q.existingClaim.id });
      if (res.ok) {
        toast.success(res.message ?? "Claim cancelled");
        onClose();
        onDone?.();
        router.refresh();
      } else toast.error(res.error);
    });

  const title = !q ? "Player" : q.mode === "claim" ? (q.existingClaim ? "Edit waiver claim" : "Place waiver claim") : "Add player";
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        q && (q.mode === "add" || q.mode === "claim") ? (
          <>
            {q.existingClaim && (
              <button type="button" onClick={cancel} disabled={pending} className={buttonClass("ghost", "md", "mr-auto text-loss")}>
                Cancel claim
              </button>
            )}
            <button type="button" onClick={onClose} className={buttonClass("secondary")}>
              Close
            </button>
            <button type="button" onClick={submit} disabled={!canSubmit || pending} className={buttonClass(isClaim ? "gold" : "success")}>
              {pending && <Loader2 size={14} className="animate-spin" />}
              {isClaim ? (q.existingClaim ? "Update claim" : "Place claim") : "Add player"}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className={buttonClass("secondary")}>
            Close
          </button>
        )
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!q && !error && (
        <div className="flex items-center justify-center py-10 text-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      )}
      {q && (
        <div className="space-y-3 text-sm">
          <DialogHeader q={q} />
          {q.blockers.map((b) => (
            <Alert key={b} tone="error">
              {b}
            </Alert>
          ))}
          {q.mode === "owned" && <Alert tone="info">{q.player.fullName} is on {q.owner?.name}. Propose a trade instead.</Alert>}
          {q.mode === "mine" && <Alert tone="info">{q.player.fullName} is already on your roster.</Alert>}
          {q.mode === "blocked" && <Alert tone="warn">{q.reason}</Alert>}
          {q.mode === "add" && <Alert tone="success">Free agent — he joins your roster immediately.</Alert>}
          {q.mode === "claim" && (
            <Alert tone="warn">
              <b>Waiver claim.</b> {q.reason}. Claims process{" "}
              {q.processAtLabel ?? "at the next waiver run"}
              {q.fab.enabled ? "; the highest bid wins." : " in waiver priority order."}
              {q.existingClaim && <div className="mt-1">You already have a pending claim on him{q.fab.enabled ? ` ($${q.existingClaim.bid})` : ""}. Saving replaces it.</div>}
            </Alert>
          )}

          {(q.mode === "add" || q.mode === "claim") && (
            <>
              {usesFab && (
                <label className="block">
                  <span className="label">FAB bid</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">$</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={q.fab.min}
                      max={q.fab.balance}
                      step={step}
                      value={bid}
                      onChange={(e) => setBid(e.target.value)}
                      className={cn("input w-28", !bidValid && "border-loss focus:border-loss")}
                      aria-invalid={!bidValid}
                      aria-describedby="fab-bid-help"
                    />
                    <span id="fab-bid-help" className="text-xs text-muted">
                      Balance ${q.fab.balance} · min ${q.fab.min}
                      {step > 1 ? ` · $${step} steps` : ""}
                    </span>
                  </div>
                  {!bidValid && (
                    <span className="mt-1 block text-xs text-loss">
                      Enter a bid between ${q.fab.min} and ${q.fab.balance}
                      {step > 1 ? ` in $${step} increments` : " (whole dollars)"}.
                    </span>
                  )}
                  {bidValid && pendingTotal > q.fab.balance && (
                    <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                      Your pending bids would total ${pendingTotal} — more than your ${q.fab.balance}. Lower-ranked claims fail if earlier ones win.
                    </span>
                  )}
                </label>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Mini label="Salary" value={money(salary)} sub={q.salaryRule.equalsBid ? `bid × ${q.salaryRule.multiplier}` : "league minimum"} />
                <Mini label="Contract" value={`${q.contractYears} yr${q.contractYears === 1 ? "" : "s"}`} sub={`thru ${q.season + q.contractYears - 1}`} />
                <Mini
                  label="Cap space after"
                  value={q.cap.enabled ? money(capAfter) : "—"}
                  sub={q.cap.enabled ? `now ${money(q.cap.space)}` : "no cap"}
                  tone={overCap ? "bad" : undefined}
                />
                <Mini label="Active roster" value={`${Math.min(activeAfter, 999)}/${q.roster.max}`} sub={`now ${q.roster.active}`} tone={needsDrop ? "bad" : undefined} />
              </div>
              {(q.limits.weekMax !== null || q.limits.seasonMax !== null) && (
                <p className="text-xs text-muted">
                  Acquisitions used:{" "}
                  {q.limits.weekMax !== null && (
                    <span>
                      {q.limits.weekUsed}/{q.limits.weekMax} this week
                    </span>
                  )}
                  {q.limits.weekMax !== null && q.limits.seasonMax !== null && " · "}
                  {q.limits.seasonMax !== null && (
                    <span>
                      {q.limits.seasonUsed}/{q.limits.seasonMax} this season
                    </span>
                  )}
                </p>
              )}
              {q.addFee > 0 && (
                <p className="text-xs text-muted">
                  League fee: <b className="text-ink">${q.addFee}</b> per add{isClaim ? " (charged only if the claim wins)" : ""}, collected with dues.
                </p>
              )}

              <DropPicker q={q} value={dropId} onChange={setDropId} required={q.roster.full} />
              {needsDrop && <Alert tone="error">Your active roster is full ({q.roster.max}). Choose an active player to drop.</Alert>}
              {overCap && <Alert tone="error">This move puts you {money(-capAfter)} over the ${q.cap.cap} salary cap. Drop a bigger contract to make room.</Alert>}
              {drop?.locked && (
                <Alert tone="error">
                  {drop.fullName} can&apos;t be dropped: {(drop.lockReason ?? "locked").toLowerCase()}.
                </Alert>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "bad" }) {
  return (
    <div className={cn("rounded-md border border-line bg-sunken/60 px-2.5 py-2", tone === "bad" && "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20")}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("font-display text-lg font-bold tabular-nums", tone === "bad" && "text-loss")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function DropPicker({ q, value, onChange, required }: { q: PlayerQuote; value: string | null; onChange: (v: string | null) => void; required: boolean }) {
  const order = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
  const list = [...q.dropCandidates].sort((a, b) => rank(a.position) - rank(b.position) || b.salary - a.salary);
  return (
    <fieldset>
      <legend className="label">{required ? "Drop a player (required — roster full)" : "Drop a player (optional)"}</legend>
      <div className="scroll-thin max-h-60 overflow-y-auto rounded-md border border-line">
        {!required && (
          <label className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 hover:bg-sunken">
            <input type="radio" name="drop" checked={value === null} onChange={() => onChange(null)} />
            <span className="text-muted">No drop</span>
          </label>
        )}
        {list.map((d) => {
          const deadNow = d.deadMoney.filter((x) => x.season === q.season).reduce((a, x) => a + x.amount, 0);
          const deadTotal = d.deadMoney.reduce((a, x) => a + x.amount, 0);
          return (
            <label
              key={d.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 border-b border-line/70 px-3 py-1.5 last:border-b-0 hover:bg-sunken",
                value === d.id && "bg-brand-50 dark:bg-brand-900/30",
                d.locked && "cursor-not-allowed opacity-50",
              )}
            >
              <input type="radio" name="drop" disabled={d.locked} checked={value === d.id} onChange={() => onChange(d.id)} aria-label={`Drop ${d.fullName}`} />
              <PosBadge pos={d.position} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate font-medium">
                  {d.fullName} <InjuryTag status={d.injuryStatus} />
                  {d.status !== "ACTIVE" && <Badge>{d.status}</Badge>}
                  {d.locked && <Lock size={11} className="text-muted" aria-label="locked" />}
                </span>
                <span className="block text-[11px] text-muted">
                  {d.team ?? "FA"} · ${d.salary} · {d.contractYears} yr{d.contractYears === 1 ? "" : "s"}
                  {d.lockReason && ` · ${d.lockReason}`}
                </span>
              </span>
              <span className={cn("text-right text-[11px] tabular-nums", deadTotal ? "text-loss" : "text-muted")}>
                {deadTotal ? (
                  <>
                    ${deadNow} dead
                    {deadTotal > deadNow && <span className="block">${deadTotal} total</span>}
                  </>
                ) : (
                  "no dead $"
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function DropDialog({ playerId, onClose, onDone }: { playerId: string; onClose: () => void; onDone?: () => void }) {
  const { quote: q, error } = useQuote(playerId);
  const router = useRouter();
  const [pending, start] = useTransition();
  const dead = q?.drop?.deadMoney ?? [];
  const deadNow = dead.filter((d) => d.season === q?.season).reduce((a, d) => a + d.amount, 0);
  const submit = () =>
    start(async () => {
      const res = await dropPlayerAction({ playerId });
      if (res.ok) {
        toast.success(res.message ?? "Dropped");
        onClose();
        onDone?.();
        router.refresh();
      } else toast.error(res.error);
    });
  return (
    <Modal
      open
      onClose={onClose}
      title="Drop player"
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className={buttonClass("secondary")}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!q || q.mode !== "mine" || !!q.drop?.blocked || pending} className={buttonClass("danger")}>
            {pending && <Loader2 size={14} className="animate-spin" />} Drop player
          </button>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!q && !error && (
        <div className="flex items-center justify-center py-10 text-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      )}
      {q && (
        <div className="space-y-3 text-sm">
          <DialogHeader q={q} />
          {q.mode !== "mine" && <Alert tone="error">{q.player.fullName} is not on your roster.</Alert>}
          {q.drop?.blocked && <Alert tone="error">{q.drop.blocked}</Alert>}
          {q.owner && (
            <p>
              Contract: <b>${q.owner.salary}</b> · {q.owner.contractYears} yr{q.owner.contractYears === 1 ? "" : "s"} (thru {q.season + q.owner.contractYears - 1})
            </p>
          )}
          {dead.length ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-loss">Dead money</div>
              <ul className="space-y-0.5 tabular-nums">
                {dead.map((d) => (
                  <li key={d.season} className="flex justify-between">
                    <span>{d.season}</span>
                    <span className="font-semibold">${d.amount}</span>
                  </li>
                ))}
              </ul>
              {q.cap.enabled && <p className="mt-2 text-xs text-muted">Cap space this season after the drop: {money(q.cap.space + (q.drop?.capHit ?? 0) - deadNow)}</p>}
            </div>
          ) : (
            <Alert tone="success">No dead money — this contract can be released for free.</Alert>
          )}
          <p className="text-xs text-muted">
            {q.waiverHours > 0
              ? `He goes on waivers for ${q.waiverHours} hours after the drop; other teams claim him through the next waiver run after that.`
              : "He becomes a free agent immediately after the drop."}
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Watch-list star toggle */
export function WatchStar({ playerId, watched: initial, playerName, className }: { playerId: string; watched: boolean; playerName: string; className?: string }) {
  const [watched, setWatched] = useState(initial);
  const [pending, start] = useTransition();
  useEffect(() => setWatched(initial), [initial]);
  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? `Remove ${playerName} from watch list` : `Add ${playerName} to watch list`}
      title={watched ? "On your watch list" : "Add to watch list"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setWatched((w) => !w);
          const res = await toggleWatchAction({ playerId });
          if (!res.ok) {
            setWatched((w) => !w);
            toast.error(res.error);
          } else if (typeof res.watched === "boolean") setWatched(res.watched);
        })
      }
      className={cn("rounded p-1 text-muted transition-colors hover:text-gold-500", watched && "text-gold-500", className)}
    >
      <Star size={15} fill={watched ? "currentColor" : "none"} />
    </button>
  );
}
