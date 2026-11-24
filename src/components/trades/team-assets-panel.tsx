"use client";
// One team's tradable assets (players, rookie picks, FAB) with selection checkboxes — used by the builder
// and the calculator.
import { useMemo, useState } from "react";
import { DollarSign, Lock, Search, Ticket } from "lucide-react";
import { Badge, InjuryTag, PlayerHeadshot, PosBadge, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { OUTLOOK_LABEL, fmtValue } from "@/lib/value/model";
import type { AssetTeam } from "@/lib/trades/assets";

export interface Destination {
  id: string;
  name: string;
}

export function TeamHeader({ team, isMe, compact }: { team: AssetTeam; isMe?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <TeamLogo team={team} size={compact ? 28 : 34} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-ink">
          {team.name}
          {isMe && <span className="ml-1 text-[11px] font-semibold text-gold-600 dark:text-gold-400">(you)</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
          <span>{team.record}</span>
          <span>·</span>
          <Badge tone={team.outlook === "contender" ? "green" : team.outlook === "rebuild" ? "purple" : "neutral"}>{OUTLOOK_LABEL[team.outlook]}</Badge>
        </div>
      </div>
    </div>
  );
}

export function TeamCapChips({ team, capEnabled, faab }: { team: AssetTeam; capEnabled: boolean; faab: boolean }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
      {capEnabled && (
        <div className="rounded-md bg-sunken px-1.5 py-1">
          <div className="text-muted">Cap room</div>
          <div className={cn("font-bold tabular-nums", team.cap.space < 0 ? "text-loss" : "text-ink")}>${team.cap.space}</div>
        </div>
      )}
      <div className="rounded-md bg-sunken px-1.5 py-1">
        <div className="text-muted">Roster</div>
        <div className={cn("font-bold tabular-nums", team.roster.active >= team.roster.max ? "text-amber-600" : "text-ink")}>
          {team.roster.active}/{team.roster.max}
        </div>
      </div>
      {faab && (
        <div className="rounded-md bg-sunken px-1.5 py-1">
          <div className="text-muted">FAB</div>
          <div className="font-bold tabular-nums text-ink">${team.faabBalance}</div>
        </div>
      )}
    </div>
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
  /** narrow column (3-team trades): hide the points column */
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
  const maxValue = Math.max(10, ...team.players.map((p) => p.value));
  const pickLock = new Map((lockedPickSeasons ?? []).map((l) => [l.season, l.reason]));
  const lockedHere = [...new Set(team.picks.filter((p) => pickLock.has(p.season)).map((p) => p.season))].sort((a, b) => a - b);
  const retainSteps = retainMax > 0 ? [...new Set([...Array.from({ length: Math.floor(retainMax / 5) + 1 }, (_, i) => i * 5), retainMax])].sort((a, b) => a - b) : [];
  const retain = (p: { id: string; salary: number; fullName: string }) =>
    retainSteps.length > 1 && onRetain ? (
      <label className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted" onClick={(e) => e.stopPropagation()}>
        Keep paying
        <select
          aria-label={`Salary ${team.name} keeps paying for ${p.fullName}`}
          className="h-6 rounded border border-line bg-panel px-1 text-[11px] text-ink"
          value={retainOf?.(p.id) ?? 0}
          onChange={(e) => onRetain(p.id, Number(e.target.value))}
        >
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
      <select
        aria-label="Send to"
        className="mt-1 h-6 rounded border border-line bg-panel px-1 text-[11px]"
        value={destinationOf?.(key) ?? destinations[0].id}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onDestination(key, e.target.value)}
      >
        {destinations.map((d) => (
          <option key={d.id} value={d.id}>
            → {d.name}
          </option>
        ))}
      </select>
    ) : null;

  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-panel", className)}>
      <header className="border-b border-line bg-sunken/70 px-3 py-2">
        <TeamHeader team={team} isMe={isMe} />
        <TeamCapChips team={team} capEnabled={capEnabled} faab={allowFaab} />
      </header>
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <label className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input h-8 py-1 pl-7 text-xs" placeholder="Filter players" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Filter ${team.name} players`} />
        </label>
        <select className="input h-8 w-auto py-1 text-xs" value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Position">
          {positions.map((p) => (
            <option key={p} value={p}>
              {p === "ALL" ? "All" : p}
            </option>
          ))}
        </select>
      </div>
      <div className="scroll-thin max-h-[420px] overflow-auto">
        <table className="tbl tbl-compact">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-7" aria-label="Select"></th>
              <th>Player</th>
              <th className="num">Contract</th>
              <th className={cn("num hidden", !compact && "sm:table-cell")}>Pts</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const on = selectedPlayers.has(p.id);
              return (
                <tr key={p.id} className={cn("cursor-pointer", on && "[&>td]:bg-gold-300/20")} onClick={() => onTogglePlayer(p.id)}>
                  <td>
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={on} readOnly aria-label={`Select ${p.fullName}`} />
                  </td>
                  <td className={compact ? "max-w-[140px]" : "max-w-[180px]"}>
                    <div className="flex items-center gap-2">
                      <PlayerHeadshot player={{ id: p.id, fullName: p.fullName, position: p.position }} size={24} className="hidden sm:block" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-semibold text-ink">{p.fullName}</span>
                          <InjuryTag status={p.injuryStatus} />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted">
                          <PosBadge pos={p.position} className="h-3.5 min-w-[22px] text-[8px]" />
                          {p.nflTeam ?? "FA"}
                          {p.age ? ` · ${p.age}y` : ""}
                          {p.rosterStatus !== "ACTIVE" && <Badge tone={p.rosterStatus === "IR" ? "red" : "amber"}>{p.rosterStatus}</Badge>}
                          {p.isRookieContract && <Badge tone="green">R</Badge>}
                        </div>
                        {on && dest(`P:${p.id}`)}
                        {on && retain(p)}
                      </div>
                    </div>
                  </td>
                  <td className="num whitespace-nowrap text-xs">
                    ${p.salary}
                    <span className="text-muted"> · {p.contractYears}y</span>
                  </td>
                  <td className={cn("num hidden text-xs", !compact && "sm:table-cell")}>
                    {p.seasonPoints.toFixed(1)}
                    <div className="text-[10px] text-muted">{p.ppg} ppg</div>
                  </td>
                  <td className="num">
                    <span className="inline-flex items-center gap-1">
                      <span className={cn("hidden h-1.5 w-10 overflow-hidden rounded-full bg-sunken", !compact && "sm:inline-block")}>
                        <span className="block h-full bg-brand-600" style={{ width: `${Math.max(3, (Math.max(0, p.value) / maxValue) * 100)}%` }} />
                      </span>
                      <span className="text-xs font-bold">{fmtValue(p.value)}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
            {!players.length && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-xs text-muted">
                  No players match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {allowPicks && (
        <div className="border-t border-line px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <Ticket size={12} /> Rookie draft picks
          </div>
          {lockedHere.map((season) => (
            <p key={season} className="mb-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
              <Lock size={11} className="mt-0.5 shrink-0" />
              {pickLock.get(season)}
            </p>
          ))}
          {team.picks.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {team.picks.map((pk) => {
                const on = selectedPicks.has(pk.id);
                const lock = pickLock.get(pk.season);
                const disabled = !!lock && !on;
                return (
                  <li key={pk.id}>
                    <label
                      title={lock}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs",
                        disabled ? "cursor-not-allowed border-line bg-sunken/60 opacity-70" : on ? "cursor-pointer border-gold-500 bg-gold-300/20" : "cursor-pointer border-line hover:bg-sunken",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-brand-600"
                        checked={on}
                        disabled={disabled}
                        aria-label={lock ? `${pk.shortLabel} (locked: ${lock})` : `Select ${pk.shortLabel}`}
                        onChange={() => onTogglePick(pk.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className={cn("truncate font-semibold", disabled ? "text-muted" : "text-ink")} title={pk.label}>
                            {pk.shortLabel}
                          </span>
                          {lock && <Lock size={11} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />}
                        </span>
                        <span className="text-[10px] text-muted">
                          {lock ? "Locked" : pk.pickInRound ? `Pick ${pk.slotLabel}` : `Proj. ${pk.slotLabel}`} · value {fmtValue(pk.value)}
                        </span>
                        {on && dest(`K:${pk.id}`)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted">No tradable picks.</p>
          )}
        </div>
      )}
      {allowFaab && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
          <label className="flex items-center gap-2 text-xs">
            <DollarSign size={14} className="text-emerald-600" />
            <span className="font-semibold text-ink">Send FAB</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={team.faabBalance}
              className="input h-8 w-20 py-1 text-right text-xs"
              value={faabAmount || ""}
              placeholder="0"
              onChange={(e) => onFaab(Math.max(0, Math.min(team.faabBalance, Math.floor(Number(e.target.value) || 0))))}
              aria-label={`FAB dollars ${team.name} sends`}
            />
            <span className="text-muted">of ${team.faabBalance}</span>
          </label>
          {faabAmount > 0 && dest(`F:${team.id}`)}
        </div>
      )}
    </section>
  );
}
