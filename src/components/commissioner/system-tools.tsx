"use client";
// Client widgets for /commissioner/system: run-job buttons, email preview modal, announcement form.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Loader2, Megaphone, Play } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { createAnnouncement, getEmailHtml, runJobNow } from "@/lib/commissioner/system-actions";

export function RunJobButton({ name, heavy, size = "xs" }: { name: string; heavy?: boolean; size?: "xs" | "sm" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonClass("secondary", size)}
      disabled={pending}
      aria-label={`Run ${name} now`}
      onClick={() => {
        if (heavy && !window.confirm(`Run ${name} now? It calls external data providers and can take a minute.`)) return;
        start(async () => {
          const r = await runJobNow({ name });
          if (r.ok) toast.success(r.message ?? "Done");
          else toast.error(r.error);
          router.refresh();
        });
      }}
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {pending ? "Running…" : "Run now"}
    </button>
  );
}

export function EmailPreviewButton({ id, size = "xs", iconOnly }: { id: string; size?: "xs" | "sm"; /** phones: a 40px eye button */ iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ html: string; subject: string; to: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className={iconOnly ? "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink" : buttonClass("secondary", size)}
        disabled={pending}
        aria-label="Preview email"
        title="Preview email"
        onClick={() =>
          start(async () => {
            const r = await getEmailHtml({ id });
            if (!r.ok) return void toast.error(r.error);
            setData(r.data ?? null);
            setOpen(true);
          })
        }
      >
        {pending ? <Loader2 size={iconOnly ? 18 : 13} className="animate-spin" /> : <Eye size={iconOnly ? 18 : 13} />}
        {!iconOnly && " Preview"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Email preview" size="xl">
        {data && (
          <div className="space-y-2">
            <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[14px]">
              <dt className="eyebrow pt-0.5">To</dt>
              <dd className="break-all text-ink">{data.to}</dd>
              <dt className="eyebrow pt-0.5">Subject</dt>
              <dd className="font-semibold text-ink">{data.subject}</dd>
            </dl>
            {/* the email is 600px wide: phones scroll it inside the sheet */}
            <iframe title={`Email: ${data.subject}`} sandbox="" srcDoc={data.html} className="h-[58vh] w-full rounded-lg border border-line bg-white sm:h-[65vh]" />
          </div>
        )}
      </Modal>
    </>
  );
}

export function AnnouncementForm({ notifyDefault, chatDefault }: { notifyDefault: boolean; chatDefault: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [f, setF] = useState({ title: "", body: "", pinned: false, notify: notifyDefault, postToChat: chatDefault });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createAnnouncement(f);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message ?? "Posted");
          setF({ ...f, title: "", body: "", pinned: false });
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="label">Title</span>
        <input className="input py-1.5" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Rookie draft is Saturday at 7 PM" />
      </label>
      <label className="block">
        <span className="label">Message</span>
        <textarea className="input min-h-[96px]" value={f.body} maxLength={4000} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-4 text-[15px] sm:text-sm">
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />
            Pin to home page
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />
            Notify managers
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.postToChat} onChange={(e) => setF({ ...f, postToChat: e.target.checked })} />
            Post in chat
          </label>
        </div>
        <button type="submit" className={buttonClass("primary", "md", "w-full sm:w-auto")} disabled={pending || f.title.trim().length < 3 || f.body.trim().length < 3}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />} Post announcement
        </button>
      </div>
    </form>
  );
}
