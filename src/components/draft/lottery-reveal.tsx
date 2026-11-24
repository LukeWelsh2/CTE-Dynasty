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
          <Button size="sm" variant="secondary" onClick={() => play(order, simulated)} disabled={playing}>
            <Play size={14} /> {simulated ? "Replay simulation" : "Watch the reveal"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => play(drawLottery(pool.map((t) => t.id), odds, Math.random, rules), true)} disabled={playing || n < 2}>
          <Dices size={14} /> Simulate a lottery
        </Button>
        {isCommish && canRun && (
          <Button size="sm" variant="gold" onClick={runOfficial} disabled={pending || playing}>
            <Sparkles size={14} /> {official ? "Redraw official lottery" : "Run official lottery"}
          </Button>
        )}
        {isCommish && canClear && official && (
          <Button size="sm" variant="ghost" className="text-loss" onClick={clear} disabled={pending || playing}>
            <RotateCcw size={14} /> Clear result
          </Button>
        )}
        {simulated && <Badge tone="amber">Simulation — not official</Badge>}
        {!simulated && official && drawnAt && <Badge tone="green">Official result</Badge>}
      </div>
      <ol className="space-y-1.5" aria-live="polite">
        {Array.from({ length: n }, (_, i) => {
          const shown = !!order && i >= n - revealed;
          const team = shown ? byId.get(order![i]) : null;
          const seed = team ? seedOf.get(team.id)! : null;
          const delta = seed ? seed - (i + 1) : 0;
          const isTop = i === 0 && shown;
          return (
            <li
              key={i}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all duration-500",
                shown ? "border-line bg-panel" : "border-dashed border-line bg-sunken/50",
                isTop && "border-gold-400 bg-gradient-to-r from-gold-300/30 to-transparent ring-2 ring-gold-400/50",
                playing && i === n - revealed - 1 && "animate-pulseDot",
              )}
            >
              <span className="w-10 text-center font-display text-2xl font-extrabold tabular-nums">{i + 1}</span>
              {team ? (
                <>
                  <TeamLogo team={team} size={34} className="animate-flash" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-lg font-bold uppercase">{team.name}</span>
                    <span className="text-xs text-muted">Pre-lottery seed #{seed}</span>
                  </span>
                  {delta > 0 && (
                    <Badge tone="green">
                      <TrendingUp size={11} /> Up {delta}
                    </Badge>
                  )}
                  {delta < 0 && (
                    <Badge tone="red">
                      <TrendingDown size={11} /> Down {-delta}
                    </Badge>
                  )}
                  {delta === 0 && <Badge>Held</Badge>}
                </>
              ) : (
                <span className="text-sm text-muted">{order ? "…" : "Not drawn yet"}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
