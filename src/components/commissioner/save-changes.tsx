"use client";
// The settings / scoring editors' save flow. While there are unsaved changes a bar floats above the phone tab bar
// (sticky at the bottom of the form on md+): "3 changes" · Reset · Review & save. "Review & save" opens a sheet
// with the list of changes, the extra inputs the save needs (league vote, re-score mode), a history note and the
// "notify managers" switch, and the final Save button.
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { buttonClass, StickyActionBar } from "@/components/ui/core";
import { Modal, Toggle } from "@/components/ui/client";
import { cn } from "@/lib/utils";

export function SaveChangesBar({
  count,
  issues,
  pending,
  title,
  saveLabel,
  changes,
  note,
  onNote,
  notify,
  onNotify,
  onReset,
  onSave,
  saveDisabled,
  children,
}: {
  /** number of unsaved changes (0 hides the bar) */
  count: number;
  /** validation problems that block saving */
  issues: number;
  pending: boolean;
  /** sheet title ("Save roster settings") */
  title: string;
  saveLabel: string;
  /** readable list of the changes ("Bench spots: 14 → 15") */
  changes: string[];
  note: string;
  onNote: (v: string) => void;
  notify: boolean;
  onNotify: (v: boolean) => void;
  onReset: () => void;
  onSave: () => void;
  /** the final Save stays disabled (e.g. the league vote doesn't pass yet) */
  saveDisabled?: boolean;
  /** extra inputs in the sheet (vote fields, apply mode) */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <StickyActionBar label="Unsaved changes" innerClassName="flex-nowrap justify-between gap-2">
        <div className="min-w-0 flex-1 text-[15px] leading-5 sm:text-sm">
          <span className="font-semibold text-ink">
            {count} change{count === 1 ? "" : "s"}
          </span>
          {issues > 0 ? <span className="block truncate text-[13px] font-semibold text-loss">{issues} to fix first</span> : <span className="block truncate text-[13px] text-muted">Not saved yet</span>}
        </div>
        <button type="button" className={buttonClass("secondary", "md", "shrink-0 px-3")} onClick={onReset} disabled={pending}>
          <RotateCcw size={14} aria-hidden /> Reset
        </button>
        <button type="button" className={buttonClass("primary", "md", "shrink-0")} onClick={() => setOpen(true)} disabled={pending || issues > 0}>
          Review &amp; save
        </button>
      </StickyActionBar>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "lg", "sm:h-9 sm:px-4 sm:text-sm")} onClick={() => setOpen(false)}>
              Keep editing
            </button>
            <button type="button" className={buttonClass("primary", "lg", "flex-1 sm:h-9 sm:flex-none sm:px-4 sm:text-sm")} onClick={onSave} disabled={pending || issues > 0 || saveDisabled}>
              {pending && <Loader2 size={15} className="animate-spin" aria-hidden />} {saveLabel}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <section>
            <h3 className="eyebrow mb-1.5">
              {count} change{count === 1 ? "" : "s"}
            </h3>
            <ul className="divide-y divide-line/70 rounded-lg bg-sunken px-3 text-[14px] leading-snug">
              {changes.slice(0, 40).map((c, i) => (
                <li key={i} className="break-words py-2 text-ink">
                  {c}
                </li>
              ))}
              {changes.length > 40 && <li className="py-2 text-muted">+{changes.length - 40} more</li>}
            </ul>
          </section>
          {children}
          <label className="block">
            <span className="label">Note for the history (optional)</span>
            <input className="input" placeholder="Why this changed" value={note} maxLength={500} onChange={(e) => onNote(e.target.value)} />
          </label>
          <div className={cn("flex min-h-11 items-center rounded-lg bg-sunken px-3")}>
            <Toggle checked={notify} onChange={onNotify} label={<span className="text-[15px] font-medium text-ink sm:text-sm">Notify managers</span>} />
          </div>
        </div>
      </Modal>
    </>
  );
}
