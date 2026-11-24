import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { Badge, EmptyState, InjuryTag, NflLogo, PageHeader, PlayerHeadshot, PosBadge, StatTile } from "@/components/ui/core";
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
    { key: "rostered", label: "Rostered in league" },
    { key: "all", label: "All fantasy-relevant" },
  ];
  const positions = ["ALL", "QB", "RB", "WR", "TE", "K", ...(ctx.settings.roster.idpEnabled ? ["DL", "LB", "DB"] : [])];
  const myStartersInjured = rows.filter((r) => r.myStarter);

  return (
    <div>
      <PageHeader kicker={`Week ${ctx.week}`} title="Injury Report" subtitle="Live designations from the NFL injury report, with practice participation and fantasy owners." />

      {ctx.myTeam && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label={`My injured starters · Wk ${ctx.week}`} value={summary.myInjuredStarters} sub={summary.myStartersOut ? `${summary.myStartersOut} out or worse` : "none ruled out"} tone={summary.myInjuredStarters ? "bad" : "good"} />
          <StatTile label="My injured players" value={summary.myInjured} sub={`${summary.myIr} on IR / PUP`} />
          <StatTile label="Injured starters (league)" value={rows.filter((r) => r.starterFor).length} sub={`${summary.questionableStarters} questionable`} />
          <StatTile label={f.scope === "mine" ? "Shown" : "Rostered & injured"} value={f.scope === "mine" ? rows.length : summary.leagueRosteredInjured} sub={f.scope === "all" ? `${rows.length} fantasy-relevant total` : undefined} />
        </div>
      )}

      {myStartersInjured.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <b>Check your lineup:</b> {myStartersInjured.map((r) => `${r.player.fullName} (${r.injury.status})`).join(", ")} {myStartersInjured.length === 1 ? "is" : "are"} in your Week {ctx.week} starting lineup.{" "}
            <Link href="/team" className="font-semibold underline">
              Edit lineup
            </Link>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="scroll-thin flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-panel p-1" role="tablist" aria-label="Scope">
          {scopes.map((s) => (
            <Link
              key={s.key}
              role="tab"
              aria-selected={f.scope === s.key}
              href={href(f, { scope: s.key })}
              className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-bold", f.scope === s.key ? "bg-brand-700 text-white dark:bg-brand-600" : "text-muted hover:bg-sunken hover:text-ink")}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <div className="scroll-thin flex gap-1 overflow-x-auto" role="tablist" aria-label="Position">
          {positions.map((p) => (
            <Link
              key={p}
              role="tab"
              aria-selected={f.pos === p}
              href={href(f, { pos: p as InjuryFilters["pos"] })}
              className={cn("h-8 min-w-[40px] rounded-md border px-2 py-1.5 text-center text-xs font-bold", f.pos === p ? "border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-600" : "border-line bg-panel hover:bg-sunken")}
            >
              {p}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={f.scope === "mine" ? "Your roster is healthy" : "No injured players"}>
          {f.scope === "mine" ? "None of your players carry an injury designation right now." : "Nobody matching these filters is on the injury report."}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {INJURY_GROUPS.map((g) => {
            const list = rows.filter((r) => r.group === g.key);
            if (!list.length) return null;
            return (
              <section key={g.key} className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
                <header className="flex items-center justify-between border-b border-line bg-sunken/70 px-3 py-2">
                  <h2 className="font-display text-[15px] font-bold uppercase tracking-wide">
                    {g.label} <span className="ml-1 text-xs font-semibold text-muted">({list.length})</span>
                  </h2>
                </header>
                <div className="scroll-thin hidden overflow-x-auto md:block">
                  <table className="tbl text-[13px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 min-w-[190px]">Player</th>
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
                        <tr key={r.player.id} className={cn(r.myStarter && "[&>td:not(:first-child)]:bg-red-50 dark:[&>td:not(:first-child)]:bg-red-950/30")}>
                          <td className={cn("sticky left-0 z-[5] !bg-panel", r.myStarter && "shadow-[inset_3px_0_0_0_theme(colors.red.600)]")}>
                            <div className="flex items-center gap-2">
                              <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                                <PlayerHeadshot player={r.player} size={28} />
                              </PlayerCardButton>
                              <div className="min-w-0">
                                <Link href={`/players/${r.player.id}`} className="block truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                  {r.player.fullName}
                                </Link>
                                {r.myStarter && <Badge tone="red">My starter · Wk {ctx.week}</Badge>}
                                {!r.myStarter && r.starterFor && <span className="block text-[10px] text-muted">Starting for {r.starterFor}</span>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <PosBadge pos={r.player.position} />
                          </td>
                          <td className="whitespace-nowrap">
                            {r.player.team ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold">
                                <NflLogo abbr={r.player.team} size={16} /> {r.player.team}
                              </span>
                            ) : (
                              <span className="text-xs text-muted">FA</span>
                            )}
                          </td>
                          <td>
                            <OwnerTag owner={r.owner} />
                            {r.rosterStatus && r.rosterStatus !== "ACTIVE" && <span className="ml-1 text-[10px] font-bold text-muted">{r.rosterStatus}</span>}
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
                          <td className="text-xs">
                            {r.injury.note ? (
                              <>
                                <p>{r.injury.note}</p>
                                {r.injury.detail && (
                                  <details className="mt-0.5">
                                    <summary className="cursor-pointer text-[11px] font-semibold text-brand-700 dark:text-brand-300">More</summary>
                                    <p className="mt-0.5 text-muted">{r.injury.detail}</p>
                                  </details>
                                )}
                              </>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap text-xs text-muted" title={r.injury.updatedAt ? fmtDateTime(r.injury.updatedAt, tz) : undefined}>
                            {r.injury.updatedAt ? timeAgo(r.injury.updatedAt) : "—"}
                          </td>
                          <td className="whitespace-nowrap text-xs">{r.injury.returnDate ? fmtCalendarDate(r.injury.returnDate) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-line md:hidden">
                  {list.map((r) => (
                    <li key={r.player.id} className={cn("flex items-start gap-3 px-3 py-2.5", r.myStarter && "bg-red-50 shadow-[inset_3px_0_0_0_theme(colors.red.600)] dark:bg-red-950/30")}>
                      <PlayerCardButton playerId={r.player.id} playerName={r.player.fullName}>
                        <PlayerHeadshot player={r.player} size={36} />
                      </PlayerCardButton>
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/players/${r.player.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                            {r.player.fullName}
                          </Link>
                          <PosBadge pos={r.player.position} />
                          <span className="text-xs text-muted">{r.player.team ?? "FA"}</span>
                          <span className="ml-auto">
                            <OwnerTag owner={r.owner} />
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <InjuryTag status={r.injury.status} />
                          <b>{r.injury.status}</b>
                          {r.injury.bodyPart && <span className="text-muted">· {r.injury.bodyPart}</span>}
                          {r.practice.value && <PracticeTag value={r.practice.value} />}
                          {r.myStarter && <Badge tone="red">My starter</Badge>}
                        </div>
                        {r.injury.note && <p className="mt-1 line-clamp-3 text-xs text-muted">{r.injury.note}</p>}
                        <div className="mt-1 text-[11px] text-muted">
                          {r.injury.updatedAt ? `Updated ${timeAgo(r.injury.updatedAt)}` : "Official designation"}
                          {r.injury.returnDate ? ` · est. return ${fmtCalendarDate(r.injury.returnDate)}` : ""}
                          {!r.myStarter && r.starterFor ? ` · starting for ${r.starterFor}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
