// Power rankings: fact-driven one-line blurbs (streaks, movement, scoring rank, all-play luck, injuries to
// key players, rest-of-season strength, playoff odds). Pure and deterministic: phrasing varies per team/week.
import { ordinal } from "@/lib/utils";
import { hashString } from "./rng";

export interface PowerFacts {
  teamId: string;
  teamName: string;
  week: number;
  rank: number;
  prevRank: number | null;
  teamCount: number;
  wins: number;
  losses: number;
  ties: number;
  /** "W3" / "L2" / "" */
  streak: string;
  pfRank: number;
  pointsFor: number;
  allPlayPct: number;
  recordPct: number;
  rosRank: number | null;
  rosPerWeek: number | null;
  injuredStars: { name: string; status: string; position: string }[];
  playoffPct: number | null;
}

interface Clause {
  kind: string;
  score: number;
  text: string;
}

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (p: number) => (p >= 0.995 ? ">99%" : p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);
const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const spell = (n: number) => words[n] ?? String(n);

function pick(f: PowerFacts, kind: string, options: string[]): string {
  return options[hashString(`${f.teamId}:${f.week}:${kind}`) % options.length]!;
}

function clauses(f: PowerFacts): Clause[] {
  const out: Clause[] = [];
  const rec = f.ties ? `${f.wins}-${f.losses}-${f.ties}` : `${f.wins}-${f.losses}`;
  const streakN = Number(f.streak.slice(1)) || 0;
  const streakType = f.streak[0];

  if (streakType === "W" && streakN >= 3)
    out.push({ kind: "streak", score: 5 + streakN, text: pick(f, "ws", [`Winners of ${spell(streakN)} straight`, `Riding a ${streakN}-game winning streak`, `${spell(streakN).replace(/^./, (c) => c.toUpperCase())} wins in a row and counting`]) });
  else if (streakType === "L" && streakN >= 3)
    out.push({ kind: "streak", score: 5 + streakN, text: pick(f, "ls", [`Dropped ${spell(streakN)} straight`, `Stuck in a ${streakN}-game skid`, `Losers of ${spell(streakN)} in a row`]) });
  else if (streakType === "W" && streakN === 2) out.push({ kind: "streak", score: 2, text: pick(f, "w2", ["Back-to-back wins", "Two straight wins"]) });
  else if (streakType === "L" && streakN === 2) out.push({ kind: "streak", score: 2, text: pick(f, "l2", ["Two straight losses", "Back-to-back losses"]) });

  if (f.prevRank !== null) {
    const d = f.prevRank - f.rank;
    if (f.rank === 1 && d === 0) out.push({ kind: "move", score: 5.5, text: pick(f, "top", ["Still the team to beat", "Holds the top spot for another week", "Nobody has knocked them off the top"]) });
    else if (f.rank === 1 && d > 0) out.push({ kind: "move", score: 7, text: pick(f, "newtop", [`Climbs ${d} ${d === 1 ? "spot" : "spots"} to No. 1`, `New No. 1 after jumping ${d} ${d === 1 ? "spot" : "spots"}`]) });
    else if (d >= 2) out.push({ kind: "move", score: 4 + d / 2, text: pick(f, "up", [`Up ${d} spots this week`, `Climbs ${d} spots to ${ordinal(f.rank)}`, `A ${d}-spot jump in the rankings`]) });
    else if (d <= -2) out.push({ kind: "move", score: 4 + -d / 2, text: pick(f, "down", [`Slides ${-d} spots to ${ordinal(f.rank)}`, `Down ${-d} spots this week`, `Tumbles ${-d} places in the rankings`]) });
  }

  if (f.pfRank === 1) out.push({ kind: "pf", score: 5, text: pick(f, "pf1", [`The league's highest-scoring team (${num(f.pointsFor)} PF)`, `Leads the league with ${num(f.pointsFor)} points scored`, `Nobody has scored more than their ${num(f.pointsFor)} points`]) });
  else if (f.pfRank === f.teamCount) out.push({ kind: "pf", score: 4, text: pick(f, "pfl", [`Last in the league in scoring (${num(f.pointsFor)} PF)`, `The offense ranks dead last at ${num(f.pointsFor)} points`]) });
  else if (f.pfRank <= 3) out.push({ kind: "pf", score: 2.5, text: pick(f, "pft", [`A top-three offense (${ordinal(f.pfRank)} in PF)`, `${ordinal(f.pfRank).replace(/^./, (c) => c.toUpperCase())} in points scored with ${num(f.pointsFor)}`]) });

  const luck = f.allPlayPct - f.recordPct;
  if (luck >= 0.15)
    out.push({ kind: "luck", score: 4 + luck * 5, text: pick(f, "unlucky", [`Better than ${rec} suggests: a ${pct(f.allPlayPct)} all-play win rate`, `Unlucky so far, with an all-play mark well ahead of their ${rec} record`, `The schedule has not been kind; all-play says they win ${pct(f.allPlayPct)} of the time`]) });
  else if (luck <= -0.15)
    out.push({ kind: "luck", score: 4 - luck * 5, text: pick(f, "lucky", [`${rec} despite a ${pct(f.allPlayPct)} all-play win rate`, `Winning closer than the scoring says: all-play has them at ${pct(f.allPlayPct)}`, `Living right at ${rec} with middling all-play numbers`]) });

  if (f.injuredStars.length) {
    const s = f.injuredStars[0]!;
    const serious = ["Out", "IR", "PUP", "Sus", "Doubtful"].includes(s.status);
    const more = f.injuredStars.length > 1 ? ` and ${f.injuredStars[1]!.name} (${f.injuredStars[1]!.status})` : "";
    out.push({
      kind: "injury",
      score: serious ? 5 : 3.5,
      text: pick(f, "inj", [`${s.name} (${s.position}, ${s.status})${more} is a real worry`, `Monitoring ${s.name} (${s.status})${more}`, `Health is the question with ${s.name} listed ${s.status}${more}`]),
    });
  }

  if (f.rosRank !== null && f.rosPerWeek !== null) {
    if (f.rosRank === 1) out.push({ kind: "ros", score: 3.5, text: pick(f, "ros1", [`Best rest-of-season projection in the league (${num(f.rosPerWeek)} per week)`, `Projected to be the strongest lineup the rest of the way`]) });
    else if (f.rosRank === f.teamCount) out.push({ kind: "ros", score: 3.5, text: pick(f, "rosl", [`The weakest rest-of-season projection in the league`, `Projects worst the rest of the way at ${num(f.rosPerWeek)} per week`]) });
    else if (f.rosRank <= 3) out.push({ kind: "ros", score: 2, text: `${ordinal(f.rosRank).replace(/^./, (c) => c.toUpperCase())}-best roster projection from here` });
  }

  if (f.playoffPct !== null) {
    if (f.playoffPct >= 0.97) out.push({ kind: "odds", score: 3, text: pick(f, "lock", [`A ${pct(f.playoffPct)} playoff lock`, `Playoff odds sit at ${pct(f.playoffPct)}`]) });
    else if (f.playoffPct <= 0.03) out.push({ kind: "odds", score: 3.5, text: pick(f, "out", [`Playing for pride with ${pct(f.playoffPct)} playoff odds`, `Playoff hopes are down to ${pct(f.playoffPct)}`]) });
    else if (f.playoffPct >= 0.4 && f.playoffPct <= 0.6) out.push({ kind: "odds", score: 2.5, text: pick(f, "bubble", [`Squarely on the playoff bubble at ${pct(f.playoffPct)}`, `A coin flip to make the playoffs (${pct(f.playoffPct)})`]) });
    else if (f.playoffPct > 0.6 && f.playoffPct < 0.8) out.push({ kind: "odds", score: 2, text: pick(f, "lean", [`Leaning in at ${pct(f.playoffPct)} playoff odds`, `In decent shape with ${pct(f.playoffPct)} playoff odds`]) });
    else if (f.playoffPct > 0.2 && f.playoffPct < 0.4) out.push({ kind: "odds", score: 2, text: pick(f, "chase", [`Chasing a spot with ${pct(f.playoffPct)} playoff odds`, `Needs help: ${pct(f.playoffPct)} to make the playoffs`]) });
  }

  out.push({ kind: "record", score: 1, text: pick(f, "rec", [`${rec} and ${ordinal(f.rank)} in the power index`, `Sits ${ordinal(f.rank)} at ${rec}`, `${rec} with ${num(f.pointsFor)} points scored`]) });
  return out;
}

/** One- or two-sentence blurb built from the most notable facts. */
export function powerBlurb(f: PowerFacts): string {
  const list = clauses(f).sort((a, b) => b.score - a.score);
  const lead = list[0]!;
  const second = list.find((c) => c.kind !== lead.kind && c.kind !== "record" && c.score >= 2.5);
  const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
  return second ? `${cap(lead.text)}. ${cap(second.text)}.` : `${cap(lead.text)}.`;
}
