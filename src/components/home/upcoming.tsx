// Upcoming schedule: my next opponents (record, rank, points-for rank) and key league dates from settings.
import Link from "next/link";
import { ArrowLeftRight, CalendarDays, Clock, Gavel, Hourglass, ListChecks, ShieldCheck, Trophy, Users, Wallet } from "lucide-react";
import { Panel, TeamLogo } from "@/components/ui/core";
import { cn, ordinal } from "@/lib/utils";
import { MoreLink, PanelEmpty, SubHeading } from "./bits";
import { countdownLabel, formatWhen, tzAbbrev, type KeyDate } from "./logic";
import type { UpcomingData } from "./types";

const ICONS: Record<string, typeof Clock> = {
  waivers: Hourglass,
  "trade-deadline": ArrowLeftRight,
  "taxi-deadline": Users,
  playoffs: ListChecks,
  championship: Trophy,
  "rookie-draft": ListChecks,
  auction: Gavel,
  "keeper-window": ShieldCheck,
  "keeper-deadline": ShieldCheck,
  cutdown: Users,
  "cap-compliance": Wallet,
  dues: Wallet,
};

function KeyDateRow({ k, timezone, now }: { k: KeyDate; timezone: string; now: Date }) {
  const Icon = ICONS[k.key] ?? CalendarDays;
  const soon = k.status === "upcoming" && k.at && new Date(k.at).getTime() - now.getTime() < 48 * 3600_000;
  const when = k.at ? formatWhen(k.at, timezone, now, { time: k.key === "waivers" || k.key.includes("draft") || k.key === "auction" || !!soon }) : k.week ? `Week ${k.week}` : null;
  const body = (
    <div className={cn("flex items-start gap-2.5 rounded-md px-1.5 py-1.5", k.href && "hover:bg-sunken")}>
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
          k.status === "live" ? "bg-live text-white" : k.status === "past" ? "bg-sunken text-muted" : soon ? "bg-gold-500 text-brand-950" : "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200",
        )}
      >
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-semibold", k.status === "past" ? "text-muted" : "text-ink")}>{k.label}</div>
        {k.detail && <div className="truncate text-[11px] text-muted">{k.detail}</div>}
      </div>
      <div className="shrink-0 text-right">
        {when && (
          <div className={cn("text-xs font-semibold tabular-nums", k.status === "past" ? "text-muted" : "text-ink")} suppressHydrationWarning>
            {when}
          </div>
        )}
        {k.status === "live" ? (
          <div className="text-[10px] font-bold uppercase text-live">Now</div>
        ) : k.status === "upcoming" && k.at ? (
          <div className={cn("text-[10px] font-semibold", soon ? "text-gold-600 dark:text-gold-400" : "text-muted")} suppressHydrationWarning>
            {countdownLabel(k.at, now)}
          </div>
        ) : k.status === "past" ? (
          <div className="text-[10px] uppercase text-muted">Passed</div>
        ) : null}
      </div>
    </div>
  );
  return <li>{k.href ? <Link href={k.href}>{body}</Link> : body}</li>;
}

export function Upcoming({ data, now, className }: { data: UpcomingData; now: Date; className?: string }) {
  const tz = data.timezone;
  return (
    <Panel title="Upcoming" subtitle={`Times in ${tzAbbrev(tz, now) || tz}`} className={className} actions={<MoreLink href="/schedule">Schedule</MoreLink>}>
      {data.hasTeam && (
        <div className="mb-3">
          <SubHeading>Next opponents</SubHeading>
          {data.opponents.length ? (
            <ul className="divide-y divide-line/70">
              {data.opponents.map((o) => (
                <li key={o.matchupId}>
                  <Link href={`/scoring/${o.matchupId}`} className="flex items-center gap-2.5 px-1 py-1.5 hover:bg-sunken">
                    <span className="w-9 shrink-0 text-center">
                      <span className="block text-[9px] font-bold uppercase leading-none text-muted">Wk</span>
                      <span className="font-display text-lg font-extrabold leading-none text-ink">{o.week}</span>
                    </span>
                    {o.team ? (
                      <>
                        <TeamLogo team={o.team} size={26} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{o.team.name}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {o.record ?? "0-0"}
                            {o.rank ? ` · ${ordinal(o.rank)} place` : ""}
                            {o.pfRank ? ` · ${ordinal(o.pfRank)} in PF` : ""}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 text-sm font-semibold text-muted">{o.isPlayoff ? "Playoff bye" : "Bye week"}</span>
                    )}
                    {o.label && <span className="shrink-0 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{o.label}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 py-1.5 text-sm text-muted">No more scheduled matchups this season. Playoff games appear once the bracket is seeded.</p>
          )}
        </div>
      )}
      <SubHeading>Key dates</SubHeading>
      {data.keyDates.length ? (
        <ul className="-mx-1.5">
          {data.keyDates.slice(0, 7).map((k) => (
            <KeyDateRow key={k.key} k={k} timezone={tz} now={now} />
          ))}
        </ul>
      ) : (
        <PanelEmpty>No upcoming deadlines. The commissioner sets draft, keeper and auction dates in league settings.</PanelEmpty>
      )}
    </Panel>
  );
}
