// Live event payloads on the draft:<draftId> topic. Clients refetch /api/draft/<id>/state on any of them.

export type DraftEventType =
  | "draft.pick" // rookie pick made (manual or autopick)
  | "draft.clock" // on-the-clock team / deadline changed
  | "draft.status" // SCHEDULED → LIVE → PAUSED → COMPLETE
  | "draft.undo" // commissioner undid a pick / lot
  | "draft.order" // order changed
  | "auction.lot" // new nomination
  | "auction.bid" // new high bid (manual or proxy)
  | "auction.sold" // lot closed (SOLD or PASSED)
  | "draft.queue"; // a manager's queue changed (only sent to that team's room)

export interface DraftEventBase {
  draftId: string;
  message?: string;
}

export interface DraftPickEvent extends DraftEventBase {
  overall: number;
  round: number;
  pickInRound: number;
  teamId: string;
  playerId: string;
  playerName: string;
  isAutopick: boolean;
}

export interface DraftClockEvent extends DraftEventBase {
  currentIndex: number;
  teamId: string | null;
  deadline: string | null;
}

export interface AuctionBidEvent extends DraftEventBase {
  lotId: string;
  playerId: string;
  amount: number;
  teamId: string;
  endsAt: string | null;
  auto: boolean;
}

export interface AuctionSoldEvent extends DraftEventBase {
  lotId: string;
  playerId: string;
  playerName: string;
  status: "SOLD" | "PASSED";
  teamId: string | null;
  amount: number;
  contractYears: number;
}
