"use client";
// Manage your own trade block: players / picks you're shopping and positions you're looking for.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { addBlockEntryAction, removeBlockEntryAction, type ActionResult } from "@/lib/trades/actions";
import { fmtValue } from "@/lib/value/model";
import { cn } from "@/lib/utils";

export interface BlockOption {
  id: string;
  label: string;
  sub: string;
  value: number;
}

export function BlockEditor({ players, picks, positions, allowPicks }: { players: BlockOption[]; picks: BlockOption[]; positions: string[]; allowPicks: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asset, setAsset] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [pos, setPos] = useState(positions[0] ?? "");
  const [seekNote, setSeekNote] = useState("");
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(r.message ?? "Saved");
        after?.();
        router.refresh();
      }
    });
  return (
    <div className="grid gap-5 pt-1 md:grid-cols-2 md:gap-6">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!asset) return;
          const [kind, id] = asset.split(":");
          run(() => addBlockEntryAction({ kind: "OFFERING", playerId: kind === "P" ? id : null, pickId: kind === "K" ? id : null, note: offerNote || undefined }), () => {
            setAsset("");
            setOfferNote("");
          });
        }}
      >
        <div className="eyebrow">Shop a player or pick</div>
        <select className="input" value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Player or pick to shop">
          <option value="">Choose from your roster…</option>
          <optgroup label="Players">
            {players.map((p) => (
              <option key={p.id} value={`P:${p.id}`}>
                {p.label} — {p.sub} · value {fmtValue(p.value)}
              </option>
            ))}
          </optgroup>
          {allowPicks && picks.length > 0 && (
            <optgroup label="Draft picks">
              {picks.map((p) => (
                <option key={p.id} value={`K:${p.id}`}>
                  {p.label} — {p.sub}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <input className="input" maxLength={280} value={offerNote} onChange={(e) => setOfferNote(e.target.value)} placeholder="Asking price or note (optional)" aria-label="Note" />
        <button type="submit" disabled={!asset || pending} className={buttonClass("primary", "md", "w-full sm:w-auto")}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to block
        </button>
      </form>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pos) return;
          run(() => addBlockEntryAction({ kind: "SEEKING", position: pos, note: seekNote || undefined }), () => setSeekNote(""));
        }}
      >
        <div className="eyebrow">What you&apos;re looking for</div>
        <select className="input" value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Position needed">
          {positions.map((p) => (
            <option key={p} value={p}>
              {p === "PICKS" ? "Draft picks" : p}
            </option>
          ))}
        </select>
        <input className="input" maxLength={280} value={seekNote} onChange={(e) => setSeekNote(e.target.value)} placeholder="e.g. Young WR1 on a long contract" aria-label="Need note" />
        <button type="submit" disabled={!pos || pending} className={buttonClass("secondary", "md", "w-full sm:w-auto")}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add need
        </button>
      </form>
    </div>
  );
}

export function RemoveBlockEntry({ id, label, className }: { id: string; label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${label} from the trade block`}
      className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-loss disabled:opacity-50", className)}
      onClick={() =>
        start(async () => {
          const r = await removeBlockEntryAction(id);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success(r.message ?? "Removed");
            router.refresh();
          }
        })
      }
    >
      {pending ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
    </button>
  );
}
