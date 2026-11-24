// Team identity strip used on /team, /team/* and /teams/[id]: logo, owner, record, cap meter, roster counts,
// FAB and this week's matchup card.
import Link from "next/link";
import { ChevronRight, Shield } from "lucide-react";
import { Badge, LiveDot, TeamLogo } from "@/components/ui/core";
import { cn, fmtMoney, fmtPct, fmtPts, ordinal } from "@/lib/utils";
import type { MatchupCardData, TeamHeaderData } from "@/lib/team/data";
import { CapMeter, CountPill } from "./bits";

export function TeamHeader({ data, actions, commishNote }: { data: TeamHeaderData; actions?: React.ReactNode; commishNote?: React.ReactNode }) {
  const { team, owner, cap, limits } = data;
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${team.primaryColor} 0 70%, ${team.secondaryColor} 70% 100%)` }} />
      {commishNote && <div className="flex items-center gap-2 border-b border-line bg-gold-300/20 px-3 py-1.5 text-xs font-semibold text-gold-600 dark:text-gold-300"><Shield size={14} />{commishNote}</div>}
      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <TeamLogo team={team} size={56} className="shadow-sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="break-words font-display text-2xl font-extrabold uppercase leading-tight tracking-wide text-ink sm:truncate sm:text-3xl">{team.name}</h1>
                {data.rank !== null && (
                  <Badge tone="brand" title="League standing">
                    {ordinal(data.rank)} of {data.teamCount}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                {owner ? (
                  <Link href={`/managers/${owner.id}`} className="link font-medium">
                    {owner.name}
                  </Link>
                ) : (
                  <span>No manager</span>
                )}
                {data.divisionName && <span>· {data.divisionName} Division</span>}
                {team.motto && <span className="hidden italic sm:inline">· “{team.motto}”</span>}
              </div>
            </div>
            {actions && <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 sm:flex">{actions}</div>}
          </div>

          <dl className="mt-3 grid grid-cols-4 gap-2 text-center sm:max-w-lg">
            <Stat label="Record" value={data.record} sub={data.streak ? `Streak ${data.streak}` : undefined} />
            <Stat label="PF" value={fmtPts(data.pointsFor, 1)} />
            <Stat label="PA" value={fmtPts(data.pointsAgainst, 1)} />
            <Stat label={data.faab !== null ? "FAB" : "Rank"} value={data.faab !== null ? fmtMoney(data.faab) : data.rank ? ordinal(data.rank) : "—"} />
          </dl>

          {cap && (
            <div className="mt-3 sm:max-w-lg">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="font-semibold uppercase tracking-wide text-muted">Salary cap</span>
                <span className="tabular-nums text-muted">
                  <b className="text-ink">{fmtMoney(cap.committed)}</b> / {fmtMoney(cap.cap)}
                  {cap.deadMoney > 0 && <span className="text-loss"> · {fmtMoney(cap.deadMoney)} dead</span>}
                  <span className={cn("ml-1 font-bold", cap.space < 0 ? "text-loss" : "text-win")}> · {fmtMoney(cap.space)} space</span>
                </span>
              </div>
              <CapMeter committed={cap.committed} deadMoney={cap.deadMoney} cap={cap.cap} />
              {cap.bySeason[1] && (
                <div className="mt-1 text-[11px] text-muted">
                  {cap.bySeason[1].season} committed: <b className="tabular-nums text-ink">{fmtMoney(cap.bySeason[1].committed)}</b>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <CountPill label="Active" value={limits.active} max={limits.maxActive} />
            {limits.irSlots > 0 && <CountPill label="IR" value={limits.ir} max={limits.irSlots} />}
            {limits.taxiSlots > 0 && <CountPill label="Taxi" value={limits.taxi} max={limits.taxiSlots} />}
          </div>
          {actions && <div className="mt-3 flex flex-wrap gap-2 sm:hidden">{actions}</div>}
        </div>
        <MatchupCard m={data.matchup} />
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-sunken/60 px-1.5 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-display text-lg font-bold leading-tight tabular-nums text-ink">{value}</dd>
      {sub && <dd className="text-[10px] text-muted">{sub}</dd>}
    </div>
  );
}

export function MatchupCard({ m }: { m: MatchupCardData | null }) {
  if (!m) {
    return (
      <div className="flex flex-col justify-center rounded-lg border border-dashed border-line bg-sunken/40 p-3 text-center text-sm text-muted">
        <div className="font-semibold text-ink">No matchup this week</div>
        <div className="text-xs">Bye, eliminated, or the schedule hasn&apos;t been set.</div>
      </div>
    );
  }
  const live = m.status === "LIVE";
  const final = m.status === "FINAL";
  const pct = Math.round(m.myWinProb * 100);
  const won = final && m.opp && m.me.score > m.opp.score;
  const lost = final && m.opp && m.me.score < m.opp.score;
  return (
    <Link href={`/scoring/${m.id}`} className="group block rounded-lg border border-line bg-sunken/40 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:hover:border-brand-700 dark:hover:bg-brand-900/20">
      <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted">
        <span className="flex items-center gap-1.5">
          {live && <LiveDot />}
          Week {m.week} {m.label ? `· ${m.label}` : m.isPlayoff ? "· Playoffs" : "matchup"}
        </span>
        <span className={cn(live && "text-live", final && "text-ink")}>{live ? "Live" : final ? (won ? "Final · W" : lost ? "Final · L" : "Final") : "Upcoming"}</span>
      </div>
      <div className="space-y-1.5">
        <SideLine side={m.me} lead={!m.opp || m.me.score >= m.opp.score} showProj={!final} />
        {m.opp ? <SideLine side={m.opp} lead={m.opp.score > m.me.score} showProj={!final} /> : <div className="text-sm text-muted">Bye week</div>}
      </div>
      {m.opp && !final && (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[11px] text-muted">
            <span>Win probability</span>
            <span className={cn("font-bold tabular-nums", pct >= 50 ? "text-win" : "text-loss")}>{fmtPct(m.myWinProb)}</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div style={{ width: `${pct}%`, background: m.me.primaryColor }} />
            <div style={{ width: `${100 - pct}%`, background: m.opp.primaryColor }} />
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-0.5 text-xs font-semibold text-brand-700 group-hover:underline dark:text-brand-300">
        {live ? "Live scoring" : "Matchup details"} <ChevronRight size={14} />
      </div>
    </Link>
  );
}

function SideLine({ side, lead, showProj }: { side: MatchupCardData["me"]; lead: boolean; showProj: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <TeamLogo team={side} size={28} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{side.name}</div>
        {side.record && <div className="text-[11px] text-muted">{side.record}</div>}
      </div>
      <div className="text-right">
        <div className={cn("font-display text-xl font-bold tabular-nums", lead ? "text-ink" : "text-muted")}>{fmtPts(side.score)}</div>
        {showProj && <div className="text-[10px] tabular-nums text-muted">Proj {fmtPts(side.projected, 1)}</div>}
      </div>
    </div>
  );
}
