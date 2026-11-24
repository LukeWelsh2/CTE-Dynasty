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
      <div>
        <PageHeader kicker="Draft" title="Rookie Draft Room" subtitle="Live rookie draft with traded picks, queues and autopick" />
        <EmptyState title={`The ${next} rookie draft hasn't been set up yet`}>
          {ctx.isCommish ? "Create it from the Draft Center — the order is computed from the league's draft settings." : "The commissioner will create it from the Draft Center. Build your big board in the meantime."}
          <div className="mt-3 flex justify-center gap-2">
            <ButtonLink href="/draft" size="sm">
              Draft Center
            </ButtonLink>
            <ButtonLink href={`/draft/board?class=${next}`} size="sm" variant="secondary">
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
      {all.length > 1 && <TabLinks active={draft.id} tabs={all.map((d) => ({ key: d.id, label: d.name, href: `/draft/rookie?id=${d.id}` }))} />}
      <RookieRoom initial={state} />
    </div>
  );
}
