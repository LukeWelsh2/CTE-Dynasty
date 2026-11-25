import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { ButtonLink, EmptyState, PageHeader, TabLinks } from "@/components/ui/core";
import { firstOpenDraftSeason } from "@/lib/picks";
import { pickRoomDraft } from "@/lib/draft/pick";
import { getRookieRoomState } from "@/lib/draft/state";
import { RookieRoom } from "@/components/draft/rookie-room";

export const metadata: Metadata = { title: "Rookie Draft Room" };

export default async function RookieDraftRoomPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await getLeagueContext();
  const { id } = await searchParams;
  const { draft, all } = await pickRoomDraft(ctx.league.id, "ROOKIE", id);
  if (!draft) {
    const next = firstOpenDraftSeason(ctx.league.season, ctx.league.phase);
    return (
      <div className="space-y-4">
        <PageHeader kicker="Draft" title="Rookie draft room" className="!mb-0" />
        <EmptyState title={`The ${next} rookie draft isn't set up yet`}>
          {ctx.isCommish ? "Create it from the Draft center — the order comes from the league's draft settings." : "The commissioner creates it from the Draft center. Build your big board meanwhile."}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <ButtonLink href="/draft" size="md">
              Draft center
            </ButtonLink>
            <ButtonLink href={`/draft/board?class=${next}`} size="md" variant="secondary">
              My big board
            </ButtonLink>
          </div>
        </EmptyState>
      </div>
    );
  }
  const state = await getRookieRoomState(draft.id, { teamId: ctx.myTeam?.id ?? null, isCommish: ctx.isCommish });
  if (!state) return <EmptyState title="Draft not found" />;
  return (
    <div>
      {all.length > 1 && <TabLinks className="!mb-4" active={draft.id} tabs={all.map((d) => ({ key: d.id, label: d.name, href: `/draft/rookie?id=${d.id}` }))} />}
      <RookieRoom initial={state} />
    </div>
  );
}
