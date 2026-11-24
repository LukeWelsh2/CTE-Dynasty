// Serializable view models passed from team pages (server) to team components (client). Client-safe.
import type { DeadMoneyEntry } from "@/lib/team/contracts";
import type { GameLine } from "@/lib/team/format";
import type { Assignment, SlotDef } from "@/lib/team/lineup-model";

export type Difficulty = "easy" | "avg" | "tough";

export interface Avail {
  ok: boolean;
  reason?: string;
}

export interface RowActions {
  ir: Avail;
  activate: Avail;
  taxi: Avail;
  promote: Avail;
  drop: Avail & { dead: DeadMoneyEntry[]; waiverHours: number | null; capAfter: number | null };
}

export interface RosterRow {
  playerId: string;
  name: string;
  /** raw NFL position */
  position: string;
  /** normalized fantasy position */
  pos: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  injuryBodyPart: string | null;
  hasNews: boolean;
  /** ACTIVE | IR | TAXI, or GONE for a past-week starter no longer rostered */
  rosterStatus: string;
  salary: number | null;
  contractYears: number | null;
  contractEnd: number | null;
  isRookie: boolean;
  isTagged: boolean;
  age: number | null;
  points: number;
  projected: number;
  liveProjected: number;
  game: GameLine;
  /** ISO lock time (kickoff minus settings.lineup.lockOffsetMinutes) for games not started — lock countdown */
  kickoff: string | null;
  seasonTotal: number;
  seasonAvg: number;
  seasonGames: number;
  byeWeek: number | null;
  onBye: boolean;
  locked: boolean;
  /** on IR but no longer has an IR-eligible designation (must be activated per settings.roster.irActivationPolicy) */
  irIneligible: boolean;
  oprk: { rank: number; of: number; perGame: number; tone: Difficulty } | null;
  actions: RowActions | null;
}

export interface RosterLimits {
  maxActive: number;
  irSlots: number;
  taxiSlots: number;
  active: number;
  ir: number;
  taxi: number;
}

export interface LineupEditorData {
  teamId: string;
  leagueId: string;
  season: number;
  week: number;
  currentWeek: number;
  editable: boolean;
  readOnlyReason: string | null;
  manage: boolean;
  commishEdit: boolean;
  slots: SlotDef[];
  saved: Assignment;
  optimal: Assignment | null;
  rows: RosterRow[];
  limits: RosterLimits;
  benchSize: number;
  timezone: string;
  showSalary: boolean;
  showContracts: boolean;
  adjustments: number;
  emptyPenalty: number;
  /** settings.roster.taxiPlayersCanStart */
  taxiCanStart: boolean;
  /** settings.lineup.lockOffsetMinutes */
  lockOffsetMinutes: number;
  /** settings.roster.irActivationPolicy */
  irPolicy: string;
  /** who may go on IR, e.g. "IR / Out / PUP" (null = any player) */
  irEligibleLabel: string | null;
}
