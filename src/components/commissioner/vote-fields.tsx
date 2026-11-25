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
    <div className={cn("rounded-lg bg-sunken p-3", className)} role="group" aria-label="League vote result">
      <div className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-ink sm:text-sm">
        <Vote size={15} aria-hidden /> League vote
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Yes votes</span>
          <NumberInput ariaLabel="Yes votes" value={value.yes} min={0} max={voters} int onChange={(n) => onChange({ ...value, yes: n })} />
        </label>
        <label className="block">
          <span className="label">No votes</span>
          <NumberInput ariaLabel="No votes" value={value.no} min={0} max={voters} int onChange={(n) => onChange({ ...value, no: n })} />
        </label>
      </div>
      <p className={cn("mt-2 text-[13px] font-semibold", o.error ? "text-loss" : "text-win")}>
        {o.error ? `${o.needed} of ${voters} yes votes needed (${threshold}%)` : `Passes: ${o.yes} of ${voters} (${o.pct}%)`}
      </p>
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
      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOpen(true)}>
        Revert to v{version}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Revert to version ${version}`}
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "lg", "sm:h-9 sm:px-4 sm:text-sm")} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary", "lg", "flex-1 sm:h-9 sm:flex-none sm:px-4 sm:text-sm")} disabled={pending || !ready} onClick={submit}>
              {pending && <Loader2 size={14} className="animate-spin" />} Revert to v{version}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Changes {sections.join(", ")} settings, which need a league vote in season. Saved as a new version, so it can be undone.
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
