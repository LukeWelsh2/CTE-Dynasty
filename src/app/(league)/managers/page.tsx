// All managers: avatar, display name, team, current record, titles and motto.
import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { managerSummaries } from "@/lib/stats/load";
import { Avatar, Badge, EmptyState, NflLogo, PageHeader, TeamLogo } from "@/components/ui/core";
import { LeagueTabs, fmtRecord } from "@/components/community/bits";
import { DmButton } from "@/components/community/dm-button";
import { ordinal } from "@/lib/utils";

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
    <div>
      <LeagueTabs active="managers" />
      <PageHeader kicker={`${ctx.season} season`} title="Managers" subtitle={`${members.length} managers · profiles, records and in-depth stats`} />
      {members.length === 0 ? (
        <EmptyState title="No managers yet">Managers appear here once they join with the league invite code.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((m) => {
            const p = m.user.profile;
            const name = p?.displayName?.trim() || m.user.name;
            const s = summaries.get(m.userId);
            const team = m.team;
            const me = m.userId === ctx.user.id;
            return (
              <article key={m.id} className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
                <Link href={`/managers/${m.userId}`} className="relative block h-16" aria-label={`${name}'s profile`}>
                  {p?.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div
                      className="h-full w-full"
                      style={{ background: `linear-gradient(120deg, ${team?.primaryColor ?? "#1f3fa1"} 0%, ${team?.primaryColor ?? "#1f3fa1"} 60%, ${team?.secondaryColor ?? "#f5b301"} 60%)` }}
                    />
                  )}
                  {s?.standing && s.standing.wins + s.standing.losses + s.standing.ties > 0 && (
                    <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-bold text-white">{ordinal(s.standing.rank)} place</span>
                  )}
                </Link>
                <div className="relative -mt-8 flex flex-1 flex-col px-3 pb-3">
                  <div className="flex items-end gap-2">
                    <Link href={`/managers/${m.userId}`} className="rounded-full ring-4 ring-panel">
                      <Avatar name={name} src={m.user.avatarUrl} size={60} />
                    </Link>
                    <div className="mb-1 flex flex-wrap gap-1">
                      {(m.role === "COMMISSIONER" || m.role === "CO_COMMISSIONER") && <Badge tone="gold">{m.role === "COMMISSIONER" ? "Commish" : "Co-commish"}</Badge>}
                      {me && <Badge tone="brand">You</Badge>}
                    </div>
                  </div>
                  <Link href={`/managers/${m.userId}`} className="mt-1 truncate font-display text-lg font-bold leading-tight hover:underline">
                    {name}
                  </Link>
                  {team ? (
                    <Link href={`/teams/${team.id}`} className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted hover:text-ink">
                      <TeamLogo team={team} size={18} /> <span className="truncate">{team.name}</span>
                    </Link>
                  ) : (
                    <span className="text-sm text-muted">No team</span>
                  )}
                  {p?.motto && <p className="mt-1.5 line-clamp-2 text-sm italic text-muted">“{p.motto}”</p>}
                  <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-2 text-center">
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{ctx.season}</dt>
                      <dd className="font-display text-base font-bold tabular-nums">{s?.standing ? fmtRecord(s.standing.wins, s.standing.losses, s.standing.ties) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">All-time</dt>
                      <dd className="font-display text-base font-bold tabular-nums">{s ? fmtRecord(s.allTime.wins, s.allTime.losses, s.allTime.ties) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Titles</dt>
                      <dd className="flex items-center justify-center gap-1 font-display text-base font-bold tabular-nums" title={`${s?.titles ?? 0} × ${trophy}`}>
                        {s?.titles ? <Trophy size={14} className="text-gold-500" /> : null}
                        {s?.titles ?? 0}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                    {p?.favoriteNflTeam && <NflLogo abbr={p.favoriteNflTeam} size={18} />}
                    {p?.location && (
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <MapPin size={12} /> {p.location}
                      </span>
                    )}
                    <span className="ml-auto flex gap-1.5">
                      {!me && <DmButton userId={m.userId} size="xs" variant="ghost" label="Message" />}
                      <Link href={`/managers/${m.userId}`} className="inline-flex h-6 items-center rounded-md px-2 text-[11px] font-semibold text-brand-600 hover:bg-sunken dark:text-brand-300">
                        Stats →
                      </Link>
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
