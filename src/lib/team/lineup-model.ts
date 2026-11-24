// Pure lineup model shared by the lineup editor (client), server actions and insights.
// No database / server imports here — this file is bundled into client components.

export interface SlotDef {
  key: string;
  index: number;
  label: string;
  eligible: string[];
}

/** slotId ("FLEX#0") -> playerId | null */
export type Assignment = Record<string, string | null>;

export interface LineupAssignmentLite {
  slot: string;
  slotIndex: number;
  playerId: string | null;
}

export interface LineupPlayerInfo {
  id: string;
  name: string;
  /** normalized fantasy position (QB, RB, WR, TE, K, DEF, DL, LB, DB) */
  pos: string;
  rosterStatus: string; // ACTIVE | IR | TAXI
  /** may be in the starting lineup (default: ACTIVE only; taxi players when the league lets them start) */
  startable?: boolean;
  locked: boolean;
  onBye: boolean;
  injuryStatus: string | null;
  projected: number;
}

export const slotId = (key: string, index: number) => `${key}#${index}`;

/** Can this player be placed in a starting slot? */
export const canStart = (p: Pick<LineupPlayerInfo, "rosterStatus" | "startable">) => p.startable ?? p.rosterStatus === "ACTIVE";

export function parseSlotId(id: string): { key: string; index: number } {
  const i = id.lastIndexOf("#");
  return { key: id.slice(0, i), index: Number(id.slice(i + 1)) };
}

export function toAssignment(list: LineupAssignmentLite[], slots: SlotDef[]): Assignment {
  const out: Assignment = {};
  for (const s of slots) out[slotId(s.key, s.index)] = null;
  for (const a of list) {
    const id = slotId(a.slot, a.slotIndex);
    if (id in out) out[id] = a.playerId;
  }
  return out;
}

export function toList(assign: Assignment, slots: SlotDef[]): LineupAssignmentLite[] {
  return slots.map((s) => ({ slot: s.key, slotIndex: s.index, playerId: assign[slotId(s.key, s.index)] ?? null }));
}

export function slotAccepts(slot: Pick<SlotDef, "eligible">, pos: string): boolean {
  return slot.eligible.includes(pos);
}

export function starterSet(assign: Assignment): Set<string> {
  return new Set(Object.values(assign).filter((x): x is string => !!x));
}

export function slotOf(assign: Assignment, playerId: string): string | null {
  for (const [k, v] of Object.entries(assign)) if (v === playerId) return k;
  return null;
}

/** Number of slots whose occupant differs between two assignments */
export function changedSlotCount(a: Assignment, b: Assignment): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let n = 0;
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) n++;
  return n;
}

const UNAVAILABLE = new Set(["out", "ir", "pup", "sus", "suspended", "na", "cov", "dnr", "injured reserve"]);

/** Statuses that mean the player will not play this week */
export function isUnavailableStatus(status: string | null | undefined): boolean {
  return !!status && UNAVAILABLE.has(status.toLowerCase());
}

export function isDoubtfulStatus(status: string | null | undefined): boolean {
  return !!status && status.toLowerCase().startsWith("doubt");
}

/** Is a slot locked because the player currently in it has a locked game? */
export function isSlotLocked(assign: Assignment, id: string, players: Map<string, LineupPlayerInfo>): boolean {
  const pid = assign[id];
  return !!pid && !!players.get(pid)?.locked;
}

export interface MoveTargets {
  /** starter slot ids the selected player can move into */
  slots: Set<string>;
  /** can the selected player be moved to the bench */
  bench: boolean;
  /** bench players the selected starter can swap places with */
  players: Set<string>;
}

const NO_TARGETS: MoveTargets = { slots: new Set(), bench: false, players: new Set() };

/** Valid destinations for moving `selectedId` (two-tap swap UX). */
export function moveTargets(assign: Assignment, slots: SlotDef[], players: Map<string, LineupPlayerInfo>, selectedId: string): MoveTargets {
  const sel = players.get(selectedId);
  if (!sel || sel.locked || !canStart(sel)) return NO_TARGETS;
  const from = slotOf(assign, selectedId);
  const fromDef = from ? slots.find((s) => slotId(s.key, s.index) === from) : undefined;
  const out: MoveTargets = { slots: new Set(), bench: !!from, players: new Set() };
  for (const s of slots) {
    const id = slotId(s.key, s.index);
    if (id === from) continue;
    if (!slotAccepts(s, sel.pos)) continue;
    if (isSlotLocked(assign, id, players)) continue;
    out.slots.add(id);
  }
  if (fromDef) {
    const starters = starterSet(assign);
    for (const p of players.values()) {
      if (p.id === selectedId || starters.has(p.id)) continue;
      if (!canStart(p) || p.locked) continue;
      if (slotAccepts(fromDef, p.pos)) out.players.add(p.id);
    }
  }
  return out;
}

export type MoveTarget = { kind: "slot"; slot: string } | { kind: "bench" } | { kind: "player"; playerId: string };

/**
 * Apply a move. Moving into an occupied slot swaps the occupant into the vacated slot when eligible,
 * otherwise the occupant goes to the bench. Returns a new assignment (input is not mutated).
 */
export function applyMove(assign: Assignment, slots: SlotDef[], players: Map<string, LineupPlayerInfo>, selectedId: string, target: MoveTarget): Assignment {
  const next: Assignment = { ...assign };
  const from = slotOf(assign, selectedId);
  const defOf = (id: string) => slots.find((s) => slotId(s.key, s.index) === id);
  if (target.kind === "bench") {
    if (from) next[from] = null;
    return next;
  }
  if (target.kind === "player") {
    if (!from) return next;
    next[from] = target.playerId;
    return next;
  }
  const occupant = assign[target.slot] ?? null;
  next[target.slot] = selectedId;
  if (from) {
    const fromDef = defOf(from);
    const occ = occupant ? players.get(occupant) : undefined;
    next[from] = occ && fromDef && slotAccepts(fromDef, occ.pos) ? occupant : null;
  }
  return next;
}

export interface LineupFix {
  playerId: string;
  name: string;
  projected: number;
}

export interface LineupIssue {
  kind: "injury" | "doubtful" | "bye" | "empty";
  slot: string;
  slotLabel: string;
  playerId: string | null;
  playerName: string | null;
  status: string | null;
  severity: "error" | "warn";
  fix: LineupFix | null;
}

/** Best available bench replacement for a slot (healthy, not on bye, not locked, eligible). */
export function bestBenchFor(
  assign: Assignment,
  slot: SlotDef,
  players: Map<string, LineupPlayerInfo>,
  opts: { minProjected?: number; exclude?: Set<string> } = {},
): LineupFix | null {
  const starters = starterSet(assign);
  let best: LineupPlayerInfo | null = null;
  for (const p of players.values()) {
    if (starters.has(p.id) || opts.exclude?.has(p.id)) continue;
    if (!canStart(p) || p.locked || p.onBye || isUnavailableStatus(p.injuryStatus)) continue;
    if (!slotAccepts(slot, p.pos)) continue;
    if (opts.minProjected !== undefined && p.projected <= opts.minProjected) continue;
    if (!best || p.projected > best.projected) best = p;
  }
  return best ? { playerId: best.id, name: best.name, projected: best.projected } : null;
}

/** Problems with a lineup: empty slots, unavailable / doubtful / bye-week starters (only unlocked slots). */
export function lineupIssues(assign: Assignment, slots: SlotDef[], players: Map<string, LineupPlayerInfo>): LineupIssue[] {
  const issues: LineupIssue[] = [];
  const reserved = new Set<string>();
  for (const s of slots) {
    const id = slotId(s.key, s.index);
    const pid = assign[id] ?? null;
    const p = pid ? players.get(pid) : undefined;
    if (p?.locked) continue;
    let kind: LineupIssue["kind"] | null = null;
    if (!pid || !p) kind = "empty";
    else if (isUnavailableStatus(p.injuryStatus)) kind = "injury";
    else if (p.onBye) kind = "bye";
    else if (isDoubtfulStatus(p.injuryStatus)) kind = "doubtful";
    if (!kind) continue;
    const fix = bestBenchFor(assign, s, players, { exclude: reserved, minProjected: kind === "doubtful" ? p?.projected ?? 0 : undefined });
    if (fix) reserved.add(fix.playerId);
    issues.push({
      kind,
      slot: id,
      slotLabel: s.label,
      playerId: p?.id ?? null,
      playerName: p?.name ?? null,
      status: p?.injuryStatus ?? null,
      severity: kind === "doubtful" ? "warn" : "error",
      fix,
    });
  }
  return issues;
}

/**
 * Empty starting slots that an eligible, unlocked player on the bench could fill (for leagues that don't allow empty
 * starter slots — settings.roster.allowEmptyStarterSlots).
 */
export function fillableEmptySlots(assign: Assignment, slots: SlotDef[], players: Map<string, LineupPlayerInfo>): SlotDef[] {
  const starters = starterSet(assign);
  const bench = [...players.values()].filter((p) => !starters.has(p.id) && canStart(p) && !p.locked);
  return slots.filter((s) => !assign[slotId(s.key, s.index)] && bench.some((p) => slotAccepts(s, p.pos)));
}

/** Put a bench player into a slot (the previous occupant goes to the bench). */
export function applyFix(assign: Assignment, slot: string, playerId: string): Assignment {
  const next: Assignment = { ...assign };
  const from = slotOf(assign, playerId);
  if (from) next[from] = null;
  next[slot] = playerId;
  return next;
}

/**
 * When an optimizer leaves a slot empty (no eligible healthy player), keep whoever is there now rather than
 * benching him for nobody (a bye-week kicker is no worse than an empty slot, and avoids empty-slot penalties).
 */
export function keepCurrentWhereEmpty(optimal: Assignment, current: Assignment): Assignment {
  const used = starterSet(optimal);
  const next: Assignment = { ...optimal };
  for (const [k, pid] of Object.entries(next)) {
    const cur = current[k] ?? null;
    if (!pid && cur && !used.has(cur)) {
      next[k] = cur;
      used.add(cur);
    }
  }
  return next;
}

/** Sum of a numeric field over the starters of an assignment */
export function sumStarters(assign: Assignment, value: (playerId: string) => number): number {
  let t = 0;
  for (const pid of Object.values(assign)) if (pid) t += value(pid);
  return Math.round(t * 100) / 100;
}

// ───────────────────────────── Slot assignment (bipartite matching) ─────────────────────────────

/**
 * Place `playerId` into the lineup, re-routing other (unlocked) starters through alternate eligible slots when
 * needed. Uses a breadth-first search for the SHORTEST displacement chain (augmenting path) ending in a free slot,
 * so existing assignments move as little as possible. `preferSlot` is tried first when it is free.
 * Returns the new assignment or null when no valid placement exists. Input is not mutated.
 */
export function placeInLineup(
  assign: Assignment,
  slots: SlotDef[],
  positions: Map<string, string>,
  playerId: string,
  fixedSlots: Set<string> = new Set(),
  preferSlot?: string,
): Assignment | null {
  const eligibleSlots = (pid: string) => {
    const pos = positions.get(pid);
    if (!pos) return [];
    return slots.filter((s) => slotAccepts(s, pos)).map((s) => slotId(s.key, s.index)).filter((id) => !fixedSlots.has(id));
  };
  const first = eligibleSlots(playerId);
  if (preferSlot) first.sort((a, b) => (a === preferSlot ? -1 : b === preferSlot ? 1 : 0));
  // parent[slot] = slot whose occupant moves INTO `slot` (null = the new player enters it)
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const id of first) {
    parent.set(id, null);
    queue.push(id);
  }
  let end: string | null = null;
  for (let i = 0; i < queue.length && !end; i++) {
    const s = queue[i];
    const occ = assign[s];
    if (!occ) {
      end = s;
      break;
    }
    for (const t of eligibleSlots(occ)) {
      if (parent.has(t)) continue;
      parent.set(t, s);
      queue.push(t);
    }
  }
  if (!end) return null;
  const next: Assignment = { ...assign };
  // walk back from the free slot: each slot receives the occupant of its parent slot
  let cur: string = end;
  for (;;) {
    const p = parent.get(cur) ?? null;
    if (p === null) {
      next[cur] = playerId;
      break;
    }
    next[cur] = assign[p] ?? null;
    cur = p;
  }
  return next;
}

/**
 * Re-arrange an optimizer's lineup so it keeps the same starters but moves as few players as possible relative to
 * the current lineup (greedy optimizers often shuffle equivalent players between RB/FLEX/etc.).
 * Falls back to `optimal` when the starters can't be placed (shouldn't happen for a valid lineup).
 */
export function alignToCurrent(
  optimal: Assignment,
  current: Assignment,
  slots: SlotDef[],
  positions: Map<string, string>,
  fixedSlots: Set<string> = new Set(),
): Assignment {
  const want = starterSet(optimal);
  let next: Assignment = {};
  for (const s of slots) {
    const id = slotId(s.key, s.index);
    const pid = current[id] ?? null;
    next[id] = pid && (want.has(pid) || fixedSlots.has(id)) ? pid : null;
  }
  const placed = starterSet(next);
  const incoming = [...want].filter((p) => !placed.has(p));
  // place the most constrained players first (fewest eligible slots)
  const eligibleCount = (pid: string) => slots.filter((s) => slotAccepts(s, positions.get(pid) ?? "")).length;
  incoming.sort((a, b) => eligibleCount(a) - eligibleCount(b));
  for (const pid of incoming) {
    const pref = Object.entries(optimal).find(([, v]) => v === pid)?.[0];
    const r = placeInLineup(next, slots, positions, pid, fixedSlots, pref);
    if (!r) return optimal;
    next = r;
  }
  return next;
}
