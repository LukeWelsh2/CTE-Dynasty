// League Home hero: league identity, week / phase status, commissioner message, pinned announcements,
// my team summary and the action items that need attention right now.
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, ChevronRight, ClipboardList, Megaphone, MessagesSquare, Pin, Swords, UserPlus } from "lucide-react";
import { LiveDot, TeamLogo } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn, fmtMoney, ordinal, timeAgo } from "@/lib/utils";
import { formatWhen, previewText, tzAbbrev, type WeekStatus } from "./logic";
import type { HeroActionItem, HeroData } from "./types";

function StatusPill({ status, week, timezone, now }: { status: WeekStatus; week: number; timezone: string; now: Date }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold";
  const quiet = "on-hero text-white/90";
  const when = (iso: string) => `${formatWhen(iso, timezone, now)} ${tzAbbrev(timezone, new Date(iso))}`.trim();
  switch (status.state) {
    case "live":
      return (
        <span className={cn(base, "bg-live text-white shadow-glow-live")}>
          <LiveDot className="bg-white" /> {status.live} game{status.live === 1 ? "" : "s"} live
        </span>
      );
    case "pre":
      return status.nextKickoff ? (
        <span className={cn(base, quiet)}>
          <CalendarClock size={13} aria-hidden /> Kickoff {when(status.nextKickoff)}
        </span>
      ) : null;
    case "between":
      return (
        <span className={cn(base, quiet)}>
          <CalendarClock size={13} aria-hidden /> Week {week} underway{status.nextKickoff ? ` · next kickoff ${when(status.nextKickoff)}` : ""}
        </span>
      );
    case "final":
      return <span className={cn(base, quiet)}>Week {week} final</span>;
    default:
      return null;
  }
}

const ACTION_TONES: Record<HeroActionItem["tone"], string> = {
  gold: "bg-gold-500 text-brand-950",
  brand: "bg-brand-500 text-white",
  red: "bg-live text-white",
  green: "bg-win text-white",
};

const QUICK_LINKS = [
  { href: "/team", label: "Set lineup", icon: ClipboardList, teamOnly: true },
  { href: "/scoring/my", label: "My matchup", icon: Swords, teamOnly: true },
  { href: "/scoring", label: "Scoreboard", icon: Swords, teamOnly: false, noTeamOnly: true },
  { href: "/players?status=available", label: "Free agents", icon: UserPlus, teamOnly: false },
  { href: "/trades", label: "Trade center", icon: ArrowLeftRight, teamOnly: false },
  { href: "/chat", label: "League chat", icon: MessagesSquare, teamOnly: false },
];

function HeroStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">{label}</dt>
      <dd className={cn("numeral mt-0.5 text-[20px] font-semibold leading-none sm:text-[22px]", tone === "bad" ? "text-red-300" : "text-white")}>{value}</dd>
    </div>
  );
}

export function Hero({ data, timezone, now }: { data: HeroData; timezone: string; now: Date }) {
  const inSeason = data.phase === "REGULAR" || data.phase === "PLAYOFFS" || data.phase === "PRESEASON";
  const kicker = [`${data.season} season`, inSeason ? `Week ${data.week}` : null, data.roundLabel ?? data.phaseLabel].filter(Boolean).join(" · ");
  const t = data.myTeam;
  return (
    <section aria-labelledby="home-hero-title" className="hero-surface relative overflow-hidden rounded-2xl">
      <div className="relative grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(300px,auto)] md:gap-x-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold-400">{kicker}</span>
            {inSeason && <StatusPill status={data.weekStatus} week={data.week} timezone={timezone} now={now} />}
          </div>
          <h1 id="home-hero-title" className="mt-2 font-display text-[34px] font-extrabold uppercase leading-[0.95] tracking-[0.01em] sm:text-[44px]">
            {data.leagueName}
          </h1>
          {data.commissionerMessage && (
            <div className="on-hero mt-3.5 flex gap-2.5 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed text-white/85 shadow-[inset_3px_0_0_theme(colors.gold.400),inset_0_0_0_1px_rgb(255_255_255/0.1)] sm:text-sm">
              <Megaphone size={16} className="mt-0.5 shrink-0 text-gold-400" aria-hidden />
              <p>
                <span className="sr-only">Commissioner message: </span>
                {data.commissionerMessage}
              </p>
            </div>
          )}
        </div>

        {t && (
          <Link href="/team" className="on-hero group flex min-w-0 flex-col self-start rounded-xl p-3 transition-colors hover:bg-white/[0.1] sm:p-3.5">
            <span className="flex min-w-0 items-center gap-3">
              <TeamLogo team={t} size={44} />
              <span className="min-w-0 flex-1">
                <span title={t.name} className="block truncate font-display text-lg font-bold uppercase leading-tight tracking-[0.03em]">
                  {t.name}
                </span>
                <span className="block text-xs text-white/65">
                  My team{t.rank ? ` · ${ordinal(t.rank)} of ${t.teams}` : ""} · PF <span className="numeral font-semibold text-white/90">{t.pointsFor.toFixed(1)}</span>
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
              <HeroStat label="Record" value={t.record} />
              {data.capSpace !== null ? (
                <HeroStat label="Cap room" value={data.capSpace < 0 ? `−${fmtMoney(-data.capSpace)}` : fmtMoney(data.capSpace)} tone={data.capSpace < 0 ? "bad" : undefined} />
              ) : (
                <HeroStat label="Rank" value={t.rank ? ordinal(t.rank) : "—"} />
              )}
              {data.faab !== null ? <HeroStat label="FAB" value={fmtMoney(data.faab)} /> : <HeroStat label="Points" value={t.pointsFor.toFixed(0)} />}
            </dl>
          </Link>
        )}

        {data.announcements.length > 0 && (
          <ul className="grid min-w-0 grid-cols-1 gap-2 md:col-span-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Pinned announcements">
            {data.announcements.map((a) => (
              <li key={a.id} className="min-w-0">
                <Link href="/league" className="on-hero block h-full rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.1]">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Pin size={13} className="shrink-0 text-gold-400" aria-hidden />
                    <span className="truncate">{a.title}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-white/70">{previewText(a.body, 240)}</span>
                  <span className="mt-1 block text-[11px] uppercase tracking-[0.08em] text-white/45" suppressHydrationWarning>
                    {a.author ? `${a.author} · ` : ""}
                    {timeAgo(a.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="flex min-w-0 flex-col gap-2 md:col-span-2 lg:flex-row lg:items-center lg:justify-between">
          {data.actions.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Needs your attention">
              {data.actions.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/[0.12] py-1 pl-1.5 pr-3.5 text-[13px] font-semibold shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition-colors hover:bg-white/[0.18] sm:min-h-9">
                    <span className={cn("numeral inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold", ACTION_TONES[a.tone])}>
                      {a.count > 0 ? a.count : <LiveDot className="bg-white" />}
                    </span>
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <ScrollRow as="nav" aria-label="Quick actions" className="-mx-4 gap-2 px-4 scroll-px-4 sm:-mx-1 sm:px-1 sm:scroll-px-1 lg:ml-auto">
            {QUICK_LINKS.filter((q) => (data.myTeam ? !q.noTeamOnly : !q.teamOnly)).map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="on-hero inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold text-white/90 transition-colors hover:bg-white/[0.14] hover:text-white active:scale-[0.97] sm:min-h-9"
              >
                <q.icon size={15} className="text-white/70" aria-hidden />
                {q.label}
              </Link>
            ))}
          </ScrollRow>
        </div>
      </div>
    </section>
  );
}
