"use client";
// My Team header — the canonical "Roster" pattern (docs/DESIGN.md §6.2), mirroring the reference app: round logo,
// team name with ▾ (switch teams), owner and record in grey, then one row of five quick-action tiles (Player · Trades ·
// Waivers · News · More). "More" opens a sheet with everything the old header showed (record, PF/PA, streak, FAB, cap
// meter, roster counts, this week's matchup) plus the team sub-pages (insights, contracts, picks, keepers…).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, Clock, Ellipsis, FileText, Plus, Shield } from "lucide-react";
import { Modal } from "@/components/ui/client";
import { Stat, TeamLogo } from "@/components/ui/core";
import { cn, fmtMoney, fmtPts, ordinal } from "@/lib/utils";
import type { TeamHeaderData } from "@/lib/team/data";
import { CapMeter, CountPill } from "./bits";

export interface RosterHeaderLinks {
  insights: string;
  contracts: string;
  picks: string;
  keepers: string | null;
}

export function RosterHeader({
  data,
  teams,
  myTeamId,
  manageOthers,
  commishNote,
  links,
}: {
  data: TeamHeaderData;
  /** every team in the league, for the ▾ switcher */
  teams: { id: string; name: string }[];
  myTeamId: string | null;
  /** commissioner with lineup powers: other teams open here (/team?team=…) instead of their public page */
  manageOthers: boolean;
  commishNote?: string;
  links: RosterHeaderLinks;
}) {
  const router = useRouter();
  const [more, setMore] = useState(false);
  const { team, owner } = data;
  const go = (id: string) => {
    if (id === myTeamId) router.push("/team");
    else router.push(manageOthers ? `/team?team=${encodeURIComponent(id)}` : `/teams/${id}`);
  };
  const tiles = [
    { label: "Player", icon: Plus, href: "/players?status=available", aria: "Add a player" },
    { label: "Trades", icon: ArrowLeftRight, href: "/trades" },
    { label: "Waivers", icon: Clock, href: "/waivers" },
    { label: "News", icon: FileText, href: "/news" },
  ];
  const tile =
    "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-sunken px-1 text-[13px] font-medium text-ink/80 transition-colors hover:bg-ink/[0.07] active:bg-ink/[0.09] dark:hover:bg-white/[0.08]";
  const m = data.matchup;
  return (
    <header className="mb-5">
      {commishNote && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-[13px] font-medium text-ink">
          <Shield size={15} className="mt-px shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
          <span className="min-w-0">{commishNote}</span>
        </div>
      )}
      <div className="flex items-center gap-4">
        <TeamLogo team={team} size={64} round />
        <div className="min-w-0 flex-1">
          {/* the name is a native select (▾ switches teams), styled as a heading */}
          <label className="relative flex min-w-0 max-w-full items-center gap-1">
            <h1 className="truncate text-[22px] font-bold leading-7 tracking-[-0.02em] text-ink sm:text-[26px] sm:leading-8" title={team.name}>
              {team.name}
            </h1>
            <ChevronDown size={20} className="shrink-0 text-ink" aria-hidden />
            <select
              aria-label="Switch team"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={team.id}
              onChange={(e) => go(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === myTeamId ? " (my team)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-0.5 truncate text-[15px] text-muted">
            {owner ? (
              <Link href={`/managers/${owner.id}`} className="hover:text-ink hover:underline">
                {owner.name}
              </Link>
            ) : (
              "No manager"
            )}
          </div>
          <div className="numeral mt-0.5 truncate text-[15px] text-muted">
            {data.record}
            {data.rank !== null && ` · ${ordinal(data.rank)} of ${data.teamCount}`}
            {data.cap && <span className={cn(data.cap.space < 0 && "font-semibold text-loss")}> · {fmtMoney(data.cap.space)} cap room</span>}
          </div>
        </div>
      </div>

      <nav aria-label="Team actions" className="mt-4 grid grid-cols-5 gap-2 sm:max-w-[560px]">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} aria-label={t.aria} className={tile}>
            <t.icon size={22} strokeWidth={1.8} aria-hidden />
            {t.label}
          </Link>
        ))}
        <button type="button" className={tile} onClick={() => setMore(true)} aria-haspopup="dialog">
          <Ellipsis size={22} strokeWidth={1.8} className="rounded-full ring-[1.8px] ring-current" aria-hidden />
          More
        </button>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title={team.name}>
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-x-3 gap-y-3">
            <Stat size="sm" label="Record" value={data.record} sub={data.streak ? `Streak ${data.streak}` : undefined} />
            <Stat size="sm" label="Rank" value={data.rank ? ordinal(data.rank) : "—"} sub={`of ${data.teamCount}`} />
            {data.faab !== null ? <Stat size="sm" label="FAB" value={fmtMoney(data.faab)} sub="left" /> : <Stat size="sm" label="Division" value={data.divisionName ?? "—"} />}
            <Stat size="sm" label="PF" value={fmtPts(data.pointsFor, 1)} />
            <Stat size="sm" label="PA" value={fmtPts(data.pointsAgainst, 1)} />
            {data.faab !== null && data.divisionName && <Stat size="sm" label="Division" value={data.divisionName} />}
          </div>
          {team.motto && <p className="text-[13px] italic text-muted">“{team.motto}”</p>}

          {data.cap && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="eyebrow">Salary cap</span>
                <span className="numeral text-[13px] text-muted">
                  <b className="font-semibold text-ink">{fmtMoney(data.cap.committed)}</b> / {fmtMoney(data.cap.cap)}
                  {data.cap.deadMoney > 0 && <span className="text-loss"> · {fmtMoney(data.cap.deadMoney)} dead</span>}
                  <span className={cn("font-semibold", data.cap.space < 0 ? "text-loss" : "text-win")}> · {fmtMoney(data.cap.space)} room</span>
                </span>
              </div>
              <CapMeter committed={data.cap.committed} deadMoney={data.cap.deadMoney} cap={data.cap.cap} />
              {data.cap.bySeason[1] && (
                <div className="mt-1.5 text-[13px] text-muted">
                  {data.cap.bySeason[1].season} committed: <b className="numeral font-semibold text-ink">{fmtMoney(data.cap.bySeason[1].committed)}</b>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <CountPill label="Active" value={data.limits.active} max={data.limits.maxActive} />
            {data.limits.irSlots > 0 && <CountPill label="IR" value={data.limits.ir} max={data.limits.irSlots} />}
            {data.limits.taxiSlots > 0 && <CountPill label="Taxi" value={data.limits.taxi} max={data.limits.taxiSlots} />}
          </div>

          <ul className="-mx-1 divide-y divide-line/70 border-y border-line/70">
            {m && (
              <MoreLink href={`/scoring/${m.id}`} onPick={() => setMore(false)}>
                <span className="min-w-0 truncate">
                  Week {m.week} {m.opp ? `vs ${m.opp.name}` : "· bye"}
                </span>
                <span className="numeral ml-auto shrink-0 pl-2 text-[13px] text-muted">
                  {m.status === "UPCOMING" ? `Proj ${fmtPts(m.me.projected, 1)}${m.opp ? `–${fmtPts(m.opp.projected, 1)}` : ""}` : `${fmtPts(m.me.score)}${m.opp ? `–${fmtPts(m.opp.score)}` : ""}`}
                </span>
              </MoreLink>
            )}
            <MoreLink href={links.insights} onPick={() => setMore(false)}>
              Lineup insights
            </MoreLink>
            <MoreLink href={links.contracts} onPick={() => setMore(false)}>
              Contracts &amp; cap
            </MoreLink>
            <MoreLink href={links.picks} onPick={() => setMore(false)}>
              Draft picks
            </MoreLink>
            {links.keepers && (
              <MoreLink href={links.keepers} onPick={() => setMore(false)}>
                Keepers
              </MoreLink>
            )}
            <MoreLink href={`/transactions?team=${team.id}`} onPick={() => setMore(false)}>
              Transactions
            </MoreLink>
            <MoreLink href="/trades/new" onPick={() => setMore(false)}>
              Propose a trade
            </MoreLink>
            <MoreLink href="/teams" onPick={() => setMore(false)}>
              All teams
            </MoreLink>
          </ul>
        </div>
      </Modal>
    </header>
  );
}

function MoreLink({ href, children, onPick }: { href: string; children: React.ReactNode; onPick: () => void }) {
  return (
    <li>
      <Link href={href} onClick={onPick} className="flex min-h-12 items-center gap-2 px-1 text-[15px] font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400">
        {children}
        <ChevronRight size={16} className="ml-auto shrink-0 text-faint" aria-hidden />
      </Link>
    </li>
  );
}
