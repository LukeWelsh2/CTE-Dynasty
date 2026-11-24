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
        "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs ring-1 ring-inset",
        severe ? "bg-panel ring-amber-500/35 dark:bg-white/[0.04]" : "bg-panel ring-line dark:bg-white/[0.04]",
      )}
    >
      <span className="rounded-full bg-sunken px-1.5 text-[10px] font-bold uppercase leading-4 text-muted">{issue.slotLabel}</span>
      {issue.player ? (
        <>
          <Link href={`/players/${issue.player.id}`} title={issue.player.fullName} className="-my-1 truncate py-1 font-semibold text-ink hover:underline">
            {issue.player.fullName}
          </Link>
          {issue.kind === "OUT" || issue.kind === "DOUBTFUL" || issue.kind === "QUESTIONABLE" ? (
            <InjuryTag status={issue.player.injuryStatus} />
          ) : (
            <span className="shrink-0 rounded-sm bg-zinc-600 px-1 text-[10px] font-extrabold uppercase leading-4 text-white">{KIND_LABEL[issue.kind]}</span>
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
        className={cn("rounded-card bg-amber-400/[0.12] p-3 text-amber-950 ring-1 ring-inset ring-amber-500/30 sm:p-4 dark:bg-amber-400/[0.08] dark:text-amber-50 dark:ring-amber-400/25", className)}
      >
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-amber-400/25 text-amber-700 dark:text-amber-300" aria-hidden>
            <TriangleAlert size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="lineup-alert-title" className="font-display text-[17px] font-bold uppercase leading-5 tracking-[0.04em]">
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
          <Link href={data.href} className={buttonClass("gold", "md", "w-full shadow-glow-gold sm:w-auto")}>
            Fix lineup
          </Link>
        </div>
      </section>
    );
  }

  if (data.watch > 0) {
    return (
      <section aria-label="Lineup check" className={cn("card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm sm:px-4", className)}>
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
          <Link href={data.href} className="-mx-1 inline-flex min-h-8 shrink-0 items-center px-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Review
          </Link>
        </span>
      </section>
    );
  }

  return (
    <section aria-label="Lineup check" className={cn("card flex items-center gap-2 px-3 py-2.5 text-sm sm:px-4", className)}>
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
      <Link href={data.href} className="-mx-1 -my-1.5 inline-flex min-h-8 shrink-0 items-center px-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
        {data.weekLocked ? "View" : "Review"}
      </Link>
    </section>
  );
}
