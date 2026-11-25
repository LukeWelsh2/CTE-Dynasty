// Settings history: every saved version with its readable diff and a "revert to this version" action.
import Link from "next/link";
import { History } from "lucide-react";
import type { LeagueSettings } from "@/lib/settings/schema";
import { Badge, EmptyState } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { SECTION_LABELS, setAt, type FormatLookups, type SettingsSection } from "@/lib/commissioner/settings-meta";
import { changedSections, describeChange, groupChanges, settingsChanges, settingsFromSnapshot, type SettingsChange } from "@/lib/commissioner/settings-logic";
import { revertSettingsVersion } from "@/lib/commissioner/settings-actions";
import { fmtDateTime } from "@/lib/commissioner/time";
import { RevertWithVote } from "./vote-fields";

export interface HistoryRow {
  id: string;
  version: number;
  createdAt: Date;
  note: string | null;
  changes: unknown;
  snapshot: unknown;
  changedBy: string | null;
}

export function SettingsHistory({
  rows,
  currentVersion,
  lookups,
  tz,
  canRevert,
  page,
  hasMore,
  current,
  voteSections,
  voters,
}: {
  rows: HistoryRow[];
  currentVersion: number;
  lookups: FormatLookups;
  tz: string;
  canRevert: boolean;
  page: number;
  hasMore: boolean;
  /** current settings (to see which sections a revert would change) */
  current: LeagueSettings;
  /** sections whose changes need a league vote right now (in season) */
  voteSections: SettingsSection[];
  voters: number;
}) {
  if (!rows.length)
    return (
      <EmptyState title="No saved changes yet" icon={<History size={28} />}>
        The league is still on its original settings (version {currentVersion}). Every save from this page is recorded here with a full snapshot you can revert to.
      </EmptyState>
    );
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {rows.map((r) => {
          const raw = (Array.isArray(r.changes) ? r.changes : []) as SettingsChange[];
          const after = settingsFromSnapshot(r.snapshot);
          const before = raw.reduce<LeagueSettings>((obj, c) => setAt(obj, c.path, c.from), after);
          const grouped = groupChanges(raw, before, after);
          const sections = changedSections(raw);
          const isCurrent = r.version === currentVersion;
          const revertVote = !isCurrent && voteSections.length ? changedSections(settingsChanges(current, after)).filter((s) => voteSections.includes(s)) : [];
          return (
            <li key={r.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="text-[17px] font-bold leading-6 tracking-[-0.01em] text-ink">Version {r.version}</h2>
                    {isCurrent && <Badge tone="green">Current</Badge>}
                    {sections.map((s) => (
                      <Badge key={s} tone="neutral">
                        {SECTION_LABELS[s as SettingsSection] ?? s}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {fmtDateTime(r.createdAt, tz, { withYear: true })} · {r.changedBy ?? "System"}
                    {raw.length ? ` · ${raw.length} change${raw.length === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                {canRevert && !isCurrent && revertVote.length > 0 && (
                  <RevertWithVote
                    historyId={r.id}
                    version={r.version}
                    currentVersion={currentVersion}
                    sections={revertVote.map((s) => SECTION_LABELS[s] ?? s)}
                    voters={voters}
                    threshold={current.commissioner.voteThresholdPercent}
                  />
                )}
                {canRevert && !isCurrent && !revertVote.length && (
                  <ActionButton
                    action={revertSettingsVersion.bind(null, { historyId: r.id, expectedVersion: currentVersion })}
                    confirm={`Revert every league setting to version ${r.version}? This is saved as a new version, so it can be undone too.`}
                    variant="secondary"
                    size="sm"
                  >
                    Revert to v{r.version}
                  </ActionButton>
                )}
              </div>
              <div className="px-4 pb-3.5 pt-2">
                {r.note && <p className="mb-1.5 text-[15px] italic text-ink sm:text-sm">“{r.note}”</p>}
                {!raw.length && <p className="text-[13px] text-muted">Snapshot of every setting at this version.</p>}
                <ul className="space-y-1 text-[14px] leading-snug sm:text-[13px]">
                  {grouped.slice(0, 12).map((c, i) => (
                    <li key={i} className="break-words text-muted">
                      {describeChange(c, lookups)}
                    </li>
                  ))}
                </ul>
                {grouped.length > 12 && (
                  <details className="mt-1 text-[14px] leading-snug sm:text-[13px]">
                    <summary className="inline-flex min-h-10 cursor-pointer items-center text-[13px] font-semibold text-brand-600 dark:text-brand-400">Show {grouped.length - 12} more</summary>
                    <ul className="space-y-1">
                      {grouped.slice(12).map((c, i) => (
                        <li key={i} className="break-words text-muted">
                          {describeChange(c, lookups)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex justify-between text-[15px] sm:text-sm">
        {page > 1 ? (
          <Link className="link inline-flex min-h-10 items-center" href={`/commissioner/settings?tab=history&page=${page - 1}`}>
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {hasMore && (
          <Link className="link inline-flex min-h-10 items-center" href={`/commissioner/settings?tab=history&page=${page + 1}`}>
            Older →
          </Link>
        )}
      </div>
    </div>
  );
}
