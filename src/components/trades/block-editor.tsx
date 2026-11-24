"use client";
// Manage your own trade block: players / picks you're shopping and positions you're looking for.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { addBlockEntryAction, removeBlockEntryAction, type ActionResult } from "@/lib/trades/actions";
import { fmtValue } from "@/lib/value/model";

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
    <div className="grid gap-3 md:grid-cols-2">
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
        <div className="text-sm font-bold text-ink">Shop a player or pick</div>
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
        <button type="submit" disabled={!asset || pending} className={buttonClass("primary", "sm")}>
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
        <div className="text-sm font-bold text-ink">What you're looking for</div>
        <select className="input" value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Position needed">
          {positions.map((p) => (
            <option key={p} value={p}>
              {p === "PICKS" ? "Draft picks" : p}
            </option>
          ))}
        </select>
        <input className="input" maxLength={280} value={seekNote} onChange={(e) => setSeekNote(e.target.value)} placeholder="e.g. Young WR1 on a long contract" aria-label="Need note" />
        <button type="submit" disabled={!pos || pending} className={buttonClass("secondary", "sm")}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add need
        </button>
      </form>
    </div>
  );
}

export function RemoveBlockEntry({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${label} from the trade block`}
      className="rounded p-1 text-muted hover:bg-sunken hover:text-loss disabled:opacity-50"
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
      {pending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
    </button>
  );
}
