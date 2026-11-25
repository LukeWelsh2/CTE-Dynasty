// Commissioner home — "What needs my attention as commissioner?" (docs/DESIGN.md page anatomy).
// Summary strip (to-dos · week · teams · settings version) → the to-do list (each row links to the tool that fixes
// it) → shortcut tiles → this week's lineup problems (phones: tap a team for its injured / bye starters) →
// deadlines and the action log, both truncated. Policy wording lives in the ⓘ sheets.
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Megaphone,
  PlayCircle,
  Settings2,
  ShieldAlert,
  Sigma,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { requireCommissioner } from "@/lib/league";
import { Badge, PageHeader, Panel, SeeAll, SummaryStrip } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { auditDetail, auditLabel, loadDashboard } from "@/lib/commissioner/dashboard";
import { LUXURY_TAX_PAID_AS } from "@/lib/commissioner/roster-logic";
import { upcomingDeadlines } from "@/lib/commissioner/deadlines";
import { fmtDateTime } from "@/lib/commissioner/time";
import { cn, fmtMoney, timeAgo } from "@/lib/utils";

export const metadata = { title: "Commissioner" };

const PHASE_LABEL: Record<string, string> = { PRESEASON: "Preseason", REGULAR: "Regular season", PLAYOFFS: "Playoffs", OFFSEASON: "Offseason", KEEPER: "Keeper window" };

// What each league rule actually does today (same wording as the rulebook, @/lib/commissioner/rulebook): the site
// applies ZERO_POINTS (scoreboard) and DUES luxury tax (dues ledger); everything else is the commissioner's to apply.
const ILLEGAL_POLICY: Record<string, string> = {
  BLOCK_MOVES: "Other moves aren't blocked automatically: fix the roster or resolve it with the manager.",
  ZERO_POINTS: "League rule: a team over a limit while a week is being played scores zero that week.",
  COMMISSIONER: "League rule: the commissioner resolves illegal rosters.",
};
const FLOOR_PENALTY: Record<string, string> = {
  NONE: "",
  CHARGE_DIFFERENCE: " The commissioner charges the shortfall as dead money.",
  FORFEIT_PICK: " Teams under the floor forfeit a draft pick (applied by the commissioner).",
};

const TONE_ICON = { red: "bg-red-500/10 text-loss dark:bg-red-400/15", amber: "bg-amber-400/15 text-amber-700 dark:text-amber-300", blue: "bg-brand-600/[0.08] text-brand-600 dark:bg-brand-400/15 dark:text-brand-400" } as const;

/** One to-do: the whole row links to the tool that resolves it. */
function AlertItem({ tone, icon, title, children, href, cta }: { tone: keyof typeof TONE_ICON; icon: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; href: string; cta: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-[56px] items-start gap-3 px-4 py-3 transition-colors hover:bg-sunken/70 active:bg-sunken">
        <span className={cn("mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-full", TONE_ICON[tone])} aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-5 text-ink sm:text-sm">{title}</span>
          {children && <span className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-muted">{children}</span>}
        </span>
        <span className="mt-1.5 inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[13px] font-semibold text-brand-600 dark:text-brand-400">
          {cta}
          <ChevronRight size={14} aria-hidden />
        </span>
      </Link>
    </li>
  );
}

// shortcut tiles: short labels (full name in the tooltip / accessible name)
const QUICK = [
  { href: "/commissioner/settings", label: "Settings", full: "League settings", icon: Settings2 },
  { href: "/commissioner/settings/scoring", label: "Scoring", full: "Scoring rules", icon: Sigma },
  { href: "/commissioner/members#invite", label: "Invite", full: "Invite a manager", icon: UserPlus },
  { href: "/commissioner/rosters", label: "Add / drop", full: "Add or drop a player for a team", icon: Users },
  { href: "/commissioner/trades", label: "Trades", full: "Review trades", icon: ArrowLeftRight },
  { href: "/commissioner/schedule#adjust", label: "Scores", full: "Score adjustment", icon: CalendarDays },
  { href: "/commissioner/system#announce", label: "Announce", full: "Post an announcement", icon: Megaphone },
  { href: "/commissioner/system#jobs", label: "Run a job", full: "Run a background job", icon: PlayCircle },
];

export default async function CommissionerHomePage() {
  const ctx = await requireCommissioner();
  const { league, settings, week } = ctx;
  const tz = settings.general.timezone;
  const d = await loadDashboard(ctx);
  // niche.minimumStartersOrForfeit only decides regular season games (the dashboard flags only those)
  const forfeits = d.lineupAlerts.filter((l) => l.forfeitRisk);
  const alertCount =
    (d.tradesAwaiting ? 1 : 0) +
    d.teamAlerts.length +
    d.underFloor.length +
    (d.overSoftCap.length ? 1 : 0) +
    (d.unclaimedTeams.length ? 1 : 0) +
    d.failedJobs.length +
    (d.unpaidDues.length ? 1 : 0) +
    (d.lineupAlerts.some((l) => l.empty) ? 1 : 0) +
    (forfeits.length ? 1 : 0);
  const deadlines = upcomingDeadlines(settings, { now: new Date(), week });
  const phase = PHASE_LABEL[league.phase] ?? league.phase;
  const inSeason = league.phase === "REGULAR" || league.phase === "PLAYOFFS";

  const attention = (
    <Panel
      id="attention"
      title="Needs attention"
      subtitle={alertCount ? `${alertCount} item${alertCount === 1 ? "" : "s"}` : "Nothing waiting on you"}
      info={
        <>
          <p>Every row opens the tool that fixes it.</p>
          <p>
            <b>Illegal rosters.</b> {ILLEGAL_POLICY[settings.roster.illegalRosterPolicy]}
          </p>
          {settings.salaryCap.enabled && settings.salaryCap.floor > 0 && (
            <p>
              <b>Salary floor.</b> Teams must carry at least {fmtMoney(settings.salaryCap.floor)}.{FLOOR_PENALTY[settings.salaryCap.floorPenalty]}
            </p>
          )}
          {settings.salaryCap.enabled && settings.salaryCap.capType === "SOFT" && (
            <p>
              <b>Soft cap.</b>{" "}
              {settings.salaryCap.luxuryTaxRate > 0 ? `Luxury tax is ${settings.salaryCap.luxuryTaxRate}× the overage, ${LUXURY_TAX_PAID_AS[settings.salaryCap.luxuryTaxPaidAs]}.` : "The luxury tax rate is 0, so overages cost nothing."}
            </p>
          )}
        </>
      }
      noPad
    >
      {alertCount === 0 && d.lineupAlerts.length === 0 ? (
        <div className="flex items-center gap-3 border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">
          <CheckCircle2 className="shrink-0 text-win" size={22} aria-hidden /> All clear: trades, rosters, cap and jobs are fine.
        </div>
      ) : alertCount === 0 ? (
        <div className="flex items-center gap-3 border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">
          <CheckCircle2 className="shrink-0 text-win" size={22} aria-hidden /> Nothing to fix. Lineup notes are below.
        </div>
      ) : (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {d.tradesAwaiting > 0 && (
            <AlertItem tone="red" icon={<ArrowLeftRight size={16} />} title={`${d.tradesAwaiting} trade${d.tradesAwaiting === 1 ? "" : "s"} to review`} href="/commissioner/trades" cta="Review">
              Accepted by every team; they process once you approve.
            </AlertItem>
          )}
          {d.tradesVoting > 0 && <AlertItem tone="blue" icon={<ArrowLeftRight size={16} />} title={`${d.tradesVoting} trade${d.tradesVoting === 1 ? "" : "s"} in the league vote`} href="/commissioner/trades" cta="View" />}
          {d.teamAlerts.map((t) => (
            <AlertItem key={t.teamId} tone="red" icon={<ShieldAlert size={16} />} title={`${t.team}: illegal roster`} href={`/commissioner/rosters?team=${t.teamId}`} cta="Fix">
              {t.problems.join(" ")}
              {settings.salaryCap.enabled ? ` Cap: ${fmtMoney(t.committed)} committed (${fmtMoney(t.space)} space).` : ""}
            </AlertItem>
          ))}
          {d.underFloor.map((t) => (
            <AlertItem key={t.abbrev} tone="amber" icon={<DollarSign size={16} />} title={`${t.team} is under the ${fmtMoney(settings.salaryCap.floor)} floor`} href="/commissioner/rosters" cta="Rosters">
              {fmtMoney(t.committed)} committed.{FLOOR_PENALTY[settings.salaryCap.floorPenalty]}
            </AlertItem>
          ))}
          {d.overSoftCap.length > 0 && (
            <AlertItem
              tone="amber"
              icon={<DollarSign size={16} />}
              title={`${d.overSoftCap.length} team${d.overSoftCap.length === 1 ? " is" : "s are"} over the ${fmtMoney(settings.salaryCap.cap)} soft cap`}
              href="/commissioner/rosters"
              cta="Rosters"
            >
              {d.overSoftCap.map((t) => `${t.abbrev} +${fmtMoney(t.over)}${t.tax ? ` (tax ${fmtMoney(t.tax)})` : ""}`).join(", ")}
            </AlertItem>
          )}
          {forfeits.length > 0 && (
            <AlertItem tone="red" icon={<AlertTriangle size={16} />} title={`${forfeits.length} team${forfeits.length === 1 ? "" : "s"} below the ${settings.niche.minimumStartersOrForfeit}-starter minimum`} href="#lineups" cta="Details">
              Would forfeit Week {week} as set: {forfeits.map((l) => `${l.abbrev} (${l.playing} playing)`).join(", ")}
            </AlertItem>
          )}
          {d.lineupAlerts.some((l) => l.empty) && (
            <AlertItem tone="amber" icon={<AlertTriangle size={16} />} title={`Empty starting slots in Week ${week}`} href="#lineups" cta="Details">
              {d.lineupAlerts
                .filter((l) => l.empty)
                .map((l) => `${l.abbrev} (${l.empty})`)
                .join(", ")}
            </AlertItem>
          )}
          {d.unclaimedTeams.length > 0 && (
            <AlertItem tone="amber" icon={<UserPlus size={16} />} title={`${d.unclaimedTeams.length} team${d.unclaimedTeams.length === 1 ? " has" : "s have"} no manager`} href="/commissioner/members" cta="Invite">
              {d.unclaimedTeams.map((t) => t.name).join(", ")} · {d.openInvites} open invite{d.openInvites === 1 ? "" : "s"}
            </AlertItem>
          )}
          {d.failedJobs.map((j) => (
            <AlertItem key={j.name} tone="red" icon={<XCircle size={16} />} title={`Job “${j.name}” failed ${j.count}× in 24h`} href="/commissioner/system#jobs" cta="System">
              Last failure {timeAgo(j.lastAt)}
              {j.message ? `: ${j.message.slice(0, 160)}` : ""}
            </AlertItem>
          ))}
          {d.unpaidDues.length > 0 && (
            <AlertItem tone="blue" icon={<DollarSign size={16} />} title={`${d.unpaidDues.length} team${d.unpaidDues.length === 1 ? "" : "s"} owe ${fmtMoney(settings.general.leagueDues)} dues`} href="/commissioner/members#dues" cta="Dues">
              {settings.general.duesDueDate ? `Due ${fmtDateTime(settings.general.duesDueDate, tz, { dateOnly: true })} · ` : ""}
              {d.unpaidDues.map((t) => t.name).join(", ")}
            </AlertItem>
          )}
        </ul>
      )}
    </Panel>
  );

  const quick = (
    <Panel title="Shortcuts" noPad>
      <ul className="grid grid-cols-4 gap-2 px-3 pb-3">
        {QUICK.map((q) => {
          const Icon = q.icon;
          return (
            <li key={q.href}>
              <Link
                href={q.href}
                title={q.full}
                aria-label={q.full}
                className="flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl bg-sunken px-1 text-center text-[12px] font-semibold leading-tight text-ink transition-colors hover:bg-ink/[0.07] active:scale-[0.98] dark:hover:bg-white/[0.08]"
              >
                <Icon size={20} className="shrink-0 text-ink/80" aria-hidden />
                <span className="w-full truncate">{q.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {d.pendingClaims > 0 && (
        <Link href="/waivers" className="flex min-h-11 items-center justify-between gap-2 border-t border-line/70 px-4 text-[13px] text-muted hover:bg-sunken/70">
          <span>
            <b className="numeral text-ink">{d.pendingClaims}</b> pending waiver claim{d.pendingClaims === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-0.5 font-semibold text-brand-600 dark:text-brand-400">
            Waivers <ChevronRight size={14} aria-hidden />
          </span>
        </Link>
      )}
    </Panel>
  );

  const lineups = inSeason ? (
    <Panel id="lineups" title={`Week ${week} lineups`} subtitle={d.lineupAlerts.length ? `${d.lineupAlerts.length} team${d.lineupAlerts.length === 1 ? "" : "s"} with notes` : undefined} info={<p>Teams with an empty starting slot, a starter ruled out, or a starter on a bye week.</p>} noPad>
      {d.lineupAlerts.length ? (
        <>
          {/* phones: one row per team, tap for the injured / bye starters */}
          <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
            {d.lineupAlerts.map((l) => (
              <li key={l.teamId}>
                <details className="group">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[15px] font-semibold text-ink" title={l.team}>
                          {l.team}
                        </span>
                        {l.forfeitRisk && <Badge tone="red">Forfeit risk</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted">
                        {[l.out.length ? `${l.out.length} out` : null, l.bye.length ? `${l.bye.length} on bye` : null].filter(Boolean).join(" · ") || "Lineup notes"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("numeral block text-[15px] font-semibold leading-5", l.empty ? "text-loss" : "text-ink")}>{l.empty}</span>
                      <span className="block text-[12px] leading-4 text-muted">empty</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("numeral block text-[15px] font-semibold leading-5", l.forfeitRisk ? "text-loss" : "text-ink")}>{l.playing}</span>
                      <span className="block text-[12px] leading-4 text-muted">playing</span>
                    </span>
                    <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="space-y-1.5 bg-sunken px-4 py-3 text-[13px]">
                    <p>
                      <span className="eyebrow mr-1.5">Out</span>
                      {l.out.join(", ") || <span className="text-muted">None</span>}
                    </p>
                    <p>
                      <span className="eyebrow mr-1.5">Bye</span>
                      {l.bye.join(", ") || <span className="text-muted">None</span>}
                    </p>
                    <Link href={`/teams/${l.teamId}`} className="link inline-flex min-h-8 items-center">
                      Team page
                    </Link>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border-t border-line/70 md:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="num">Empty</th>
                  <th className="num" title="Starters expected to play">
                    Playing
                  </th>
                  <th>Injured starters</th>
                  <th>Bye-week starters</th>
                </tr>
              </thead>
              <tbody>
                {d.lineupAlerts.map((l) => (
                  <tr key={l.teamId}>
                    <td className="whitespace-nowrap font-semibold">
                      <Link href={`/teams/${l.teamId}`} className="hover:underline">
                        {l.team}
                      </Link>
                      {l.forfeitRisk && (
                        <Badge tone="red" className="ml-1.5">
                          Forfeit risk
                        </Badge>
                      )}
                    </td>
                    <td className={cn("num", l.empty && "font-bold text-loss")}>{l.empty}</td>
                    <td className={cn("num", l.forfeitRisk && "font-bold text-loss")}>{l.playing}</td>
                    <td className="text-[13px]">{l.out.join(", ") || <span className="text-muted">—</span>}</td>
                    <td className="text-[13px]">{l.bye.join(", ") || <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">Every lineup is full and healthy.</p>
      )}
    </Panel>
  ) : null;

  const deadlinesPanel = (
    <Panel title="Deadlines" info={<p>Dates and special weeks from the league settings. A week shown in red is this week.</p>} noPad>
      {deadlines.length ? (
        <ShowMore as="ul" initial={4} className="divide-y divide-line/70 border-t border-line/70">
          {deadlines.map((x) => (
            <li key={x.key}>
              <Link href={x.href} className="flex min-h-[52px] items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70">
                <CalendarClock size={18} className={cn("shrink-0", x.passed ? "text-faint" : "text-brand-600 dark:text-brand-400")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{x.label}</span>
                  {x.detail && <span className="block truncate text-[13px] leading-[18px] text-muted">{x.detail}</span>}
                </span>
                <span className={cn("numeral shrink-0 text-[13px] font-semibold", x.passed ? "text-muted line-through" : x.week === week ? "text-loss" : "text-ink")}>
                  {x.week !== null ? (x.week === week ? `This week` : `Week ${x.week}`) : fmtDateTime(x.at, tz, { dateOnly: true })}
                </span>
              </Link>
            </li>
          ))}
        </ShowMore>
      ) : (
        <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">
          No dates set.{" "}
          <Link href="/commissioner/settings" className="link">
            Add them in Settings
          </Link>
        </p>
      )}
    </Panel>
  );

  const activity = (
    <Panel title="Recent actions" actions={<Badge tone="neutral">{settings.commissioner.auditLogVisibleToLeague ? "Public" : "Private"}</Badge>} info={<p>Every commissioner override is logged. When the log is public, recent actions also appear in the rulebook.</p>} noPad>
      {d.audit.length ? (
        <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
          {d.audit.map((a) => (
            <li key={a.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{auditLabel(a.action)}</span>
                <span className="block truncate text-[13px] leading-[18px] text-muted">
                  {a.actor ?? "System"}
                  {auditDetail(a.details) ? ` · ${auditDetail(a.details)}` : ""}
                </span>
              </span>
              <span className="numeral shrink-0 text-[12px] text-muted" title={fmtDateTime(a.createdAt, tz)}>
                {timeAgo(a.createdAt)}
              </span>
            </li>
          ))}
        </ShowMore>
      ) : (
        <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">No commissioner actions yet.</p>
      )}
      <SeeAll href="/commissioner/system#audit">Full action log</SeeAll>
    </Panel>
  );

  return (
    <div>
      <PageHeader title="Commissioner" subtitle={`${league.name} · ${phase}`} />
      <SummaryStrip
        className="mb-4"
        items={[
          { label: "To do", value: alertCount, tone: alertCount ? "bad" : "good", sub: alertCount ? "items" : "all clear", href: "#attention" },
          { label: "Week", value: week, sub: league.weekOverride ? "pinned" : phase === "Regular season" ? "regular" : phase.toLowerCase(), href: "/commissioner/season", title: league.weekOverride ? "Pinned by the commissioner" : "Following the NFL calendar" },
          {
            label: "Teams",
            value: d.unclaimedTeams.length ? `${d.teamCount - d.unclaimedTeams.length}/${d.teamCount}` : d.teamCount,
            sub: d.unclaimedTeams.length ? `${d.unclaimedTeams.length} open` : `${d.openInvites} invite${d.openInvites === 1 ? "" : "s"}`,
            href: "/commissioner/members",
            title: `${d.teamCount} teams · ${d.memberCount} managers · ${d.openInvites} open invite${d.openInvites === 1 ? "" : "s"}`,
          },
          {
            label: "Settings",
            value: `v${league.settingsVersion}`,
            sub: d.latestSettings ? timeAgo(d.latestSettings.createdAt) : "original",
            href: "/commissioner/settings?tab=history",
            title: d.latestSettings ? `Changed ${timeAgo(d.latestSettings.createdAt)}${d.latestSettings.by ? ` by ${d.latestSettings.by}` : ""}` : "Original settings",
          },
        ]}
      />

      {/* phones: one column in priority order; lg: main column + rail */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-4">
          <div className="order-1">{attention}</div>
          {lineups && <div className="order-3">{lineups}</div>}
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-2">{quick}</div>
          <div className="order-4">{deadlinesPanel}</div>
          <div className="order-5">{activity}</div>
        </div>
      </div>
    </div>
  );
}
