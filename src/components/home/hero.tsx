// League Home, top of the page (docs/DESIGN.md "Reference screens → Home"):
//   HomeHeader   — the week as the page title, its state as a chip, then one scrolling row of to-do chips
//                  (counted action items first) and shortcuts.
//   MyTeamStrip  — the summary strip: record, rank, cap room, FAB (the numbers that answer "how am I doing?").
//   LeagueNotes  — commissioner message + pinned announcements as compact rows (full text on /league).
import Link from "next/link";
import { ArrowLeftRight, CalendarClock, ChevronRight, ClipboardList, Megaphone, MessagesSquare, Pin, Swords, UserPlus } from "lucide-react";
import { LiveDot, Panel, SummaryStrip, TeamLogo, type SummaryItem } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn, fmtMoney, ordinal, timeAgo } from "@/lib/utils";
import { formatWhen, previewText, tzAbbrev, type WeekStatus } from "./logic";
import type { HeroActionItem, HeroData } from "./types";

function StatusChip({ status, week, timezone, now }: { status: WeekStatus; week: number; timezone: string; now: Date }) {
  const base = "inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold";
  const quiet = cn(base, "bg-sunken text-muted ring-1 ring-inset ring-line/70");
  const when = (iso: string) => `${formatWhen(iso, timezone, now)} ${tzAbbrev(timezone, new Date(iso))}`.trim();
  switch (status.state) {
    case "live":
      return (
        <span className={cn(base, "bg-live text-white")}>
          <LiveDot className="h-1.5 w-1.5 bg-white" /> {status.live} live
        </span>
      );
    case "pre":
      return status.nextKickoff ? (
        <span className={quiet} suppressHydrationWarning>
          <CalendarClock size={14} aria-hidden /> Kickoff {when(status.nextKickoff)}
        </span>
      ) : null;
    case "between":
      return (
        <span className={quiet} suppressHydrationWarning>
          <CalendarClock size={14} aria-hidden /> {status.nextKickoff ? `Next kickoff ${when(status.nextKickoff)}` : `Week ${week} underway`}
        </span>
      );
    case "final":
      return <span className={quiet}>Final</span>;
    default:
      return null;
  }
}

const ACTION_DOT: Record<HeroActionItem["tone"], string> = {
  gold: "bg-brand-600 text-white",
  brand: "bg-brand-600 text-white",
  red: "bg-live text-white",
  green: "bg-green-700 text-white",
};

const QUICK_LINKS = [
  { href: "/team", label: "Set lineup", icon: ClipboardList, teamOnly: true },
  { href: "/scoring/my", label: "My matchup", icon: Swords, teamOnly: true },
  { href: "/scoring", label: "Scoreboard", icon: Swords, teamOnly: false, noTeamOnly: true },
  { href: "/players?status=available", label: "Free agents", icon: UserPlus, teamOnly: false },
  { href: "/trades", label: "Trades", icon: ArrowLeftRight, teamOnly: false },
  { href: "/chat", label: "Chat", icon: MessagesSquare, teamOnly: false },
];

export function HomeHeader({ data, timezone, now }: { data: HeroData; timezone: string; now: Date }) {
  const inSeason = data.phase === "REGULAR" || data.phase === "PLAYOFFS" || data.phase === "PRESEASON";
  const title = inSeason ? (data.roundLabel ? `${data.roundLabel}` : `Week ${data.week}`) : data.phaseLabel;
  const kicker = [data.leagueName, `${data.season}`, inSeason ? (data.roundLabel ? `Week ${data.week}` : data.phaseLabel) : null].filter(Boolean).join(" · ");
  return (
    <section aria-labelledby="home-title" className="min-w-0">
      <div className="eyebrow truncate">{kicker}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h1 id="home-title" className="text-[28px] font-bold leading-9 tracking-[-0.02em] text-ink sm:text-[32px]">
          {title}
        </h1>
        {inSeason && <StatusChip status={data.weekStatus} week={data.week} timezone={timezone} now={now} />}
      </div>
      {/* To-do first (count badge), then shortcuts; one row that scrolls sideways on phones */}
      <ScrollRow as="nav" aria-label="To do and shortcuts" className="-mx-3 mt-3 min-w-0 gap-2 px-3 scroll-px-3 sm:mx-0 sm:px-0">
        {data.actions.map((a) => (
          <Link
            key={a.key}
            href={a.href}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-panel py-1 pl-1.5 pr-3.5 text-[14px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-accent)/0.35)] transition-colors hover:bg-brand-600/[0.05] active:scale-[0.98] sm:min-h-9 sm:text-[13px]"
          >
            <span className={cn("numeral inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold", ACTION_DOT[a.tone])}>
              {a.count > 0 ? a.count : <LiveDot className="h-1.5 w-1.5 bg-white" />}
            </span>
            {a.label}
          </Link>
        ))}
        {QUICK_LINKS.filter((q) => (data.myTeam ? !q.noTeamOnly : !q.teamOnly)).map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-panel px-3.5 text-[14px] font-semibold text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] transition-colors hover:bg-sunken active:scale-[0.98] sm:min-h-9 sm:text-[13px] dark:bg-white/[0.05]"
          >
            <q.icon size={15} className="text-muted" aria-hidden />
            {q.label}
          </Link>
        ))}
      </ScrollRow>
    </section>
  );
}

/** My team in four numbers (record · rank · cap room · FAB), with the team as a link row on top. */
export function MyTeamStrip({ data, className }: { data: HeroData; className?: string }) {
  const t = data.myTeam;
  if (!t) return null;
  const items: SummaryItem[] = [
    { label: "Record", value: t.record, sub: `PF ${t.pointsFor.toFixed(1)}` },
    { label: "Rank", value: t.rank ? ordinal(t.rank) : "—", sub: `of ${t.teams}`, href: "/standings" },
  ];
  if (data.capSpace !== null)
    items.push({ label: "Cap", value: data.capSpace < 0 ? `−${fmtMoney(-data.capSpace)}` : fmtMoney(data.capSpace), tone: data.capSpace < 0 ? "bad" : undefined, href: "/team/contracts", sub: data.capSpace < 0 ? "Over cap" : "Room", title: "Cap room" });
  if (data.faab !== null) items.push({ label: "FAB", value: fmtMoney(data.faab), sub: "Left", href: "/waivers", title: "Free-agent budget left" });
  return (
    <SummaryStrip
      className={className}
      items={items}
      header={
        <Link href="/team" className="group flex min-h-[52px] items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70">
          <TeamLogo team={t} size={32} />
          <span className="min-w-0 flex-1">
            <span title={t.name} className="block truncate text-[15px] font-semibold leading-5 text-ink">
              {t.name}
            </span>
            <span className="block text-[13px] leading-[18px] text-muted">My team</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      }
    />
  );
}

/** Commissioner message + pinned announcements: short rows; the full text lives on the League page. */
export function LeagueNotes({ data, className }: { data: HeroData; className?: string }) {
  if (!data.commissionerMessage && data.announcements.length === 0) return null;
  return (
    <Panel title="From the commissioner" className={className} noPad>
      <ul className="divide-y divide-line/70">
        {data.commissionerMessage && (
          <li className="flex gap-3 px-4 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600/[0.08] text-brand-600 dark:bg-brand-400/15 dark:text-brand-400" aria-hidden>
              <Megaphone size={16} />
            </span>
            <p className="line-clamp-3 min-w-0 text-[15px] leading-[22px] text-ink/90 sm:text-sm">
              <span className="sr-only">Commissioner message: </span>
              {data.commissionerMessage}
            </p>
          </li>
        )}
        {data.announcements.map((a) => (
          <li key={a.id}>
            <Link href="/league" className="flex gap-3 px-4 py-3 transition-colors hover:bg-sunken/70">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken text-muted" aria-hidden>
                <Pin size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{a.title}</span>
                <span className="mt-0.5 line-clamp-1 text-[13px] leading-[18px] text-muted">{previewText(a.body, 160)}</span>
                <span className="block text-[12px] leading-4 text-muted" suppressHydrationWarning>
                  {a.author ? `${a.author} · ` : ""}
                  {timeAgo(a.createdAt)}
                </span>
              </span>
              <ChevronRight size={16} className="mt-2 shrink-0 text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
