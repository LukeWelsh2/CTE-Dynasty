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
import { generateRecapAction, previewRecapEmailAction, sendRecapAction } from "@/lib/recap/actions";

export function RecapAdminBar({
  season,
  week,
  sentAt,
  generatedAt,
  emailHtml,
  emailSubject,
  teams,
  recipients,
  recapEnabled,
  scheduleText,
}: {
  season: number;
  week: number;
  sentAt: string | null;
  generatedAt: string;
  emailHtml: string;
  emailSubject: string;
  teams: { id: string; name: string }[];
  recipients: number;
  recapEnabled: boolean;
  scheduleText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState<string>("");
  const [html, setHtml] = useState(emailHtml);
  const [subject, setSubject] = useState(emailSubject);
  const [loading, start] = useTransition();

  const loadPreview = (id: string) => {
    setTeamId(id);
    if (!id) {
      setHtml(emailHtml);
      setSubject(emailSubject);
      return;
    }
    start(async () => {
      const res = await previewRecapEmailAction({ season, week, teamId: id });
      if (res.ok) {
        setHtml(res.html);
        setSubject(res.subject);
      } else toast.error(res.error);
    });
  };

  return (
    <section aria-label="Commissioner recap tools" className="mb-4 rounded-lg border border-gold-400/50 bg-gold-300/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <div className="font-semibold text-ink">Commissioner tools</div>
          <div className="text-xs text-muted">
            {sentAt ? `Emailed to the league ${sentAt}` : "Not emailed yet"} · generated {generatedAt}
            {recapEnabled ? ` · auto-sends ${scheduleText}` : " · automatic recap emails are off"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            action={() => generateRecapAction({ season, week })}
            onDone={() => router.refresh()}
            variant="secondary"
            size="sm"
            title="Rebuild the recap from the latest stats, standings and projections"
          >
            <RefreshCw size={14} aria-hidden /> Refresh recap
          </ActionButton>
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOpen(true)}>
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
            size="sm"
          >
            <Send size={14} aria-hidden /> {sentAt ? "Resend to league" : "Send to league now"}
          </ActionButton>
          <Link href="/commissioner/settings?tab=notifications" className={buttonClass("ghost", "sm")} title="Recap schedule and awards settings">
            <Settings2 size={14} aria-hidden />
            <span className="sr-only sm:not-sr-only">Settings</span>
          </Link>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Email preview" size="xl">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="label">Subject</div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Mail size={14} className="shrink-0 text-muted" aria-hidden />
              <span className="truncate">{subject}</span>
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
        <iframe title="Recap email preview" sandbox="" srcDoc={html} className="h-[65vh] w-full rounded-md border border-line bg-white" />
        <p className="mt-2 text-xs text-muted">Each manager&apos;s copy adds a personal &ldquo;Your week&rdquo; box. Links in the preview are disabled.</p>
      </Modal>
    </section>
  );
}
