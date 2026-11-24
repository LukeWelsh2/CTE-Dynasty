// League pulse modules: rule suggestions in voting, the latest weekly recap teaser, top-3 power rankings.
import Link from "next/link";
import { Check, Medal, Newspaper, Vote } from "lucide-react";
import { Badge, Panel, TeamLogo } from "@/components/ui/core";
import { cn, ordinal } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
import { countdownLabel, formatWhen } from "./logic";
import type { PulseData } from "./types";

export function RuleVotes({ data, now, timezone, className }: { data: PulseData; now: Date; timezone: string; className?: string }) {
  return (
    <Panel title="Rule Votes" className={className} actions={<MoreLink href="/rules/suggestions">Suggestions</MoreLink>}>
      {data.votes.length ? (
        <ul className="space-y-3">
          {data.votes.map((v) => {
            const cast = v.support + v.oppose + v.abstain;
            const decisive = v.support + v.oppose;
            const supportPct = decisive ? (v.support / decisive) * 100 : 0;
            const ends = v.votingEndsAt ? new Date(v.votingEndsAt) : null;
            const open = !ends || ends.getTime() > now.getTime();
            return (
              <li key={v.id}>
                <Link href={`/rules/suggestions/${v.id}`} className="group block">
                  <div className="flex items-start gap-2">
                    <Vote size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold leading-snug text-ink group-hover:underline">{v.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                        <Badge tone="neutral">{v.category.toLowerCase()}</Badge>
                        <span>
                          {cast} of {data.totalVoters} voted
                        </span>
                        {ends && (
                          <span suppressHydrationWarning title={formatWhen(ends, timezone, now)}>
                            {open ? `closes ${countdownLabel(ends, now)}` : "voting closed"}
                          </span>
                        )}
                      </div>
                    </div>
                    {v.myVote !== null ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-win">
                        <Check size={12} aria-hidden /> Voted
                      </span>
                    ) : open ? (
                      <span className="shrink-0 rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-bold uppercase text-brand-950">Vote</span>
                    ) : null}
                  </div>
                  <div className="ml-6 mt-1.5 flex items-center gap-2 text-[10px] font-semibold tabular-nums">
                    <span className="text-win">{v.support} yes</span>
                    <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${v.support} support, ${v.oppose} oppose`}>
                      <span className="h-full bg-win" style={{ width: `${supportPct}%` }} />
                      <span className="h-full bg-loss" style={{ width: `${decisive ? 100 - supportPct : 0}%` }} />
                    </div>
                    <span className="text-loss">{v.oppose} no</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <PanelEmpty action={<MoreLink href="/rules/suggestions">Suggest a rule change</MoreLink>}>No rule changes are up for a vote.</PanelEmpty>
      )}
    </Panel>
  );
}

export function RecapTeaser({ data, week, className }: { data: PulseData; week: number; className?: string }) {
  const r = data.recap;
  return (
    <Panel title="Weekly Recap" className={className} actions={<MoreLink href={r ? `/recaps/${r.week}` : "/recaps"}>{r ? "Read recap" : "All recaps"}</MoreLink>}>
      {r ? (
        <div className="flex gap-3">
          <span className="hidden h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-900 text-white sm:flex">
            <span className="text-[9px] font-bold uppercase leading-none text-gold-400">Week</span>
            <span className="font-display text-xl font-extrabold leading-none">{r.week}</span>
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/recaps/${r.week}`} className="font-display text-lg font-bold uppercase leading-tight tracking-wide text-ink hover:underline">
              {r.headline}
            </Link>
            {r.intro && <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted">{r.intro}</p>}
            {r.awards.length > 0 && (
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {r.awards.map((a) => {
                  const team = a.teamId ? r.teams[a.teamId] : undefined;
                  return (
                    <li key={a.title} className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-sunken/60 px-2 py-1.5">
                      {team ? <TeamLogo team={team} size={22} /> : <Medal size={16} className="text-gold-500" aria-hidden />}
                      <div className="min-w-0">
                        <div className="truncate text-[10px] font-bold uppercase tracking-wide text-muted">{a.title}</div>
                        <div className="truncate text-xs font-semibold text-ink">
                          {team?.abbrev ? `${team.abbrev} · ` : ""}
                          {a.value}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href={`/recaps/${r.week}`} className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Read the full Week {r.week} recap →
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 text-sm text-muted">
          <Newspaper size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            No recap yet this season.{" "}
            {data.recapsEnabled
              ? `Recaps of each completed week post ${data.recapSchedule}${week > 1 ? "." : " once Week 1 wraps."}`
              : "Each week's recap is written once all of its matchups are final."}{" "}
            <Link href="/recaps" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Recap archive
            </Link>
          </p>
        </div>
      )}
    </Panel>
  );
}

const MEDALS = ["bg-gold-500 text-brand-950", "bg-slate-300 text-slate-900", "bg-amber-700 text-white"];

export function PowerTop3({ data, className }: { data: PulseData; className?: string }) {
  if (!data.showPower) return null;
  return (
    <Panel title="Power Rankings" className={className} actions={<MoreLink href="/standings/power">Top to bottom</MoreLink>}>
      {data.power.length ? (
        <ol className="space-y-2">
          {data.power.map((p, i) => (
            <li key={p.team.id}>
              <Link href={`/teams/${p.team.id}`} className="flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-sunken">
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold", MEDALS[i] ?? "bg-sunken text-ink")}>{p.powerRank}</span>
                <TeamLogo team={p.team} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{p.team.name}</span>
                  <span className="block text-[11px] text-muted">
                    {p.record} · {ordinal(p.rank)} in standings
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-lg font-bold leading-none tabular-nums text-ink">{p.powerScore.toFixed(1)}</span>
                  <span className="block text-[9px] font-bold uppercase text-muted">score</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <PanelEmpty>Power rankings appear after the first week of games.</PanelEmpty>
      )}
    </Panel>
  );
}
