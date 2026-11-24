// "Set your lineup" alert: empty, bye-week, free-agent and injured starters for the week being set.
import Link from "next/link";
import { CircleCheck, Lock, TriangleAlert } from "lucide-react";
import { buttonClass, InjuryTag } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import type { LineupIssue, LineupIssueKind } from "./logic";
import type { LineupAlertData } from "./types";

const KIND_LABEL: Record<LineupIssueKind, string> = {
  EMPTY: "Empty",
  NO_TEAM: "Free agent",
  BYE: "Bye",
  OUT: "Out",
  DOUBTFUL: "Doubtful",
  QUESTIONABLE: "Questionable",
};

function IssueChip({ issue }: { issue: LineupIssue }) {
  const severe = issue.kind !== "QUESTIONABLE";
  return (
    <li
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        severe ? "border-amber-300 bg-white/70 dark:border-amber-700 dark:bg-amber-950/40" : "border-line bg-panel",
      )}
    >
      <span className="rounded bg-sunken px-1 text-[10px] font-bold uppercase text-muted">{issue.slotLabel}</span>
      {issue.player ? (
        <>
          <Link href={`/players/${issue.player.id}`} className="truncate font-semibold text-ink hover:underline">
            {issue.player.fullName}
          </Link>
          {issue.kind === "OUT" || issue.kind === "DOUBTFUL" || issue.kind === "QUESTIONABLE" ? (
            <InjuryTag status={issue.player.injuryStatus} />
          ) : (
            <span className="rounded-sm bg-zinc-600 px-1 text-[9px] font-extrabold uppercase leading-4 text-white">{KIND_LABEL[issue.kind]}</span>
          )}
        </>
      ) : (
        <span className="font-semibold text-amber-800 dark:text-amber-200">Empty slot</span>
      )}
    </li>
  );
}

export function LineupAlert({ data, className }: { data: LineupAlertData; className?: string }) {
  if (data.bestBall) return null;
  const weekLabel = `Week ${data.week}`;

  if (data.actionable > 0) {
    return (
      <section
        aria-labelledby="lineup-alert-title"
        className={cn("rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 shadow-panel dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-100", className)}
      >
        <div className="flex flex-wrap items-start gap-3">
          <TriangleAlert size={20} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="lineup-alert-title" className="font-display text-base font-bold uppercase tracking-wide">
              Set your lineup for {weekLabel}
            </h2>
            <p className="text-sm">
              {data.actionable} starter{data.actionable === 1 ? " needs" : "s need"} attention: {data.summary}
              {data.issues.some((i) => i.kind === "EMPTY") && data.emptySlotPenalty > 0 ? ` (empty slots cost ${data.emptySlotPenalty} pts each)` : ""}.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {data.issues.slice(0, 8).map((i, idx) => (
                <IssueChip key={`${i.slotLabel}-${i.player?.id ?? "empty"}-${idx}`} issue={i} />
              ))}
              {data.issues.length > 8 && <li className="self-center text-xs">+{data.issues.length - 8} more</li>}
            </ul>
          </div>
          <Link href={data.href} className={buttonClass("gold", "sm", "w-full sm:w-auto")}>
            Fix lineup
          </Link>
        </div>
      </section>
    );
  }

  if (data.watch > 0) {
    return (
      <section aria-label="Lineup check" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm shadow-panel", className)}>
        <span className="flex min-w-[15rem] flex-1 items-start gap-2">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
          <span className="min-w-0">
            <strong className="font-semibold">{weekLabel} lineup is full</strong>
            <span className="text-muted">
              {" "}
              · {data.watch} questionable starter{data.watch === 1 ? "" : "s"} to watch before kickoff
            </span>
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <ul className="flex min-w-0 flex-wrap gap-1.5">
            {data.issues.slice(0, 4).map((i, idx) => (
              <IssueChip key={`${i.slotLabel}-${i.player?.id ?? "q"}-${idx}`} issue={i} />
            ))}
          </ul>
          <Link href={data.href} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Review
          </Link>
        </span>
      </section>
    );
  }

  return (
    <section aria-label="Lineup check" className={cn("flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm shadow-panel", className)}>
      {data.weekLocked ? <Lock size={16} className="shrink-0 text-muted" aria-hidden /> : <CircleCheck size={16} className="shrink-0 text-win" aria-hidden />}
      <span className="min-w-0 flex-1">
        {data.weekLocked ? (
          <>
            <strong className="font-semibold">{weekLabel} lineups are locked</strong>
            <span className="text-muted"> · good luck</span>
          </>
        ) : (
          <>
            <strong className="font-semibold">Your {weekLabel} lineup is set</strong>
            <span className="text-muted"> · no empty, bye-week or injured starters</span>
          </>
        )}
      </span>
      <Link href={data.href} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
        {data.weekLocked ? "View" : "Review"}
      </Link>
    </section>
  );
}
