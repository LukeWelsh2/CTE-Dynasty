// Seed CTE Dynasty: league, 12 teams/managers, startup-auction rosters with salaries & contracts,
// 3 years of rookie picks, schedule, lineups + real results for completed weeks, chat, sample trades.
//   npm run db:seed            (requires players/stats already synced: npm run sync:all)
//   SEED_PASSWORD=... npm run db:seed
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, resolveSettings } from "@/lib/settings/schema";
import { calcPoints } from "@/lib/scoring/engine";
import { generateSchedule } from "@/lib/schedule";
import { ensureDraftPicks } from "@/lib/picks";
import { autoFillLineup } from "@/lib/lineup";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { ensureDefaultChannels, postSystemMessage } from "@/lib/chat-system";
import { getNflState } from "@/lib/nfl/state";
import { normalizePosition } from "@/lib/settings/stat-catalog";

const PASSWORD = process.env.SEED_PASSWORD || "ctedynasty";

const TEAMS = [
  { name: "Concussion Protocol", abbrev: "CP", owner: "The Commish", email: "commish@ctedynasty.local", div: "east", c1: "#b91c1c", c2: "#fbbf24", commish: true },
  { name: "Helmet to Helmet", abbrev: "H2H", owner: "Marcus Reed", email: "marcus@ctedynasty.local", div: "east", c1: "#1d4ed8", c2: "#e5e7eb" },
  { name: "Blindside Bandits", abbrev: "BB", owner: "Tyler Brooks", email: "tyler@ctedynasty.local", div: "east", c1: "#0f766e", c2: "#facc15" },
  { name: "Targeting Penalty", abbrev: "TGT", owner: "Jordan Ellis", email: "jordan@ctedynasty.local", div: "east", c1: "#7c3aed", c2: "#f472b6" },
  { name: "Bell Ringers", abbrev: "RING", owner: "Chris Park", email: "chris@ctedynasty.local", div: "east", c1: "#ca8a04", c2: "#111827" },
  { name: "Head Trauma FC", abbrev: "HTFC", owner: "Danny Ortiz", email: "danny@ctedynasty.local", div: "east", c1: "#be123c", c2: "#1e293b" },
  { name: "Sideline Tent", abbrev: "TENT", owner: "Ryan Cole", email: "ryan@ctedynasty.local", div: "west", c1: "#15803d", c2: "#f8fafc" },
  { name: "Spearing Kings", abbrev: "SPK", owner: "Alex Kim", email: "alex@ctedynasty.local", div: "west", c1: "#9333ea", c2: "#fde047" },
  { name: "Stinger Squad", abbrev: "STNG", owner: "Ben Carter", email: "ben@ctedynasty.local", div: "west", c1: "#ea580c", c2: "#1f2937" },
  { name: "Lights Out", abbrev: "LO", owner: "Sam Patel", email: "sam@ctedynasty.local", div: "west", c1: "#0369a1", c2: "#f59e0b" },
  { name: "Seeing Stars", abbrev: "STAR", owner: "Nick Moore", email: "nick@ctedynasty.local", div: "west", c1: "#4338ca", c2: "#facc15" },
  { name: "Ringing Ears", abbrev: "EARS", owner: "Matt Hughes", email: "matt@ctedynasty.local", div: "west", c1: "#334155", c2: "#22d3ee" },
];

const TARGET = { QB: 3, RB: 6, WR: 8, TE: 3, K: 1, DEF: 1 } as Record<string, number>;
const ROSTER_SIZE = Object.values(TARGET).reduce((a, b) => a + b, 0) + 3; // + 3 best available

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function main() {
  const t0 = Date.now();
  const nfl = await getNflState(true);
  const season = nfl.season;
  const currentWeek = nfl.week;
  const playerCount = await db.player.count();
  if (playerCount < 500) throw new Error("Sync players first: npm run sync:all");
  console.log(`Seeding CTE Dynasty for ${season}, current NFL week ${currentWeek}`);

  // wipe league data (keeps NFL players/stats)
  await db.league.deleteMany({});
  await db.user.deleteMany({});

  const rand = rng(20261124);
  const passwordHash = await bcrypt.hash(PASSWORD, 11);

  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.general.commissionerMessage =
    "Welcome to the CTE Dynasty! Trade deadline is Week 11. Rookie draft picks for the next three seasons are tradable. Keep your lineups full and your cap legal.";
  settings.general.leagueDues = 100;
  settings.general.payouts = [
    { place: "Champion", amount: 800 },
    { place: "Runner-up", amount: 250 },
    { place: "Most regular season points", amount: 150 },
  ];
  settings.niche.lastPlacePunishment = "Last place wears the CTE helmet of shame to the rookie draft and writes the season recap.";
  settings.niche.custom = [
    { id: "no-tank", title: "No tanking", description: "Managers must start a full, healthy lineup every week through Week 14.", enabled: true, since: 2024 },
    { id: "trade-back", title: "No trade-backs", description: "You can't trade a player back to the team you got him from in the same season.", enabled: true, since: 2025 },
  ];

  const league = await db.league.create({
    data: {
      slug: "cte-dynasty",
      name: "CTE Dynasty",
      season,
      phase: currentWeek >= settings.playoffs.startWeek ? "PLAYOFFS" : "REGULAR",
      settings: settings as never,
      inviteCode: "CTE-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
    },
  });
  const s = resolveSettings(league.settings);

  // users + teams
  const teams = [];
  for (const [i, t] of TEAMS.entries()) {
    const user = await db.user.create({
      data: {
        email: t.email,
        name: t.owner,
        passwordHash,
        isSiteAdmin: !!t.commish,
        profile: {
          create: {
            displayName: t.owner,
            bio: i === 0 ? "Founder and commissioner of the CTE Dynasty. Will veto your lopsided trades." : `Manager of ${t.name}.`,
            motto: ["Ball don't lie", "Trust the process", "Youth is a currency", "Win now, cry later", "Never pay for kickers"][i % 5],
            favoriteNflTeam: ["KC", "DET", "PHI", "BUF", "SF", "BAL", "CIN", "GB", "DAL", "MIA", "NYJ", "LAR"][i],
            managerStyle: ["Win-now", "Rebuilder", "Trade addict", "Balanced", "Analytics nerd"][i % 5],
            yearsPlaying: 3 + (i % 9),
          },
        },
        notificationPrefs: { create: {} },
      },
    });
    const team = await db.team.create({
      data: {
        leagueId: league.id,
        ownerId: user.id,
        name: t.name,
        abbrev: t.abbrev,
        division: t.div,
        primaryColor: t.c1,
        secondaryColor: t.c2,
        waiverPriority: i + 1,
        faabBalance: s.waivers.faabBudget,
      },
    });
    await db.leagueMember.create({ data: { leagueId: league.id, userId: user.id, role: t.commish ? "COMMISSIONER" : "MANAGER", teamId: team.id } });
    await db.faabLedger.create({ data: { leagueId: league.id, teamId: team.id, season, amount: s.waivers.faabBudget, reason: "SEASON_START" } });
    teams.push(team);
  }

  // ── Startup auction simulation: value every relevant player by season projection ──
  const candidates = await db.player.findMany({
    where: { active: true, position: { in: ["QB", "RB", "WR", "TE", "K", "DEF"] }, team: { not: null } },
  });
  const projRows = await db.playerWeekProjection.findMany({
    where: { season, seasonType: "REG", playerId: { in: candidates.map((c) => c.id) } },
    select: { playerId: true, stats: true },
  });
  const statRows = await db.playerWeekStat.findMany({
    where: { season, seasonType: "REG", playerId: { in: candidates.map((c) => c.id) } },
    select: { playerId: true, stats: true },
  });
  const pos = new Map(candidates.map((c) => [c.id, c.position]));
  const value = new Map<string, number>();
  for (const r of [...projRows, ...statRows]) value.set(r.playerId, (value.get(r.playerId) ?? 0) + calcPoints(r.stats as Record<string, number>, pos.get(r.playerId)!, s.scoring).points);
  // dynasty bump for youth
  for (const c of candidates) {
    const v = value.get(c.id) ?? 0;
    const age = c.age ?? 27;
    const youth = c.position === "QB" ? (age < 26 ? 1.15 : age > 33 ? 0.8 : 1) : age < 24 ? 1.2 : age > 29 ? 0.8 : 1;
    const qbBoost = c.position === "QB" ? 1.25 : 1; // superflex
    const kd = c.position === "K" || c.position === "DEF" ? 0.35 : 1;
    value.set(c.id, v * youth * qbBoost * kd);
  }
  const pool = candidates.filter((c) => (value.get(c.id) ?? 0) > 0).sort((a, b) => (value.get(b.id) ?? 0) - (value.get(a.id) ?? 0));

  const rosters = new Map<string, typeof pool>(teams.map((t) => [t.id, []]));
  const counts = new Map<string, Record<string, number>>(teams.map((t) => [t.id, {}]));
  const taken = new Set<string>();
  const rounds = ROSTER_SIZE;
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 === 0 ? teams : [...teams].reverse();
    for (const team of order) {
      const c = counts.get(team.id)!;
      const needAny = r >= rounds - 3;
      const pick = pool.find((p) => {
        if (taken.has(p.id)) return false;
        const cur = c[p.position] ?? 0;
        if (needAny) return p.position !== "K" && p.position !== "DEF" ? cur < TARGET[p.position] + 2 : false;
        return cur < TARGET[p.position];
      });
      if (!pick) continue;
      taken.add(pick.id);
      c[pick.position] = (c[pick.position] ?? 0) + 1;
      rosters.get(team.id)!.push(pick);
    }
  }
  // salaries: share of total league budget by value^1.35
  const allRostered = [...rosters.values()].flat();
  const budget = teams.length * s.salaryCap.cap * 0.9;
  const replacement = value.get(allRostered[allRostered.length - 1]?.id ?? "") ?? 0;
  const weights = new Map(allRostered.map((p) => [p.id, Math.pow(Math.max(0, (value.get(p.id) ?? 0) - replacement * 0.9), 1.35)]));
  const wSum = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const spendable = budget - allRostered.length * s.salaryCap.minSalary;
  const salaryOf = (id: string) => Math.max(s.salaryCap.minSalary, Math.round(s.salaryCap.minSalary + (spendable * (weights.get(id) ?? 0)) / wSum));

  for (const team of teams) {
    const list = rosters.get(team.id)!;
    let total = 0;
    const entries = list.map((p) => {
      const salary = salaryOf(p.id);
      total += salary;
      return { p, salary };
    });
    // keep under the cap
    while (total > s.salaryCap.cap - 5) {
      const top = entries.reduce((a, b) => (b.salary > a.salary ? b : a));
      top.salary -= 1;
      total -= 1;
    }
    for (const { p, salary } of entries) {
      const rookie = (p.yearsExp ?? 1) === 0;
      const years = rookie ? s.contracts.rookieContractYears : 1 + Math.floor(rand() * 4);
      await db.rosterSpot.create({
        data: {
          leagueId: league.id,
          teamId: team.id,
          playerId: p.id,
          salary: rookie ? Math.max(1, Math.min(salary, 10)) : salary,
          contractYears: years,
          contractStart: season,
          isRookieContract: rookie,
          acquiredVia: rookie ? "ROOKIE_DRAFT" : "AUCTION",
          acquiredAt: new Date(Date.UTC(season, 7, 20)),
        },
      });
      await db.transaction.create({
        data: {
          leagueId: league.id,
          season,
          week: 0,
          type: rookie ? "ROOKIE_DRAFT" : "AUCTION",
          teamId: team.id,
          playerId: p.id,
          salary,
          description: rookie ? `Drafted ${p.fullName} (${p.position} ${p.team}) — rookie contract` : `Won ${p.fullName} (${p.position} ${p.team}) at auction for $${salary}`,
          createdAt: new Date(Date.UTC(season, 7, 20, 20, Math.floor(rand() * 59))),
        },
      });
    }
  }
  console.log(`rosters: ${allRostered.length} players`);

  // completed startup auction record
  await db.draft.create({
    data: { leagueId: league.id, season, type: "AUCTION", status: "COMPLETE", name: `${season} Salary Auction`, completedAt: new Date(Date.UTC(season, 7, 20, 23)), settings: s.draft.auction as never },
  });

  // ── Draft picks (3 future years x 2 rounds), plus a few traded picks ──
  await ensureDraftPicks(league.id, season + 1, s);
  const picks = await db.draftPick.findMany({ where: { leagueId: league.id }, orderBy: [{ season: "asc" }, { round: "asc" }] });

  // ── Schedule + lineups + results ──
  await generateSchedule(league.id, season, s);
  for (let w = 1; w <= Math.min(currentWeek, 18); w++) {
    for (const team of teams) await autoFillLineup(team.id, league.id, season, w, s);
    await refreshWeekMatchups(league.id, season, w, s);
  }
  console.log(`lineups + matchups through week ${currentWeek}`);

  // ── Sample completed trades (players + picks) ──
  const pickFor = (teamId: string, yr: number, round: number) => picks.find((p) => p.originalTeamId === teamId && p.season === yr && p.round === round)!;
  const tradeDefs = [
    { a: 0, b: 3, week: 4, msg: "Win-now move for the Protocol" },
    { a: 5, b: 9, week: 7, msg: "Rebuild mode activated" },
    { a: 2, b: 7, week: 9, msg: "" },
  ];
  for (const def of tradeDefs) {
    const A = teams[def.a], B = teams[def.b];
    const aSpots = await db.rosterSpot.findMany({ where: { teamId: A.id }, include: { player: true }, orderBy: { salary: "asc" } });
    const bSpots = await db.rosterSpot.findMany({ where: { teamId: B.id }, include: { player: true }, orderBy: { salary: "desc" } });
    const aGive = aSpots.find((x) => x.player.position === "WR" && x.salary >= 8) ?? aSpots[aSpots.length - 1];
    const capRoom = (sp: typeof aSpots) => s.salaryCap.cap - sp.reduce((a, x) => a + x.salary, 0);
    // keep both teams cap-legal after the swap
    const bGive =
      bSpots.find((x) => x.player.position === "RB" && x.salary - aGive.salary <= capRoom(aSpots) && aGive.salary - x.salary <= capRoom(bSpots)) ??
      bSpots.find((x) => x.salary - aGive.salary <= capRoom(aSpots) && aGive.salary - x.salary <= capRoom(bSpots)) ??
      bSpots[bSpots.length - 1];
    const pick = pickFor(A.id, season + 1, 2);
    const when = new Date(Date.UTC(season, 8, 10 + def.week * 7, 18));
    const trade = await db.trade.create({
      data: {
        leagueId: league.id,
        season,
        week: def.week,
        proposerTeamId: A.id,
        status: "COMPLETED",
        message: def.msg || null,
        acceptedAt: when,
        completedAt: when,
        createdAt: when,
        teams: { create: [{ teamId: A.id, accepted: true, respondedAt: when }, { teamId: B.id, accepted: true, respondedAt: when }] },
        assets: {
          create: [
            { type: "PLAYER", fromTeamId: A.id, toTeamId: B.id, playerId: aGive.playerId, salary: aGive.salary, contractYears: aGive.contractYears, label: aGive.player.fullName },
            { type: "PICK", fromTeamId: A.id, toTeamId: B.id, pickId: pick.id, label: `${pick.season} Round ${pick.round} (${A.name})` },
            { type: "PLAYER", fromTeamId: B.id, toTeamId: A.id, playerId: bGive.playerId, salary: bGive.salary, contractYears: bGive.contractYears, label: bGive.player.fullName },
            ...(def.a === 0 ? [{ type: "FAAB", fromTeamId: A.id, toTeamId: B.id, faabAmount: 10, label: "$10 FAB" }] : []),
          ],
        },
      },
    });
    await db.rosterSpot.update({ where: { id: aGive.id }, data: { teamId: B.id, acquiredVia: "TRADE", acquiredAt: when } });
    await db.rosterSpot.update({ where: { id: bGive.id }, data: { teamId: A.id, acquiredVia: "TRADE", acquiredAt: when } });
    await db.draftPick.update({ where: { id: pick.id }, data: { ownerTeamId: B.id } });
    if (def.a === 0) {
      await db.faabLedger.createMany({
        data: [
          { leagueId: league.id, teamId: A.id, season, amount: -10, reason: "TRADE", refType: "trade", refId: trade.id },
          { leagueId: league.id, teamId: B.id, season, amount: 10, reason: "TRADE", refType: "trade", refId: trade.id },
        ],
      });
      await db.team.update({ where: { id: A.id }, data: { faabBalance: { decrement: 10 } } });
      await db.team.update({ where: { id: B.id }, data: { faabBalance: { increment: 10 } } });
    }
    for (const [t, other, got] of [[A, B, bGive], [B, A, aGive]] as const) {
      await db.transaction.create({
        data: { leagueId: league.id, season, week: def.week, type: "TRADE", teamId: t.id, relatedTeamId: other.id, playerId: got.playerId, tradeId: trade.id, description: `Traded with ${other.name}: received ${got.player.fullName}`, createdAt: when },
      });
    }
  }

  // ── Some FAB waiver pickups ──
  const fas = await db.player.findMany({ where: { active: true, position: { in: ["RB", "WR", "TE"] }, team: { not: null }, rosterSpots: { none: {} } }, orderBy: { searchRank: "asc" }, take: 8 });
  for (const [i, p] of fas.slice(0, 6).entries()) {
    const team = teams[(i * 5) % teams.length];
    const bid = [17, 4, 9, 1, 22, 6][i];
    const wk = 2 + i;
    const when = new Date(Date.UTC(season, 8, 10 + wk * 7, 8));
    const drop = await db.rosterSpot.findFirst({ where: { teamId: team.id, player: { position: p.position } }, orderBy: { salary: "asc" }, include: { player: true } });
    if (drop) {
      await db.rosterSpot.delete({ where: { id: drop.id } });
      await db.lineupSlot.updateMany({ where: { teamId: team.id, playerId: drop.playerId, week: { gte: wk } }, data: { playerId: null } });
      await db.transaction.create({ data: { leagueId: league.id, season, week: wk, type: "DROP", teamId: team.id, playerId: drop.playerId, description: `Dropped ${drop.player.fullName}`, createdAt: when } });
    }
    await db.rosterSpot.create({ data: { leagueId: league.id, teamId: team.id, playerId: p.id, salary: Math.max(1, Math.round(bid / 4)), contractYears: 1, contractStart: season, acquiredVia: "WAIVER", acquiredAt: when } });
    await db.waiverClaim.create({ data: { leagueId: league.id, teamId: team.id, season, week: wk, addPlayerId: p.id, dropPlayerId: drop?.playerId, bidAmount: bid, status: "WON", processedAt: when, createdAt: when } });
    await db.transaction.create({ data: { leagueId: league.id, season, week: wk, type: "WAIVER", teamId: team.id, playerId: p.id, faabAmount: bid, salary: Math.max(1, Math.round(bid / 4)), description: `Claimed ${p.fullName} (${p.position} ${p.team}) for $${bid} FAB`, createdAt: when } });
    await db.faabLedger.create({ data: { leagueId: league.id, teamId: team.id, season, amount: -bid, reason: "WAIVER", createdAt: when } });
    await db.team.update({ where: { id: team.id }, data: { faabBalance: { decrement: bid } } });
  }
  // re-fill current week lineups after roster moves
  for (const team of teams) {
    await db.lineupSlot.deleteMany({ where: { teamId: team.id, season, week: { gte: currentWeek } } });
    await autoFillLineup(team.id, league.id, season, currentWeek, s);
  }
  await refreshWeekMatchups(league.id, season, currentWeek, s);
  if (currentWeek < 18) await refreshWeekMatchups(league.id, season, currentWeek + 1, s);

  // ── Chat, announcements, rule proposals ──
  await ensureDefaultChannels(league.id);
  const general = await db.chatChannel.findUniqueOrThrow({ where: { leagueId_slug: { leagueId: league.id, slug: "general" } } });
  const users = await db.user.findMany();
  const lines = [
    "Who's ready for another week of pain",
    "My kicker outscored my WR2 again. Love this game.",
    "Trade block is open for business, DM me",
    "That last-minute TD was a crime against my matchup",
    "Commish when are we doing the rookie draft lottery?",
    "Projected to lose by 0.4. Pray for me.",
  ];
  for (const [i, line] of lines.entries()) {
    await db.chatMessage.create({ data: { channelId: general.id, userId: users[(i * 3) % users.length].id, body: line, createdAt: new Date(Date.now() - (lines.length - i) * 3600_000) } });
  }
  await postSystemMessage(league.id, "Season is underway — good luck everyone!", { channel: "general" });
  await db.leagueAnnouncement.create({
    data: { leagueId: league.id, authorId: users[0].id, title: "Trade deadline reminder", body: `The trade deadline is the end of Week ${s.trades.deadlineWeek}. Rookie picks for ${season + 1}–${season + 3} can be traded.`, pinned: true },
  });
  const proposals = [
    { title: "Add a TE premium bump to 1.75 PPR", body: "TEs are still undervalued in superflex. Bump TE receptions to 1.75.", category: "SCORING" },
    { title: "Expand taxi squad to 5", body: "More room to stash rookies. Taxi players still don't count against the cap.", category: "ROSTER" },
    { title: "Toilet bowl loser buys the draft-day wings", body: "Self explanatory.", category: "FUN" },
  ];
  for (const [i, p] of proposals.entries()) {
    const rp = await db.ruleProposal.create({ data: { leagueId: league.id, authorId: users[i + 1].id, title: p.title, body: p.body, category: p.category, status: i === 0 ? "VOTING" : "OPEN", votingEndsAt: i === 0 ? new Date(Date.now() + 5 * 864e5) : null } });
    for (const [j, u] of users.entries()) if ((i + j) % 3 !== 0) await db.ruleProposalVote.create({ data: { proposalId: rp.id, userId: u.id, value: (i + j) % 4 === 0 ? -1 : 1 } });
  }

  // ── Invites: one open invite per team for real managers to claim ──
  for (const team of teams.slice(1)) {
    await db.invite.create({ data: { leagueId: league.id, code: crypto.randomBytes(4).toString("hex").toUpperCase(), teamId: team.id, createdById: users[0].id } });
  }

  console.log(`\n✅ Seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`   League invite code: ${league.inviteCode}`);
  console.log(`   Commissioner login: ${TEAMS[0].email} / ${PASSWORD}`);
  console.log(`   Other demo managers: <name>@ctedynasty.local / ${PASSWORD}`);
  void normalizePosition;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
