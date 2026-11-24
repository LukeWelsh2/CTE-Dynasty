// Pure helpers for the transaction log: filter vocabulary, grouping trade legs and add/drop pairs into
// single entries, CSV encoding. No database access (safe for tests and client components).

export const TX_FILTERS = [
  { key: "all", label: "All transactions", types: null },
  { key: "adds", label: "Adds", types: ["ADD"] },
  { key: "drops", label: "Drops", types: ["DROP"] },
  { key: "waivers", label: "Waivers", types: ["WAIVER"] },
  { key: "trades", label: "Trades", types: ["TRADE"] },
  { key: "draft", label: "Draft & auction", types: ["AUCTION", "ROOKIE_DRAFT", "DRAFT"] },
  { key: "keepers", label: "Keepers", types: ["KEEPER"] },
  { key: "contract", label: "Contracts", types: ["CONTRACT"] },
  { key: "roster", label: "IR / taxi moves", types: ["IR", "TAXI", "ACTIVATE"] },
  { key: "commissioner", label: "Commissioner", types: ["COMMISSIONER", "FAAB"] },
] as const;

export type TxFilterKey = (typeof TX_FILTERS)[number]["key"];

export function parseTxFilter(raw: string | null | undefined): TxFilterKey {
  return (TX_FILTERS.find((f) => f.key === raw)?.key ?? "all") as TxFilterKey;
}

/** Stored Transaction.type values for a filter key (null = no type filter). */
export function txTypesFor(key: string | null | undefined): string[] | null {
  const f = TX_FILTERS.find((x) => x.key === key);
  return f?.types ? [...f.types] : null;
}

const TYPE_LABELS: Record<string, string> = {
  ADD: "Free-agent add",
  DROP: "Drop",
  WAIVER: "Waiver claim",
  TRADE: "Trade",
  AUCTION: "Auction",
  ROOKIE_DRAFT: "Rookie draft",
  DRAFT: "Draft",
  KEEPER: "Keeper",
  IR: "Moved to IR",
  TAXI: "Moved to taxi",
  ACTIVATE: "Activated",
  CONTRACT: "Contract",
  FAAB: "FAB adjustment",
  COMMISSIONER: "Commissioner",
};

export function describeTransactionType(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0) + type.slice(1).toLowerCase();
}

/** Badge tone per transaction type */
export function txTone(type: string): "green" | "red" | "brand" | "gold" | "purple" | "amber" | "neutral" {
  switch (type) {
    case "ADD":
    case "WAIVER":
      return "green";
    case "DROP":
      return "red";
    case "TRADE":
      return "brand";
    case "AUCTION":
    case "ROOKIE_DRAFT":
    case "DRAFT":
      return "gold";
    case "KEEPER":
    case "CONTRACT":
      return "purple";
    case "COMMISSIONER":
    case "FAAB":
      return "amber";
    default:
      return "neutral";
  }
}

export interface GroupableTx {
  id: string;
  type: string;
  teamId: string | null;
  tradeId: string | null;
  playerId: string | null;
  createdAt: Date;
  details: unknown;
}

export interface TxEntry {
  kind: "trade" | "single";
  key: string;
  /** primary row first */
  rowIds: string[];
  tradeId: string | null;
  createdAt: Date;
}

function dropPlayerIdOf(details: unknown): string | null {
  if (details && typeof details === "object" && "dropPlayerId" in details) {
    const v = (details as { dropPlayerId?: unknown }).dropPlayerId;
    return typeof v === "string" ? v : null;
  }
  return null;
}

/**
 * Group raw transaction rows (any order) into log entries, newest first:
 *  • all TRADE rows of one trade → one entry
 *  • an ADD / WAIVER with the DROP made for it (same team, declared drop or within a second) → one entry
 */
export function groupTransactions<T extends GroupableTx>(rows: T[]): TxEntry[] {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const drops = sorted.filter((r) => r.type === "DROP");
  const entries: TxEntry[] = [];
  const tradeEntry = new Map<string, TxEntry>();
  for (const r of sorted) {
    if (used.has(r.id)) continue;
    if (r.type === "TRADE" && r.tradeId) {
      const e = tradeEntry.get(r.tradeId);
      if (e) {
        e.rowIds.push(r.id);
        used.add(r.id);
        continue;
      }
      const ne: TxEntry = { kind: "trade", key: `trade:${r.tradeId}`, rowIds: [r.id], tradeId: r.tradeId, createdAt: r.createdAt };
      tradeEntry.set(r.tradeId, ne);
      entries.push(ne);
      used.add(r.id);
      continue;
    }
    const entry: TxEntry = { kind: "single", key: r.id, rowIds: [r.id], tradeId: null, createdAt: r.createdAt };
    used.add(r.id);
    if (r.type === "ADD" || r.type === "WAIVER") {
      const declared = dropPlayerIdOf(r.details);
      const pair = drops.find(
        (d) =>
          !used.has(d.id) &&
          d.teamId === r.teamId &&
          (declared ? d.playerId === declared && Math.abs(d.createdAt.getTime() - r.createdAt.getTime()) <= 120_000 : Math.abs(d.createdAt.getTime() - r.createdAt.getTime()) <= 1_500),
      );
      if (pair) {
        entry.rowIds.push(pair.id);
        used.add(pair.id);
      }
    } else if (r.type === "DROP") {
      // a drop listed before its add (same timestamp ordering) — attach to that add instead
      const add = sorted.find(
        (a) =>
          !used.has(a.id) &&
          (a.type === "ADD" || a.type === "WAIVER") &&
          a.teamId === r.teamId &&
          (dropPlayerIdOf(a.details) ? dropPlayerIdOf(a.details) === r.playerId && Math.abs(a.createdAt.getTime() - r.createdAt.getTime()) <= 120_000 : Math.abs(a.createdAt.getTime() - r.createdAt.getTime()) <= 1_500),
      );
      if (add) {
        entry.key = add.id;
        entry.rowIds = [add.id, r.id];
        used.add(add.id);
      }
    }
    entries.push(entry);
  }
  return entries;
}

type Cell = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV. Text cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR at the start — e.g. a
 * team name typed by a manager) are prefixed with an apostrophe.
 */
export function toCsv(rows: Cell[][]): string {
  return rows
    .map((row) =>
      row
        .map((c) => {
          if (c === null || c === undefined) return "";
          let s = String(c);
          if (typeof c === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
