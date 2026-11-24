// Recap copywriting: headline, intro paragraph, matchup blurbs and the Matchup of the Week summary, written
// from the week's facts. Template variants are chosen deterministically from (league, season, week) so a
// refreshed recap keeps its wording while different weeks read differently. Pure (no database access).
import { fmtNum } from "./compute";
import type { PlayerPerf } from "./types";

/** FNV-1a hash → unsigned 32-bit */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickVariant<T>(variants: readonly T[], seed: string): T {
  return variants[hashSeed(seed) % variants.length];
}

/**
 * Variant for a recurring slot that rotates week to week within a series (league + season), so the same
 * storyline in consecutive weeks never reads the same way; falls back to a per-week hash without a series.
 */
export function rotateVariant<T>(variants: readonly T[], f: { seed: string; series?: string; week: number }, key: string): T {
  if (!f.series) return pickVariant(variants, `${f.seed}:${key}`);
  return variants[(hashSeed(`${f.series}:${key}`) + f.week) % variants.length];
}

/** Possessive form of a name: "Mike Evans'", "Josh Allen's". */
export function poss(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}

/** Fill "{key}" placeholders. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export interface ScoreFact {
  teamId: string;
  opponentId: string;
  score: number;
  opponentScore: number;
  /** P = a week of a multi-week playoff game that isn't over (no result yet) */
  result: "W" | "L" | "T" | "P";
  /** the scores are a multi-week playoff game's combined score over this many weeks */
  weeks?: number;
  /** a week's score from a game that spans this many weeks (its result is the game's) */
  legs?: number;
}

/** " over 2 weeks" for a multi-week game's combined score, "" otherwise */
function over(f: Pick<ScoreFact, "weeks"> | null | undefined): string {
  return f?.weeks && f.weeks > 1 ? ` over ${f.weeks} weeks` : "";
}

export interface NarrativeFacts {
  seed: string;
  /** league + season: template choices rotate through the season instead of repeating */
  series?: string;
  week: number;
  weekLabel: string;
  isPlayoffs: boolean;
  decimals: number;
  name: (teamId: string) => string;
  high: ScoreFact | null;
  low: ScoreFact | null;
  highTop: PlayerPerf | null;
  average: number;
  /** winner perspective */
  closest: ScoreFact | null;
  blowout: ScoreFact | null;
  comeback: { winner: ScoreFact; lowWinProb: number } | null;
  upset: { winner: ScoreFact; preGameWinProb: number } | null;
  leader: { teamId: string; record: string; streak: string; isNew: boolean } | null;
  benchBlunder: { teamId: string; pointsLeft: number; wouldHaveWon: boolean } | null;
  topPerformer: { name: string; points: number; ownerName: string | null; started: boolean } | null;
  championship: ScoreFact | null;
  /**
   * the playoff games of this week continue next week (a week of multi-week playoff rounds that isn't their last):
   * nobody was knocked out
   */
  playoffLeg?: { leg: number; legs: number } | null;
  /** leaders of the multi-week playoff games still going, combined score through this week (biggest lead first) */
  leads?: ScoreFact[];
}

interface Story {
  score: number;
  headlines: string[];
  vars: Record<string, string | number>;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Headline from the most newsworthy storyline of the week. */
export function buildHeadline(f: NarrativeFacts): string {
  const n = (x: number) => fmtNum(x, f.decimals);
  const stories: Story[] = [];
  if (f.championship && f.championship.result === "W") {
    const c = f.championship;
    const multi = !!c.weeks && c.weeks > 1;
    stories.push({
      score: 100,
      headlines: multi
        ? c.score === c.opponentScore
          ? ["{W} wins the title on the tiebreaker", "Dead even over {k} weeks, {W} takes the crown from {L}"]
          : ["{W} wins the title, beating {L} {ws}–{ls} over {k} weeks", "{W} wins it all, {ws}–{ls} over {k} weeks", "Crown secured: {W} takes the {k}-week final from {L}"]
        : ["{W} wins the title, {ws}–{ls} over {L}", "{W} wins it all, topping {L} {ws}–{ls}", "Crown secured: {W} takes the championship from {L}"],
      vars: { W: f.name(c.teamId), L: f.name(c.opponentId), ws: n(c.score), ls: n(c.opponentScore), k: c.weeks ?? 1 },
    });
  }
  if (f.comeback && f.comeback.lowWinProb <= 0.2) {
    const c = f.comeback.winner;
    stories.push({
      score: 90,
      headlines: ["{W} storms back to stun {L}", "Down to {p}, {W} rallies past {L}", "{W} pulls off the Week {N} heist against {L}"],
      vars: { W: f.name(c.teamId), L: f.name(c.opponentId), p: pct(f.comeback.lowWinProb), N: f.week },
    });
  }
  if (f.closest && f.closest.result === "W" && f.closest.score - f.closest.opponentScore < 2 && f.closest.score > f.closest.opponentScore) {
    const c = f.closest;
    stories.push({
      score: 85,
      headlines: c.weeks && c.weeks > 1
        ? ["{W} survives {L} by {m} over {k} weeks", "Photo finish: {W} outlasts {L} by {m} over {k} weeks"]
        : ["{W} survives {L} by {m}", "{m} points: {W} edges {L} in a Week {N} thriller", "Photo finish: {W} outlasts {L}"],
      vars: { W: f.name(c.teamId), L: f.name(c.opponentId), m: n(c.score - c.opponentScore), N: f.week, k: c.weeks ?? 1 },
    });
  }
  if (f.high && (f.high.score >= f.average + 40 || f.high.score >= 175)) {
    stories.push({
      score: 80,
      headlines: [
        "{T} drops {s} on the league",
        "{T} goes nuclear with {s} points",
        "{s}: {T} sets the bar in Week {N}",
        "{T} lights up the scoreboard for {s}",
        "{T} posts a monster {s}",
        "Nobody could touch {T} and its {s}",
      ],
      vars: { T: f.name(f.high.teamId), s: n(f.high.score), N: f.week },
    });
  }
  if (f.upset && f.upset.preGameWinProb <= 0.25) {
    const u = f.upset.winner;
    stories.push({
      score: 78,
      headlines: ["Upset alert: {W} knocks off {L}", "{W} defies the odds against {L}", "Only {p} to win, {W} takes down {L}"],
      vars: { W: f.name(u.teamId), L: f.name(u.opponentId), p: pct(f.upset.preGameWinProb) },
    });
  }
  if (f.blowout && f.blowout.score - f.blowout.opponentScore >= 50 * (f.blowout.weeks ?? 1)) {
    const b = f.blowout;
    stories.push({
      score: 75,
      headlines: b.weeks && b.weeks > 1
        ? ["{W} flattens {L} by {m} over {k} weeks", "No contest: {W} rolls {L} {ws}–{ls} over {k} weeks"]
        : ["{W} flattens {L} by {m}", "No contest: {W} rolls {L} {ws}–{ls}", "{W} runs {L} off the field"],
      vars: { W: f.name(b.teamId), L: f.name(b.opponentId), m: n(b.score - b.opponentScore), ws: n(b.score), ls: n(b.opponentScore), k: b.weeks ?? 1 },
    });
  }
  const lead = f.playoffLeg ? f.leads?.[0] : undefined;
  if (lead && f.playoffLeg && lead.score - lead.opponentScore >= 30) {
    stories.push({
      score: 72,
      headlines: ["{T} takes a {m}-point lead over {O} into week {k}", "{T} puts {O} in a {m}-point hole", "Advantage {T}: up {m} on {O} with {r} to go"],
      vars: { T: f.name(lead.teamId), O: f.name(lead.opponentId), m: n(lead.score - lead.opponentScore), k: f.playoffLeg.leg + 1, r: f.playoffLeg.legs - f.playoffLeg.leg === 1 ? "a week" : `${f.playoffLeg.legs - f.playoffLeg.leg} weeks` },
    });
  }
  if (f.leader?.isNew && !f.isPlayoffs) {
    stories.push({
      score: 70,
      headlines: ["{T} seizes first place", "New king of the hill: {T} takes the top spot", "{T} climbs to No. 1 after Week {N}"],
      vars: { T: f.name(f.leader.teamId), N: f.week },
    });
  }
  if (f.benchBlunder?.wouldHaveWon) {
    stories.push({
      score: 65,
      headlines: ["{T} leaves a win on the bench", "Wrong guys, {T}: {p} points stuck on the pine", "{T} watches the winning lineup from the bench"],
      vars: { T: f.name(f.benchBlunder.teamId), p: n(f.benchBlunder.pointsLeft) },
    });
  }
  if (f.high) {
    stories.push({
      score: 50,
      headlines: ["{T} owns Week {N}", "Week {N}: {T} sets the pace", "{T} leads the way in Week {N}", "{T} tops the Week {N} leaderboard"],
      vars: { T: f.name(f.high.teamId), N: f.week },
    });
  }
  if (!stories.length) return `${f.weekLabel} Recap`;
  const best = stories.sort((a, b) => b.score - a.score)[0];
  return fill(rotateVariant(best.headlines, f, "headline"), best.vars);
}

/** Intro paragraph: four to six sentences from the week's facts. */
export function buildIntro(f: NarrativeFacts): string {
  const n = (x: number) => fmtNum(x, f.decimals);
  const s: string[] = [];
  s.push(
    rotateVariant(
      f.isPlayoffs && f.playoffLeg
        ? [
            `{L} is in the books, but the playoff games are only ${f.playoffLeg.leg} of ${f.playoffLeg.legs} weeks old.`,
            `Week ${f.playoffLeg.leg} of ${f.playoffLeg.legs} in the playoffs is done, and every game is still alive.`,
          ]
        : f.isPlayoffs
        ? ["The playoff bracket just got smaller.", "Win or go home, and {L} is final.", "Postseason football is unforgiving, and {L} proved it."]
        : [
            "{L} is in the books.",
            "Another Sunday, another round of second-guessing: {L} is final.",
            "The dust has settled on {L}, and the group chat has plenty to talk about.",
            "{L} is final. Here is how it all shook out.",
            "Lineups are locked in the history books for {L}.",
          ],
      f,
      "open",
    ).replace("{L}", f.weekLabel),
  );
  if (f.high) {
    const top = f.highTop ? `, powered by ${poss(f.highTop.name)} ${n(f.highTop.points)}` : "";
    s.push(
      fill(
        rotateVariant(["{T} led the league with {s} points{top}.", "{T} put up a week-best {s}{top}.", "Nobody topped {T}, who posted {s}{top}."], f, "high"),
        { T: f.name(f.high.teamId), s: n(f.high.score), top },
      ),
    );
  }
  if (f.closest && f.blowout && f.closest.teamId !== f.blowout.teamId) {
    s.push(
      f.closest.result === "T"
        ? `${f.name(f.closest.teamId)} and ${f.name(f.closest.opponentId)} could not be separated, finishing tied at ${n(f.closest.score)}, while ${f.name(f.blowout.teamId)} rolled ${f.name(f.blowout.opponentId)} by ${n(f.blowout.score - f.blowout.opponentScore)}${over(f.blowout)}.`
        : f.closest.score === f.closest.opponentScore
          ? `${f.name(f.closest.teamId)} and ${f.name(f.closest.opponentId)} finished level${over(f.closest)} before ${f.name(f.closest.teamId)} advanced on the tiebreaker, while ${f.name(f.blowout.teamId)} beat ${f.name(f.blowout.opponentId)} by ${n(f.blowout.score - f.blowout.opponentScore)}${over(f.blowout)}.`
          : fill(
              rotateVariant(
                ["{CW} edged {CL} by {just}{cm}{co} in the closest game of the week, while {BW} blew out {BL} by {bm}{bo}.", "The tightest finish belonged to {CW}, who held off {CL} by {cm}{co}; the widest to {BW}, who beat {BL} by {bm}{bo}."],
                f,
                "games",
              ),
              {
                CW: f.name(f.closest.teamId),
                CL: f.name(f.closest.opponentId),
                cm: n(f.closest.score - f.closest.opponentScore),
                co: over(f.closest),
                just: f.closest.score - f.closest.opponentScore < 5 ? "just " : "",
                BW: f.name(f.blowout.teamId),
                BL: f.name(f.blowout.opponentId),
                bm: n(f.blowout.score - f.blowout.opponentScore),
                bo: over(f.blowout),
              },
            ),
    );
  } else if (f.closest && f.closest.result === "W" && f.closest.score > f.closest.opponentScore) {
    s.push(`${f.name(f.closest.teamId)} edged ${f.name(f.closest.opponentId)} by ${n(f.closest.score - f.closest.opponentScore)}${over(f.closest)} in the closest game of the week.`);
  }
  if (f.playoffLeg && f.leads?.length) {
    const [big, ...rest] = f.leads;
    const tight = rest.length ? rest[rest.length - 1] : null;
    const next = f.playoffLeg.leg + 1;
    const line = (x: ScoreFact) => `${f.name(x.teamId)} leads ${f.name(x.opponentId)} by ${n(x.score - x.opponentScore)}`;
    if (big.score === big.opponentScore) s.push(`${f.name(big.teamId)} and ${f.name(big.opponentId)} are dead even at ${n(big.score)} going into week ${next}.`);
    else if (tight && tight.teamId !== big.teamId)
      s.push(
        tight.score === tight.opponentScore
          ? `${line(big)} going into week ${next}, while ${f.name(tight.teamId)} and ${f.name(tight.opponentId)} are level at ${n(tight.score)}.`
          : `${line(big)} going into week ${next}, and ${line(tight)} in the tightest game.`,
      );
    else s.push(`${line(big)} going into week ${next}.`);
  }
  if (f.low && f.high && f.low.teamId !== f.high.teamId) {
    s.push(
      fill(rotateVariant(["At the other end, {T} limped to a week-low {s}.", "{T} would like to forget its {s}, the lowest total of the week.", "The basement belonged to {T} at {s}."], f, "low"), {
        T: f.name(f.low.teamId),
        s: n(f.low.score),
      }) + (f.low.result === "W" ? (f.low.legs && f.low.legs > 1 ? ` It still won the ${f.low.legs}-week game.` : " It still won.") : ""),
    );
  }
  if (f.benchBlunder && f.benchBlunder.pointsLeft >= 15) {
    s.push(
      `${f.name(f.benchBlunder.teamId)} left ${n(f.benchBlunder.pointsLeft)} points on the bench${f.benchBlunder.wouldHaveWon ? ", enough to flip the result" : ""}.`,
    );
  }
  if (f.topPerformer && f.topPerformer.ownerName && f.topPerformer.started) {
    s.push(`${f.topPerformer.name} was the top player in the league with ${n(f.topPerformer.points)} for ${f.topPerformer.ownerName}.`);
  } else if (f.topPerformer && !f.topPerformer.ownerName) {
    s.push(`The top scorer in the league, ${f.topPerformer.name} (${n(f.topPerformer.points)}), is sitting in free agency.`);
  }
  if (f.leader && !f.isPlayoffs) {
    const streak = /^W(\d+)$/.exec(f.leader.streak);
    const streakTxt = streak && Number(streak[1]) >= 3 ? ` with ${streak[1]} straight wins` : "";
    s.push(
      f.leader.isNew
        ? `${f.name(f.leader.teamId)} moved into first place at ${f.leader.record}${streakTxt}.`
        : fill(rotateVariant(["{T} stays on top at {r}{st}.", "{T} still sits atop the standings at {r}{st}.", "First place still belongs to {T} ({r}){st}."], f, "leader"), {
            T: f.name(f.leader.teamId),
            r: f.leader.record,
            st: streakTxt,
          }),
    );
  }
  return s.join(" ");
}

export interface BlurbFacts {
  seed: string;
  decimals: number;
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
  tie: boolean;
  winnerTop: PlayerPerf | null;
  loserTop: PlayerPerf | null;
  /** the loser's hindsight-optimal lineup would have won */
  loserFlip: { benched: PlayerPerf; started: PlayerPerf; diff: number; pointsLeft: number } | null;
}

/** One- or two-sentence matchup recap. */
export function matchupBlurb(b: BlurbFacts): string {
  const n = (x: number) => fmtNum(x, b.decimals);
  if (b.tie) return `${b.winnerName} and ${b.loserName} played to a ${n(b.winnerScore)}–${n(b.loserScore)} draw.`;
  const margin = b.winnerScore - b.loserScore;
  const verbs = margin < 3 ? ["survived", "squeaked past", "held off"] : margin < 15 ? ["beat", "got past", "took down"] : margin < 40 ? ["handled", "pulled away from", "cruised past"] : ["routed", "steamrolled", "buried"];
  const verb = pickVariant(verbs, `${b.seed}:verb`);
  const top = b.winnerTop && b.winnerTop.points > 0 ? ` behind ${poss(b.winnerTop.name)} ${n(b.winnerTop.points)}` : "";
  let out = `${b.winnerName} ${verb} ${b.loserName} ${n(b.winnerScore)}–${n(b.loserScore)}${top}.`;
  if (b.loserFlip && b.loserFlip.diff > margin)
    out += ` ${b.loserName} had the answer on the bench: starting ${b.loserFlip.benched.name} (${n(b.loserFlip.benched.points)}) over ${b.loserFlip.started.name} (${n(b.loserFlip.started.points)}) would have flipped it.`;
  else if (b.loserFlip) out += ` ${b.loserName} left ${n(b.loserFlip.pointsLeft)} points on the bench, enough to flip the result.`;
  else if (b.loserTop && b.loserTop.points >= 25) out += ` ${poss(b.loserTop.name)} ${n(b.loserTop.points)} for ${b.loserName} wasn't enough.`;
  return out;
}

export interface LegBlurbFacts {
  seed: string;
  decimals: number;
  leg: number;
  legs: number;
  /** the game ended this week */
  decided: boolean;
  /** a decided game level on points, settled by the playoff tiebreakers */
  tiebreak: boolean;
  /** "a": the game's winner (decided) or leader (ties: either), "b": the other team */
  aName: string;
  bName: string;
  /** this week's scores */
  aWeek: number;
  bWeek: number;
  /** combined score through this week */
  aTotal: number;
  bTotal: number;
  aTop: PlayerPerf | null;
  /** decided: b's hindsight-optimal lineup this week would have won the game */
  bFlip: { pointsLeft: number } | null;
}

/** Blurb for one week of a multi-week playoff game: where the game stands (or how it was won) on the combined score. */
export function legBlurb(b: LegBlurbFacts): string {
  const n = (x: number) => fmtNum(x, b.decimals);
  const left = b.legs - b.leg;
  const toGo = left === 1 ? "One week to go." : `${left} weeks to go.`;
  const top = b.aTop && b.aTop.points > 0 ? `, with ${poss(b.aTop.name)} ${n(b.aTop.points)} leading the way this week` : "";
  if (!b.decided) {
    if (b.aTotal === b.bTotal) return `${b.aName} and ${b.bName} are level at ${n(b.aTotal)} after week ${b.leg} of ${b.legs}. ${toGo}`;
    const week =
      b.leg === 1
        ? top
        : b.aWeek >= b.bWeek
          ? `, taking this week ${n(b.aWeek)}–${n(b.bWeek)}`
          : `, though ${b.bName} won this week ${n(b.bWeek)}–${n(b.aWeek)}`;
    return `${b.aName} leads ${b.bName} ${n(b.aTotal)}–${n(b.bTotal)} after week ${b.leg} of ${b.legs}${week}. ${toGo}`;
  }
  if (b.tiebreak) return `${b.aName} and ${b.bName} finished level at ${n(b.aTotal)} over ${b.legs} weeks; ${b.aName} advances on the tiebreaker.`;
  const margin = b.aTotal - b.bTotal;
  const verbs = margin < 3 ? ["survived", "squeaked past", "held off"] : margin < 20 ? ["beat", "got past", "took down"] : margin < 60 ? ["handled", "pulled away from", "cruised past"] : ["routed", "steamrolled", "buried"];
  let out = `${b.aName} ${pickVariant(verbs, `${b.seed}:verb`)} ${b.bName} ${n(b.aTotal)}–${n(b.bTotal)} over ${b.legs} weeks${top}.`;
  const aBefore = b.aTotal - b.aWeek;
  const bBefore = b.bTotal - b.bWeek;
  if (b.aWeek < b.bWeek) out += ` ${b.bName} won week ${b.leg} ${n(b.bWeek)}–${n(b.aWeek)} but couldn't close the gap.`;
  else if (aBefore < bBefore) out += ` ${b.aName} trailed by ${n(bBefore - aBefore)} going into week ${b.leg}.`;
  if (b.bFlip) out += ` ${b.bName} left ${n(b.bFlip.pointsLeft)} points on the bench this week, enough to flip the game.`;
  return out;
}

/** Matchup of the Week summary sentence + chip label. */
export function motwCopy(
  reason: "COMEBACK" | "CLOSEST" | "SHOOTOUT" | "UPSET",
  x: {
    seed: string;
    decimals: number;
    winnerName: string;
    loserName: string;
    winnerScore: number;
    loserScore: number;
    lowWinProb: number | null;
    preGameWinProb: number | null;
    tie: boolean;
    /**
     * a week of a multi-week playoff game: winner / loser = the game's winner (decided) or leader, with the combined
     * score through this week; `weekCombined` = both teams' points this week
     */
    game?: { leg: number; legs: number; decided: boolean; weekCombined: number } | null;
  },
): { label: string; summary: string } {
  const n = (v: number) => fmtNum(v, x.decimals);
  const combined = n(x.winnerScore + x.loserScore);
  const g = x.game;
  if (g) {
    const level = x.winnerScore === x.loserScore;
    const label = reason === "CLOSEST" ? "Closest game" : "Shootout of the week";
    if (!g.decided) {
      const standing = level ? `${x.winnerName} and ${x.loserName} are level at ${n(x.winnerScore)}` : `${x.winnerName} leads ${x.loserName} ${n(x.winnerScore)}–${n(x.loserScore)}`;
      if (reason === "CLOSEST")
        return { label, summary: level ? `All square: ${standing} after week ${g.leg} of ${g.legs}.` : `${x.winnerName} leads ${x.loserName} by just ${n(x.winnerScore - x.loserScore)} after week ${g.leg} of ${g.legs}.` };
      return { label, summary: `${n(g.weekCombined)} combined points in week ${g.leg} of ${g.legs}: ${standing}.` };
    }
    if (level) return { label: "Dead heat", summary: `${x.winnerName} and ${x.loserName} finished level at ${n(x.winnerScore)} over ${g.legs} weeks; ${x.winnerName} advances on the tiebreaker.` };
    if (reason === "CLOSEST") return { label, summary: `${x.winnerName} outlasted ${x.loserName} by ${n(x.winnerScore - x.loserScore)} over ${g.legs} weeks, ${n(x.winnerScore)}–${n(x.loserScore)}.` };
    return { label, summary: `${n(g.weekCombined)} combined points in the deciding week as ${x.winnerName} beat ${x.loserName} ${n(x.winnerScore)}–${n(x.loserScore)} over ${g.legs} weeks.` };
  }
  if (x.tie) return { label: "Dead heat", summary: `${x.winnerName} and ${x.loserName} finished all square at ${n(x.winnerScore)}.` };
  switch (reason) {
    case "COMEBACK":
      return {
        label: "Comeback of the week",
        summary: `${x.winnerName} fell to a ${pct(x.lowWinProb ?? 0)} chance to win before rallying past ${x.loserName}, ${n(x.winnerScore)}–${n(x.loserScore)}.`,
      };
    case "CLOSEST":
      return {
        label: "Closest game",
        summary: pickVariant(
          [
            `${x.winnerName} outlasted ${x.loserName} by ${n(x.winnerScore - x.loserScore)} in the tightest game of the week.`,
            `Every point mattered: ${x.winnerName} ${n(x.winnerScore)}, ${x.loserName} ${n(x.loserScore)}.`,
          ],
          `${x.seed}:motw`,
        ),
      };
    case "UPSET":
      return {
        label: "Upset of the week",
        summary: `Given just a ${pct(x.preGameWinProb ?? 0)} chance before kickoff, ${x.winnerName} beat ${x.loserName} ${n(x.winnerScore)}–${n(x.loserScore)}.`,
      };
    default:
      return {
        label: "Shootout of the week",
        summary: `${combined} combined points: ${x.winnerName} outgunned ${x.loserName} ${n(x.winnerScore)}–${n(x.loserScore)}.`,
      };
  }
}
