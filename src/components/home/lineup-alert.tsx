// Lineup check: empty, bye-week, free-agent and injured starters for the week being set.
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
  return (
    <li className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-panel py-1 pl-1 pr-2.5 text-[13px] ring-1 ring-inset ring-line dark:bg-white/[0.04]">
      <span className="rounded-full bg-sunken px-1.5 text-[11px] font-bold uppercase leading-4 text-muted">{issue.slotLabel}</span>
      {issue.player ? (
        <>
          <Link href={`/players/${issue.player.id}`} title={issue.player.fullName} className="-my-1 truncate py-1 font-semibold text-ink hover:underline">
            {issue.player.fullName}
          </Link>
          {issue.kind === "OUT" || issue.kind === "DOUBTFUL" || issue.kind === "QUESTIONABLE" ? (
            <InjuryTag status={issue.player.injuryStatus} />
          ) : (
            <span className="shrink-0 rounded-sm bg-ink/60 px-1 text-[10px] font-bold uppercase leading-4 text-white dark:bg-white/30">{KIND_LABEL[issue.kind]}</span>
          )}
        </>
      ) : (
        <span className="font-semibold text-loss">Empty slot</span>
      )}
    </li>
  );
}

/**
 * Lineup check (Home). Needs action → an alert card with the problem starters as chips and one "Fix lineup" button.
 * Only questionable starters → one compact row. All good / locked → one quiet line.
 */
export function LineupAlert({ data, className }: { data: LineupAlertData; className?: string }) {
  if (data.bestBall) return null;
  const weekLabel = `Week ${data.week}`;

  if (data.actionable > 0) {
    return (
      <section aria-labelledby="lineup-alert-title" className={cn("card p-4 shadow-[inset_3px_0_0_rgb(var(--c-loss)),var(--shadow-card)]", className)}>
        <div className="flex items-start gap-3">
          <TriangleAlert size={20} className="mt-0.5 shrink-0 text-loss" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="lineup-alert-title" className="text-[17px] font-bold leading-6 tracking-[-0.01em]">
              Fix your {weekLabel} lineup
            </h2>
            <p className="text-[13px] text-muted">
              {data.actionable} starter{data.actionable === 1 ? "" : "s"} · {data.summary}
              {data.issues.some((i) => i.kind === "EMPTY") && data.emptySlotPenalty > 0 ? ` · empty slots −${data.emptySlotPenalty} pts` : ""}
            </p>
          </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {data.issues.slice(0, 8).map((i, idx) => (
            <IssueChip key={`${i.slotLabel}-${i.player?.id ?? "empty"}-${idx}`} issue={i} />
          ))}
          {data.issues.length > 8 && <li className="self-center text-[13px] text-muted">+{data.issues.length - 8} more</li>}
        </ul>
        <Link href={data.href} className={buttonClass("primary", "lg", "mt-3 w-full sm:w-auto")}>
          Fix lineup
        </Link>
      </section>
    );
  }

  if (data.watch > 0) {
    return (
      <section aria-label="Lineup check" className={cn("card px-4 py-3", className)}>
        <div className="flex items-center gap-3">
          <TriangleAlert size={18} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-5">{weekLabel} lineup is full</div>
            <div className="truncate text-[13px] leading-[18px] text-muted">
              {data.watch} questionable starter{data.watch === 1 ? "" : "s"} to watch
            </div>
          </div>
          <Link href={data.href} className={buttonClass("secondary", "sm", "shrink-0")}>
            Review
          </Link>
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-1.5 pl-[30px]">
          {data.issues.slice(0, 4).map((i, idx) => (
            <IssueChip key={`${i.slotLabel}-${i.player?.id ?? "q"}-${idx}`} issue={i} />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-label="Lineup check" className={cn("card flex items-center gap-3 px-4 py-3", className)}>
      {data.weekLocked ? <Lock size={18} className="shrink-0 text-muted" aria-hidden /> : <CircleCheck size={18} className="shrink-0 text-win" aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{data.weekLocked ? `${weekLabel} lineups locked` : `${weekLabel} lineup set`}</span>
      <Link href={data.href} className="-my-1.5 inline-flex min-h-10 shrink-0 items-center px-1 text-[14px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
        {data.weekLocked ? "View" : "Review"}
      </Link>
    </section>
  );
}
