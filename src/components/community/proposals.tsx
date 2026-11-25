"use client";
// Rule suggestion board client widgets: vote buttons, propose / edit form (with settings-patch preview),
// filters, comment form, commissioner workflow panel and live refresh.
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, Loader2, Pause, Pencil, Plus, RotateCcw, ThumbsDown, ThumbsUp, Undo2, Vote, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonClass } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { useLiveEvents } from "@/lib/realtime/client";
import { cn } from "@/lib/utils";
import { isoToLocalInput, localInputToIso } from "@/lib/commissioner/time";
import { PROPOSAL_CATEGORIES, STATUS_META, type ProposalCategory, type ProposalStatus } from "@/lib/proposals/logic";
import {
  applyProposalPatchAction,
  commentProposalAction,
  createProposalAction,
  deleteProposalAction,
  previewPatchAction,
  setProposalStatusAction,
  updateProposalAction,
  voteProposalAction,
} from "@/lib/proposals/actions";

// ───────────────────────────── Votes ─────────────────────────────

export function VoteButtons({
  id,
  myVote,
  support,
  oppose,
  abstain = 0,
  open,
  layout = "column",
  allowAbstain = false,
}: {
  id: string;
  myVote: number | null;
  support: number;
  oppose: number;
  abstain?: number;
  open: boolean;
  layout?: "column" | "row";
  allowAbstain?: boolean;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<number | null>(myVote);
  const [counts, setCounts] = useState({ support, oppose, abstain });
  const [pending, start] = useTransition();
  useEffect(() => {
    setMine(myVote);
    setCounts({ support, oppose, abstain });
  }, [myVote, support, oppose, abstain]);

  const cast = (value: 1 | -1 | 0) => {
    if (!open || pending) return;
    const next = mine === value ? null : value;
    const prev = { mine, counts };
    const c = { ...counts };
    const dec = (v: number | null) => (v === 1 ? c.support-- : v === -1 ? c.oppose-- : v === 0 ? c.abstain-- : 0);
    const inc = (v: number | null) => (v === 1 ? c.support++ : v === -1 ? c.oppose++ : v === 0 ? c.abstain++ : 0);
    dec(mine);
    inc(next);
    setMine(next);
    setCounts(c);
    start(async () => {
      const res = await voteProposalAction({ id, value: next });
      if (!res.ok) {
        toast.error(res.error);
        setMine(prev.mine);
        setCounts(prev.counts);
      } else router.refresh();
    });
  };

  const btn = (value: 1 | -1, label: string) => {
    const active = mine === value;
    const Icon = value === 1 ? ThumbsUp : ThumbsDown;
    const n = value === 1 ? counts.support : counts.oppose;
    return (
      <button
        type="button"
        onClick={() => cast(value)}
        disabled={!open}
        aria-pressed={active}
        aria-label={`${label}${active ? " (your vote — tap to clear)" : ""}, ${n} vote${n === 1 ? "" : "s"}`}
        title={open ? (active ? "Your vote — tap again to clear" : label) : "Voting is closed"}
        className={cn(
          "inline-flex items-center justify-center gap-1 rounded-md border font-bold tabular-nums transition-colors disabled:cursor-default",
          layout === "column" ? "h-10 w-14 text-[13px] sm:h-8 sm:text-xs" : "h-10 min-w-[96px] px-3 text-[15px] sm:h-9 sm:text-sm",
          active
            ? value === 1
              ? "border-green-700 bg-green-700 text-white dark:border-green-600 dark:bg-green-600"
              : "border-[rgb(208_31_43)] bg-[rgb(208_31_43)] text-white"
            : cn("border-line bg-panel text-ink", open && (value === 1 ? "hover:border-win hover:text-win" : "hover:border-loss hover:text-loss")),
        )}
      >
        <Icon size={layout === "column" ? 13 : 15} /> {n}
        {layout === "row" && <span className="font-semibold">{value === 1 ? "Support" : "Oppose"}</span>}
      </button>
    );
  };

  return (
    <div className={cn("flex items-center gap-1.5", layout === "column" ? "flex-col" : "flex-wrap")}>
      {btn(1, "Support")}
      {btn(-1, "Oppose")}
      {allowAbstain && (
        <button
          type="button"
          onClick={() => cast(0)}
          disabled={!open}
          aria-pressed={mine === 0}
          className={cn("h-10 rounded-md border px-3 text-[15px] font-semibold sm:h-9 sm:text-sm", mine === 0 ? "border-ink/40 bg-ink/60 text-white dark:bg-white/30" : "border-line bg-panel text-muted hover:text-ink")}
        >
          Abstain {counts.abstain ? <span className="tabular-nums">{counts.abstain}</span> : null}
        </button>
      )}
      {pending && <Loader2 size={12} className="animate-spin text-muted" />}
    </div>
  );
}

// ───────────────────────────── Propose / edit ─────────────────────────────

export interface ProposalDraft {
  id?: string;
  title: string;
  body: string;
  category: string;
  settingsPatch: string;
  effectiveSeason: number | null;
}

type PatchPreview = { changes: { label: string; from: string; to: string }[]; warnings: string[]; locked: string[]; errors: string[] };

function PatchPreviewTable({ p }: { p: PatchPreview }) {
  return (
    <div className="mt-2 space-y-2 text-xs">
      {p.errors.map((e) => (
        <div key={e} className="flex items-start gap-1.5 text-loss">
          <XCircle size={13} className="mt-px shrink-0" /> {e}
        </div>
      ))}
      {p.locked.length > 0 && (
        <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {p.locked.join(", ")} settings are locked in season — this can only be applied after the season.
        </div>
      )}
      {p.warnings.map((w) => (
        <div key={w} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-px shrink-0" /> {w}
        </div>
      ))}
      {p.changes.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th className="text-left">Setting</th>
                <th className="text-left">Now</th>
                <th className="text-left">Proposed</th>
              </tr>
            </thead>
            <tbody>
              {p.changes.map((c) => (
                <tr key={c.label + c.to}>
                  <td className="font-semibold">{c.label}</td>
                  <td className="text-muted">{c.from}</td>
                  <td className="font-semibold text-win">{c.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!p.errors.length && !p.changes.length && !p.warnings.length && <div className="text-muted">No settings change.</div>}
    </div>
  );
}

const PATCH_EXAMPLE = '{ "roster": { "taxiSlots": 5 } }';

function ProposalForm({ draft, isCommish, season, onDone }: { draft: ProposalDraft; isCommish: boolean; season: number; onDone: (id?: string) => void }) {
  const [v, setV] = useState(draft);
  const [pending, start] = useTransition();
  const [checking, startCheck] = useTransition();
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const set = <K extends keyof ProposalDraft>(k: K, val: ProposalDraft[K]) => setV((p) => ({ ...p, [k]: val }));

  const check = () =>
    startCheck(async () => {
      const res = await previewPatchAction({ text: v.settingsPatch });
      if (!res.ok) {
        setPreview({ changes: [], warnings: [], locked: [], errors: [res.error] });
        return;
      }
      setPreview(res.data ?? null);
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const payload = { title: v.title, body: v.body, category: v.category as ProposalCategory, settingsPatch: isCommish ? v.settingsPatch : undefined, effectiveSeason: v.effectiveSeason };
      const res = v.id ? await updateProposalAction({ ...payload, id: v.id }) : await createProposalAction(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      onDone("data" in res && res.data ? (res.data as { id: string }).id : v.id);
    });
  };

  return (
    <form id="proposal-form" onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="label">Title</span>
        <input className="input" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={120} required placeholder="e.g. Expand the taxi squad to 5 spots" autoFocus />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Category</span>
          <select className="input" value={v.category} onChange={(e) => set("category", e.target.value)}>
            {PROPOSAL_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Takes effect</span>
          <select className="input" value={v.effectiveSeason ?? ""} onChange={(e) => set("effectiveSeason", e.target.value ? Number(e.target.value) : null)}>
            <option value="">As soon as adopted</option>
            {[season, season + 1, season + 2].map((s) => (
              <option key={s} value={s}>
                {s} season
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label flex justify-between">
          The proposal <span className={cn(v.body.length > 4500 ? "text-amber-600" : "text-muted")}>{v.body.length}/5000</span>
        </span>
        <textarea
          className="input min-h-[150px] py-2"
          value={v.body}
          onChange={(e) => set("body", e.target.value)}
          maxLength={5000}
          required
          placeholder={"What should change, and why? How would it work in practice?\n\n**bold**, *italic* and links work."}
        />
      </label>
      {isCommish && (
        <div className="rounded-lg border border-dashed border-line bg-sunken/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="label mb-0 flex items-center gap-1">
              <Wand2 size={12} /> Settings patch (commissioner, optional)
            </span>
            <button type="button" onClick={check} disabled={checking || !v.settingsPatch.trim()} className={buttonClass("secondary", "sm")}>
              {checking ? <Loader2 size={12} className="animate-spin" /> : null} Check patch
            </button>
          </div>
          <textarea
            className="input mt-1 min-h-[80px] py-2 font-mono text-xs"
            value={v.settingsPatch}
            onChange={(e) => {
              set("settingsPatch", e.target.value);
              setPreview(null);
            }}
            placeholder={PATCH_EXAMPLE}
            spellCheck={false}
            aria-label="Settings patch JSON"
          />
          <p className="mt-1 text-[12px] text-muted">
            JSON merged into the league settings when the proposal is adopted with “Adopt &amp; apply”, e.g. <code className="font-mono">{PATCH_EXAMPLE}</code> or{" "}
            <code className="font-mono">{'{ "scoring": { "positionOverrides": { "TE": { "rec": 1.75 } } } }'}</code>.
          </p>
          {preview && <PatchPreviewTable p={preview} />}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="md" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" size="md" disabled={pending}>
          {pending && <Loader2 size={14} className="animate-spin" />} {v.id ? "Save changes" : "Post proposal"}
        </Button>
      </div>
    </form>
  );
}

export function ProposalEditorButton({
  isCommish,
  season,
  draft,
  label,
  variant = "primary",
  size = "sm",
}: {
  isCommish: boolean;
  season: number;
  draft?: ProposalDraft;
  label?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const editing = !!draft?.id;
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => setOpen(true)}>
        {editing ? <Pencil size={14} /> : <Plus size={14} />} {label ?? (editing ? "Edit" : "Propose a rule")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit proposal" : "Propose a rule change"} size="lg">
        <ProposalForm
          draft={draft ?? { title: "", body: "", category: "GENERAL", settingsPatch: "", effectiveSeason: null }}
          isCommish={isCommish}
          season={season}
          onDone={(id) => {
            setOpen(false);
            if (id && !editing) router.push(`/rules/suggestions/${id}`);
            else router.refresh();
          }}
        />
      </Modal>
    </>
  );
}

// ───────────────────────────── Filters ─────────────────────────────

export function UrlSelect({ param, value, options, label, className }: { param: string; value: string; options: { value: string; label: string }[]; label: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <label className={cn("flex min-w-0 items-center gap-2 text-[13px] font-semibold text-muted", className)}>
      <span className="whitespace-nowrap">{label}</span>
      <select
        className="input h-10 min-w-0 flex-1 py-0 text-sm sm:h-9"
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          if (e.target.value) q.set(param, e.target.value);
          else q.delete(param);
          const s = q.toString();
          router.push(s ? `${pathname}?${s}` : pathname);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ───────────────────────────── Live refresh ─────────────────────────────

export function ProposalLiveRefresh({ leagueId, id }: { leagueId: string; id?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "proposal.update") return;
    const d = e.data as { id?: string; kind?: string };
    if (id && d.id !== id) return;
    if (id && d.kind === "deleted") {
      toast.info("This proposal was deleted.");
      router.push("/rules/suggestions");
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 500);
  });
  return null;
}

// ───────────────────────────── Comments ─────────────────────────────

export function CommentForm({ id, disabled }: { id: string; disabled?: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  if (disabled) return <p className="text-sm text-muted">{disabled}</p>;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        start(async () => {
          const res = await commentProposalAction({ id, body });
          if (!res.ok) toast.error(res.error);
          else {
            setBody("");
            router.refresh();
          }
        });
      }}
    >
      <label className="sr-only" htmlFor={`comment-${id}`}>
        Add a comment
      </label>
      <textarea
        id={`comment-${id}`}
        className="input min-h-[80px] py-2"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        placeholder="Make your case… (**bold**, *italic* and links work)"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{body.length ? `${body.length}/2000 · ⌘/Ctrl+Enter to post` : "Comments notify the author."}</span>
        <Button type="submit" size="md" disabled={pending || !body.trim()}>
          {pending && <Loader2 size={14} className="animate-spin" />} Post comment
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────────── Workflow ─────────────────────────────

const STATUS_ICON: Record<ProposalStatus, typeof Vote> = { OPEN: RotateCcw, VOTING: Vote, ADOPTED: CheckCircle2, REJECTED: XCircle, TABLED: Pause, WITHDRAWN: Undo2 };

export function ProposalWorkflow({
  id,
  status,
  allowed,
  isCommish,
  canApply,
  hasPatch,
  patchApplied,
  patchBlockedReason,
  effectiveSeason,
  season,
  tz,
  canDelete,
  passing,
}: {
  id: string;
  status: ProposalStatus;
  allowed: ProposalStatus[];
  isCommish: boolean;
  /** user has full commissioner powers (settings changes) */
  canApply: boolean;
  hasPatch: boolean;
  patchApplied: boolean;
  /** why the patch can't be applied right now (lock, future season, invalid) */
  patchBlockedReason: string | null;
  effectiveSeason: number | null;
  season: number;
  tz: string;
  canDelete: boolean;
  passing: boolean | null;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ProposalStatus | null>(null);
  const [note, setNote] = useState("");
  const [ends, setEnds] = useState(() => {
    const d = new Date(Date.now() + 3 * 86_400_000);
    return isoToLocalInput(d.toISOString(), tz).slice(0, 10) + "T23:59";
  });
  const [eff, setEff] = useState<number | null>(effectiveSeason);
  const [apply, setApply] = useState(hasPatch && !patchApplied && !patchBlockedReason && canApply);
  const [pending, start] = useTransition();
  // what the checkbox actually shows: a future "takes effect" season or a blocked patch can't be applied now
  const futureSeason = !!(eff && eff > season);
  const applyNow = hasPatch && apply && canApply && !patchBlockedReason && !futureSeason;

  const go = () => {
    if (!target) return;
    start(async () => {
      const votingEndsAt = target === "VOTING" ? localInputToIso(ends, tz) : null;
      if (target === "VOTING" && !votingEndsAt) {
        toast.error("Pick when voting closes.");
        return;
      }
      const res = await setProposalStatusAction({ id, status: target, votingEndsAt, effectiveSeason: eff, note: note.trim() || undefined, applyPatch: target === "ADOPTED" && applyNow });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Updated");
      setTarget(null);
      setNote("");
      router.refresh();
    });
  };

  const labelFor = (s: ProposalStatus) =>
    s === "OPEN" ? (status === "VOTING" ? "Cancel vote (back to discussion)" : status === "WITHDRAWN" ? "Reopen my proposal" : "Reopen discussion") : s === "VOTING" ? "Open league vote" : s === "ADOPTED" ? (hasPatch ? "Adopt (& apply)" : "Adopt") : s === "REJECTED" ? "Reject" : s === "TABLED" ? "Table" : "Withdraw my proposal";

  if (!allowed.length && !canDelete && !(isCommish && status === "ADOPTED" && hasPatch && !patchApplied)) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {allowed.map((s) => {
          const Icon = STATUS_ICON[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => setTarget(target === s ? null : s)}
              aria-expanded={target === s}
              className={buttonClass(target === s ? "primary" : s === "ADOPTED" ? "success" : s === "REJECTED" || s === "WITHDRAWN" ? "secondary" : "secondary", "md")}
            >
              <Icon size={14} /> {labelFor(s)}
            </button>
          );
        })}
        {isCommish && status === "ADOPTED" && hasPatch && !patchApplied && (
          <button
            type="button"
            disabled={pending || !canApply || !!patchBlockedReason}
            title={patchBlockedReason ?? (canApply ? undefined : "Needs full commissioner powers")}
            className={buttonClass("success", "md")}
            onClick={() =>
              start(async () => {
                if (!window.confirm("Apply this proposal's settings change to the league now?")) return;
                const res = await applyProposalPatchAction(id);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success(res.message ?? "Applied");
                  router.refresh();
                }
              })
            }
          >
            <Wand2 size={14} /> Apply settings change
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            disabled={pending}
            className={buttonClass("ghost", "md", "text-loss")}
            onClick={() =>
              start(async () => {
                if (!window.confirm("Delete this proposal, its votes and comments? This can't be undone.")) return;
                const res = await deleteProposalAction(id);
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success(res.message ?? "Deleted");
                  router.push("/rules/suggestions");
                }
              })
            }
          >
            <Ban size={14} /> Delete
          </button>
        )}
      </div>
      {isCommish && status === "ADOPTED" && hasPatch && !patchApplied && patchBlockedReason && <p className="text-xs text-muted">{patchBlockedReason}</p>}

      {target && (
        <div className="space-y-2 rounded-lg border border-line bg-sunken/50 p-3">
          <div className="text-sm font-semibold">{STATUS_META[target].label}: {STATUS_META[target].hint.toLowerCase()}</div>
          {target === "VOTING" && (
            <label className="block">
              <span className="label">Voting closes ({tz.replace(/_/g, " ")})</span>
              <input type="datetime-local" className="input" value={ends} onChange={(e) => setEnds(e.target.value)} required />
            </label>
          )}
          {(target === "ADOPTED" || target === "VOTING") && isCommish && (
            <label className="block">
              <span className="label">Takes effect</span>
              <select className="input" value={eff ?? ""} onChange={(e) => setEff(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Immediately</option>
                {[season, season + 1, season + 2].map((s) => (
                  <option key={s} value={s}>
                    {s} season
                  </option>
                ))}
              </select>
            </label>
          )}
          {target === "ADOPTED" && passing === false && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle size={13} className="mt-px shrink-0" /> Support is below the league&apos;s vote threshold — make sure the league agrees before adopting.
            </p>
          )}
          {target === "ADOPTED" && hasPatch && (
            <label className={cn("flex items-start gap-2 text-sm", (!canApply || patchBlockedReason || futureSeason) && "opacity-60")}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={applyNow}
                disabled={!canApply || !!patchBlockedReason || futureSeason}
                onChange={(e) => setApply(e.target.checked)}
              />
              <span>
                <b>Apply the settings change now</b>
                <span className="block text-xs text-muted">
                  {!canApply
                    ? "Needs full commissioner powers."
                    : patchBlockedReason
                      ? patchBlockedReason
                      : futureSeason
                        ? `Takes effect in ${eff} — apply it from this page once that season starts.`
                        : "Updates league settings, records a new settings version and logs it in the audit history."}
                </span>
              </span>
            </label>
          )}
          <label className="block">
            <span className="label">{target === "VOTING" ? "Message to the league (optional)" : "Resolution note (optional)"}</span>
            <textarea className="input min-h-[60px] py-2" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={target === "REJECTED" ? "e.g. Failed 4–8" : target === "ADOPTED" ? "e.g. Passed 9–3, starts next season" : ""} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button type="button" size="md" onClick={go} disabled={pending} variant={target === "REJECTED" ? "danger" : target === "ADOPTED" ? "success" : "primary"}>
              {pending && <Loader2 size={14} className="animate-spin" />} Confirm: {labelFor(target)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
