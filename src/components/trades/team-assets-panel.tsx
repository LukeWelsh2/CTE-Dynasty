"use client";
// One team's tradable assets (players, rookie picks, FAB) as tappable rows — used by the builder and the calculator.
// v3 / phones: each row is one big tap target (check circle · headshot · name / position + team + contract · value),
// selected rows tint blue; destination and salary-retention pickers appear under a selected row.
import { useMemo, useState } from "react";
import { Check, DollarSign, Lock, Search } from "lucide-react";
import { Badge, TeamLogo } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { PickIcon } from "@/components/trades/trade-card";
import { cn, fmtMoney } from "@/lib/utils";
import { OUTLOOK_LABEL, fmtValue } from "@/lib/value/model";
import type { AssetTeam } from "@/lib/trades/assets";

export interface Destination {
  id: string;
  name: string;
}

export function TeamHeader({ team, isMe, compact }: { team: AssetTeam; isMe?: boolean; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TeamLogo team={team} size={compact ? 32 : 36} />
      <div className="min-w-0 flex-1">
        <div title={team.name} className={cn("truncate text-[15px] font-semibold leading-5", isMe ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
          {team.name}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
          <span className="numeral">{team.record}</span>
          <Badge tone={team.outlook === "contender" ? "green" : team.outlook === "rebuild" ? "purple" : "neutral"}>{OUTLOOK_LABEL[team.outlook]}</Badge>
          {isMe && <span>· you</span>}
        </div>
      </div>
    </div>
  );
}

/** Cap room · roster · FAB as three small label-over-number stats. */
export function TeamCapChips({ team, capEnabled, faab, className }: { team: AssetTeam; capEnabled: boolean; faab: boolean; className?: string }) {
  const items = [
    capEnabled ? { label: "Cap room", value: fmtMoney(team.cap.space), tone: team.cap.space < 0 ? "text-loss" : "text-ink" } : null,
    { label: "Roster", value: `${team.roster.active}/${team.roster.max}`, tone: team.roster.active >= team.roster.max ? "text-amber-700 dark:text-amber-300" : "text-ink" },
    faab ? { label: "FAB", value: fmtMoney(team.faabBalance), tone: "text-ink" } : null,
  ].filter((x): x is { label: string; value: string; tone: string } => !!x);
  return (
    <dl className={cn("mt-2 grid gap-2", items.length === 3 ? "grid-cols-3" : items.length === 2 ? "grid-cols-2" : "grid-cols-1", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="truncate text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] text-muted">{it.label}</dt>
          <dd className={cn("numeral text-[15px] font-semibold leading-5", it.tone)}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Round check (24px) that reads selected / not selected. */
function CheckDot({ on, disabled, danger }: { on: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
        on ? (danger ? "bg-[rgb(208_31_43)] text-white" : "bg-brand-600 text-white") : "shadow-[inset_0_0_0_1.5px_rgb(var(--c-ink)/0.25)]",
        disabled && "opacity-40",
      )}
    >
      {on && <Check size={14} strokeWidth={3} />}
    </span>
  );
}

export function TeamAssetsPanel({
  team,
  isMe,
  selectedPlayers,
  selectedPicks,
  onTogglePlayer,
  onTogglePick,
  faabAmount,
  onFaab,
  destinations,
  destinationOf,
  onDestination,
  allowPicks,
  allowFaab,
  capEnabled,
  className,
  compact,
  retainMax = 0,
  retainOf,
  onRetain,
  lockedPickSeasons,
}: {
  team: AssetTeam;
  isMe?: boolean;
  selectedPlayers: Set<string>;
  selectedPicks: Set<string>;
  onTogglePlayer: (id: string) => void;
  onTogglePick: (id: string) => void;
  faabAmount: number;
  onFaab: (amount: number) => void;
  /** for multi-team trades: where each selected asset goes */
  destinations?: Destination[];
  destinationOf?: (key: string) => string | undefined;
  onDestination?: (key: string, teamId: string) => void;
  allowPicks: boolean;
  allowFaab: boolean;
  capEnabled: boolean;
  className?: string;
  /** narrow column (3-team trades): hide the points line */
  compact?: boolean;
  /** salary retention (settings.trades.salaryRetentionMaxPercent): max %, current % per player, setter */
  retainMax?: number;
  retainOf?: (playerId: string) => number;
  onRetain?: (playerId: string, pct: number) => void;
  /**
   * pick seasons that can't be traded right now (TradeRulesSummary.lockedPickSeasons: their rookie draft is under way):
   * those picks are shown disabled with the reason; one that is already selected can still be removed
   */
  lockedPickSeasons?: readonly { season: number; reason: string }[];
}) {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("ALL");
  const positions = useMemo(() => ["ALL", ...new Set(team.players.map((p) => p.position))], [team.players]);
  const players = team.players.filter((p) => (pos === "ALL" || p.position === pos) && (!q || p.fullName.toLowerCase().includes(q.toLowerCase())));
  const pickLock = new Map((lockedPickSeasons ?? []).map((l) => [l.season, l.reason]));
  const lockedHere = [...new Set(team.picks.filter((p) => pickLock.has(p.season)).map((p) => p.season))].sort((a, b) => a - b);
  const retainSteps = retainMax > 0 ? [...new Set([...Array.from({ length: Math.floor(retainMax / 5) + 1 }, (_, i) => i * 5), retainMax])].sort((a, b) => a - b) : [];
  const selectCls = "input h-10 py-1 text-[15px] sm:h-9 sm:text-sm";
  const retain = (p: { id: string; salary: number; fullName: string }) =>
    retainSteps.length > 1 && onRetain ? (
      <label className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
        <span className="shrink-0">Keep paying</span>
        <select aria-label={`Salary ${team.name} keeps paying for ${p.fullName}`} className={cn(selectCls, "w-auto min-w-0")} value={retainOf?.(p.id) ?? 0} onChange={(e) => onRetain(p.id, Number(e.target.value))}>
          {retainSteps.map((pct) => (
            <option key={pct} value={pct}>
              {pct ? `${pct}% ($${Math.round((p.salary * pct) / 100)})` : "0%"}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  const dest = (key: string) =>
    destinations && destinations.length > 1 && onDestination ? (
      <label className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
        <span className="shrink-0">Send to</span>
        <select aria-label="Send to" className={cn(selectCls, "w-auto min-w-0")} value={destinationOf?.(key) ?? destinations[0]!.id} onChange={(e) => onDestination(key, e.target.value)}>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  return (
    <section className={cn("card flex min-w-0 flex-col overflow-hidden", className)}>
      <header className="px-4 pb-3 pt-3">
        <TeamHeader team={team} isMe={isMe} />
        <TeamCapChips team={team} capEnabled={capEnabled} faab={allowFaab} />
      </header>
      <div className="flex items-center gap-2 border-t border-line/70 px-4 py-2">
        <label className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input h-10 pl-8 sm:h-9" placeholder="Filter players" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Filter ${team.name} players`} />
        </label>
        <select className={cn(selectCls, "w-[5.5rem] shrink-0")} value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Position">
          {positions.map((p) => (
            <option key={p} value={p}>
              {p === "ALL" ? "All" : p}
            </option>
          ))}
        </select>
      </div>
      <ul className="scroll-thin divide-y divide-line/70 border-t border-line/70 lg:max-h-[460px] lg:overflow-y-auto">
        {players.map((p) => {
          const on = selectedPlayers.has(p.id);
          const extra = on ? [dest(`P:${p.id}`), retain(p)].filter(Boolean) : [];
          return (
            <li key={p.id} className={cn(on && "bg-brand-600/[0.06] dark:bg-brand-400/10")}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-label={`Select ${p.fullName}`}
                onClick={() => onTogglePlayer(p.id)}
                className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-sunken/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/50"
              >
                <CheckDot on={on} />
                <HeadshotBadge player={{ id: p.id, fullName: p.fullName, position: p.position }} nflTeam={p.nflTeam} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold leading-5 text-ink" title={p.fullName}>
                      {p.fullName}
                    </span>
                    <InjuryLetter status={p.injuryStatus} className="text-[13px]" />
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted">
                    <PosPill pos={p.position} />
                    <span className="min-w-0 truncate">
                      {p.position === "DEF" ? "" : `${p.nflTeam ?? "FA"} · `}
                      <span className="numeral font-medium text-ink">
                        ${p.salary} · {p.contractYears}y
                      </span>
                      {p.age ? ` · ${p.age}y old` : ""}
                    </span>
                    {p.rosterStatus !== "ACTIVE" && <Badge tone={p.rosterStatus === "IR" ? "red" : "amber"}>{p.rosterStatus}</Badge>}
                    {p.isRookieContract && <Badge tone="green">R</Badge>}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="numeral block text-[15px] font-semibold leading-5 text-ink">{fmtValue(p.value)}</span>
                  {!compact && <span className="numeral block text-[12px] leading-4 text-muted">{p.ppg} ppg</span>}
                </span>
              </button>
              {extra.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-2 pb-2.5 pl-[3.25rem] pr-4">{extra}</div>}
            </li>
          );
        })}
        {!players.length && <li className="px-4 py-5 text-center text-[13px] text-muted">No players match.</li>}
      </ul>
      {allowPicks && (
        <div className="border-t border-line/70">
          <div className="eyebrow px-4 pb-1 pt-3">Draft picks</div>
          {lockedHere.map((season) => (
            <p key={season} className="flex items-start gap-1.5 px-4 pb-1 text-[13px] text-amber-700 dark:text-amber-300">
              <Lock size={13} className="mt-[3px] shrink-0" aria-hidden />
              {pickLock.get(season)}
            </p>
          ))}
          {team.picks.length ? (
            <ul className="divide-y divide-line/70">
              {team.picks.map((pk) => {
                const on = selectedPicks.has(pk.id);
                const lock = pickLock.get(pk.season);
                const disabled = !!lock && !on;
                const d = on ? dest(`K:${pk.id}`) : null;
                return (
                  <li key={pk.id} className={cn(on && "bg-brand-600/[0.06] dark:bg-brand-400/10")}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={disabled}
                      title={lock}
                      aria-label={lock ? `${pk.shortLabel} (locked: ${lock})` : `Select ${pk.shortLabel}`}
                      onClick={() => onTogglePick(pk.id)}
                      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-sunken/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/50 disabled:cursor-not-allowed"
                    >
                      <CheckDot on={on} disabled={disabled} />
                      <PickIcon round={pk.round} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={cn("truncate text-[15px] font-semibold leading-5", disabled ? "text-muted" : "text-ink")} title={pk.label}>
                            {pk.shortLabel}
                          </span>
                          {lock && <Lock size={13} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />}
                        </span>
                        <span className="block truncate text-[13px] leading-[18px] text-muted">{lock ? "Locked" : pk.pickInRound ? `Pick ${pk.slotLabel}` : `Projected ${pk.slotLabel}`}</span>
                      </span>
                      <span className="numeral shrink-0 text-[15px] font-semibold text-ink">{fmtValue(pk.value)}</span>
                    </button>
                    {d && <div className="pb-2.5 pl-[3.25rem] pr-4">{d}</div>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 pb-3 text-[13px] text-muted">No tradable picks.</p>
          )}
        </div>
      )}
      {allowFaab && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line/70 px-4 py-3">
          <label className="flex items-center gap-3 text-[15px]">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10 text-win dark:bg-green-400/15" aria-hidden>
              <DollarSign size={14} />
            </span>
            <span className="font-semibold text-ink">Send FAB</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={team.faabBalance}
              className="input h-10 w-24 text-right sm:h-9"
              value={faabAmount || ""}
              placeholder="0"
              onChange={(e) => onFaab(Math.max(0, Math.min(team.faabBalance, Math.floor(Number(e.target.value) || 0))))}
              aria-label={`FAB dollars ${team.name} sends`}
            />
            <span className="numeral text-[13px] text-muted">of ${team.faabBalance}</span>
          </label>
          {faabAmount > 0 && dest(`F:${team.id}`)}
        </div>
      )}
    </section>
  );
}
