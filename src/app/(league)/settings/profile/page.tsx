// /settings/profile — edit my manager profile, photos, team branding and password. ?welcome=1 greets new managers.
import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ImagePlus, PartyPopper, Shield, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { loadStandings } from "@/lib/stats/load";
import { readSocials } from "@/lib/profiles/schema";
import { Alert, Avatar, Badge, ButtonLink, PageHeader, Panel } from "@/components/ui/core";
import { SettingsTabs } from "@/components/community/settings-tabs";
import { SectionNav, fmtRecord } from "@/components/community/bits";
import { CoverUpload, ImageUpload } from "@/components/community/image-upload";
import { ProfileForm, type ProfileFormValues } from "@/components/community/profile-form";
import { BrandingForm } from "@/components/community/branding-form";
import { PasswordForm } from "@/components/community/password-form";

export const metadata: Metadata = { title: "My Profile" };
export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const ctx = await getLeagueContext();
  const [user, players, standings] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, include: { profile: true, pushSubscriptions: { select: { id: true } } } }),
    db.player.findMany({ where: { active: true, searchRank: { not: null }, position: { in: ["QB", "RB", "WR", "TE"] } }, orderBy: { searchRank: "asc" }, take: 250, select: { fullName: true } }),
    ctx.myTeam ? loadStandings(ctx.league.id, ctx.season, ctx.settings) : Promise.resolve([]),
  ]);
  const p = user.profile;
  const team = ctx.myTeam;
  const row = team ? standings.find((s) => s.team.id === team.id) : undefined;
  const record = row && row.wins + row.losses + row.ties > 0 ? fmtRecord(row.wins, row.losses, row.ties) : null;
  const welcome = sp.welcome === "1";
  const displayName = p?.displayName?.trim() || user.name;

  const initial: ProfileFormValues = {
    name: user.name,
    displayName: p?.displayName ?? "",
    bio: p?.bio ?? "",
    motto: p?.motto ?? "",
    location: p?.location ?? "",
    favoriteNflTeam: p?.favoriteNflTeam ?? "",
    favoritePlayer: p?.favoritePlayer ?? "",
    yearsPlaying: p?.yearsPlaying != null ? String(p.yearsPlaying) : "",
    managerStyle: p?.managerStyle ?? "",
    timezone: user.timezone,
    phone: user.phone ?? "",
    showEmail: p?.showEmail ?? false,
    showPhone: p?.showPhone ?? false,
    socials: readSocials(p?.socials),
  };

  const checklist = [
    { done: !!user.avatarUrl, label: "Add a profile photo", href: "#photos", icon: ImagePlus },
    { done: !!(p?.bio || p?.motto), label: "Write a bio or motto", href: "#about", icon: UserRound },
    // Team defaults are #1d4ed8 / #f59e0b (prisma schema) — anything else means the manager picked colors
    { done: !!team && (!!team.logoUrl || team.primaryColor !== "#1d4ed8" || team.secondaryColor !== "#f59e0b"), label: "Brand your team", href: "#team", icon: Shield },
    { done: user.pushSubscriptions.length > 0, label: "Turn on phone alerts", href: "/settings/notifications", icon: BellRing },
  ];

  return (
    <div>
      <SettingsTabs active="profile" userId={ctx.user.id} />
      <PageHeader
        kicker="Account settings"
        title="My Profile"
        subtitle="What the league sees on your manager page, plus your team's look."
        actions={
          <ButtonLink href={`/managers/${ctx.user.id}`} variant="secondary" size="sm">
            View public profile
          </ButtonLink>
        }
      />

      {welcome && (
        <Alert tone="success" className="mb-4">
          <div className="flex items-start gap-3">
            <PartyPopper size={22} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-display text-lg font-bold uppercase tracking-wide">Welcome to {ctx.league.name}, {displayName}!</div>
              <p className="mt-0.5">Take a minute to set up your profile so the league knows who they&apos;re trading with — and turn on phone alerts so you never miss a touchdown or trade offer.</p>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {checklist.map((c) => (
                  <li key={c.label}>
                    <Link href={c.href} className="flex items-center gap-2 rounded-md bg-white/60 px-2 py-1.5 text-sm font-semibold hover:bg-white dark:bg-black/20 dark:hover:bg-black/30">
                      <c.icon size={15} className="shrink-0" />
                      <span className={c.done ? "line-through opacity-70" : ""}>{c.label}</span>
                      {c.done && <Badge tone="green" className="ml-auto">Done</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Alert>
      )}

      <SectionNav
        items={[
          { id: "photos", label: "Photos" },
          { id: "about", label: "About you" },
          { id: "socials", label: "Socials" },
          { id: "team", label: "Team branding" },
          { id: "password", label: "Password" },
        ]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel id="photos" title="Photos" subtitle="Your avatar appears in chat, standings and the scoreboard">
            <CoverUpload
              current={p?.coverUrl ?? null}
              fallbackStyle={{ background: `linear-gradient(120deg, ${team?.primaryColor ?? "#1f3fa1"} 0%, ${team?.primaryColor ?? "#1f3fa1"} 62%, ${team?.secondaryColor ?? "#f5b301"} 62%)` }}
            />
            <div className="relative -mt-12 ml-3 w-fit sm:ml-4">
              <ImageUpload
                target={{ kind: "avatar" }}
                current={user.avatarUrl}
                label="Profile photo"
                round
                size={92}
                fallback={<Avatar name={displayName} size={92} />}
                hint=""
                textClassName="pt-12"
              />
            </div>
            <p className="mt-2 text-xs text-muted">Tap your photo or the cover to change it. PNG, JPEG, WebP or GIF up to 2 MB — wide images (about 3:1) work best for the cover.</p>
          </Panel>

          <Panel id="about" title="About you" subtitle="Everything here shows on your manager profile">
            {/* keyed on the saved values (not timestamps) so a photo upload doesn't wipe unsaved edits */}
            <ProfileForm key={JSON.stringify(initial)} initial={initial} email={user.email} playerSuggestions={players.map((x) => x.fullName)} />
          </Panel>
        </div>

        <div className="space-y-4 lg:sticky lg:top-14">
          <Panel id="team" title="Team branding" subtitle={team ? "Name, colors and logo shown across the site" : undefined}>
            {team ? (
              <BrandingForm
                key={JSON.stringify([team.name, team.abbrev, team.motto, team.primaryColor, team.secondaryColor])}
                record={record}
                initial={{ teamId: team.id, name: team.name, abbrev: team.abbrev, motto: team.motto ?? "", primaryColor: team.primaryColor, secondaryColor: team.secondaryColor, logoUrl: team.logoUrl }}
              />
            ) : (
              <p className="text-sm text-muted">You don&apos;t manage a team in {ctx.league.name} yet. Once the commissioner assigns you a team you can set its name, colors and logo here.</p>
            )}
          </Panel>

          <Panel id="password" title="Password">
            <PasswordForm />
          </Panel>

          <Panel title="Account">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Email</dt>
                <dd className="truncate font-semibold">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">League role</dt>
                <dd className="font-semibold">{ctx.member.role === "COMMISSIONER" ? "Commissioner" : ctx.member.role === "CO_COMMISSIONER" ? "Co-commissioner" : "Manager"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Member since</dt>
                <dd className="font-semibold">{ctx.member.joinedAt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: ctx.settings.general.timezone })}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Phone alert devices</dt>
                <dd className="font-semibold">
                  <Link href="/settings/notifications#devices" className="link">
                    {user.pushSubscriptions.length || "None"} →
                  </Link>
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
