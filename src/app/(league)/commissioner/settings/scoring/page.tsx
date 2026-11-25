import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { MoreLink, PageHeader, SummaryStrip } from "@/components/ui/core";
import { ScoringEditor } from "@/components/commissioner/scoring-editor";
import { sectionLock } from "@/lib/commissioner/settings-logic";
import { hasFullPowers } from "@/lib/commissioner/server";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Scoring Rules" };

export default async function ScoringSettingsPage() {
  const ctx = await requireCommissioner();
  const { league, settings } = ctx;
  const [last, voters] = await Promise.all([
    db.leagueSettingsHistory.findFirst({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.team.count({ where: { leagueId: league.id } }),
  ]);
  const lock = sectionLock(settings, "scoring", league.phase);
  const scored = Object.values(settings.scoring.rules).filter((v) => v !== 0).length;
  const overrides = Object.values(settings.scoring.positionOverrides).reduce((a, m) => a + Object.keys(m).length, 0);
  const preset = settings.scoring.preset === "HALF_PPR" ? "Half PPR" : settings.scoring.preset === "CUSTOM" ? "Custom" : settings.scoring.preset === "PPR" ? "PPR" : "Standard";

  return (
    <div>
      <PageHeader
        title="Scoring rules"
        subtitle={`v${league.settingsVersion}${last ? ` · changed ${timeAgo(last.createdAt)}` : ""}`}
        actions={
          <span className="flex items-center gap-4">
            <MoreLink href="/commissioner/settings?tab=history">History</MoreLink>
            <MoreLink href="/rules#scoring">Rulebook</MoreLink>
          </span>
        }
      />
      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Preset", value: preset, sub: "base" },
          { label: "Stats", value: scored, sub: "scored" },
          { label: "By pos", value: overrides, sub: "overrides" },
          { label: "Bonuses", value: settings.scoring.bonuses.length, sub: "milestones" },
        ]}
      />
      <ScoringEditor
        key={league.settingsVersion}
        initial={JSON.parse(JSON.stringify(settings.scoring))}
        idpEnabled={settings.roster.idpEnabled}
        version={league.settingsVersion}
        notifyDefault={settings.notifications.settingsChangeNotifyDefault}
        locked={lock.locked}
        requiresVote={lock.requiresVote}
        voters={voters}
        voteThreshold={settings.commissioner.voteThresholdPercent}
        canEdit={hasFullPowers(ctx)}
        week={ctx.week}
      />
    </div>
  );
}
