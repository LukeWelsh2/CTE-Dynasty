// Implementation of the "sync-news" job (entry point: src/lib/sync/news.ts).
// ESPN news + injury reports → NewsItem / NewsPlayer / InjuryReport, with injury alerts for rostered players.
//
// Sources (no API keys):
//   - site.api.espn.com/.../nfl/news            league-wide headlines (athlete + team categories)
//   - site.api.espn.com/.../nfl/injuries        current injury report for all 32 teams (+ latest player note)
//   - site.api.espn.com/apis/fantasy/.../news/players?playerId=<espnId>   per-player fantasy notes & analysis
//
// Only news / injury tables (plus small sync cursors in KeyValue) are written; Player rows are owned by the
// Sleeper sync. Each source is fetched independently so one failing feed does not stop the others.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchJson } from "@/lib/sync/http";
import { NFL_TEAM_BY_ABBR, fromEspnAbbr } from "@/lib/nfl/teams";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { resolveSettings } from "@/lib/settings/schema";
import { notify } from "@/lib/notify";
import { latestInjuryReports } from "@/lib/players/injury-data";
import { espnIdFromUrl, injurySeverity, isInjuryText, nameKey, normalizeInjuryStatus, textKey } from "@/lib/players/logic";

const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";
const INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";
const FANTASY_NEWS_URL = (espnId: string) => `https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=10&playerId=${espnId}`;
const TEAM_ROSTER_URL = (teamId: string) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
/** ESPN franchise ids (1-30, 33 BAL, 34 HOU) */
const ESPN_TEAM_IDS = [...Array.from({ length: 30 }, (_, i) => String(i + 1)), "33", "34"];

const ROSTER_INDEX_KEY = "espn_roster_index";
const ROSTER_INDEX_TTL_MS = 24 * 3600_000;
const FANTASY_CURSOR_KEY = "news_fantasy_cursor";
const FANTASY_REFRESH_MS = 50 * 60_000;
const ALERT_MAX_AGE_MS = 48 * 3600_000;

// ───────────────────────────── ESPN payload types ─────────────────────────────

type EspnCategory = {
  type: string;
  description?: string;
  athleteId?: number;
  teamId?: number;
  team?: { abbreviation?: string };
  athlete?: { links?: { web?: { athletes?: { href?: string } } } };
};
type EspnArticle = {
  id: number;
  type?: string;
  headline: string;
  description?: string;
  published: string;
  images?: { url?: string; type?: string }[];
  categories?: EspnCategory[];
  links?: { web?: { href?: string } };
};
type EspnInjury = {
  id: string;
  status: string;
  date?: string;
  shortComment?: string;
  longComment?: string;
  type?: { abbreviation?: string; description?: string };
  details?: { type?: string; location?: string; detail?: string; side?: string; returnDate?: string };
  athlete: {
    displayName: string;
    links?: { href: string; rel?: string[] }[];
    position?: { abbreviation?: string };
    team?: { abbreviation?: string };
  };
};
type EspnInjuries = { injuries?: { id: string; displayName?: string; injuries?: EspnInjury[] }[] };
type EspnFantasyNews = {
  feed?: {
    id: number;
    type?: string;
    headline: string;
    description?: string;
    story?: string;
    published: string;
    images?: { url?: string }[];
    links?: { web?: { href?: string }; mobile?: { href?: string } };
  }[];
};
type EspnRoster = {
  team?: { abbreviation?: string };
  athletes?: { items?: { id: string; fullName?: string; displayName?: string; position?: { abbreviation?: string } }[] }[];
};

// ───────────────────────────── Helpers ─────────────────────────────

function hash(s: string) {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&lt;": "<", "&gt;": ">" };
/** A summary that adds something: no leading dash, not a copy of the headline */
function distinctSummary(summary: string | null, headline: string): string | null {
  const s = summary?.replace(/^[\s—–-]+/, "").trim();
  if (!s) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(s) === norm(headline) ? null : s;
}

function cleanText(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .replace(/ -- /g, " — ")
    .trim();
  return t || null;
}

/** Drop placeholder comments such as "out" that only repeat the status */
function meaningful(s: string | null, status: string): string | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/[^a-z]/g, "");
  if (t.length < 8 || t === status.toLowerCase().replace(/[^a-z]/g, "")) return null;
  return s;
}

function espnImage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname === "a.espncdn.com" ? url : null;
  } catch {
    return null;
  }
}

function nflTeam(abbr: string | null | undefined): string | null {
  if (!abbr) return null;
  const a = fromEspnAbbr(abbr.toUpperCase());
  return NFL_TEAM_BY_ABBR[a] ? a : null;
}

function bodyPartOf(d: EspnInjury["details"]): string | null {
  if (!d?.type || d.type === "Not Specified") return null;
  const detail = d.detail && d.detail !== "Not Specified" && d.detail.toLowerCase() !== d.type.toLowerCase() ? d.detail.toLowerCase() : null;
  return detail ? `${d.type} (${detail})` : d.type;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function readKv<T>(key: string): Promise<T | null> {
  const row = await db.keyValue.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

async function writeKv(key: string, value: unknown) {
  const v = value as Prisma.InputJsonValue;
  await db.keyValue.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ───────────────────────────── Player resolution ─────────────────────────────

interface PlayerLite {
  id: string;
  espnId: string | null;
  fullName: string;
  position: string;
  team: string | null;
  active: boolean;
  injuryStatus: string | null;
}

class PlayerResolver {
  private byEspn = new Map<string, PlayerLite>();
  private byNameTeam = new Map<string, PlayerLite[]>();
  private byName = new Map<string, PlayerLite[]>();
  readonly byId = new Map<string, PlayerLite>();
  /** espn ids learned during this run (players whose Sleeper record has no espn id) */
  readonly learnedEspn = new Map<string, string>(); // playerId -> espnId

  constructor(players: PlayerLite[]) {
    for (const p of players) {
      this.byId.set(p.id, p);
      if (p.espnId) this.byEspn.set(p.espnId, p);
      if (p.position === "DEF") continue;
      const k = nameKey(p.fullName);
      if (!k) continue;
      if (p.team) push(this.byNameTeam, `${k}|${p.team}`, p);
      push(this.byName, k, p);
    }
  }

  resolve(a: { espnId?: string | null; name?: string | null; teams?: (string | null)[]; position?: string | null }): PlayerLite | null {
    if (a.espnId) {
      const p = this.byEspn.get(a.espnId);
      if (p) return p;
    }
    if (!a.name) return null;
    const key = nameKey(a.name);
    const pos = a.position ? normalizePosition(a.position) : null;
    const compat = (p: PlayerLite) => !pos || normalizePosition(p.position) === pos;
    for (const t of a.teams ?? []) {
      if (!t) continue;
      const c = this.byNameTeam.get(`${key}|${t}`) ?? [];
      if (c.length === 1) return this.learn(a.espnId, c[0]!);
      const f = c.filter(compat);
      if (f.length === 1) return this.learn(a.espnId, f[0]!);
    }
    const all = (this.byName.get(key) ?? []).filter((p) => p.active);
    const f = pos ? all.filter(compat) : all;
    if (f.length === 1) return this.learn(a.espnId, f[0]!);
    return null;
  }

  espnIdFor(playerId: string): string | null {
    return this.byId.get(playerId)?.espnId ?? this.learnedEspn.get(playerId) ?? null;
  }

  private learn(espnId: string | null | undefined, p: PlayerLite): PlayerLite {
    if (espnId && !p.espnId) {
      this.learnedEspn.set(p.id, espnId);
      this.byEspn.set(espnId, p);
    }
    return p;
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

// ───────────────────────────── News upsert ─────────────────────────────

interface NewsInput {
  externalId: string;
  source: string;
  headline: string;
  summary?: string | null;
  analysis?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  team?: string | null;
  category: string;
  publishedAt: Date;
  playerIds: string[];
}

/** Upsert news items + player links. Returns the number of newly created items. */
async function upsertNews(input: NewsInput[]): Promise<number> {
  // collapse duplicates within the batch (same blurb from two feeds): keep the richest version
  const byExt = new Map<string, NewsInput>();
  for (const n of input) {
    const prev = byExt.get(n.externalId);
    if (!prev) byExt.set(n.externalId, n);
    else
      byExt.set(n.externalId, {
        ...prev,
        ...n,
        analysis: n.analysis ?? prev.analysis,
        summary: n.summary ?? prev.summary,
        imageUrl: n.imageUrl ?? prev.imageUrl,
        category: prev.category === "INJURY" || n.category === "INJURY" ? "INJURY" : n.category,
        playerIds: [...new Set([...prev.playerIds, ...n.playerIds])],
      });
  }
  const items = [...byExt.values()];
  if (!items.length) return 0;
  const existing = await db.newsItem.findMany({
    where: { externalId: { in: items.map((i) => i.externalId) } },
    select: { id: true, externalId: true, headline: true, summary: true, analysis: true, imageUrl: true, category: true, source: true, url: true },
  });
  const exMap = new Map(existing.map((e) => [e.externalId, e]));
  const fresh = items.filter((i) => !exMap.has(i.externalId));
  const created = fresh.length
    ? await db.newsItem.createManyAndReturn({
        data: fresh.map((n) => ({
          source: n.source,
          externalId: n.externalId,
          headline: n.headline.slice(0, 500),
          summary: n.summary ?? null,
          analysis: n.analysis ?? null,
          url: n.url ?? null,
          imageUrl: n.imageUrl ?? null,
          team: n.team ?? null,
          category: n.category,
          publishedAt: n.publishedAt,
        })),
        skipDuplicates: true,
        select: { id: true, externalId: true },
      })
    : [];
  const idByExt = new Map<string, string>([...existing.map((e) => [e.externalId, e.id] as const), ...created.map((c) => [c.externalId, c.id] as const)]);

  for (const n of items) {
    const e = exMap.get(n.externalId);
    if (!e) continue;
    const next = {
      headline: n.headline.slice(0, 500),
      summary: n.summary ?? e.summary,
      analysis: n.analysis ?? e.analysis,
      imageUrl: n.imageUrl ?? e.imageUrl,
      url: n.url ?? e.url,
      category: e.category === "INJURY" || n.category === "INJURY" ? "INJURY" : n.category,
      source: n.source === "ROTOWIRE" ? "ROTOWIRE" : e.source,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== e[k]);
    if (changed) await db.newsItem.update({ where: { id: e.id }, data: next });
  }

  const links = items.flatMap((n) => {
    const newsId = idByExt.get(n.externalId);
    return newsId ? n.playerIds.map((playerId) => ({ newsId, playerId })) : [];
  });
  if (links.length) await db.newsPlayer.createMany({ data: links, skipDuplicates: true });
  return created.length;
}

// ───────────────────────────── 1. Headline news ─────────────────────────────

async function syncHeadlineNews(resolver: PlayerResolver): Promise<number> {
  const res = await fetchJson<{ articles?: EspnArticle[] }>(NEWS_URL, { timeoutMs: 20_000 });
  const items: NewsInput[] = [];
  for (const a of res.articles ?? []) {
    if (!a?.id || !a.headline) continue;
    const cats = a.categories ?? [];
    const teams = cats.filter((c) => c.type === "team").map((c) => nflTeam(c.team?.abbreviation)).filter((t): t is string => !!t);
    const playerIds = new Set<string>();
    for (const c of cats) {
      if (c.type !== "athlete") continue;
      const espnId = c.athleteId ? String(c.athleteId) : espnIdFromUrl(c.athlete?.links?.web?.athletes?.href);
      const p = resolver.resolve({ espnId, name: c.description, teams });
      if (p) playerIds.add(p.id);
    }
    // team defense / special teams pieces link to the DEF "player"
    if (/\bD\/ST\b|\bDST\b/i.test(a.headline)) for (const t of teams) if (resolver.byId.has(t)) playerIds.add(t);
    const topicInjury = cats.some((c) => c.type === "topic" && /injur/i.test(c.description ?? ""));
    const published = parseDate(a.published) ?? new Date();
    const img = a.images?.find((i) => i.type === "header") ?? a.images?.[0];
    items.push({
      externalId: `espn:${a.id}`,
      source: "ESPN",
      headline: cleanText(a.headline) ?? a.headline,
      summary: distinctSummary(cleanText(a.description), a.headline),
      url: a.links?.web?.href ?? null,
      imageUrl: espnImage(img?.url),
      team: teams[0] ?? null,
      category: topicInjury || isInjuryText(a.headline) || isInjuryText(a.description) ? "INJURY" : "NEWS",
      publishedAt: published,
      playerIds: [...playerIds],
    });
  }
  return upsertNews(items);
}

// ───────────────────────────── 2. Injury report ─────────────────────────────

interface InjuryRow {
  externalId: string;
  playerId: string;
  status: string;
  bodyPart: string | null;
  shortComment: string | null;
  longComment: string | null;
  returnDate: Date | null;
  reportedAt: Date;
}

async function syncInjuries(resolver: PlayerResolver): Promise<{ created: number; notes: number; alerts: number }> {
  const res = await fetchJson<EspnInjuries>(INJURIES_URL, { timeoutMs: 60_000 });
  const now = new Date();
  const rows: InjuryRow[] = [];
  const notes: NewsInput[] = [];
  const teamsInResponse = new Set<string>();
  let entries = 0;
  for (const block of res.injuries ?? []) {
    for (const i of block.injuries ?? []) {
      entries++;
      const team = nflTeam(i.athlete?.team?.abbreviation);
      if (team) teamsInResponse.add(team);
      const card = i.athlete?.links?.find((l) => l.href.includes("/player/_/id/")) ?? i.athlete?.links?.[0];
      const espnId = espnIdFromUrl(card?.href);
      const p = resolver.resolve({ espnId, name: i.athlete?.displayName, teams: [team], position: i.athlete?.position?.abbreviation });
      if (!p || !i.id) continue;
      const status = normalizeInjuryStatus(i.type?.abbreviation === "IR" ? "IR" : i.status);
      const reportedAt = parseDate(i.date) ?? now;
      const shortComment = meaningful(cleanText(i.shortComment), i.status);
      const longComment = meaningful(cleanText(i.longComment), i.status);
      rows.push({
        externalId: `espn-inj:${i.id}`,
        playerId: p.id,
        status,
        bodyPart: bodyPartOf(i.details),
        shortComment,
        longComment: longComment && longComment !== shortComment ? longComment : null,
        returnDate: parseDate(i.details?.returnDate),
        reportedAt,
      });
      // The injury feed carries each player's latest note; keep meaningful ones as player news
      if (shortComment && shortComment.length >= 30 && espnId) {
        notes.push({
          externalId: `espn-note:${espnId}:${hash(textKey(shortComment))}`,
          source: "ESPN",
          headline: shortComment,
          analysis: longComment && longComment !== shortComment ? longComment : null,
          url: `https://www.espn.com/nfl/player/_/id/${espnId}`,
          team: team ?? p.team,
          category: status !== "Active" || isInjuryText(shortComment) ? "INJURY" : "NEWS",
          publishedAt: reportedAt,
          playerIds: [p.id],
        });
      }
    }
  }

  const hadReports = (await db.injuryReport.count({ where: { source: "ESPN" } })) > 0;
  const existing = rows.length
    ? await db.injuryReport.findMany({
        where: { externalId: { in: rows.map((r) => r.externalId) } },
        select: { id: true, externalId: true, status: true, bodyPart: true, shortComment: true, longComment: true, returnDate: true },
      })
    : [];
  const exMap = new Map(existing.map((e) => [e.externalId!, e]));
  const currentPlayers = new Set(rows.map((r) => r.playerId));
  const prevLatest = await latestInjuryReports([...currentPlayers]);

  // status transitions to alert on: { playerId, from, to, row }
  const transitions: { row: InjuryRow; from: string }[] = [];
  const fresh: InjuryRow[] = [];
  for (const r of rows) {
    const e = exMap.get(r.externalId);
    if (!e) {
      fresh.push(r);
      const prev = prevLatest.get(r.playerId);
      const from = prev ? prev.status : normalizeInjuryStatus(resolver.byId.get(r.playerId)?.injuryStatus);
      transitions.push({ row: r, from });
      continue;
    }
    const changed =
      e.status !== r.status ||
      e.bodyPart !== r.bodyPart ||
      e.shortComment !== r.shortComment ||
      e.longComment !== r.longComment ||
      (e.returnDate?.getTime() ?? null) !== (r.returnDate?.getTime() ?? null);
    if (changed) {
      await db.injuryReport.update({
        where: { id: e.id },
        data: { status: r.status, bodyPart: r.bodyPart, shortComment: r.shortComment, longComment: r.longComment, returnDate: r.returnDate },
      });
      if (e.status !== r.status) transitions.push({ row: r, from: e.status });
    }
  }
  // the same ESPN entry can appear once per player only; guard against duplicate ids in one payload
  const seen = new Set<string>();
  const createData = fresh.filter((r) => (seen.has(r.externalId) ? false : (seen.add(r.externalId), true)));
  if (createData.length) await db.injuryReport.createMany({ data: createData.map((r) => ({ ...r, source: "ESPN" })), skipDuplicates: true });

  // Players who dropped off a complete ESPN report are healthy again: record that in the timeline.
  // A player who reappears after a spurious clear gets the clear entry removed.
  const complete = teamsInResponse.size >= 28 && entries >= 200;
  if (complete) {
    const allLatest = await latestInjuryReports();
    const spurious = [...allLatest.values()].filter((l) => currentPlayers.has(l.playerId) && l.externalId?.startsWith("espn-inj-clear:"));
    for (const s of spurious) await db.injuryReport.delete({ where: { id: s.id } }).catch(() => {});
    const clears = [...allLatest.values()].filter((l) => {
      if (currentPlayers.has(l.playerId) || l.source !== "ESPN" || l.status === "Active") return false;
      const team = resolver.byId.get(l.playerId)?.team ?? null;
      return !team || teamsInResponse.has(team);
    });
    if (clears.length)
      await db.injuryReport.createMany({
        data: clears.map((l) => ({
          playerId: l.playerId,
          externalId: `espn-inj-clear:${l.playerId}:${l.externalId ?? l.id}`,
          status: "Active",
          shortComment: "Removed from the injury report.",
          source: "ESPN",
          reportedAt: now,
        })),
        skipDuplicates: true,
      });
  }

  const notesCreated = await upsertNews(notes);
  const alerts = hadReports ? await sendInjuryAlerts(transitions, resolver, now) : 0;
  return { created: createData.length, notes: notesCreated, alerts };
}

async function sendInjuryAlerts(transitions: { row: InjuryRow; from: string }[], resolver: PlayerResolver, now: Date): Promise<number> {
  const worse = transitions.filter(
    (t) => injurySeverity(t.row.status) > injurySeverity(t.from) && injurySeverity(t.row.status) >= 1 && now.getTime() - t.row.reportedAt.getTime() <= ALERT_MAX_AGE_MS,
  );
  if (!worse.length) return 0;
  const spots = await db.rosterSpot.findMany({
    where: { playerId: { in: worse.map((w) => w.row.playerId) } },
    select: {
      playerId: true,
      leagueId: true,
      team: { select: { ownerId: true, member: { select: { userId: true } } } },
      league: { select: { settings: true } },
    },
  });
  const settingsCache = new Map<string, boolean>();
  // Each report + status notifies a manager once, even if two sync runs overlap or a run is retried
  const allUsers = [...new Set(spots.flatMap((s) => [s.team.ownerId, s.team.member?.userId]).filter((x): x is string => !!x))];
  const already = new Set<string>();
  if (allUsers.length) {
    const prior = await db.notification.findMany({
      where: { type: "INJURY", userId: { in: allUsers }, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      select: { userId: true, leagueId: true, data: true },
    });
    for (const n of prior) {
      const d = (n.data ?? {}) as { report?: string; status?: string };
      if (d.report && d.status) already.add(`${n.userId}|${n.leagueId}|${d.report}|${d.status}`);
    }
  }
  let sent = 0;
  for (const t of worse) {
    const p = resolver.byId.get(t.row.playerId);
    if (!p) continue;
    const label = t.row.status === "IR" ? "on injured reserve" : t.row.status === "PUP" ? "on the PUP list" : t.row.status === "Sus" ? "suspended" : t.row.status.toLowerCase();
    const body = [t.row.bodyPart, t.row.shortComment].filter(Boolean).join(" — ").slice(0, 240) || `${p.fullName} has been listed as ${t.row.status}.`;
    for (const s of spots.filter((x) => x.playerId === t.row.playerId)) {
      if (!settingsCache.has(s.leagueId)) settingsCache.set(s.leagueId, resolveSettings(s.league.settings).notifications.injuryAlerts);
      if (!settingsCache.get(s.leagueId)) continue;
      const userIds = [...new Set([s.team.ownerId, s.team.member?.userId].filter((x): x is string => !!x))].filter(
        (u) => !already.has(`${u}|${s.leagueId}|${t.row.externalId}|${t.row.status}`),
      );
      if (!userIds.length) continue;
      for (const u of userIds) already.add(`${u}|${s.leagueId}|${t.row.externalId}|${t.row.status}`);
      try {
        await notify({
          userIds,
          leagueId: s.leagueId,
          type: "INJURY",
          title: `${p.fullName} (${p.position}${p.team ? ` · ${p.team}` : ""}) is ${label}`,
          body,
          url: `/players/${p.id}`,
          data: { playerId: p.id, status: t.row.status, previousStatus: t.from, report: t.row.externalId },
        });
        sent++;
      } catch (e) {
        console.warn(`[sync-news] injury alert for ${p.fullName} failed: ${(e as Error).message}`);
      }
    }
  }
  return sent;
}

// ───────────────────────────── 3. Fantasy notes for rostered players ─────────────────────────────

type RosterIndex = { fetchedAt: string; athletes: [string, string, string, string][] }; // [espnId, name, team, pos]

async function espnRosterIndex(): Promise<RosterIndex["athletes"]> {
  const cached = await readKv<RosterIndex>(ROSTER_INDEX_KEY);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < ROSTER_INDEX_TTL_MS) return cached.athletes;
  const athletes: RosterIndex["athletes"] = [];
  let ok = 0;
  await pool(ESPN_TEAM_IDS, 4, async (id) => {
    try {
      const r = await fetchJson<EspnRoster>(TEAM_ROSTER_URL(id), { timeoutMs: 15_000, retries: 1 });
      const team = nflTeam(r.team?.abbreviation);
      if (!team) return;
      ok++;
      for (const g of r.athletes ?? []) for (const a of g.items ?? []) if (a.id && (a.fullName || a.displayName)) athletes.push([a.id, a.fullName ?? a.displayName!, team, a.position?.abbreviation ?? ""]);
    } catch {
      /* skip team */
    }
  });
  if (ok >= 28) await writeKv(ROSTER_INDEX_KEY, { fetchedAt: new Date().toISOString(), athletes });
  return athletes.length ? athletes : (cached?.athletes ?? []);
}

async function syncFantasyNews(resolver: PlayerResolver, batch?: number): Promise<number> {
  const rostered = await db.rosterSpot.findMany({ distinct: ["playerId"], select: { playerId: true } });
  const ids = rostered.map((r) => r.playerId).filter((id) => resolver.byId.get(id)?.position !== "DEF");
  if (!ids.length) return 0;
  if (ids.some((id) => !resolver.espnIdFor(id))) {
    for (const [espnId, name, team, pos] of await espnRosterIndex()) resolver.resolve({ espnId, name, teams: [team], position: pos });
  }
  const cursor = (await readKv<Record<string, number>>(FANTASY_CURSOR_KEY)) ?? {};
  const now = Date.now();
  const limit = batch ?? (Object.keys(cursor).length ? 100 : 400);
  const due = ids
    .map((id) => ({ id, espnId: resolver.espnIdFor(id), last: cursor[id] ?? 0 }))
    .filter((x): x is { id: string; espnId: string; last: number } => !!x.espnId && now - x.last > FANTASY_REFRESH_MS)
    .sort((a, b) => a.last - b.last)
    .slice(0, limit);
  if (!due.length) return 0;

  const items: NewsInput[] = [];
  let failures = 0;
  let successes = 0;
  await pool(due, 6, async ({ id, espnId }) => {
    if (failures >= 6 && successes === 0) return; // endpoint unavailable: stop early
    let res: EspnFantasyNews;
    try {
      res = await fetchJson<EspnFantasyNews>(FANTASY_NEWS_URL(espnId), { timeoutMs: 8_000, retries: 0 });
    } catch {
      failures++;
      return;
    }
    successes++;
    cursor[id] = Date.now();
    const p = resolver.byId.get(id)!;
    for (const f of res.feed ?? []) {
      const headline = cleanText(f.headline);
      if (!headline || !f.id) continue;
      const isNote = f.type === "Rotowire" || !f.links?.web?.href;
      const story = cleanText(f.story);
      const summary = cleanText(f.description);
      items.push({
        externalId: isNote ? `espn-note:${espnId}:${hash(textKey(headline))}` : `espn:${f.id}`,
        source: f.type === "Rotowire" ? "ROTOWIRE" : "ESPN",
        headline,
        summary: distinctSummary(summary, headline),
        analysis: story && story !== headline ? story : null,
        url: f.links?.web?.href ?? `https://www.espn.com/nfl/player/_/id/${espnId}`,
        imageUrl: espnImage(f.images?.[0]?.url),
        team: p.team,
        category: isInjuryText(headline) ? "INJURY" : "NEWS",
        publishedAt: parseDate(f.published) ?? new Date(),
        playerIds: [id],
      });
    }
  });
  if (successes) {
    // keep the cursor small: only currently rostered players
    const keep = new Set(ids);
    await writeKv(FANTASY_CURSOR_KEY, Object.fromEntries(Object.entries(cursor).filter(([k]) => keep.has(k))));
  }
  return upsertNews(items);
}

// ───────────────────────────── Entry point ─────────────────────────────

export async function syncNewsAndInjuriesImpl(opts: { fantasyBatch?: number } = {}): Promise<{ news: number; injuries: number; alerts: number }> {
  const players = await db.player.findMany({
    select: { id: true, espnId: true, fullName: true, position: true, team: true, active: true, injuryStatus: true },
  });
  const resolver = new PlayerResolver(players);
  const errors: string[] = [];
  let news = 0;
  let injuries = 0;
  let alerts = 0;

  try {
    news += await syncHeadlineNews(resolver);
  } catch (e) {
    errors.push(`news: ${(e as Error).message}`);
  }
  try {
    const r = await syncInjuries(resolver);
    injuries += r.created;
    news += r.notes;
    alerts += r.alerts;
  } catch (e) {
    errors.push(`injuries: ${(e as Error).message}`);
  }
  try {
    news += await syncFantasyNews(resolver, opts.fantasyBatch);
  } catch (e) {
    errors.push(`fantasy news: ${(e as Error).message}`);
  }

  if (errors.length === 3) throw new Error(errors.join("; "));
  if (errors.length) console.warn(`[sync-news] partial failure: ${errors.join("; ")}`);
  return { news, injuries, alerts };
}
