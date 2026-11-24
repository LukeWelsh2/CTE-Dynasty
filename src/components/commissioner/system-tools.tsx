"use client";
// Client widgets for /commissioner/system: run-job buttons, email preview modal, announcement form.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Loader2, Megaphone, Play } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { createAnnouncement, getEmailHtml, runJobNow } from "@/lib/commissioner/system-actions";

export function RunJobButton({ name, heavy }: { name: string; heavy?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonClass("secondary", "xs")}
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
      {pending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {pending ? "Running…" : "Run now"}
    </button>
  );
}

export function EmailPreviewButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ html: string; subject: string; to: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className={buttonClass("secondary", "xs")}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await getEmailHtml({ id });
            if (!r.ok) return void toast.error(r.error);
            setData(r.data ?? null);
            setOpen(true);
          })
        }
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Email preview" size="xl">
        {data && (
          <div className="space-y-2">
            <div className="text-sm">
              <div>
                <span className="text-muted">To:</span> {data.to}
              </div>
              <div>
                <span className="text-muted">Subject:</span> <b>{data.subject}</b>
              </div>
            </div>
            <iframe title={`Email: ${data.subject}`} sandbox="" srcDoc={data.html} className="h-[65vh] w-full rounded-md border border-line bg-white" />
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
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />
            Pin to home page
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />
            Notify managers
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.postToChat} onChange={(e) => setF({ ...f, postToChat: e.target.checked })} />
            Post in chat
          </label>
        </div>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending || f.title.trim().length < 3 || f.body.trim().length < 3}>
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Megaphone size={13} />} Post announcement
        </button>
      </div>
    </form>
  );
}
