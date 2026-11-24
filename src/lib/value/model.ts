// Dynasty trade value model (pure — no database access, unit-tested in tests/value.test.ts).
//
// Every asset is expressed in "CTE value" units where the league's most valuable rostered player ≈ 100.
//   player value = production (points over replacement, this season + future seasons at a flat age)
//                + age curve adjustment (position-specific dynasty aging, rookie upside)
//                + superflex premium (QBs when a SUPERFLEX slot exists)
//                + contract surplus (market $ of the production − salary, over the years remaining)
//                − injury discount (expected games missed this season, long-term injury risk)
//   pick value   = draft-slot curve (projected slot from standings) − future-year discount + rookie-scale surplus
//   FAB value    = small fixed value per $ (scaled to the league budget and how much of the waiver season is left)
// Team context (contender / balanced / rebuild) changes how current production vs. the future is weighted.
import type { LeagueSettings, RosterSlotDef } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { salaryInYear } from "@/lib/roster";

export type TeamOutlook = "contender" | "balanced" | "rebuild";
/** User-selectable valuation mode. "auto" = each team's own outlook (receiving team's perspective). */
export type ValueMode = "auto" | TeamOutlook;

export const OUTLOOK_LABEL: Record<TeamOutlook, string> = { contender: "Win-now", balanced: "Balanced", rebuild: "Rebuild" };
export const MODE_LABEL: Record<ValueMode, string> = { auto: "Auto (team outlook)", ...OUTLOOK_LABEL };

export interface ModeWeights {
  /** multiplier on this season's remaining production */
  currentSeason: number;
  /** per-season discount on future production */
  discount: number;
  /** number of seasons (incl. this one) the model looks ahead */
  horizon: number;
  /** multiplier on draft pick value */
  pickMultiplier: number;
  /** per-year discount on future draft picks */
  pickYearDiscount: number;
}

export const MODE_WEIGHTS: Record<TeamOutlook, ModeWeights> = {
  contender: { currentSeason: 1.6, discount: 0.68, horizon: 4, pickMultiplier: 0.75, pickYearDiscount: 0.75 },
  balanced: { currentSeason: 1.0, discount: 0.8, horizon: 5, pickMultiplier: 1.0, pickYearDiscount: 0.86 },
  rebuild: { currentSeason: 0.5, discount: 0.88, horizon: 6, pickMultiplier: 1.2, pickYearDiscount: 0.93 },
};

/** Share of a player's production credited as depth value even below replacement level */
export const DEPTH_SHARE = 0.06;
/** Streamable positions: week-to-week replacement is far better than season-long, so value is discounted */
export const POSITION_VALUE_FACTOR: Record<string, number> = { K: 0.3, DEF: 0.35 };
/** How much contract surplus ($ → value) counts relative to production */
export const CONTRACT_WEIGHT = 0.5;
/** Explicit superflex market premium for QBs (on top of the scarcity already in replacement levels) */
export const SUPERFLEX_PREMIUM = 0.12;
/**
 * 1.01 draft-slot value relative to the league's top player (= 100). With the rookie-contract surplus on top a
 * 1.01 lands around a top-20 player, in line with dynasty markets (DynastyProcess prices the 1.01 near a
 * rank-20 startup asset).
 */
export const PICK_TOP_VALUE = 38;
/** Value of the last pick of round 1 relative to 1.01 (markets ≈ 0.12, realized production ≈ 0.55) */
export const PICK_ROUND_END_RATIO = 0.22;
/** Value of the whole FAB budget (e.g. $100) with the full waiver season remaining */
export const FAAB_FULL_BUDGET_VALUE = 12;
/** Consolidation exponent: side totals use an Lp norm so two mid assets < one stud with the same sum */
export const CONSOLIDATION_POWER = 1.3;
/**
 * Smallest deal size the fairness % is measured against, so swaps of depth pieces (e.g. 2 vs 4 value) aren't
 * called lopsided: a gap matters relative to the bigger side, but never less than relative to this.
 */
export const FAIRNESS_MIN_SCALE = 20;

export interface ValueComponent {
  key: "production" | "age" | "superflex" | "contract" | "injury" | "slot" | "year" | "outlook" | "rookie" | "faab";
  label: string;
  value: number;
  note?: string;
}

export interface AssetValue {
  value: number;
  components: ValueComponent[];
  notes: string[];
}

// ───────────────────────────── Age curves ─────────────────────────────

/** [age, production factor relative to peak] knots, linearly interpolated */
export const AGE_CURVES: Record<string, [number, number][]> = {
  QB: [[21, 0.72], [22, 0.8], [23, 0.9], [24, 1], [34, 1], [35, 0.9], [36, 0.8], [37, 0.68], [38, 0.55], [40, 0.3], [42, 0.1]],
  RB: [[20, 0.82], [21, 0.9], [22, 1], [26, 1], [27, 0.88], [28, 0.75], [29, 0.6], [30, 0.47], [31, 0.36], [32, 0.27], [34, 0.12], [36, 0.05]],
  WR: [[20, 0.7], [21, 0.78], [22, 0.88], [23, 1], [28, 1], [29, 0.92], [30, 0.82], [31, 0.7], [32, 0.58], [33, 0.46], [34, 0.36], [36, 0.18], [38, 0.08]],
  TE: [[21, 0.62], [22, 0.72], [23, 0.85], [24, 1], [29, 1], [30, 0.9], [31, 0.8], [32, 0.68], [33, 0.56], [34, 0.44], [36, 0.25], [38, 0.1]],
  K: [[20, 1], [40, 1], [44, 0.6], [46, 0.3]],
  DL: [[21, 0.85], [23, 1], [29, 1], [31, 0.85], [33, 0.65], [35, 0.4]],
  LB: [[21, 0.85], [23, 1], [29, 1], [31, 0.85], [33, 0.65], [35, 0.4]],
  DB: [[21, 0.85], [23, 1], [29, 1], [31, 0.85], [33, 0.65], [35, 0.4]],
};

export const PEAK_AGES: Record<string, string> = { QB: "24–34", RB: "22–26", WR: "23–28", TE: "24–29", DL: "23–29", LB: "23–29", DB: "23–29" };

/** Production factor (0..1, 1 = peak) for a position at an age. Unknown age / team defense = 1. */
export function ageFactor(position: string, age: number | null | undefined): number {
  const knots = AGE_CURVES[normalizePosition(position)];
  if (!knots || age === null || age === undefined || !Number.isFinite(age)) return 1;
  if (age <= knots[0][0]) return knots[0][1];
  const last = knots[knots.length - 1];
  if (age >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const [a1, f1] = knots[i];
    if (age <= a1) {
      const [a0, f0] = knots[i - 1];
      return f0 + ((f1 - f0) * (age - a0)) / (a1 - a0);
    }
  }
  return last[1];
}

// ───────────────────────────── Injuries ─────────────────────────────

/** Expected games missed this season for an injury designation, capped at the remaining games. */
export function expectedGamesMissed(status: string | null | undefined, remainingGames: number): number {
  const s = (status ?? "").trim().toLowerCase();
  const remaining = Math.max(0, remainingGames);
  let g = 0;
  if (!s || s === "active" || s === "healthy") g = 0;
  else if (s.startsWith("q")) g = 0.3;
  else if (s.startsWith("doubt")) g = 0.85;
  else if (s === "out" || s === "o") g = 1.6;
  else if (s === "ir" || s.includes("reserve")) g = Math.max(4, remaining * 0.7);
  else if (s.includes("pup")) g = Math.max(4, remaining * 0.5);
  else if (s.startsWith("sus")) g = 2;
  else if (s === "na" || s === "cov" || s === "dnr") g = 1;
  return Math.min(remaining, g);
}

/** Next-season production haircut for long-term injuries */
export function longTermInjuryHaircut(status: string | null | undefined): number {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "ir" || s.includes("reserve")) return 0.1;
  if (s.includes("pup")) return 0.06;
  return 0;
}

// ───────────────────────────── League environment ─────────────────────────────

export interface ValueEnv {
  settings: LeagueSettings;
  teams: number;
  /** fantasy weeks remaining this season (incl. the current week) */
  remainingWeeks: number;
  /** total fantasy weeks in a season (regular season + playoffs) */
  seasonWeeks: number;
  /** regular-season weeks remaining (waiver/FAB season) */
  remainingRegularWeeks: number;
  /** points-per-game replacement level by fantasy position */
  replacement: Record<string, number>;
  /** $ of market salary per point over replacement */
  dollarsPerPoint: number;
  /** raw points-over-replacement → display value multiplier */
  scale: number;
  /** season of the next rookie draft that hasn't happened */
  nextDraftSeason: number;
  /** projected slot (1 = first pick) in the next rookie draft, by original team id */
  projectedSlots: Record<string, number>;
  /** 0..1 how much the current standings are trusted for the next draft's order */
  slotConfidence: number;
}

export function isSuperflex(settings: LeagueSettings): boolean {
  return settings.roster.slots.some((s) => s.count > 0 && s.eligible.includes("QB") && s.eligible.length > 1);
}

/** Games a player plays in a full future season */
export function gamesPerSeason(env: Pick<ValueEnv, "seasonWeeks">): number {
  return Math.max(1, env.seasonWeeks - 1) * 0.92;
}

/**
 * Replacement level per position by filling every team's starting slots greedily with the best available
 * players (dedicated slots first, then flex slots from the narrowest eligibility). Replacement = the best
 * player at the position who doesn't make a starting lineup.
 */
export function replacementLevels(
  pool: { position: string; ppg: number }[],
  slots: Pick<RosterSlotDef, "key" | "count" | "eligible">[],
  teams: number,
): { replacement: Record<string, number>; starterIdx: Set<number>; startersByPos: Record<string, number> } {
  const order = pool
    .map((p, i) => ({ i, pos: normalizePosition(p.position), ppg: Number.isFinite(p.ppg) ? p.ppg : 0 }))
    .sort((a, b) => b.ppg - a.ppg);
  const taken = new Set<number>();
  const startersByPos: Record<string, number> = {};
  const sortedSlots = [...slots].filter((s) => s.count > 0).sort((a, b) => a.eligible.length - b.eligible.length);
  for (const slot of sortedSlots) {
    const need = slot.count * teams;
    let filled = 0;
    for (const p of order) {
      if (filled >= need) break;
      if (taken.has(p.i) || !slot.eligible.includes(p.pos)) continue;
      taken.add(p.i);
      startersByPos[p.pos] = (startersByPos[p.pos] ?? 0) + 1;
      filled++;
    }
  }
  const replacement: Record<string, number> = {};
  const positions = new Set<string>([...order.map((o) => o.pos), ...slots.flatMap((s) => s.eligible)]);
  for (const pos of positions) {
    const best = order.find((p) => p.pos === pos && !taken.has(p.i));
    if (best) replacement[pos] = Math.max(0, best.ppg);
    else {
      // every player at the position starts: use 85% of the weakest starter
      const starters = order.filter((p) => p.pos === pos && taken.has(p.i));
      replacement[pos] = starters.length ? Math.max(0, starters[starters.length - 1].ppg * 0.85) : 0;
    }
  }
  return { replacement, starterIdx: taken, startersByPos };
}

/**
 * Market $ per point over replacement: the league's discretionary cap dollars (cap × teams minus minimum
 * salaries for full rosters) divided by the season points over replacement produced by every starter.
 */
export function marketDollarsPerPoint(settings: LeagueSettings, totalStarterParPerSeason: number): number {
  const teams = settings.general.teamCount;
  const discretionary = Math.max(1, teams * settings.salaryCap.cap - teams * settings.roster.maxActiveRoster * settings.salaryCap.minSalary);
  return discretionary / Math.max(1, totalStarterParPerSeason);
}

/**
 * Salary in a future season given the league's annual raise (yearOffset 0 = this season). Pass the contract
 * (rookie deal / NFL experience) so settings.contracts.raiseAppliesTo and raiseRounding are honored.
 */
export function salaryForYear(salary: number, yearOffset: number, settings: LeagueSettings, contract?: { isRookieContract?: boolean | null; yearsExp?: number | null }): number {
  return salaryInYear(salary, yearOffset, settings, contract);
}

// ───────────────────────────── Players ─────────────────────────────

export interface PlayerValueInput {
  id: string;
  position: string;
  age: number | null;
  yearsExp: number | null;
  injuryStatus: string | null;
  /** projected fantasy points for the rest of this season */
  rosPoints: number;
  /** remaining weeks the player is projected to play (projection > 0) */
  rosGames: number;
  /** remaining weeks his NFL team has a game */
  scheduledGames: number;
  /** actual fantasy points per game this season */
  seasonPpg: number;
  gamesPlayed: number;
  /** null = free agent / no contract */
  salary: number | null;
  contractYears: number | null;
  isRookieContract: boolean;
}

export interface PlayerValueResult extends AssetValue {
  ppg: number;
  replacement: number;
  parPerGame: number;
  /** market salary for a full season of this production */
  marketSalary: number;
  /** expected games missed this season */
  gamesMissed: number;
}

function parOf(ppg: number, repl: number, pos = ""): number {
  return (Math.max(0, ppg - repl) + DEPTH_SHARE * Math.max(0, ppg)) * (POSITION_VALUE_FACTOR[pos] ?? 1);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function blendedPpg(p: Pick<PlayerValueInput, "rosPoints" | "rosGames" | "seasonPpg" | "gamesPlayed">): number {
  const proj = p.rosGames > 0 ? p.rosPoints / p.rosGames : null;
  const act = p.gamesPlayed > 0 ? p.seasonPpg : null;
  if (proj === null && act === null) return 0;
  if (proj === null) return act!;
  if (act === null) return proj;
  const wAct = p.gamesPlayed / (p.gamesPlayed + 8);
  return proj * (1 - wAct) + act * wAct;
}

export function playerValue(p: PlayerValueInput, env: ValueEnv, outlook: TeamOutlook = "balanced"): PlayerValueResult {
  const s = env.settings;
  const w = MODE_WEIGHTS[outlook];
  const pos = normalizePosition(p.position);
  const repl = env.replacement[pos] ?? 0;
  const ppg = blendedPpg(p);
  const par = parOf(ppg, repl, pos);
  const notes: string[] = [];
  const gps = gamesPerSeason(env);

  // this season: projected games minus expected injury absences (games already zeroed by projections count)
  const alreadyOut = Math.max(0, p.scheduledGames - p.rosGames);
  const expMissed = expectedGamesMissed(p.injuryStatus, p.scheduledGames);
  const missed = Math.min(p.rosGames, Math.max(0, expMissed - alreadyOut));
  const rosGames = Math.max(0, p.rosGames);
  const currentFull = par * rosGames * w.currentSeason;
  const injuryNow = par * missed * w.currentSeason;

  // future seasons: flat (no aging) vs. age curve
  const f0 = ageFactor(pos, p.age);
  const haircut = longTermInjuryHaircut(p.injuryStatus);
  let futureFlat = 0;
  let futureAged = 0;
  let injuryFuture = 0;
  const seasonPar: number[] = [par * Math.max(0, rosGames - missed)];
  for (let y = 1; y < w.horizon; y++) {
    const d = Math.pow(w.discount, y);
    const rel = p.age === null || f0 <= 0 ? 1 : Math.min(1.6, ageFactor(pos, p.age + y) / f0);
    const parAged = parOf(ppg * rel, repl, pos) * gps;
    futureFlat += par * gps * d;
    futureAged += parAged * d;
    seasonPar.push(parAged);
    if (y === 1 && haircut) injuryFuture += parAged * d * haircut;
  }
  const rookieBoost = p.yearsExp === 0 ? 0.12 : p.yearsExp === 1 ? 0.05 : 0;
  const ageAdj = futureAged - futureFlat;
  const production = currentFull + futureFlat;
  const rookie = (production + ageAdj) * rookieBoost;

  const sfx = pos === "QB" && isSuperflex(s) ? (production + ageAdj - injuryNow) * SUPERFLEX_PREMIUM : 0;

  // contract surplus (cap leagues only)
  let contract = 0;
  let contractNote: string | undefined;
  const marketSalary = s.salaryCap.minSalary + par * gps * env.dollarsPerPoint;
  if (s.salaryCap.enabled && s.contracts.enabled && p.salary !== null && p.contractYears !== null && env.dollarsPerPoint > 0) {
    const years = Math.max(1, p.contractYears);
    const seasonFrac = Math.min(1, env.remainingWeeks / Math.max(1, env.seasonWeeks));
    let surplus$ = 0;
    for (let y = 0; y < years; y++) {
      const d = y === 0 ? 1 : Math.pow(w.discount, y);
      const prodPar = y === 0 ? seasonPar[0] : seasonPar[y] ?? seasonPar[seasonPar.length - 1] * Math.pow(0.85, y - seasonPar.length + 1);
      const market = (y === 0 ? s.salaryCap.minSalary * seasonFrac : s.salaryCap.minSalary) + prodPar * env.dollarsPerPoint;
      const pay = salaryForYear(p.salary, y, s, p) * (y === 0 ? seasonFrac : 1);
      surplus$ += (market - pay) * d * (y === 0 ? w.currentSeason : 1);
    }
    // rookie contracts: the team holds a fourth-year option (only exercised when it's a bargain)
    if (p.isRookieContract && s.contracts.rookieFourthYearOption) {
      const y = years;
      const prodPar = seasonPar[y] ?? 0;
      const optSalary = Math.round(salaryForYear(p.salary, y, s, p) * (1 + s.contracts.rookieOptionRaisePercent / 100));
      const optSurplus = s.salaryCap.minSalary + prodPar * env.dollarsPerPoint - optSalary;
      if (optSurplus > 0) surplus$ += optSurplus * Math.pow(w.discount, y);
    }
    contract = (surplus$ / env.dollarsPerPoint) * CONTRACT_WEIGHT;
    // years after the contract ends: less control (free agency / escalating keeper cost)
    const control = s.keepers.enabled ? 0.85 : s.contracts.expiredContractsBecome === "RFA" ? 0.75 : 0.5;
    let beyond = 0;
    for (let y = years + (p.isRookieContract && s.contracts.rookieFourthYearOption ? 1 : 0); y < w.horizon; y++) beyond += (seasonPar[y] ?? 0) * Math.pow(w.discount, y);
    const controlLoss = beyond * (1 - control);
    contract -= controlLoss;
    const perYear = Math.round(marketSalary - p.salary);
    contractNote = `$${p.salary} × ${years} yr${years === 1 ? "" : "s"} vs ~$${Math.round(marketSalary)} market (${perYear >= 0 ? "+" : "−"}$${Math.abs(perYear)}/yr)`;
    if (controlLoss * env.scale >= 0.5) contractNote += `; −${(controlLoss * env.scale).toFixed(1)} for seasons after the deal ends`;
  }

  const injury = -(injuryNow + injuryFuture);
  const k = env.scale;
  const components: ValueComponent[] = [
    { key: "production", label: "Production", value: production * k, note: `${r1(ppg)} PPG vs ${pos} replacement ${r1(repl)}` },
    { key: "age", label: "Age curve", value: ageAdj * k, note: p.age ? `Age ${p.age} ${pos}${PEAK_AGES[pos] ? ` (peak ${PEAK_AGES[pos]})` : ""}` : undefined },
  ];
  if (rookie) components.push({ key: "rookie", label: p.yearsExp === 0 ? "Rookie upside" : "Second-year upside", value: rookie * k });
  if (sfx) components.push({ key: "superflex", label: "Superflex premium", value: sfx * k });
  if (contract || contractNote) components.push({ key: "contract", label: "Contract", value: contract * k, note: contractNote });
  if (Math.abs(injury * k) >= 0.05) components.push({ key: "injury", label: "Injury", value: injury * k, note: `${p.injuryStatus}: ~${r1(missed)} more game${missed === 1 ? "" : "s"} missed${haircut ? ", long-term risk" : ""}` });

  if (p.age && f0 < 0.75) notes.push(`Past his ${pos} prime`);
  if (p.isRookieContract) notes.push("Rookie contract");

  const raw = production + ageAdj + rookie + sfx + contract + injury;
  return {
    value: raw * k,
    components,
    notes,
    ppg,
    replacement: repl,
    parPerGame: par,
    marketSalary,
    gamesMissed: missed,
  };
}

// ───────────────────────────── Draft picks ─────────────────────────────

export interface PickValueInput {
  season: number;
  round: number;
  originalTeamId: string;
  /** set once the draft order is final */
  pickInRound: number | null;
}

export interface PickValueResult extends AssetValue {
  projectedSlot: number;
  overall: number;
  /** "1.04" style */
  slotLabel: string;
  rookieSalary: number;
  yearsOut: number;
}

/** Value of an overall rookie pick number (1-based): exponential decay where the last 1st ≈ 30% of 1.01 */
export function pickCurve(overall: number, teams: number): number {
  const k = Math.log(1 / PICK_ROUND_END_RATIO) / Math.max(1, teams - 1);
  return PICK_TOP_VALUE * Math.exp(-k * (Math.max(1, overall) - 1));
}

export function projectedPickSlot(pick: PickValueInput, env: ValueEnv): number {
  const mid = (env.teams + 1) / 2;
  if (pick.pickInRound) return pick.pickInRound;
  if (pick.season !== env.nextDraftSeason) return mid;
  const proj = env.projectedSlots[pick.originalTeamId];
  if (!proj) return mid;
  const c = Math.max(0, Math.min(1, env.slotConfidence));
  return mid + (proj - mid) * c;
}

export function rookieScaleSalary(settings: LeagueSettings, round: number, slot: number): number {
  const scale = settings.contracts.rookieScale?.[String(round)];
  const idx = Math.max(0, Math.min((scale?.length ?? 1) - 1, Math.round(slot) - 1));
  const v = scale?.[idx];
  return typeof v === "number" && v > 0 ? v : settings.salaryCap.minSalary;
}

export function pickValue(pick: PickValueInput, env: ValueEnv, outlook: TeamOutlook = "balanced"): PickValueResult {
  const s = env.settings;
  const w = MODE_WEIGHTS[outlook];
  const slot = projectedPickSlot(pick, env);
  const overall = (pick.round - 1) * env.teams + slot;
  const base = pickCurve(overall, env.teams);
  const yearsOut = Math.max(0, pick.season - env.nextDraftSeason);
  const yearFactor = Math.pow(w.pickYearDiscount, yearsOut);
  const afterYear = base * yearFactor;
  const outlookAdj = afterYear * (w.pickMultiplier - 1);
  const rookieSalary = rookieScaleSalary(s, pick.round, slot);
  let contract = 0;
  let contractNote: string | undefined;
  if (s.salaryCap.enabled && s.contracts.enabled && env.dollarsPerPoint > 0 && env.scale > 0) {
    // expected yearly production of the drafted rookie implied by the pick's value
    const bal = MODE_WEIGHTS.balanced;
    let horizonSum = 0;
    for (let y = 0; y < bal.horizon; y++) horizonSum += Math.pow(bal.discount, y);
    const annualPar = base / env.scale / horizonSum;
    const market = s.salaryCap.minSalary + annualPar * env.dollarsPerPoint;
    let surplus$ = 0;
    const years = Math.max(1, s.contracts.rookieContractYears);
    for (let y = 0; y < years; y++) surplus$ += (market - salaryForYear(rookieSalary, y, s, { isRookieContract: true, yearsExp: y })) * Math.pow(w.discount, y);
    contract = (surplus$ / env.dollarsPerPoint) * CONTRACT_WEIGHT * env.scale * yearFactor;
    contractNote = `Rookie scale $${rookieSalary} × ${years} yrs vs ~$${Math.round(market)} market`;
  }
  const slotLabel = `${pick.round}.${String(Math.max(1, Math.round(slot))).padStart(2, "0")}`;
  const components: ValueComponent[] = [
    {
      key: "slot",
      label: "Draft slot",
      value: base,
      note: pick.pickInRound ? `Pick ${slotLabel}` : pick.season === env.nextDraftSeason ? `Projected ${slotLabel} from standings` : `Mid-round assumption (${slotLabel})`,
    },
  ];
  if (yearsOut > 0) components.push({ key: "year", label: "Future-year discount", value: afterYear - base, note: `${yearsOut} draft${yearsOut === 1 ? "" : "s"} away` });
  if (outlookAdj) components.push({ key: "outlook", label: "Team outlook", value: outlookAdj, note: `${OUTLOOK_LABEL[outlook]} weighting` });
  if (contract || contractNote) components.push({ key: "contract", label: "Rookie contract", value: contract, note: contractNote });
  const value = afterYear + outlookAdj + contract;
  return { value, components, notes: [], projectedSlot: slot, overall, slotLabel, rookieSalary, yearsOut };
}

// ───────────────────────────── FAB ─────────────────────────────

export function faabValue(amount: number, env: ValueEnv): AssetValue {
  const s = env.settings;
  const budget = Math.max(1, s.waivers.faabBudget);
  const perDollar = FAAB_FULL_BUDGET_VALUE / budget;
  const seasonFactor = s.waivers.faabRollover ? 1 : Math.max(0.15, Math.min(1, env.remainingRegularWeeks / Math.max(1, s.general.regularSeasonWeeks)));
  const value = Math.max(0, amount) * perDollar * seasonFactor;
  return {
    value,
    components: [{ key: "faab", label: "FAB dollars", value, note: `$${amount} × ${perDollar.toFixed(2)} per $${s.waivers.faabRollover ? "" : ` × ${Math.round(seasonFactor * 100)}% of waiver season left`}` }],
    notes: [],
  };
}

// ───────────────────────────── Trade evaluation ─────────────────────────────

/** Lp-norm side total: positive values consolidate (stud premium), liabilities subtract linearly. */
export function consolidatedTotal(values: number[], power = CONSOLIDATION_POWER): number {
  const pos = values.filter((v) => v > 0);
  const neg = values.filter((v) => v < 0).reduce((a, b) => a + b, 0);
  const norm = pos.length ? Math.pow(pos.reduce((a, v) => a + Math.pow(v, power), 0), 1 / power) : 0;
  return norm + neg;
}

export interface EvalAssetInput {
  key: string;
  type: "PLAYER" | "PICK" | "FAAB";
  label: string;
  fromTeamId: string;
  toTeamId: string;
  value: number;
  components: ValueComponent[];
  notes?: string[];
  /** players: salary and cap hit for the cap impact */
  salary?: number | null;
  capHit?: number;
  nextSeasonSalary?: number;
  contractYears?: number | null;
  /** players: roster status after the move (TAXI players become ACTIVE) */
  rosterStatus?: "ACTIVE" | "IR" | "TAXI";
  /** players: roster status + cap hit on the sending team (defaults to the receiving values) */
  fromStatus?: "ACTIVE" | "IR" | "TAXI";
  fromCapHit?: number;
  /** players: next-season salary leaving the sending team (less any retained salary; defaults to nextSeasonSalary) */
  fromNextSeasonSalary?: number;
  /** players: % of the salary the sending team keeps paying */
  retainPercent?: number;
}

export interface EvalTeamInput {
  teamId: string;
  name: string;
  outlook: TeamOutlook;
  cap?: { enabled: boolean; cap: number; committed: number; nextSeasonCommitted: number; nextSeasonCap: number };
  roster?: { active: number; maxActive: number; ir: number; irSlots: number };
  /** players this team will drop on completion */
  drops?: { capHit: number; deadMoney: number; nextSeasonSalary: number; nextSeasonDead: number; status: string }[];
}

export interface EvalTeamResult {
  teamId: string;
  name: string;
  outlook: TeamOutlook;
  receivedRaw: number;
  received: number;
  sent: number;
  consolidation: number;
  net: number;
  cap?: { before: number; after: number; cap: number; spaceAfter: number; nextBefore: number; nextAfter: number; nextCap: number; over: boolean };
  roster?: { activeBefore: number; activeAfter: number; max: number; overflow: number; irBefore: number; irAfter: number; irSlots: number };
}

export interface TradeEvaluation {
  teams: EvalTeamResult[];
  assets: EvalAssetInput[];
  /** 0..1 */
  fairness: number;
  verdict: string;
  verdictTone: "fair" | "slight" | "lopsided";
  favoredTeamId: string | null;
  warnings: string[];
}

export function verdictFor(fairness: number, favoredName: string | null): { verdict: string; tone: TradeEvaluation["verdictTone"] } {
  if (fairness >= 0.9 || !favoredName) return { verdict: "Fair", tone: "fair" };
  if (fairness >= 0.75) return { verdict: `Slightly favors ${favoredName}`, tone: "slight" };
  return { verdict: `Lopsided for ${favoredName}`, tone: "lopsided" };
}

export function evaluateTrade(input: { teams: EvalTeamInput[]; assets: EvalAssetInput[]; extraWarnings?: string[] }): TradeEvaluation {
  const warnings: string[] = [...(input.extraWarnings ?? [])];
  const results: EvalTeamResult[] = input.teams.map((t) => {
    const inA = input.assets.filter((a) => a.toTeamId === t.teamId);
    const outA = input.assets.filter((a) => a.fromTeamId === t.teamId);
    const receivedRaw = inA.reduce((a, x) => a + x.value, 0);
    const received = consolidatedTotal(inA.map((a) => a.value));
    const sent = consolidatedTotal(outA.map((a) => a.value));
    const r: EvalTeamResult = { teamId: t.teamId, name: t.name, outlook: t.outlook, receivedRaw, received, sent, consolidation: received - receivedRaw, net: received - sent };
    const drops = t.drops ?? [];
    if (t.cap) {
      const inHit = inA.filter((a) => a.type === "PLAYER").reduce((a, x) => a + (x.capHit ?? x.salary ?? 0), 0);
      const outHit = outA.filter((a) => a.type === "PLAYER").reduce((a, x) => a + (x.fromCapHit ?? x.capHit ?? x.salary ?? 0), 0);
      const dropDelta = drops.reduce((a, d) => a - d.capHit + d.deadMoney, 0);
      const after = t.cap.committed + inHit - outHit + dropDelta;
      const inNext = inA.filter((a) => a.type === "PLAYER").reduce((a, x) => a + (x.nextSeasonSalary ?? 0), 0);
      const outNext = outA.filter((a) => a.type === "PLAYER").reduce((a, x) => a + (x.fromNextSeasonSalary ?? x.nextSeasonSalary ?? 0), 0);
      const nextAfter = t.cap.nextSeasonCommitted + inNext - outNext + drops.reduce((a, d) => a - d.nextSeasonSalary + d.nextSeasonDead, 0);
      r.cap = { before: t.cap.committed, after, cap: t.cap.cap, spaceAfter: t.cap.cap - after, nextBefore: t.cap.nextSeasonCommitted, nextAfter, nextCap: t.cap.nextSeasonCap, over: t.cap.enabled && after > t.cap.cap };
      if (r.cap.over) warnings.push(`${t.name} would be $${after - t.cap.cap} over the $${t.cap.cap} cap.`);
      else if (t.cap.enabled && nextAfter > t.cap.nextSeasonCap && nextAfter > t.cap.nextSeasonCommitted) warnings.push(`${t.name} would have $${nextAfter} committed next season (cap $${t.cap.nextSeasonCap}).`);
    }
    if (t.roster) {
      const st = (a: EvalAssetInput, side: "in" | "out") => (side === "out" ? a.fromStatus ?? a.rosterStatus : a.rosterStatus) ?? "ACTIVE";
      const isActive = (side: "in" | "out") => (a: EvalAssetInput) => a.type === "PLAYER" && st(a, side) === "ACTIVE";
      const isIr = (side: "in" | "out") => (a: EvalAssetInput) => a.type === "PLAYER" && st(a, side) === "IR";
      const activeAfter = t.roster.active + inA.filter(isActive("in")).length - outA.filter(isActive("out")).length - drops.filter((d) => d.status !== "IR" && d.status !== "TAXI").length;
      const irAfter = t.roster.ir + inA.filter(isIr("in")).length - outA.filter(isIr("out")).length - drops.filter((d) => d.status === "IR").length;
      const overflow = Math.max(0, activeAfter - t.roster.maxActive);
      r.roster = { activeBefore: t.roster.active, activeAfter, max: t.roster.maxActive, overflow, irBefore: t.roster.ir, irAfter, irSlots: t.roster.irSlots };
      if (overflow > 0 && activeAfter > t.roster.active) warnings.push(`${t.name} would have ${activeAfter} active players (max ${t.roster.maxActive}) — ${overflow} drop${overflow === 1 ? "" : "s"} needed.`);
    }
    return r;
  });

  let fairness = 1;
  let favored: EvalTeamResult | null = null;
  if (results.length >= 2) {
    const maxSide = Math.max(...results.map((r) => Math.max(r.received, r.sent)), 0);
    const nets = results.map((r) => r.net);
    const spread = Math.max(...nets) - Math.min(...nets);
    fairness = maxSide > 0 ? Math.max(0, Math.min(1, 1 - spread / (2 * Math.max(maxSide, FAIRNESS_MIN_SCALE)))) : 1;
    favored = [...results].sort((a, b) => b.net - a.net)[0] ?? null;
    if (favored && favored.net <= 0) favored = null;
  }
  const v = verdictFor(fairness, favored?.name ?? null);
  return { teams: results, assets: input.assets, fairness, verdict: v.verdict, verdictTone: v.tone, favoredTeamId: v.tone === "fair" ? null : favored?.teamId ?? null, warnings };
}

// ───────────────────────────── Team outlook ─────────────────────────────

/**
 * Contender / rebuild classification. With playoff odds: ≥ 55% contender, ≤ 20% rebuild.
 * Otherwise by rank (record then points): top (playoff teams − 1) contend, bottom third rebuild.
 * Too early in the season (< 3 games) everyone is balanced unless odds exist.
 */
export function classifyOutlooks(
  teams: { teamId: string; rank: number; playoffPct?: number | null }[],
  opts: { playoffTeams: number; gamesPlayed: number },
): Record<string, TeamOutlook> {
  const out: Record<string, TeamOutlook> = {};
  const n = teams.length;
  const contenders = Math.max(2, opts.playoffTeams - 1);
  const rebuilders = Math.ceil(n / 3);
  for (const t of teams) {
    if (t.playoffPct !== null && t.playoffPct !== undefined) {
      out[t.teamId] = t.playoffPct >= 0.55 ? "contender" : t.playoffPct <= 0.2 ? "rebuild" : "balanced";
    } else if (opts.gamesPlayed < 3) {
      out[t.teamId] = "balanced";
    } else {
      out[t.teamId] = t.rank <= contenders ? "contender" : t.rank > n - rebuilders ? "rebuild" : "balanced";
    }
  }
  return out;
}

/** Display rounding for values */
export function fmtValue(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Math.abs(r) >= 10 ? Math.round(r).toString() : r.toFixed(1);
}
