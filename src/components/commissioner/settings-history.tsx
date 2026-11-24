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
            <li key={r.id} className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/60 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-display text-base font-bold text-ink">v{r.version}</span>
                  {isCurrent && <Badge tone="green">Current</Badge>}
                  {sections.map((s) => (
                    <Badge key={s} tone="brand">
                      {SECTION_LABELS[s as SettingsSection] ?? s}
                    </Badge>
                  ))}
                  <span className="text-xs text-muted">
                    {fmtDateTime(r.createdAt, tz, { withYear: true })} · {r.changedBy ?? "System"}
                    {raw.length ? ` · ${raw.length} change${raw.length === 1 ? "" : "s"}` : ""}
                  </span>
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
                    size="xs"
                  >
                    Revert to v{r.version}
                  </ActionButton>
                )}
              </div>
              <div className="px-3 py-2">
                {r.note && <p className="mb-1.5 text-sm italic text-ink">“{r.note}”</p>}
                {!raw.length && <p className="text-[13px] text-muted">Snapshot of every setting at this version.</p>}
                <ul className="space-y-0.5 text-[13px]">
                  {grouped.slice(0, 12).map((c, i) => (
                    <li key={i} className="break-words text-muted">
                      {describeChange(c, lookups)}
                    </li>
                  ))}
                </ul>
                {grouped.length > 12 && (
                  <details className="mt-1 text-[13px]">
                    <summary className="cursor-pointer text-xs font-semibold text-brand-700 dark:text-brand-300">Show {grouped.length - 12} more</summary>
                    <ul className="mt-1 space-y-0.5">
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
      <div className="flex justify-between text-sm">
        {page > 1 ? (
          <Link className="link" href={`/commissioner/settings?tab=history&page=${page - 1}`}>
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        {hasMore && (
          <Link className="link" href={`/commissioner/settings?tab=history&page=${page + 1}`}>
            Older →
          </Link>
        )}
      </div>
    </div>
  );
}
