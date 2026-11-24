// Team identity strip used on /team, /team/* and /teams/[id]: logo, owner, record, cap meter, roster counts,
// FAB and this week's matchup card.
import Link from "next/link";
import { ChevronRight, Shield } from "lucide-react";
import { Badge, GameStatus, ScoreNumber, TeamLogo, WinProbBar } from "@/components/ui/core";
import { cn, fmtMoney, fmtPts, ordinal } from "@/lib/utils";
import type { MatchupCardData, TeamHeaderData } from "@/lib/team/data";
import { CapMeter, CountPill } from "./bits";

export function TeamHeader({ data, actions, commishNote }: { data: TeamHeaderData; actions?: React.ReactNode; commishNote?: React.ReactNode }) {
  const { team, owner, cap, limits } = data;
  return (
    <section className="card mb-4 overflow-hidden">
      <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${team.primaryColor} 0 70%, ${team.secondaryColor} 70% 100%)` }} />
      {commishNote && (
        <div className="flex items-start gap-2 border-b border-line/70 bg-gold-400/15 px-3 py-2 text-xs font-semibold text-gold-800 dark:bg-gold-400/10 dark:text-gold-300 sm:px-4">
          <Shield size={14} className="mt-px shrink-0" />
          <span className="min-w-0">{commishNote}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <TeamLogo team={team} size={56} className="shadow-card" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="break-words font-display text-[26px] font-extrabold uppercase leading-[1.02] tracking-[0.01em] text-ink sm:truncate sm:text-[32px]" title={team.name}>
                  {team.name}
                </h1>
                {data.rank !== null && (
                  <Badge tone="brand" title="League standing">
                    {ordinal(data.rank)} of {data.teamCount}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
                {owner ? (
                  <Link href={`/managers/${owner.id}`} className="link -my-1 inline-flex min-h-6 items-center">
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

          <dl className="mt-4 grid grid-cols-4 gap-2 sm:max-w-lg">
            <Stat label="Record" value={data.record} sub={data.streak ? `Streak ${data.streak}` : undefined} />
            <Stat label="PF" value={fmtPts(data.pointsFor, 1)} />
            <Stat label="PA" value={fmtPts(data.pointsAgainst, 1)} />
            <Stat label={data.faab !== null ? "FAB" : "Rank"} value={data.faab !== null ? fmtMoney(data.faab) : data.rank ? ordinal(data.rank) : "—"} />
          </dl>

          {cap && (
            <div className="mt-4 sm:max-w-lg">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="eyebrow">Salary cap</span>
                <span className="numeral text-xs text-muted">
                  <b className="font-semibold text-ink">{fmtMoney(cap.committed)}</b> / {fmtMoney(cap.cap)}
                  {cap.deadMoney > 0 && <span className="text-loss"> · {fmtMoney(cap.deadMoney)} dead</span>}
                  <span className={cn("font-semibold", cap.space < 0 ? "text-loss" : "text-win")}> · {fmtMoney(cap.space)} space</span>
                </span>
              </div>
              <CapMeter committed={cap.committed} deadMoney={cap.deadMoney} cap={cap.cap} />
              {cap.bySeason[1] && (
                <div className="mt-1.5 text-xs text-muted">
                  {cap.bySeason[1].season} committed: <b className="numeral font-semibold text-ink">{fmtMoney(cap.bySeason[1].committed)}</b>
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
    <div className="min-w-0 rounded-lg bg-sunken px-2 py-2 text-center sm:px-3 sm:text-left">
      <dt className="eyebrow truncate">{label}</dt>
      <dd className="numeral mt-0.5 text-[17px] font-semibold leading-tight text-ink sm:text-xl">{value}</dd>
      {sub && <dd className="truncate text-[11px] leading-tight text-muted">{sub}</dd>}
    </div>
  );
}

export function MatchupCard({ m }: { m: MatchupCardData | null }) {
  if (!m) {
    return (
      <div className="flex flex-col justify-center rounded-lg bg-sunken/70 p-4 text-center ring-1 ring-inset ring-line/70">
        <div className="text-[15px] font-semibold text-ink">No matchup this week</div>
        <div className="mt-0.5 text-xs text-muted">Bye, eliminated, or the schedule hasn&apos;t been set.</div>
      </div>
    );
  }
  const live = m.status === "LIVE";
  const final = m.status === "FINAL";
  const pct = Math.round(m.myWinProb * 100);
  const won = final && m.opp && m.me.score > m.opp.score;
  const lost = final && m.opp && m.me.score < m.opp.score;
  return (
    <Link
      href={`/scoring/${m.id}`}
      className="group block rounded-lg bg-sunken/70 p-3 ring-1 ring-inset ring-line/70 transition-colors duration-150 hover:bg-sunken active:bg-sunken dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="eyebrow truncate">
          Week {m.week} {m.label ? `· ${m.label}` : m.isPlayoff ? "· Playoffs" : "matchup"}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {won ? <Badge tone="green">Final · W</Badge> : lost ? <Badge tone="red">Final · L</Badge> : <GameStatus status={m.status} />}
          {/* phones: the whole card is the link; the footer line is dropped to save height */}
          <ChevronRight size={16} className="-mr-1 text-faint sm:hidden" aria-hidden />
        </span>
      </div>
      <div className="space-y-2">
        <SideLine side={m.me} lead={!m.opp || m.me.score >= m.opp.score} showProj={!final} mine />
        {m.opp ? <SideLine side={m.opp} lead={m.opp.score > m.me.score} showProj={!final} /> : <div className="text-sm text-muted">Bye week</div>}
      </div>
      {m.opp && !final && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
            <span className={cn("numeral font-semibold", pct >= 50 ? "text-ink" : "text-muted")}>{pct}%</span>
            <span className="eyebrow">{live ? "Live win prob." : "Win probability"}</span>
            <span className={cn("numeral font-semibold", pct < 50 ? "text-ink" : "text-muted")}>{100 - pct}%</span>
          </div>
          <WinProbBar left={m.myWinProb} leftColor={m.me.primaryColor} rightColor={m.opp.primaryColor} label={`${m.me.name} win probability`} />
        </div>
      )}
      <div className="mt-2.5 hidden items-center justify-end gap-0.5 text-xs font-semibold text-brand-600 group-hover:underline dark:text-brand-300 sm:flex">
        {live ? "Live scoring" : "Matchup details"} <ChevronRight size={14} />
      </div>
    </Link>
  );
}

function SideLine({ side, lead, showProj, mine }: { side: MatchupCardData["me"]; lead: boolean; showProj: boolean; mine?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <TeamLogo team={side} size={32} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[15px] font-semibold leading-tight sm:text-sm", mine ? "text-brand-700 dark:text-brand-300" : "text-ink")} title={side.name}>
          {side.name}
        </div>
        {side.record && <div className="mt-0.5 text-xs leading-tight text-muted">{side.record}</div>}
      </div>
      <div className="shrink-0 text-right">
        <ScoreNumber value={side.score} size="md" dim={!lead} />
        {showProj && <div className="numeral mt-0.5 text-[11px] text-muted">Proj {fmtPts(side.projected, 1)}</div>}
      </div>
    </div>
  );
}
