// League Home hero: league identity, week / phase status, commissioner message, pinned announcements,
// my team summary and the action items that need attention right now.
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, ClipboardList, Megaphone, MessagesSquare, Pin, Swords, UserPlus } from "lucide-react";
import { LiveDot, TeamLogo } from "@/components/ui/core";
import { cn, fmtMoney, ordinal, timeAgo } from "@/lib/utils";
import { formatWhen, tzAbbrev, type WeekStatus } from "./logic";
import type { HeroActionItem, HeroData } from "./types";

function StatusPill({ status, week, timezone, now }: { status: WeekStatus; week: number; timezone: string; now: Date }) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold";
  const when = (iso: string) => `${formatWhen(iso, timezone, now)} ${tzAbbrev(timezone, new Date(iso))}`.trim();
  switch (status.state) {
    case "live":
      return (
        <span className={cn(base, "bg-live/90 text-white")}>
          <LiveDot className="bg-white" /> {status.live} game{status.live === 1 ? "" : "s"} live
        </span>
      );
    case "pre":
      return status.nextKickoff ? (
        <span className={cn(base, "bg-white/10 text-white")}>
          <CalendarClock size={13} aria-hidden /> Kickoff {when(status.nextKickoff)}
        </span>
      ) : null;
    case "between":
      return (
        <span className={cn(base, "bg-white/10 text-white")}>
          <CalendarClock size={13} aria-hidden /> Week {week} underway{status.nextKickoff ? ` · next kickoff ${when(status.nextKickoff)}` : ""}
        </span>
      );
    case "final":
      return <span className={cn(base, "bg-white/10 text-white")}>Week {week} final</span>;
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
  { href: "/team", label: "Set lineup", icon: ClipboardList },
  { href: "/scoring/my", label: "My matchup", icon: Swords },
  { href: "/players?status=available", label: "Free agents", icon: UserPlus },
  { href: "/trades", label: "Trade center", icon: ArrowLeftRight },
  { href: "/chat", label: "League chat", icon: MessagesSquare },
];

export function Hero({ data, timezone, now }: { data: HeroData; timezone: string; now: Date }) {
  const inSeason = data.phase === "REGULAR" || data.phase === "PLAYOFFS" || data.phase === "PRESEASON";
  const kicker = [`${data.season} season`, inSeason ? `Week ${data.week}` : null, data.roundLabel ?? data.phaseLabel].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="home-hero-title" className="relative overflow-hidden rounded-xl border border-brand-900 bg-brand-950 text-white shadow-pop">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 63px, rgba(255,255,255,0.07) 63px 64px), radial-gradient(ellipse at 85% -20%, rgba(245,179,1,0.35), transparent 55%)",
        }}
      />
      <div className="relative grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400">{kicker}</span>
            {inSeason && <StatusPill status={data.weekStatus} week={data.week} timezone={timezone} now={now} />}
          </div>
          <h1 id="home-hero-title" className="mt-1 font-display text-3xl font-extrabold uppercase leading-none tracking-wide sm:text-4xl">
            {data.leagueName}
          </h1>
          {data.commissionerMessage && (
            <div className="mt-3 flex gap-2.5 rounded-lg border-l-4 border-gold-500 bg-white/[0.07] px-3 py-2.5 text-sm leading-relaxed text-white/90">
              <Megaphone size={16} className="mt-0.5 shrink-0 text-gold-400" aria-hidden />
              <p>
                <span className="sr-only">Commissioner message: </span>
                {data.commissionerMessage}
              </p>
            </div>
          )}
        </div>

        {data.myTeam && (
          <Link
            href="/team"
            className="flex min-w-0 items-center gap-3 self-start rounded-lg border border-white/10 bg-white/[0.06] p-3 transition-colors hover:bg-white/10 md:min-w-[260px]"
          >
            <TeamLogo team={data.myTeam} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg font-bold uppercase leading-tight tracking-wide">{data.myTeam.name}</div>
              <div className="text-xs text-white/70">
                <span className="font-semibold text-white">{data.myTeam.record}</span>
                {data.myTeam.rank ? ` · ${ordinal(data.myTeam.rank)} of ${data.myTeam.teams}` : ""}
              </div>
              <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/70">
                <div className="flex gap-1">
                  <dt>PF</dt>
                  <dd className="font-semibold tabular-nums text-white">{data.myTeam.pointsFor.toFixed(1)}</dd>
                </div>
                {data.faab !== null && (
                  <div className="flex gap-1">
                    <dt>FAB</dt>
                    <dd className="font-semibold tabular-nums text-white">{fmtMoney(data.faab)}</dd>
                  </div>
                )}
                {data.capSpace !== null && (
                  <div className="flex gap-1">
                    <dt>Cap room</dt>
                    <dd className={cn("font-semibold tabular-nums", data.capSpace < 0 ? "text-red-300" : "text-white")}>{data.capSpace < 0 ? `−${fmtMoney(-data.capSpace)}` : fmtMoney(data.capSpace)}</dd>
                  </div>
                )}
              </dl>
            </div>
          </Link>
        )}

        {data.announcements.length > 0 && (
          <ul className="grid gap-2 md:col-span-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Pinned announcements">
            {data.announcements.map((a) => (
              <li key={a.id} className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <Pin size={13} className="shrink-0 text-gold-400" aria-hidden />
                  <span className="truncate">{a.title}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-white/75">{a.body}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-white/50" suppressHydrationWarning>
                  {a.author ? `${a.author} · ` : ""}
                  {timeAgo(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 md:col-span-2 lg:flex-row lg:items-center lg:justify-between">
          {data.actions.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Needs your attention">
              {data.actions.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pl-1 pr-3 text-xs font-semibold hover:bg-white/15">
                    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold", ACTION_TONES[a.tone])}>
                      {a.count > 0 ? a.count : <LiveDot className="bg-white" />}
                    </span>
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="Quick actions" className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 lg:ml-auto">
            {QUICK_LINKS.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/20 hover:text-white"
              >
                <q.icon size={14} aria-hidden />
                {q.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
