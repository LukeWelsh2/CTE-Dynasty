// League pulse modules: rule suggestions in voting, the latest weekly recap teaser, top-3 power rankings.
import Link from "next/link";
import { Check, Medal, Newspaper } from "lucide-react";
import { buttonClass, Panel, RankBar, RankList, TeamLogo } from "@/components/ui/core";
import { ordinal } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
import { countdownLabel, formatWhen } from "./logic";
import type { PulseData } from "./types";

export function RuleVotes({ data, now, timezone, className }: { data: PulseData; now: Date; timezone: string; className?: string }) {
  return (
    <Panel title="Rule votes" className={className} noPad actions={<MoreLink href="/rules/suggestions">All</MoreLink>}>
      {data.votes.length ? (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {data.votes.map((v) => {
            const cast = v.support + v.oppose + v.abstain;
            const decisive = v.support + v.oppose;
            const supportPct = decisive ? (v.support / decisive) * 100 : 0;
            const ends = v.votingEndsAt ? new Date(v.votingEndsAt) : null;
            const open = !ends || ends.getTime() > now.getTime();
            return (
              <li key={v.id}>
                <Link href={`/rules/suggestions/${v.id}`} className="block px-4 py-3 transition-colors hover:bg-sunken/70">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[15px] font-semibold leading-5 text-ink sm:text-sm">{v.title}</div>
                      <div className="mt-0.5 truncate text-[13px] leading-[18px] text-muted">
                        {v.category.charAt(0) + v.category.slice(1).toLowerCase()} · {cast}/{data.totalVoters} voted
                        {ends && (
                          <span suppressHydrationWarning title={formatWhen(ends, timezone, now)}>
                            {" "}
                            · {open ? `closes ${countdownLabel(ends, now)}` : "closed"}
                          </span>
                        )}
                      </div>
                    </div>
                    {v.myVote !== null ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-win">
                        <Check size={14} aria-hidden /> Voted
                      </span>
                    ) : open ? (
                      <span className={buttonClass("primary", "sm", "pointer-events-none shrink-0")}>Vote</span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[12px] font-semibold tabular-nums">
                    <span className="w-10 text-win">{v.support} yes</span>
                    <div className="flex h-1.5 flex-1 gap-[2px] overflow-hidden rounded-full bg-ink/[0.06] dark:bg-white/[0.08]" role="img" aria-label={`${v.support} support, ${v.oppose} oppose`}>
                      {supportPct > 0 && <span className="h-full rounded-full bg-win" style={{ width: `${supportPct}%` }} />}
                      {decisive > 0 && supportPct < 100 && <span className="h-full rounded-full bg-loss" style={{ width: `${100 - supportPct}%` }} />}
                    </div>
                    <span className="w-10 text-right text-loss">{v.oppose} no</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 pb-4">
          <PanelEmpty action={<MoreLink href="/rules/suggestions">Suggest a rule change</MoreLink>}>No rule changes are up for a vote.</PanelEmpty>
        </div>
      )}
    </Panel>
  );
}

/** Latest weekly recap: headline, the intro behind "Read", and the awards as a stat grid. */
export function RecapTeaser({ data, week, className }: { data: PulseData; week: number; className?: string }) {
  const r = data.recap;
  return (
    <Panel
      title={r ? `Week ${r.week} recap` : "Weekly recap"}
      className={className}
      actions={<MoreLink href={r ? `/recaps/${r.week}` : "/recaps"}>{r ? "Read" : "All recaps"}</MoreLink>}
      info={
        r?.intro ? (
          <p>{r.intro}</p>
        ) : !r ? (
          <p>
            {data.recapsEnabled
              ? `Recaps of each completed week post ${data.recapSchedule}${week > 1 ? "." : " once Week 1 wraps."}`
              : "Each week's recap is written once all of its matchups are final."}
          </p>
        ) : undefined
      }
      infoTitle={r ? r.headline : "Weekly recaps"}
    >
      {r ? (
        <div>
          <Link href={`/recaps/${r.week}`} className="line-clamp-2 text-[17px] font-semibold leading-6 tracking-[-0.01em] text-ink hover:underline">
            {r.headline}
          </Link>
          {r.awards.length > 0 && (
            <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              {r.awards.map((a) => {
                const team = a.teamId ? r.teams[a.teamId] : undefined;
                return (
                  <li key={a.title} className="flex min-w-0 items-center gap-2.5">
                    {team ? <TeamLogo team={team} size={28} /> : <Medal size={18} className="text-gold-600" aria-hidden />}
                    <div className="min-w-0">
                      <div className="eyebrow truncate">{a.title}</div>
                      <div className="truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">
                        {team?.abbrev ? `${team.abbrev} · ` : ""}
                        {a.value}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[15px] text-muted sm:text-sm">
          <Newspaper size={18} className="shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">No recap yet this season.</p>
          <Link href="/recaps" className="link shrink-0">
            Archive
          </Link>
        </div>
      )}
    </Panel>
  );
}

/** Top-3 power rankings as RankBars (score bar scaled to the leader). */
export function PowerTop3({ data, className }: { data: PulseData; className?: string }) {
  if (!data.showPower) return null;
  const max = Math.max(1, ...data.power.map((p) => p.powerScore));
  return (
    <Panel title="Power rankings" className={className} noPad actions={<MoreLink href="/standings/power">All</MoreLink>}>
      {data.power.length ? (
        <RankList className="border-t border-line/70">
          {data.power.map((p) => (
            <RankBar
              key={p.team.id}
              rank={p.powerRank}
              leading={<TeamLogo team={p.team} size={28} />}
              title={p.team.name}
              sub={`${p.record} · ${ordinal(p.rank)}`}
              value={p.powerScore}
              max={max}
              href={`/teams/${p.team.id}`}
            />
          ))}
        </RankList>
      ) : (
        <div className="px-4 pb-4">
          <PanelEmpty>Power rankings appear after the first week of games.</PanelEmpty>
        </div>
      )}
    </Panel>
  );
}
