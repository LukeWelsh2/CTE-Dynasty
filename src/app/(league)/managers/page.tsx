// All managers, ranked by this season's standings: avatar, name, team, season + all-time record, titles.
// Motto, location, favourite NFL team and the in-depth stats live one tap away on each profile.
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { managerSummaries } from "@/lib/stats/load";
import { Avatar, EmptyState, PageHeader, TeamLogo } from "@/components/ui/core";
import { LeagueTabs, fmtRecord } from "@/components/community/bits";
import { DmButton } from "@/components/community/dm-button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Managers" };

export default async function ManagersPage() {
  const ctx = await getLeagueContext();
  const [members, summaries] = await Promise.all([
    db.leagueMember.findMany({
      where: { leagueId: ctx.league.id },
      include: { user: { include: { profile: true } }, team: true },
      orderBy: { joinedAt: "asc" },
    }),
    managerSummaries(ctx),
  ]);
  const sorted = [...members].sort((a, b) => (summaries.get(a.userId)?.standing?.rank ?? 99) - (summaries.get(b.userId)?.standing?.rank ?? 99));
  const trophy = ctx.settings.general.championTrophyName || "Championship";

  return (
    <div className="mx-auto max-w-3xl">
      <LeagueTabs active="managers" />
      <PageHeader kicker={`${ctx.season} season`} title="Managers" subtitle={`${members.length} managers · ranked by standings`} />
      {members.length === 0 ? (
        <EmptyState title="No managers yet">Managers appear here once they join with the league invite code.</EmptyState>
      ) : (
        <section className="card overflow-hidden">
          <div className="eyebrow flex items-center gap-2 border-b border-line/70 py-2 pl-4 pr-12 sm:gap-3 sm:pr-14">
            <span className="w-5 text-center">#</span>
            <span className="flex-1">Manager</span>
            <span className="w-11 text-right sm:w-16">{ctx.season}</span>
            <span className="w-[52px] whitespace-nowrap text-right sm:w-20">All-time</span>
            <span className="hidden w-14 text-right sm:block">Titles</span>
          </div>
          <ul className="divide-y divide-line/70">
            {sorted.map((m) => {
              const p = m.user.profile;
              const name = p?.displayName?.trim() || m.user.name;
              const s = summaries.get(m.userId);
              const team = m.team;
              const me = m.userId === ctx.user.id;
              const played = !!s?.standing && s.standing.wins + s.standing.losses + s.standing.ties > 0;
              const season = s?.standing ? fmtRecord(s.standing.wins, s.standing.losses, s.standing.ties) : "—";
              const allTime = s ? fmtRecord(s.allTime.wins, s.allTime.losses, s.allTime.ties) : "—";
              const titles = s?.titles ?? 0;
              const commish = m.role === "COMMISSIONER" || m.role === "CO_COMMISSIONER";
              return (
                <li key={m.id} className={cn("flex items-center", me && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]")}>
                  <Link
                    href={`/managers/${m.userId}`}
                    className="flex min-h-[64px] min-w-0 flex-1 items-center gap-2 py-2.5 pl-4 pr-1 transition-colors hover:bg-sunken/70 active:bg-sunken sm:gap-3"
                  >
                    <span className="numeral w-5 shrink-0 text-center text-[15px] font-semibold text-muted">{played ? s!.standing!.rank : "—"}</span>
                    <Avatar name={name} src={m.user.avatarUrl} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={cn("truncate text-[15px] font-semibold leading-5 sm:text-sm", me ? "text-brand-600 dark:text-brand-400" : "text-ink")} title={name}>
                          {name}
                        </span>
                        {commish && (
                          <span className="inline-flex shrink-0 text-brand-600 dark:text-brand-400" title={m.role === "COMMISSIONER" ? "Commissioner" : "Co-commissioner"}>
                            <ShieldCheck size={15} aria-label={m.role === "COMMISSIONER" ? "Commissioner" : "Co-commissioner"} />
                          </span>
                        )}
                        {titles > 0 && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-gold-700 sm:hidden dark:text-gold-400" title={`${titles} × ${trophy}`}>
                            <Trophy size={13} aria-hidden /> {titles}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted" title={team?.name}>
                        {team ? (
                          <>
                            <TeamLogo team={team} size={16} className="shrink-0" /> <span className="truncate">{team.name}</span>
                          </>
                        ) : (
                          "No team"
                        )}
                      </span>
                    </span>
                    <span className="numeral w-11 shrink-0 text-right text-[15px] font-semibold text-ink sm:w-16 sm:text-sm">{season}</span>
                    <span className="numeral w-[52px] shrink-0 text-right text-[15px] text-muted sm:w-20 sm:text-sm sm:text-ink">{allTime}</span>
                    <span className="numeral hidden w-14 shrink-0 items-center justify-end gap-1 text-[15px] sm:flex sm:text-sm" title={`${titles} × ${trophy}`}>
                      {titles > 0 && <Trophy size={13} className="text-gold-700 dark:text-gold-400" aria-hidden />}
                      {titles}
                    </span>
                  </Link>
                  <span className="flex w-11 shrink-0 justify-center pr-1 sm:w-[52px] sm:pr-2">{!me && <DmButton userId={m.userId} iconOnly label={`Message ${name}`} />}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
