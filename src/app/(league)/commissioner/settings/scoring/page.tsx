import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { ButtonLink, PageHeader } from "@/components/ui/core";
import { ScoringEditor } from "@/components/commissioner/scoring-editor";
import { sectionLock } from "@/lib/commissioner/settings-logic";
import { hasFullPowers } from "@/lib/commissioner/server";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Scoring Rules" };

export default async function ScoringSettingsPage() {
  const ctx = await requireCommissioner();
  const { league, settings } = ctx;
  const last = await db.leagueSettingsHistory.findFirst({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const lock = sectionLock(settings, "scoring", league.phase);
  const preset = settings.scoring.preset === "HALF_PPR" ? "Half PPR" : settings.scoring.preset === "CUSTOM" ? "Custom" : settings.scoring.preset === "PPR" ? "PPR" : "Standard";

  return (
    <div>
      <PageHeader
        kicker="Commissioner"
        title="Scoring Rules"
        subtitle={`${preset} base · ${Object.values(settings.scoring.rules).filter((v) => v !== 0).length} scored stats · ${Object.values(settings.scoring.positionOverrides).reduce((a, m) => a + Object.keys(m).length, 0)} position overrides · ${settings.scoring.bonuses.length} bonuses${last ? ` · settings changed ${timeAgo(last.createdAt)}` : ""}`}
        actions={
          <>
            <ButtonLink href="/rules#scoring" variant="secondary" size="sm">
              Scoring in the rulebook
            </ButtonLink>
            <ButtonLink href="/commissioner/settings?tab=history" variant="secondary" size="sm">
              History
            </ButtonLink>
          </>
        }
      />
      <ScoringEditor
        key={league.settingsVersion}
        initial={JSON.parse(JSON.stringify(settings.scoring))}
        idpEnabled={settings.roster.idpEnabled}
        version={league.settingsVersion}
        notifyDefault={settings.notifications.settingsChangeNotifyDefault}
        locked={lock.locked}
        requiresVote={lock.requiresVote}
        canEdit={hasFullPowers(ctx)}
        week={ctx.week}
      />
    </div>
  );
}
