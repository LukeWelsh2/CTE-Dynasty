"use client";
// Yes / no vote inputs for in-season rule changes that need a league vote
// (settings.commissioner.sectionsRequiringVote + voteThresholdPercent).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { voteOutcome } from "@/lib/commissioner/settings-logic";
import { revertSettingsVersion } from "@/lib/commissioner/settings-actions";
import { NumberInput } from "./fields";

export interface VoteValue {
  yes: number;
  no: number;
}

export function voteReady(v: VoteValue, voters: number, threshold: number): boolean {
  return Number.isInteger(v.yes) && Number.isInteger(v.no) && !voteOutcome(v, voters, threshold).error;
}

export function VoteFields({ value, onChange, voters, threshold, className }: { value: VoteValue; onChange: (v: VoteValue) => void; voters: number; threshold: number; className?: string }) {
  const valid = Number.isInteger(value.yes) && Number.isInteger(value.no);
  const o = voteOutcome({ yes: valid ? value.yes : 0, no: valid ? value.no : 0 }, voters, threshold);
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)} role="group" aria-label="League vote result">
      <span className="inline-flex items-center gap-1 font-semibold text-ink">
        <Vote size={13} aria-hidden /> League vote
      </span>
      <label className="inline-flex items-center gap-1">
        <span className="text-muted">Yes</span>
        <NumberInput ariaLabel="Yes votes" value={value.yes} min={0} max={voters} int className="w-16" onChange={(n) => onChange({ ...value, yes: n })} />
      </label>
      <label className="inline-flex items-center gap-1">
        <span className="text-muted">No</span>
        <NumberInput ariaLabel="No votes" value={value.no} min={0} max={voters} int className="w-16" onChange={(n) => onChange({ ...value, no: n })} />
      </label>
      <span className={cn("font-semibold", o.error ? "text-loss" : "text-win")}>
        {o.error ? `${o.needed} of ${voters} yes votes needed (${threshold}%)` : `Passes: ${o.yes} of ${voters} (${o.pct}%)`}
      </span>
    </div>
  );
}

/** "Revert to vN" for a version whose revert touches sections that need an in-season league vote. */
export function RevertWithVote({ historyId, version, currentVersion, sections, voters, threshold }: { historyId: string; version: number; currentVersion: number; sections: string[]; voters: number; threshold: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vote, setVote] = useState<VoteValue>({ yes: 0, no: 0 });
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const ready = voteReady(vote, voters, threshold);
  const submit = () =>
    start(async () => {
      const r = await revertSettingsVersion({ historyId, expectedVersion: currentVersion, vote, note: note.trim() || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Reverted");
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <button type="button" className={buttonClass("secondary", "xs")} onClick={() => setOpen(true)}>
        Revert to v{version}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Revert to version ${version}`}
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary", "sm")} disabled={pending || !ready} onClick={submit}>
              {pending && <Loader2 size={13} className="animate-spin" />} Revert
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            This revert changes {sections.join(", ")} settings, which need a league vote during the season. Record the result ({threshold}% of {voters} managers must vote yes). The revert is
            saved as a new version, so it can be undone too.
          </p>
          <VoteFields value={vote} onChange={setVote} voters={voters} threshold={threshold} />
          <label className="block">
            <span className="label">Note (optional)</span>
            <input className="input" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder={`Reverted to version ${version}`} />
          </label>
        </div>
      </Modal>
    </>
  );
}
