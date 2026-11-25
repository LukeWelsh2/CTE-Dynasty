"use client";
// Animated draft lottery reveal (last lottery pick first, #1 last) + official draw / simulation controls.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dices, Play, RotateCcw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { drawLottery, type LotteryRules } from "@/lib/draft/logic";
import { useLiveEvents } from "@/lib/realtime/client";
import { clearLotteryAction, runLotteryAction } from "@/lib/draft/actions";
import type { RoomTeam } from "@/lib/draft/types";

export function LotteryReveal({
  leagueId,
  season,
  pool,
  odds,
  official,
  drawnAt,
  canRun,
  canClear,
  warn,
  isCommish,
  rules,
  liveReveal = true,
  myTeamId = null,
}: {
  leagueId: string;
  season: number;
  /** pre-lottery seeds, worst first */
  pool: RoomTeam[];
  odds: number[];
  official: string[] | null;
  drawnAt: string | null;
  canRun: boolean;
  canClear: boolean;
  warn: string | null;
  isCommish: boolean;
  /** settings.draft.rookie.lottery picksDrawn / maxDropSpots (simulations follow the same rules) */
  rules: LotteryRules;
  /** settings.draft.rookie.lottery.liveReveal: animate the official draw for everyone watching */
  liveReveal?: boolean;
  myTeamId?: string | null;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[] | null>(official);
  const [simulated, setSimulated] = useState(false);
  const [revealed, setRevealed] = useState(official ? pool.length : 0);
  const [playing, setPlaying] = useState(false);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(pool.map((t) => [t.id, t])), [pool]);
  const seedOf = useMemo(() => new Map(pool.map((t, i) => [t.id, i + 1])), [pool]);
  const n = pool.length;

  useEffect(() => {
    setOrder(official);
    setSimulated(false);
  }, [official]);

  useEffect(() => {
    if (!playing) return;
    if (revealed >= n) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setRevealed((r) => r + 1), revealed === n - 1 ? 2600 : 1500);
    return () => clearTimeout(t);
  }, [playing, revealed, n]);

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "draft.lottery") return;
    const data = e.data as { season?: number; result?: string[]; liveReveal?: boolean };
    if (data.season !== season || !data.result) return;
    setOrder(data.result);
    setSimulated(false);
    if (liveReveal && data.liveReveal !== false) {
      setRevealed(0);
      setPlaying(true);
    } else {
      setPlaying(false);
      setRevealed(data.result.length);
    }
    router.refresh();
  });

  const play = (o: string[], sim: boolean) => {
    setOrder(o);
    setSimulated(sim);
    setRevealed(0);
    setPlaying(true);
  };

  const runOfficial = () => {
    const msg = warn ? `${warn}\n\nRun the official ${season} lottery anyway?` : `Run the official ${season} draft lottery now? The result is saved and applied to the draft order.`;
    if (!window.confirm(msg)) return;
    start(async () => {
      const res = await runLotteryAction({ season });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(liveReveal ? "Lottery drawn — revealing…" : "Lottery drawn");
        router.refresh();
      }
    });
  };
  const clear = () => {
    if (!window.confirm("Clear the official lottery result? The draft order goes back to the pre-lottery seeds.")) return;
    start(async () => {
      const res = await clearLotteryAction({ season });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Cleared");
        setOrder(null);
        setRevealed(0);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {order && (
          <Button size="md" variant="secondary" onClick={() => play(order, simulated)} disabled={playing}>
            <Play size={15} /> {simulated ? "Replay" : "Watch the reveal"}
          </Button>
        )}
        <Button size="md" variant={official ? "ghost" : "secondary"} onClick={() => play(drawLottery(pool.map((t) => t.id), odds, Math.random, rules), true)} disabled={playing || n < 2}>
          <Dices size={15} /> Simulate
        </Button>
        {isCommish && canRun && (
          <Button size="md" onClick={runOfficial} disabled={pending || playing}>
            <Sparkles size={15} /> {official ? "Redraw official" : "Run official lottery"}
          </Button>
        )}
        {isCommish && canClear && official && (
          <Button size="md" variant="ghost" className="text-loss" onClick={clear} disabled={pending || playing}>
            <RotateCcw size={15} /> Clear
          </Button>
        )}
        {simulated && <Badge tone="amber">Simulation</Badge>}
        {!simulated && official && drawnAt && <Badge tone="green">Official</Badge>}
      </div>
      <ol className="divide-y divide-line/70 rounded-lg ring-1 ring-inset ring-line/70" aria-live="polite">
        {Array.from({ length: n }, (_, i) => {
          const shown = !!order && i >= n - revealed;
          const team = shown ? byId.get(order![i]) : null;
          const seed = team ? seedOf.get(team.id)! : null;
          const delta = seed ? seed - (i + 1) : 0;
          const isTop = i === 0 && shown;
          const mine = !!team && team.id === myTeamId;
          return (
            <li
              key={i}
              className={cn(
                "flex min-h-[60px] items-center gap-3 px-3 py-2 transition-colors duration-500",
                !shown && "bg-sunken/60",
                isTop && "bg-brand-600/[0.06] dark:bg-brand-400/10",
                mine && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]",
                playing && i === n - revealed - 1 && "animate-pulseDot",
              )}
            >
              <span className="numeral w-8 shrink-0 text-center text-[22px] font-semibold text-ink">{i + 1}</span>
              {team ? (
                <>
                  <TeamLogo team={team} size={34} className="animate-flash" round />
                  <span className="min-w-0 flex-1">
                    <span title={team.name} className={cn("block truncate text-[15px] font-semibold", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                      {team.name}
                    </span>
                    <span className="text-[13px] text-muted">Seed #{seed}</span>
                  </span>
                  {delta > 0 && (
                    <Badge tone="green">
                      <TrendingUp size={12} /> {delta}
                    </Badge>
                  )}
                  {delta < 0 && (
                    <Badge tone="red">
                      <TrendingDown size={12} /> {-delta}
                    </Badge>
                  )}
                  {delta === 0 && <Badge>Held</Badge>}
                </>
              ) : (
                <span className="text-[14px] text-muted">{order ? "…" : "Not drawn yet"}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
