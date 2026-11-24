// Transaction log queries (/transactions page + CSV export).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pickShortLabel } from "@/lib/picks";
import { searchName } from "@/lib/utils";
import { groupTransactions, parseTxFilter, txTypesFor, type TxFilterKey } from "@/lib/waivers/tx-logic";

export interface TxQuery {
  season: number | null;
  type: TxFilterKey;
  teamId: string | null;
  week: number | null;
  q: string;
  page: number;
}

export function parseTxQuery(sp: Record<string, string | undefined>, defaults: { season: number }): TxQuery {
  const seasonRaw = sp.season;
  const season = seasonRaw === "all" ? null : Number.isInteger(Number(seasonRaw)) && Number(seasonRaw) > 2000 ? Number(seasonRaw) : defaults.season;
  const week = sp.week !== undefined && sp.week !== "" && Number.isInteger(Number(sp.week)) && Number(sp.week) >= 0 && Number(sp.week) <= 22 ? Number(sp.week) : null;
  return {
    season,
    type: parseTxFilter(sp.type),
    teamId: sp.team && /^[a-z0-9]{10,40}$/i.test(sp.team) ? sp.team : null,
    week,
    q: (sp.q ?? "").trim().slice(0, 60),
    page: Math.max(1, Math.floor(Number(sp.page) || 1)),
  };
}

export function txWhere(leagueId: string, q: TxQuery): Prisma.TransactionWhereInput {
  const types = txTypesFor(q.type);
  const where: Prisma.TransactionWhereInput = { leagueId };
  if (q.season !== null) where.season = q.season;
  if (types) where.type = { in: types };
  if (q.teamId) where.teamId = q.teamId;
  if (q.week !== null) where.week = q.week;
  if (q.q) {
    const sn = searchName(q.q);
    const search: Prisma.TransactionWhereInput[] = [{ description: { contains: q.q, mode: "insensitive" } }];
    if (sn) search.push({ player: { searchName: { contains: sn } } });
    where.AND = [{ OR: search }];
  }
  return where;
}

const playerSelect = { id: true, fullName: true, position: true, team: true, injuryStatus: true } as const;
const teamSelect = { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } as const;

type TeamLite = { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
type PlayerLite = { id: string; fullName: string; position: string; team: string | null; injuryStatus: string | null };

export interface LogRow {
  id: string;
  type: string;
  description: string;
  faabAmount: number | null;
  salary: number | null;
  player: PlayerLite | null;
  team: TeamLite | null;
  details: Record<string, unknown>;
}

export interface TradeSide {
  team: TeamLite;
  receives: { key: string; kind: "PLAYER" | "PICK" | "FAAB"; label: string; player: PlayerLite | null; salary: number | null; contractYears: number | null }[];
}

export interface LogEntry {
  key: string;
  kind: "trade" | "single";
  at: Date;
  season: number;
  week: number;
  type: string;
  team: TeamLite | null;
  rows: LogRow[];
  trade: { id: string; status: string; sides: TradeSide[] } | null;
  waiver: { bid: number | null; priority: number | null; tiebreak: boolean; competing: { team: TeamLite | null; bid: number }[] } | null;
  declaredDrop: PlayerLite | null;
}

const MAX_SCAN = 10_000;

export async function queryTransactions(leagueId: string, q: TxQuery, pageSize = 40) {
  const where = txWhere(leagueId, q);
  const minimal = await db.transaction.findMany({
    where,
    select: { id: true, type: true, teamId: true, tradeId: true, playerId: true, createdAt: true, details: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: MAX_SCAN,
  });
  const entries = groupTransactions(minimal);
  const total = entries.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(q.page, pages);
  const slice = entries.slice((page - 1) * pageSize, page * pageSize);
  const ids = slice.flatMap((e) => e.rowIds);
  const tradeIds = [...new Set(slice.map((e) => e.tradeId).filter((x): x is string => !!x))];
  const [rows, trades, teams] = await Promise.all([
    ids.length ? db.transaction.findMany({ where: { id: { in: ids } }, include: { player: { select: playerSelect }, team: { select: teamSelect } } }) : Promise.resolve([]),
    tradeIds.length
      ? db.trade.findMany({ where: { id: { in: tradeIds } }, include: { teams: { include: { team: { select: teamSelect } } }, assets: { include: { player: { select: playerSelect }, pick: true } } } })
      : Promise.resolve([]),
    db.team.findMany({ where: { leagueId }, select: teamSelect }),
  ]);
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const tradeMap = new Map(trades.map((t) => [t.id, t]));

  // declared drops for adds whose drop row isn't in the filtered result (e.g. "Waivers" filter)
  const missingDrops = new Set<string>();
  for (const e of slice) {
    if (e.kind !== "single") continue;
    const primary = rowMap.get(e.rowIds[0]);
    const d = (primary?.details ?? {}) as { dropPlayerId?: string };
    if (primary && (primary.type === "ADD" || primary.type === "WAIVER") && d.dropPlayerId && e.rowIds.length === 1) missingDrops.add(d.dropPlayerId);
  }
  const dropPlayers = missingDrops.size ? await db.player.findMany({ where: { id: { in: [...missingDrops] } }, select: playerSelect }) : [];
  const dropMap = new Map(dropPlayers.map((p) => [p.id, p]));

  const out: LogEntry[] = slice.map((e) => {
    const list = e.rowIds.map((id) => rowMap.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
    const primary = list[0];
    const logRows: LogRow[] = list.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      faabAmount: r.faabAmount,
      salary: r.salary,
      player: r.player,
      team: r.team,
      details: (r.details ?? {}) as Record<string, unknown>,
    }));
    let trade: LogEntry["trade"] = null;
    if (e.kind === "trade" && e.tradeId) {
      const t = tradeMap.get(e.tradeId);
      if (t) {
        trade = {
          id: t.id,
          status: t.status,
          sides: t.teams.map((tt) => ({
            team: tt.team,
            receives: t.assets
              .filter((a) => a.toTeamId === tt.teamId)
              .map((a) => ({
                key: a.id,
                kind: (a.type === "PICK" ? "PICK" : a.type === "FAAB" ? "FAAB" : "PLAYER") as "PLAYER" | "PICK" | "FAAB",
                label:
                  a.type === "PICK" && a.pick
                    ? `${pickShortLabel(a.pick)}${a.pick.originalTeamId !== a.fromTeamId ? ` (${teamMap.get(a.pick.originalTeamId)?.abbrev ?? "via"})` : ""}`
                    : a.type === "FAAB"
                      ? `$${a.faabAmount ?? 0} FAB`
                      : (a.player?.fullName ?? a.label ?? "Player"),
                player: a.player,
                salary: a.salary,
                contractYears: a.contractYears,
              }))
              .sort((x, y) => ["PLAYER", "PICK", "FAAB"].indexOf(x.kind) - ["PLAYER", "PICK", "FAAB"].indexOf(y.kind)),
          })),
        };
      }
    }
    let waiver: LogEntry["waiver"] = null;
    if (primary?.type === "WAIVER") {
      const d = (primary.details ?? {}) as { bid?: number; waiverPriority?: number | null; decidedByTiebreak?: boolean; competing?: { teamId: string; bid: number }[] };
      waiver = {
        bid: primary.faabAmount ?? d.bid ?? null,
        priority: d.waiverPriority ?? null,
        tiebreak: !!d.decidedByTiebreak,
        competing: (d.competing ?? []).map((c) => ({ team: teamMap.get(c.teamId) ?? null, bid: c.bid })).sort((a, b) => b.bid - a.bid),
      };
    }
    const declaredDropId = ((primary?.details ?? {}) as { dropPlayerId?: string }).dropPlayerId;
    return {
      key: e.key,
      kind: e.kind,
      at: e.createdAt,
      season: primary?.season ?? q.season ?? 0,
      week: primary?.week ?? 0,
      type: primary?.type ?? "",
      team: primary?.team ?? null,
      rows: logRows,
      trade,
      waiver,
      declaredDrop: declaredDropId && list.length === 1 ? (dropMap.get(declaredDropId) ?? null) : null,
    };
  });
  return { entries: out, total, page, pages, truncated: minimal.length >= MAX_SCAN };
}

/** Distinct seasons / weeks with transactions (filter options) */
export async function txFilterOptions(leagueId: string) {
  const [seasons, weeks] = await Promise.all([
    db.transaction.findMany({ where: { leagueId }, distinct: ["season"], select: { season: true }, orderBy: { season: "desc" } }),
    db.transaction.findMany({ where: { leagueId }, distinct: ["week"], select: { week: true }, orderBy: { week: "asc" } }),
  ]);
  return { seasons: seasons.map((s) => s.season), weeks: weeks.map((w) => w.week) };
}

/** Flat rows for CSV export */
export async function exportTransactions(leagueId: string, q: TxQuery) {
  return db.transaction.findMany({
    where: txWhere(leagueId, q),
    include: { player: { select: playerSelect }, team: { select: { name: true } }, relatedTeam: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 25_000,
  });
}
