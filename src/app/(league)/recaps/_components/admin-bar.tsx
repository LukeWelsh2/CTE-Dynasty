"use client";
// Commissioner recap controls: refresh, preview the email (sandboxed iframe, optionally personalized
// for a team) and send it to the league.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Mail, RefreshCw, Send, Settings2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { ActionButton, Modal } from "@/components/ui/client";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { generateRecapAction, previewRecapEmailAction, sendRecapAction } from "@/lib/recap/actions";

export function RecapAdminBar({
  season,
  week,
  sentAt,
  generatedAt,
  teams,
  recipients,
  recapEnabled,
  scheduleText,
}: {
  season: number;
  week: number;
  sentAt: string | null;
  generatedAt: string;
  teams: { id: string; name: string }[];
  recipients: number;
  recapEnabled: boolean;
  scheduleText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState<string>("");
  const [html, setHtml] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [loading, start] = useTransition();

  // the email is rendered on demand (it is ~70 KB of HTML, too heavy to ship with every page view)
  const loadPreview = (id: string) => {
    setTeamId(id);
    start(async () => {
      const res = await previewRecapEmailAction({ season, week, teamId: id || null });
      if (res.ok) {
        setHtml(res.html);
        setSubject(res.subject);
      } else toast.error(res.error);
    });
  };

  const openPreview = () => {
    setOpen(true);
    loadPreview(teamId);
  };

  return (
    <section aria-label="Commissioner recap tools" className="card mb-4 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink sm:text-sm">Commissioner</div>
          <div className="text-[13px] text-muted">
            {sentAt ? `Emailed ${sentAt}` : "Not emailed yet"} · generated {generatedAt}
            {recapEnabled ? ` · auto-sends ${scheduleText}` : " · auto-email off"}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <ActionButton
            action={() => generateRecapAction({ season, week })}
            onDone={() => router.refresh()}
            variant="secondary"
            size="md"
            className="w-full sm:w-auto"
            title="Rebuild the recap from the latest stats, standings and projections"
          >
            <RefreshCw size={14} aria-hidden /> Refresh
          </ActionButton>
          <button type="button" className={buttonClass("secondary", "md", "w-full sm:w-auto")} onClick={openPreview}>
            <Eye size={14} aria-hidden /> Preview email
          </button>
          <ActionButton
            action={() => sendRecapAction({ season, week, resend: !!sentAt })}
            onDone={() => router.refresh()}
            confirm={
              sentAt
                ? `This recap was already emailed (${sentAt}). Send it to all ${recipients} managers again?`
                : `Email the Week ${week} recap to all ${recipients} managers now? Managers who turned recap emails off are skipped.`
            }
            variant={sentAt ? "secondary" : "primary"}
            size="md"
            className="w-full sm:w-auto"
          >
            <Send size={14} aria-hidden /> {sentAt ? "Resend" : "Send now"}
          </ActionButton>
          <Link href="/commissioner/settings?tab=notifications" className={buttonClass("ghost", "md", "w-full sm:w-auto")} title="Recap schedule and awards settings">
            <Settings2 size={14} aria-hidden /> Settings
          </Link>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Email preview" size="xl">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="label">Subject</div>
            <div className="flex items-start gap-1.5 text-[15px] font-semibold text-ink sm:text-sm">
              <Mail size={14} className="mt-1 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 break-words">{subject || "Rendering…"}</span>
            </div>
          </div>
          <label className="block w-full sm:w-64">
            <span className="label">Preview as</span>
            <span className="relative block">
              <select className="input pr-8" value={teamId} onChange={(e) => loadPreview(e.target.value)} aria-label="Preview the email as a manager">
                <option value="">League (no personal box)</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {loading && <Loader2 size={14} className="absolute right-7 top-1/2 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
            </span>
          </label>
        </div>
        <div className="relative">
          {html !== null ? (
            // the email is a 600px table layout: on phones it scrolls inside the frame
            <iframe title="Recap email preview" sandbox="" srcDoc={html} className={cn("h-[55vh] w-full rounded-lg border border-line bg-white transition-opacity sm:h-[65vh]", loading && "opacity-60")} />
          ) : (
            <div className="flex h-[55vh] w-full items-center justify-center rounded-lg border border-line bg-sunken text-sm text-muted sm:h-[65vh]">
              <Loader2 size={18} className="mr-2 animate-spin" aria-hidden /> Rendering the email…
            </div>
          )}
        </div>
        <p className="mt-2 text-[13px] text-muted">Each manager&apos;s copy adds a personal &ldquo;Your week&rdquo; box. Links in the preview are disabled.</p>
      </Modal>
    </section>
  );
}
