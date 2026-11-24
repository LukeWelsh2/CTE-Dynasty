// Upcoming schedule: my next opponents (record, rank, points-for rank) and key league dates from settings.
import Link from "next/link";
import { ArrowLeftRight, CalendarDays, Clock, Gavel, Hourglass, ListChecks, ShieldCheck, Trophy, Users, Wallet } from "lucide-react";
import { Badge, Panel, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { cn, ordinal } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
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
  const past = k.status === "past";
  const body = (
    <div className={cn("flex min-h-[52px] items-center gap-3 px-4 py-2", k.href && "transition-colors hover:bg-sunken/70")}>
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", k.status === "live" ? "bg-live text-white" : past ? "bg-sunken text-faint" : "bg-sunken text-ink/70")}>
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[15px] font-semibold leading-5 sm:text-sm", past ? "text-muted" : "text-ink")}>{k.label}</div>
        {k.detail && <div className="truncate text-[13px] leading-[18px] text-muted">{k.detail}</div>}
      </div>
      <div className="shrink-0 text-right">
        {when && (
          <div className={cn("numeral text-[13px] font-semibold leading-[18px]", past ? "text-muted" : "text-ink")} suppressHydrationWarning>
            {when}
          </div>
        )}
        {k.status === "live" ? (
          <div className="text-[12px] font-bold uppercase leading-4 text-live">Now</div>
        ) : k.status === "upcoming" && k.at ? (
          <div className={cn("text-[12px] leading-4", soon ? "font-semibold text-brand-600 dark:text-brand-400" : "text-muted")} suppressHydrationWarning>
            {countdownLabel(k.at, now)}
          </div>
        ) : past ? (
          <div className="text-[12px] leading-4 text-muted">Passed</div>
        ) : null}
      </div>
    </div>
  );
  return <li>{k.href ? <Link href={k.href}>{body}</Link> : body}</li>;
}

/** Next opponents (record · place · PF rank) and key league dates — three dates shown, the rest behind "Show more". */
export function Upcoming({ data, now, className }: { data: UpcomingData; now: Date; className?: string }) {
  const tz = data.timezone;
  return (
    <Panel
      title="Upcoming"
      info={<p>Times are shown in the league timezone ({tzAbbrev(tz, now) || tz}). Deadlines and draft dates come from the league settings.</p>}
      className={className}
      noPad
      actions={<MoreLink href="/schedule">Schedule</MoreLink>}
    >
      {data.hasTeam && (
        <>
          <h3 className="eyebrow border-t border-line/70 px-4 pb-1 pt-3">Next opponents</h3>
          {data.opponents.length ? (
            <ul className="divide-y divide-line/70">
              {data.opponents.map((o) => (
                <li key={o.matchupId}>
                  <Link href={`/scoring/${o.matchupId}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70">
                    <span className="w-8 shrink-0 text-center leading-none">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">Wk</span>
                      <span className="numeral text-[17px] font-bold text-ink">{o.week}</span>
                    </span>
                    {o.team ? (
                      <>
                        <TeamLogo team={o.team} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{o.team.name}</span>
                          <span className="numeral block truncate text-[13px] leading-[18px] text-muted">
                            {o.record ?? "0-0"}
                            {o.rank ? ` · ${ordinal(o.rank)}` : ""}
                            {o.pfRank ? ` · ${ordinal(o.pfRank)} in PF` : ""}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="flex-1 text-[15px] font-semibold text-muted">{o.isPlayoff ? "Playoff bye" : "Bye week"}</span>
                    )}
                    {o.label && (
                      <Badge tone="neutral" className="shrink-0">
                        {o.label}
                      </Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-3 text-[13px] text-muted">No more scheduled matchups. Playoff games appear once the bracket is seeded.</p>
          )}
        </>
      )}
      <h3 className="eyebrow border-t border-line/70 px-4 pb-1 pt-3">Key dates</h3>
      {data.keyDates.length ? (
        <ShowMore as="ul" initial={3} className="divide-y divide-line/70">
          {data.keyDates.slice(0, 7).map((k) => (
            <KeyDateRow key={k.key} k={k} timezone={tz} now={now} />
          ))}
        </ShowMore>
      ) : (
        <div className="px-4 pb-4">
          <PanelEmpty>No upcoming deadlines.</PanelEmpty>
        </div>
      )}
    </Panel>
  );
}
