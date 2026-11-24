// Deterministic clinch / elimination checks (docs/research/trade-value-and-sim.md §6.7). They ignore
// points and tiebreakers, so they are conservative: a team can sit at 99.9% for a while before it gets an "x".

export type Lock = "clinched" | "eliminated" | null;

export interface ClinchStatus {
  playoffs: Lock;
  division: Lock;
  bye: Lock;
}

export interface ClinchTeam {
  id: string;
  division: string | null;
  wins: number;
  losses: number;
  ties: number;
  /** remaining games that produce a W/L/T (head-to-head + median games) */
  remaining: number;
  /** remaining weeks in which a weekly high-score bonus win is possible */
  bonusWeeks: number;
}

export interface ClinchRules {
  playoffTeams: number;
  /** effective first-round byes */
  byes: number;
  wildcardsByPoints: number;
  seeding: "RECORD" | "POINTS_FOR";
  divisionWinnersTopSeeds: boolean;
  /** division winners are guaranteed a spot but seeded by record */
  divisionWinnersQualify?: boolean;
}

/** Marker letter shown in the standings: z bye · y division · x playoffs · e eliminated. */
export type Marker = "z" | "y" | "x" | "e";

export const MARKER_INFO: Record<Marker, { label: string; description: string }> = {
  z: { label: "z", description: "Clinched a first-round bye" },
  y: { label: "y", description: "Clinched the division" },
  x: { label: "x", description: "Clinched a playoff spot" },
  e: { label: "e", description: "Eliminated from playoff contention" },
};

function bounds(t: ClinchTeam) {
  const g = t.wins + t.losses + t.ties;
  const minDen = g + t.remaining;
  const maxDen = g + t.remaining + t.bonusWeeks;
  return {
    min: minDen ? (t.wins + t.ties * 0.5) / minDen : 0,
    max: maxDen ? (t.wins + t.remaining + t.bonusWeeks + t.ties * 0.5) / maxDen : 0,
  };
}

/** Clinch status from win-percentage bounds (season in progress). */
export function clinchStatus(teams: ClinchTeam[], rules: ClinchRules): Map<string, ClinchStatus> {
  const out = new Map<string, ClinchStatus>();
  const b = new Map(teams.map((t) => [t.id, bounds(t)]));
  const N = Math.min(rules.playoffTeams, teams.length);
  const divisions = new Set(teams.map((t) => t.division).filter((d): d is string => !!d));
  const D = rules.divisionWinnersTopSeeds || rules.divisionWinnersQualify ? divisions.size : 0;
  const byPoints = Math.max(0, rules.wildcardsByPoints ?? 0);
  const recordMath = rules.seeding === "RECORD";
  for (const t of teams) {
    const me = b.get(t.id)!;
    const others = teams.filter((o) => o.id !== t.id);
    // C: teams that could finish at or above my worst case; A: teams certainly above my best case
    const C = others.filter((o) => b.get(o.id)!.max >= me.min).length;
    const above = others.filter((o) => b.get(o.id)!.min > me.max);
    const A = above.length;

    let division: Lock = null;
    if (t.division) {
      const rivals = others.filter((o) => o.division === t.division);
      if (rivals.every((o) => me.min > b.get(o.id)!.max)) division = "clinched";
      else if (rivals.some((o) => b.get(o.id)!.min > me.max)) division = "eliminated";
    }

    let playoffs: Lock = null;
    if (N <= 0) playoffs = "eliminated";
    else if (N >= teams.length) playoffs = "clinched";
    else if (recordMath) {
      if (D > 0) {
        if (division === "clinched" || C <= N - byPoints - D) playoffs = "clinched";
        else if (byPoints === 0 && division === "eliminated") {
          const divsAbove = new Set(above.map((o) => o.division).filter((d): d is string => !!d)).size;
          if (A - divsAbove >= N - D) playoffs = "eliminated";
        }
      } else {
        if (C < N - byPoints) playoffs = "clinched";
        else if (byPoints === 0 && A >= N) playoffs = "eliminated";
      }
    }

    let bye: Lock = null;
    const B = Math.min(rules.byes, N);
    if (B <= 0) bye = null;
    else if (playoffs === "eliminated") bye = "eliminated";
    else if (recordMath) {
      if (D > 0 && rules.divisionWinnersTopSeeds) {
        if (division === "clinched" && C < B) bye = "clinched";
        else if (division === "eliminated" && B <= D) bye = "eliminated";
      } else if (D > 0) {
        if (playoffs === "clinched" && C < B) bye = "clinched";
        else if (A >= B) bye = "eliminated";
      } else if (B <= N - byPoints) {
        if (C < B) bye = "clinched";
        else if (A >= B) bye = "eliminated";
      }
    }
    out.set(t.id, { playoffs, division, bye });
  }
  return out;
}

/** Exact status once the regular season is over (seeds are known). */
export function finalClinchStatus(teamIds: string[], seeds: string[], divisionWinners: string[], byes: number): Map<string, ClinchStatus> {
  const seedOf = new Map(seeds.map((id, i) => [id, i + 1]));
  const winners = new Set(divisionWinners);
  return new Map(
    teamIds.map((id) => {
      const seed = seedOf.get(id);
      return [
        id,
        {
          playoffs: seed ? "clinched" : "eliminated",
          division: winners.size ? (winners.has(id) ? "clinched" : "eliminated") : null,
          bye: byes > 0 ? (seed && seed <= byes ? "clinched" : "eliminated") : null,
        },
      ] as const;
    }),
  );
}

export function markerFor(s: ClinchStatus | undefined | null): Marker | null {
  if (!s) return null;
  if (s.bye === "clinched") return "z";
  if (s.division === "clinched") return "y";
  if (s.playoffs === "clinched") return "x";
  if (s.playoffs === "eliminated") return "e";
  return null;
}
