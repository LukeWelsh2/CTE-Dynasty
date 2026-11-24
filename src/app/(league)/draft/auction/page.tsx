import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { ButtonLink, EmptyState, PageHeader, TabLinks } from "@/components/ui/core";
import { pickRoomDraft } from "@/lib/draft/pick";
import { getAuctionRoomState } from "@/lib/draft/state";
import { AuctionRoom } from "@/components/draft/auction-room";
import { CompletedAuction } from "@/components/draft/completed-auction";
import { auctionResults } from "@/lib/draft/results";

export const metadata: Metadata = { title: "Salary Auction Room" };

export default async function AuctionRoomPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await getLeagueContext();
  const { id } = await searchParams;
  const { draft, all } = await pickRoomDraft(ctx.league.id, "AUCTION", id);
  if (!draft) {
    return (
      <div>
        <PageHeader kicker="Draft" title="Salary Auction Room" subtitle="Live nominations and bidding with budgets, max bids and contract years" />
        <EmptyState title="No auction has been set up">
          {ctx.isCommish ? "Create a startup or free-agent auction from the Draft Center." : "The commissioner hasn't scheduled an auction yet."}
          <div className="mt-3">
            <ButtonLink href="/draft" size="sm">
              Draft Center
            </ButtonLink>
          </div>
        </EmptyState>
      </div>
    );
  }
  const tabs = all.length > 1 ? <TabLinks active={draft.id} tabs={all.map((d) => ({ key: d.id, label: d.name, href: `/draft/auction?id=${d.id}` }))} /> : null;
  if (draft.status === "COMPLETE") {
    const results = await auctionResults(draft, ctx.league.season);
    return (
      <div>
        {tabs}
        <CompletedAuction draft={draft} results={results} isCommish={ctx.isCommish} timezone={ctx.settings.general.timezone} />
      </div>
    );
  }
  const state = await getAuctionRoomState(draft.id, { teamId: ctx.myTeam?.id ?? null, isCommish: ctx.isCommish });
  if (!state) return <EmptyState title="Auction not found" />;
  return (
    <div>
      {tabs}
      <AuctionRoom initial={state} timezone={ctx.settings.general.timezone} />
    </div>
  );
}
