// League standings with configurable tiebreakers, all-play records, streaks, power rankings.
import type { Matchup, Team } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";

export interface StandingRow {
  team: Team;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  pointsFor: number;
  pointsAgainst: number;
  divWins: number;
  divLosses: number;
  divTies: number;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  streak: string; // "W3"
  last5: ("W" | "L" | "T")[];
  gamesBack: number;
  divisionRank: number;
  maxPointsFor: number; // optimal lineup PF not tracked here; equals PF placeholder
  powerScore: number;
  powerRank: number;
  /** wins over median (when the median game is enabled) */
  medianWins: number;
  medianLosses: number;
}

export async function computeStandings(leagueId: string, season: number, settings: LeagueSettings, opts: { throughWeek?: number } = {}): Promise<StandingRow[]> {
  const teams = await db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } });
  const matchups = await db.matchup.findMany({
    where: { leagueId, season, isPlayoff: false, status: "FINAL", ...(opts.throughWeek ? { week: { lte: opts.throughWeek } } : {}) },
    orderBy: { week: "asc" },
  });
  return standingsFromMatchups(teams, matchups, settings);
}

export function standingsFromMatchups(teams: Team[], matchups: Matchup[], settings: LeagueSettings): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const t of teams) {
    rows.set(t.id, {
      team: t, rank: 0, wins: 0, losses: 0, ties: 0, pct: 0, pointsFor: 0, pointsAgainst: 0,
      divWins: 0, divLosses: 0, divTies: 0, allPlayWins: 0, allPlayLosses: 0, allPlayTies: 0,
      streak: "", last5: [], gamesBack: 0, divisionRank: 0, maxPointsFor: 0, powerScore: 0, powerRank: 0,
      medianWins: 0, medianLosses: 0,
    });
  }
  const results = new Map<string, ("W" | "L" | "T")[]>();
  const h2h = new Map<string, { w: number; l: number }>(); // key a|b
  const byWeek = new Map<number, Matchup[]>();
  for (const m of matchups) {
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week)!.push(m);
  }
  const push = (id: string, r: "W" | "L" | "T") => {
    if (!results.has(id)) results.set(id, []);
    results.get(id)!.push(r);
  };
  for (const [, ms] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const weekScores: { id: string; pts: number }[] = [];
    for (const m of ms) {
      if (!m.homeTeamId || !m.awayTeamId) continue;
      const h = rows.get(m.homeTeamId);
      const a = rows.get(m.awayTeamId);
      if (!h || !a) continue;
      h.pointsFor += m.homeScore; h.pointsAgainst += m.awayScore;
      a.pointsFor += m.awayScore; a.pointsAgainst += m.homeScore;
      weekScores.push({ id: h.team.id, pts: m.homeScore }, { id: a.team.id, pts: m.awayScore });
      const sameDiv = h.team.division && h.team.division === a.team.division;
      let hr: "W" | "L" | "T";
      if (m.winnerTeamId === m.homeTeamId) hr = "W";
      else if (m.winnerTeamId === m.awayTeamId) hr = "L";
      else hr = m.homeScore > m.awayScore ? "W" : m.homeScore < m.awayScore ? "L" : "T";
      const ar: "W" | "L" | "T" = hr === "W" ? "L" : hr === "L" ? "W" : "T";
      for (const [row, r] of [[h, hr], [a, ar]] as const) {
        if (r === "W") row.wins++; else if (r === "L") row.losses++; else row.ties++;
        if (sameDiv) { if (r === "W") row.divWins++; else if (r === "L") row.divLosses++; else row.divTies++; }
        push(row.team.id, r);
      }
      const k1 = `${h.team.id}|${a.team.id}`, k2 = `${a.team.id}|${h.team.id}`;
      const e1 = h2h.get(k1) ?? { w: 0, l: 0 }, e2 = h2h.get(k2) ?? { w: 0, l: 0 };
      if (hr === "W") { e1.w++; e2.l++; } else if (hr === "L") { e1.l++; e2.w++; }
      h2h.set(k1, e1); h2h.set(k2, e2);
    }
    // all-play + median game
    const sorted = [...weekScores].sort((x, y) => x.pts - y.pts);
    const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)].pts + sorted[Math.ceil((sorted.length - 1) / 2)].pts) / 2 : 0;
    for (const ws of weekScores) {
      const row = rows.get(ws.id)!;
      for (const other of weekScores) {
        if (other.id === ws.id) continue;
        if (ws.pts > other.pts) row.allPlayWins++; else if (ws.pts < other.pts) row.allPlayLosses++; else row.allPlayTies++;
      }
      if (settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN") {
        if (ws.pts > median) { row.medianWins++; row.wins++; push(ws.id, "W"); }
        else if (ws.pts < median) { row.medianLosses++; row.losses++; push(ws.id, "L"); }
      }
    }
    if (settings.niche.weeklyHighScoreBonusWin && weekScores.length) {
      const top = [...weekScores].sort((x, y) => y.pts - x.pts)[0];
      rows.get(top.id)!.wins++;
    }
  }

  for (const row of rows.values()) {
    const g = row.wins + row.losses + row.ties;
    row.pct = g ? (row.wins + row.ties * 0.5) / g : 0;
    row.pointsFor = Math.round(row.pointsFor * 100) / 100;
    row.pointsAgainst = Math.round(row.pointsAgainst * 100) / 100;
    const res = results.get(row.team.id) ?? [];
    row.last5 = res.slice(-5);
    if (res.length) {
      const last = res[res.length - 1];
      let n = 0;
      for (let i = res.length - 1; i >= 0 && res[i] === last; i--) n++;
      row.streak = `${last}${n}`;
    }
  }

  const tiebreak = (a: StandingRow, b: StandingRow): number => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    for (const tb of settings.standings.tiebreakers) {
      if (tb === "H2H") {
        const e = h2h.get(`${a.team.id}|${b.team.id}`);
        if (e && e.w !== e.l) return e.l - e.w;
      } else if (tb === "POINTS_FOR") {
        if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      } else if (tb === "DIVISION_RECORD") {
        const ap = a.divWins + a.divLosses ? a.divWins / (a.divWins + a.divLosses) : 0;
        const bp = b.divWins + b.divLosses ? b.divWins / (b.divWins + b.divLosses) : 0;
        if (bp !== ap) return bp - ap;
      } else if (tb === "POINTS_AGAINST") {
        if (a.pointsAgainst !== b.pointsAgainst) return b.pointsAgainst - a.pointsAgainst;
      } else if (tb === "ALL_PLAY") {
        if (b.allPlayWins !== a.allPlayWins) return b.allPlayWins - a.allPlayWins;
      } else if (tb === "COIN_FLIP") {
        return a.team.id < b.team.id ? -1 : 1; // deterministic "coin flip"
      }
    }
    return 0;
  };
  const list = [...rows.values()].sort(tiebreak);
  list.forEach((r, i) => (r.rank = i + 1));
  const leader = list[0];
  for (const r of list) r.gamesBack = leader ? ((leader.wins - r.wins) + (r.losses - leader.losses)) / 2 : 0;
  // division ranks
  const divs = new Map<string, StandingRow[]>();
  for (const r of list) {
    const d = r.team.division ?? "";
    if (!divs.has(d)) divs.set(d, []);
    divs.get(d)!.push(r);
  }
  for (const d of divs.values()) d.forEach((r, i) => (r.divisionRank = i + 1));

  // power rankings
  const w = settings.standings.powerRanking;
  const maxPF = Math.max(1, ...list.map((r) => r.pointsFor));
  for (const r of list) {
    const apg = r.allPlayWins + r.allPlayLosses + r.allPlayTies;
    const allPlayPct = apg ? (r.allPlayWins + r.allPlayTies * 0.5) / apg : 0;
    const recent = r.last5.length ? r.last5.filter((x) => x === "W").length / r.last5.length : 0;
    r.powerScore = Math.round((w.recordWeight * r.pct + w.pointsWeight * (r.pointsFor / maxPF) + w.allPlayWeight * allPlayPct + w.recentFormWeight * recent) * 1000) / 10;
  }
  [...list].sort((a, b) => b.powerScore - a.powerScore).forEach((r, i) => (r.powerRank = i + 1));
  return list;
}

/** Playoff seeding from standings (division winners first if configured; wildcards by points if configured). */
export function playoffSeeds(standings: StandingRow[], settings: LeagueSettings): StandingRow[] {
  const n = settings.playoffs.teams;
  let seeds: StandingRow[] = [];
  if (settings.standings.divisionWinnersTopSeeds) {
    const winners = standings.filter((r) => r.divisionRank === 1 && r.team.division);
    seeds.push(...winners);
  }
  const rest = standings.filter((r) => !seeds.includes(r));
  const byPoints = settings.playoffs.wildcardsByPoints ?? 0;
  const recordSpots = Math.max(0, n - seeds.length - byPoints);
  const recordList = settings.playoffs.seeding === "POINTS_FOR" ? [...rest].sort((a, b) => b.pointsFor - a.pointsFor) : rest;
  seeds.push(...recordList.slice(0, recordSpots));
  const remaining = standings.filter((r) => !seeds.includes(r)).sort((a, b) => b.pointsFor - a.pointsFor);
  seeds.push(...remaining.slice(0, byPoints));
  seeds = seeds.slice(0, n);
  return seeds;
}
