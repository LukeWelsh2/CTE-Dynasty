// Injury report — "Which of my players are hurt, and who's out this week?" Summary strip (my injured starters, my
// injured players, league starters, rostered), a one-line lineup alert, scope + position controls, then one card per
// designation group: phones get Roster-pattern rows (headshot · name + owner / position · status · injury · practice /
// the latest note), md+ the full table. Where the data comes from sits in the ⓘ.
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { Badge, Chip, EmptyState, InfoButton, InjuryTag, NflLogo, PageHeader, Panel, PlayerHeadshot, SegmentedLinks, SummaryStrip } from "@/components/ui/core";
import { HeadshotBadge, PosPill } from "@/components/ui/fantasy";
import { ScrollRow } from "@/components/ui/scroll-row";
import { PlayerCardButton } from "@/components/players/player-card";
import { OwnerTag, PracticeTag } from "@/components/players/tags";
import { fmtCalendarDate, fmtDateTime } from "@/lib/players/format";
import { INJURY_GROUPS } from "@/lib/players/logic";
import { loadInjuryReport, parseInjuryFilters, type InjuryFilters } from "@/lib/players/injuries";
import { cn, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Injury Report" };

function href(f: InjuryFilters, patch: Partial<InjuryFilters>) {
  const n = { ...f, ...patch };
  const p = new URLSearchParams();
  p.set("scope", n.scope);
  if (n.pos !== "ALL") p.set("pos", n.pos);
  return `/injuries?${p.toString()}`;
}

export default async function InjuriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getLeagueContext();
  const f = parseInjuryFilters(await searchParams, !!ctx.myTeam);
  const { rows, summary } = await loadInjuryReport(ctx, f);
  const tz = ctx.settings.general.timezone;
  const scopes: { key: InjuryFilters["scope"]; label: string }[] = [
    ...(ctx.myTeam ? [{ key: "mine" as const, label: "My team" }] : []),
    { key: "rostered", label: "Rostered" },
    { key: "all", label: "All" },
  ];
  const positions = ["ALL", "QB", "RB", "WR", "TE", "K", ...(ctx.settings.roster.idpEnabled ? ["DL", "LB", "DB"] : [])];
  const myStartersInjured = rows.filter((r) => r.myStarter);

  return (
    <div>
      <PageHeader
        kicker={`Week ${ctx.week}`}
        title={
          <span className="inline-flex items-center gap-1.5">
            Injury report
            <InfoButton title="Injury report" size={18}>
              <p>Live designations from the NFL injury report (via ESPN), with practice participation and each player&apos;s fantasy owner.</p>
              <p>&quot;Rostered&quot; shows players on a team in this league; &quot;All&quot; adds fantasy-relevant free agents. Practice marked from a note is read from the latest report text.</p>
            </InfoButton>
          </span>
        }
      />

      <div className="space-y-3">
        {ctx.myTeam && (
          <SummaryStrip
            items={[
              { label: "Starters", value: summary.myInjuredStarters, sub: summary.myStartersOut ? `${summary.myStartersOut} out` : "none out", tone: summary.myInjuredStarters ? "bad" : "good", title: `My injured starters · Week ${ctx.week}` },
              { label: "My team", value: summary.myInjured, sub: `${summary.myIr} IR / PUP`, title: "My injured players" },
              { label: "League", value: summary.leagueInjuredStarters, sub: `${summary.questionableStarters} Q`, title: `Injured starters in the league · Week ${ctx.week}` },
              { label: "Total", value: summary.leagueRosteredInjured, sub: "rostered", title: "Rostered and injured, league-wide" },
            ]}
          />
        )}

        {myStartersInjured.length > 0 && (
          <Link href="/team" className="flex min-h-12 items-start gap-2 rounded-card bg-red-500/[0.07] px-4 py-3 text-[15px] text-ink transition-colors hover:bg-red-500/10 dark:bg-red-400/10 sm:text-sm">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-loss" aria-hidden />
            <span className="min-w-0">
              <b className="text-loss">Check your lineup:</b> {myStartersInjured.map((r) => `${r.player.fullName} (${r.injury.status})`).join(", ")}{" "}
              <span className="font-semibold text-brand-600 dark:text-brand-400">Edit lineup ›</span>
            </span>
          </Link>
        )}

        <SegmentedLinks options={scopes.map((s) => ({ key: s.key, label: s.label, href: href(f, { scope: s.key }) }))} active={f.scope} full ariaLabel="Scope" scroll={false} />
        <ScrollRow aria-label="Position" className="-mx-3 scroll-px-3 gap-2 px-3 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {positions.map((p) => (
            <Chip key={p} href={href(f, { pos: p as InjuryFilters["pos"] })} active={f.pos === p} scroll={false} className="min-w-[48px]">
              {p === "ALL" ? "All" : p}
            </Chip>
          ))}
        </ScrollRow>

        {rows.length === 0 ? (
          <EmptyState title={f.scope === "mine" ? "Your roster is healthy" : "No injured players"}>
            {f.scope === "mine" ? "None of your players has an injury designation." : "Nobody matching these filters is on the injury report."}
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {INJURY_GROUPS.map((g) => {
              const list = rows.filter((r) => r.group === g.key);
              if (!list.length) return null;
              return (
                <Panel key={g.key} title={`${g.label} · ${list.length}`} noPad>
                  <div className="scroll-thin hidden overflow-x-auto border-t border-line/70 md:block">
                    <table className="tbl text-[13px]">
                      <thead>
                        <tr>
                          <th className="tbl-sticky min-w-[200px]">Player</th>
                          <th>Pos</th>
                          <th>NFL</th>
                          <th>Owner</th>
                          <th>Status</th>
                          <th>Injury</th>
                          <th>Practice</th>
                          <th className="min-w-[280px]">Latest note</th>
                          <th>Updated</th>
                          <th>Est. return</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.player.id} className={cn(r.myStarter && "row-mine")}>
                            <td className="tbl-sticky">
                              <div className="flex items-center gap-2">
                                <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                                  <PlayerHeadshot player={r.player} size={28} />
                                </PlayerCardButton>
                                <div className="min-w-0">
                                  <Link href={`/players/${r.player.id}`} className="block truncate font-semibold text-ink hover:underline">
                                    {r.player.fullName}
                                  </Link>
                                  {r.myStarter && <Badge tone="red">My starter · Wk {ctx.week}</Badge>}
                                  {!r.myStarter && r.starterFor && <span className="block text-[12px] text-muted">Starting for {r.starterFor}</span>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <PosPill pos={r.player.position} />
                            </td>
                            <td className="whitespace-nowrap">
                              {r.player.team ? (
                                <span className="inline-flex items-center gap-1 font-semibold">
                                  <NflLogo abbr={r.player.team} size={16} /> {r.player.team}
                                </span>
                              ) : (
                                <span className="text-muted">FA</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap">
                              <OwnerTag owner={r.owner} />
                              {r.rosterStatus && r.rosterStatus !== "ACTIVE" && <span className="ml-1 text-[11px] font-bold text-muted">{r.rosterStatus}</span>}
                            </td>
                            <td className="whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                <InjuryTag status={r.injury.status} /> <span className="font-semibold">{r.injury.status}</span>
                              </span>
                            </td>
                            <td className="whitespace-nowrap">{r.injury.bodyPart ?? "—"}</td>
                            <td>
                              <span title={r.practice.derived ? "From the latest injury-report note" : undefined}>
                                <PracticeTag value={r.practice.value} />
                              </span>
                            </td>
                            <td>
                              {r.injury.note ? (
                                <>
                                  <p>{r.injury.note}</p>
                                  {r.injury.detail && (
                                    <details className="mt-0.5">
                                      <summary className="cursor-pointer text-[12px] font-semibold text-brand-600 dark:text-brand-400">More</summary>
                                      <p className="mt-0.5 text-muted">{r.injury.detail}</p>
                                    </details>
                                  )}
                                </>
                              ) : (
                                <span className="text-faint">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap text-muted" title={r.injury.updatedAt ? fmtDateTime(r.injury.updatedAt, tz) : undefined}>
                              {r.injury.updatedAt ? timeAgo(r.injury.updatedAt) : "—"}
                            </td>
                            <td className="whitespace-nowrap">{r.injury.returnDate ? fmtCalendarDate(r.injury.returnDate) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
                    {list.map((r) => (
                      <li key={r.player.id} className={cn("flex items-start gap-3 px-4 py-3", r.myStarter && "bg-red-500/[0.05] shadow-[inset_3px_0_0_rgb(208_31_43)] dark:bg-red-400/10")}>
                        <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                          <HeadshotBadge player={r.player} nflTeam={r.player.team} size={44} />
                        </PlayerCardButton>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link href={`/players/${r.player.id}`} title={r.player.fullName} className="min-w-0 truncate text-[15px] font-bold leading-5 text-ink hover:underline">
                              {r.player.fullName}
                            </Link>
                            <span className="ml-auto shrink-0">
                              <OwnerTag owner={r.owner} />
                            </span>
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-4">
                            <PosPill pos={r.player.position} />
                            <span className="font-medium text-ink">{r.player.team ?? "FA"}</span>
                            <span className="font-bold text-loss">{r.injury.status}</span>
                            {r.injury.bodyPart && <span className="text-muted">· {r.injury.bodyPart}</span>}
                            {r.practice.value && <PracticeTag value={r.practice.value} />}
                          </div>
                          {r.myStarter && (
                            <div className="mt-1">
                              <Badge tone="red">My starter · Wk {ctx.week}</Badge>
                            </div>
                          )}
                          {r.injury.note && <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-muted">{r.injury.note}</p>}
                          <div className="mt-1 truncate text-[12px] text-muted">
                            {r.injury.updatedAt ? `Updated ${timeAgo(r.injury.updatedAt)}` : "Official designation"}
                            {r.injury.returnDate ? ` · est. return ${fmtCalendarDate(r.injury.returnDate)}` : ""}
                            {!r.myStarter && r.starterFor ? ` · starting for ${r.starterFor}` : ""}
                            {r.rosterStatus && r.rosterStatus !== "ACTIVE" ? ` · ${r.rosterStatus}` : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
