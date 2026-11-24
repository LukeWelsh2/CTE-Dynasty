// Playoff finish for the rookie draft order from the stored bracket + aggregated bracket games (pure).
// Teams with first-round byes are in the stored seed list even though they have no round-1 game, and
// multi-week games only count once every leg is FINAL (bracketGames aggregates the legs).
import { advKey, bracketPlan, bracketWinner, type BracketKind } from "@/lib/playoffs/structure";

export interface FinishEntry {
  teamId: string;
  seed: number;
}

export interface FinishGame {
  kind: BracketKind;
  round: number;
  slot: number;
  status: "UPCOMING" | "LIVE" | "FINAL";
  winnerTeamId: string | null;
  loserTeamId: string | null;
}

export interface FinishInput {
  winners: FinishEntry[];
  consolation: FinishEntry[] | null;
  reseed: boolean;
  games: FinishGame[];
}

export interface BracketFinish {
  /** playoff teams, best finish first (alive teams by seed ahead of eliminated ones) */
  order: string[];
  champion: string | null;
  consolationWinner: string | null;
}

export function bracketFinish(input: FinishInput): BracketFinish {
  const plan = bracketPlan(input.winners.length);
  const wGames = input.games.filter((g) => g.kind === "WINNERS");
  const seedOf = new Map(input.winners.map((e) => [e.teamId, e.seed]));
  const eliminated = new Map<string, number>();
  for (const g of wGames) if (g.status === "FINAL" && g.loserTeamId) eliminated.set(g.loserTeamId, Math.max(eliminated.get(g.loserTeamId) ?? 0, g.round));
  const champGame = wGames.find((g) => g.round === plan.rounds && g.status === "FINAL" && g.winnerTeamId);
  const champion = plan.rounds === 0 ? input.winners[0]?.teamId ?? null : champGame?.winnerTeamId ?? null;
  const third = input.games.find((g) => g.kind === "THIRD" && g.status === "FINAL" && g.winnerTeamId);
  const order = input.winners.map((e) => e.teamId);
  order.sort((a, b) => {
    if (a === champion) return -1;
    if (b === champion) return 1;
    const ea = eliminated.get(a) ?? Infinity; // still alive sorts first
    const eb = eliminated.get(b) ?? Infinity;
    if (ea !== eb) return eb - ea;
    if (third) {
      if (a === third.winnerTeamId && b === third.loserTeamId) return -1;
      if (b === third.winnerTeamId && a === third.loserTeamId) return 1;
    }
    return (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99);
  });
  let consolationWinner: string | null = null;
  if (input.consolation?.length) {
    const cPlan = bracketPlan(input.consolation.length);
    const cSeed = new Map(input.consolation.map((e) => [e.teamId, e.seed]));
    const adv = new Map<string, number>();
    for (const g of input.games) {
      if (g.kind !== "CONSOLATION" || g.status !== "FINAL" || !g.winnerTeamId) continue;
      const s = cSeed.get(g.winnerTeamId);
      if (s !== undefined) adv.set(advKey(g.round, g.slot), s);
    }
    const seed = bracketWinner(cPlan, input.reseed, adv);
    consolationWinner = input.consolation.find((e) => e.seed === seed)?.teamId ?? null;
  }
  return { order, champion, consolationWinner };
}
