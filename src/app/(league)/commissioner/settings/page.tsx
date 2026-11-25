// League settings editor — "What are the league's rules, and how do I change one?". Title + version line, the
// section tabs (scroll sideways on phones; locked sections carry a lock), a row of jump chips for the section's
// groups (its description in the ⓘ), then one card per group; History lists every saved version with a revert.
import Link from "next/link";
import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Chip, InfoButton, MoreLink, PageHeader, TabLinks } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { SettingsSectionForm } from "@/components/commissioner/settings-form";
import { SettingsHistory } from "@/components/commissioner/settings-history";
import { SECTIONS, SECTION_BY_KEY, isEditableSection } from "@/lib/commissioner/settings-meta";
import { sectionLock } from "@/lib/commissioner/settings-logic";
import { hasFullPowers } from "@/lib/commissioner/server";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "League Settings" };

const PAGE_SIZE = 20;

export default async function CommissionerSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string }> }) {
  const ctx = await requireCommissioner();
  const sp = await searchParams;
  const tab = sp.tab === "history" ? "history" : sp.tab && isEditableSection(sp.tab) ? sp.tab : "general";
  const page = Math.max(1, Number(sp.page) || 1);
  const { league, settings } = ctx;

  const [teams, latest, undroppable] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { name: "asc" }, select: { id: true, name: true, abbrev: true } }),
    db.leagueSettingsHistory.findFirst({ where: { leagueId: league.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, changedById: true } }),
    settings.waivers.undroppablePlayerIds.length
      ? db.player.findMany({ where: { id: { in: settings.waivers.undroppablePlayerIds } }, select: { id: true, fullName: true, position: true, team: true } })
      : Promise.resolve([]),
  ]);
  const latestBy = latest?.changedById ? await db.user.findUnique({ where: { id: latest.changedById }, select: { name: true } }) : null;
  const canEdit = hasFullPowers(ctx);
  const playerNames = Object.fromEntries(undroppable.map((p) => [p.id, `${p.fullName} (${p.position}${p.team ? ` ${p.team}` : ""})`]));

  // scoring has its own tab in the commissioner bar, so it isn't repeated here
  const tabs = [
    ...SECTIONS.map((s) => {
      const lock = sectionLock(settings, s.key, league.phase);
      return {
        key: s.key,
        href: `/commissioner/settings?tab=${s.key}`,
        label: (
          <span className="inline-flex items-center gap-1">
            {s.label}
            {lock.locked && <Lock size={12} aria-label="locked" />}
          </span>
        ),
      };
    }),
    { key: "history", href: "/commissioner/settings?tab=history", label: "History" },
  ];

  let history = null;
  if (tab === "history") {
    const rows = await db.leagueSettingsHistory.findMany({
      where: { leagueId: league.id },
      orderBy: { version: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    });
    const userIds = [...new Set(rows.map((r) => r.changedById).filter((x): x is string => !!x))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    history = {
      rows: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, changedBy: r.changedById ? names.get(r.changedById) ?? "Former member" : null })),
      hasMore: rows.length > PAGE_SIZE,
    };
  }

  const sectionMeta = tab !== "history" ? SECTION_BY_KEY[tab] : null;

  return (
    <div>
      <PageHeader
        title="League settings"
        subtitle={
          <span title={latest ? `Version ${league.settingsVersion}, changed ${timeAgo(latest.createdAt)}${latestBy ? ` by ${latestBy.name}` : ""}` : undefined}>
            v{league.settingsVersion} · {latest ? `${timeAgo(latest.createdAt)}${latestBy ? ` · ${latestBy.name}` : ""}` : "original"}
          </span>
        }
        actions={<MoreLink href="/rules">Rulebook</MoreLink>}
      />
      <TabLinks tabs={tabs} active={tab} />
      {sectionMeta && (
        // jump chips for the section's groups (scroll sideways on phones); the section's description in the ⓘ
        <ScrollRow as="nav" aria-label={`${sectionMeta.label} groups`} className="-mx-3 mb-3 items-center gap-2 px-3 sm:mx-0 sm:px-0">
          <InfoButton title={`${sectionMeta.label} settings`} className="shrink-0">
            <p>{sectionMeta.description}</p>
            <p>
              Every save is a new version you can revert under{" "}
              <Link href="/commissioner/settings?tab=history" className="link">
                History
              </Link>
              .
            </p>
          </InfoButton>
          {sectionMeta.groups.map((g) => (
            <Chip key={g.id} href={`#g-${g.id}`} size="sm">
              {g.title}
            </Chip>
          ))}
        </ScrollRow>
      )}
      {history ? (
        <SettingsHistory
          rows={history.rows}
          currentVersion={league.settingsVersion}
          lookups={{ teams: new Map(teams.map((t) => [t.id, t.name])), players: new Map(Object.entries(playerNames)), tz: settings.general.timezone }}
          tz={settings.general.timezone}
          canRevert={canEdit}
          page={page}
          hasMore={history.hasMore}
          current={JSON.parse(JSON.stringify(settings))}
          voteSections={(["scoring", ...SECTIONS.map((s) => s.key)] as const).filter((s) => sectionLock(settings, s, league.phase).requiresVote)}
          voters={teams.length}
        />
      ) : (
        <SettingsSectionForm
          key={`${tab}-${league.settingsVersion}`}
          section={tab as Exclude<typeof tab, "history">}
          initial={JSON.parse(JSON.stringify(settings[tab as Exclude<typeof tab, "history">]))}
          settings={JSON.parse(JSON.stringify(settings))}
          teams={teams}
          players={playerNames}
          version={league.settingsVersion}
          lock={sectionLock(settings, tab as Exclude<typeof tab, "history">, league.phase)}
          notifyDefault={settings.notifications.settingsChangeNotifyDefault}
          canEdit={canEdit}
          readOnlyReason="Co-commissioners can view but not change league settings (the commissioner can grant full powers under Commissioner)."
          week={ctx.week}
        />
      )}
    </div>
  );
}
