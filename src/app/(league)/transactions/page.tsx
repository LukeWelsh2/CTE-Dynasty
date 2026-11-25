// Transactions — "What moves has the league made?"
// Type chips + team / season / week / player filters (behind "Filters" on phones), the count line, then the log as
// one list grouped by day: each entry = team logo · team · what happened (type, player with position + NFL team,
// money chips) · one grey note line · time. Trades are one entry with what each side received.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Download } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, ButtonLink, EmptyState, PageHeader, TeamLogo, buttonClass } from "@/components/ui/core";
import { InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { MoneyChip, TxNav } from "@/components/waivers/bits";
import { LiveRefresh } from "@/components/waivers/countdown";
import { TxFilters } from "@/components/waivers/tx-filters";
import { parseTxQuery, queryTransactions, txFilterOptions, type LogEntry, type LogRow, type TxQuery } from "@/lib/waivers/transactions";
import { TX_FILTERS, describeTransactionType, txTone } from "@/lib/waivers/tx-logic";
import { fmtTime } from "@/lib/waivers/format";
import { bidVisible } from "@/lib/waivers/logic";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Transactions" };

type SP = { type?: string; team?: string; season?: string; week?: string; q?: string; page?: string };

function qs(q: TxQuery, page: number, base = "/transactions", defaultSeason?: number) {
  const p = new URLSearchParams();
  if (q.type !== "all") p.set("type", q.type);
  if (q.teamId) p.set("team", q.teamId);
  if (q.season === null) p.set("season", "all");
  else if (q.season !== defaultSeason) p.set("season", String(q.season));
  if (q.week !== null) p.set("week", String(q.week));
  if (q.q) p.set("q", q.q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

function weekLabel(w: number) {
  return w === 0 ? "Preseason" : `Week ${w}`;
}

/** v3: gold is for trophies only — draft / auction rows read purple. */
function typeTone(type: string) {
  const t = txTone(type);
  return t === "gold" ? "purple" : t;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam } = ctx;
  const tz = settings.general.timezone;
  const q = parseTxQuery(sp, { season: league.season });
  const [teams, opts, result] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    txFilterOptions(league.id),
    queryTransactions(league.id, q),
  ]);
  const seasons = [...new Set([league.season, ...opts.seasons])].sort((a, b) => b - a);
  const filtered = q.type !== "all" || q.teamId || q.week !== null || q.q || q.season !== league.season;
  const teamName = q.teamId ? teams.find((t) => t.id === q.teamId)?.name : null;
  const reveal = (teamId: string | null | undefined, won: boolean) => bidVisible(settings, { teamId: teamId ?? "", won }, { teamId: myTeam?.id ?? null, isCommish: ctx.isCommish });

  // day separators
  const dayKey = (d: Date) => d.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const groups: { day: string; entries: LogEntry[] }[] = [];
  for (const e of result.entries) {
    const k = dayKey(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === k) last.entries.push(e);
    else groups.push({ day: k, entries: [e] });
  }

  return (
    <div>
      <LiveRefresh leagueId={league.id} types={["transaction", "waivers.processed", "season.rollover"]} />
      <PageHeader
        title="Transactions"
        actions={
          <a href={qs(q, 1, "/transactions/export", league.season)} className={buttonClass("secondary", "md")} download>
            <Download size={15} /> CSV
          </a>
        }
      />
      <TxNav active="log" />

      <TxFilters
        key={`${q.type}|${q.teamId ?? ""}|${q.season ?? "all"}|${q.week ?? ""}|${q.q}`}
        options={{
          types: TX_FILTERS.map((f) => ({ value: f.key, label: f.label })),
          teams: [{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))],
          seasons: [...seasons.map((s) => ({ value: String(s), label: String(s) })), { value: "all", label: "All seasons" }],
          weeks: [{ value: "", label: "All weeks" }, ...Array.from(new Set([0, ...opts.weeks, ctx.week])).sort((a, b) => a - b).map((w) => ({ value: String(w), label: weekLabel(w) }))],
        }}
        values={{ type: q.type, team: q.teamId ?? "", season: q.season === null ? "all" : String(q.season), week: q.week === null ? "" : String(q.week), q: q.q }}
        defaultSeason={String(league.season)}
      />

      <div className="mb-2 mt-3 flex min-h-8 items-center justify-between gap-3 px-1 text-[13px] text-muted">
        <span className="min-w-0 truncate">
          {result.total} {result.total === 1 ? "entry" : "entries"}
          {teamName ? ` · ${teamName}` : ""}
          {q.season !== null ? ` · ${q.season}` : " · all seasons"}
          {result.truncated ? " · most recent" : ""}
        </span>
        {filtered && (
          <Link href="/transactions" className="-my-1 inline-flex min-h-8 shrink-0 items-center font-semibold text-brand-600 dark:text-brand-400">
            Reset
          </Link>
        )}
      </div>

      {result.entries.length ? (
        <div className="card overflow-clip">
          {groups.map((g, gi) => (
            <section key={g.day}>
              <h2 className={cn("sticky top-0 z-10 flex min-h-9 items-center bg-sunken px-4 py-1.5 text-[13px] font-semibold text-ink", gi > 0 && "border-t border-line/70")}>{g.day}</h2>
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {g.entries.map((e) => {
                  const mine = !!myTeam && (e.team?.id === myTeam.id || !!e.trade?.sides.some((s) => s.team.id === myTeam.id));
                  return (
                    <li key={e.key} className={cn("flex gap-3 px-4 py-3", mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}>
                      <EntryLogo entry={e} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <EntryTeam entry={e} mine={mine} />
                          <span className="numeral shrink-0 text-[12px] text-muted" title={`${e.season} · ${weekLabel(e.week)}`}>
                            {fmtTime(e.at, tz)}
                            {" · "}
                            {e.week === 0 ? "Pre" : `Wk ${e.week}`}
                          </span>
                        </div>
                        <div className="mt-1">{e.kind === "trade" && e.trade ? <TradeEntry entry={e} myTeamId={myTeam?.id ?? null} /> : <SingleEntry entry={e} fab={settings.waivers.type === "FAB"} reveal={reveal} />}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState title="No transactions for this period">{filtered ? "Nothing matches these filters." : `No moves in ${league.season} yet.`}</EmptyState>
      )}

      {result.pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Pages">
          {result.page > 1 && (
            <ButtonLink href={qs(q, result.page - 1, "/transactions", league.season)} variant="secondary">
              Newer
            </ButtonLink>
          )}
          <span className="text-[13px] text-muted">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages && (
            <ButtonLink href={qs(q, result.page + 1, "/transactions", league.season)} variant="secondary">
              Older
            </ButtonLink>
          )}
        </nav>
      )}
    </div>
  );
}

function EntryLogo({ entry }: { entry: LogEntry }) {
  if (entry.kind === "trade" && entry.trade) {
    const [a, b] = entry.trade.sides;
    return (
      <span className="relative mt-0.5 h-9 w-9 shrink-0" aria-hidden>
        {a && <TeamLogo team={a.team} size={26} className="absolute left-0 top-0" />}
        {b && <TeamLogo team={b.team} size={26} className="absolute bottom-0 right-0 ring-2 ring-panel" />}
      </span>
    );
  }
  if (!entry.team) return <span className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-sunken" aria-hidden />;
  return <TeamLogo team={entry.team} size={36} className="mt-0.5" />;
}

function EntryTeam({ entry, mine }: { entry: LogEntry; mine: boolean }) {
  const cls = cn("min-w-0 truncate text-[15px] font-semibold leading-5", mine ? "text-brand-600 dark:text-brand-400" : "text-ink");
  if (entry.kind === "trade" && entry.trade) {
    return (
      <span className={cls} title={entry.trade.sides.map((s) => s.team.name).join(" ⇄ ")}>
        {entry.trade.sides.map((s) => s.team.abbrev).join(" ⇄ ")}
      </span>
    );
  }
  if (!entry.team) return <span className="text-[15px] font-semibold text-muted">League</span>;
  return (
    <Link href={`/teams/${entry.team.id}`} title={entry.team.name} className={cn(cls, "hover:underline")}>
      {entry.team.name}
    </Link>
  );
}

type Reveal = (teamId: string | null | undefined, won: boolean) => boolean;

function PlayerName({ p }: { p: NonNullable<LogRow["player"]> }) {
  return (
    <Link href={`/players/${p.id}`} title={p.fullName} className="min-w-0 truncate font-semibold text-ink hover:underline">
      {p.fullName}
    </Link>
  );
}

function RowLine({ row, fab, reveal }: { row: LogRow; fab: boolean; reveal: Reveal }) {
  const dead = row.type === "DROP" && Array.isArray(row.details.deadMoney) ? deadNow(row.details.deadMoney) : 0;
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-5">
        <Badge tone={typeTone(row.type)}>{describeTransactionType(row.type)}</Badge>
        {row.player && (
          <span className="flex min-w-0 max-w-full items-center gap-1.5">
            <PosPill pos={row.player.position} />
            <PlayerName p={row.player} />
            <span className="shrink-0 text-[13px] text-muted">{row.player.position === "DEF" ? "" : (row.player.team ?? "FA")}</span>
            <InjuryLetter status={row.player.injuryStatus} className="text-[12px]" />
          </span>
        )}
        {fab && row.faabAmount !== null && row.type === "WAIVER" && reveal(row.team?.id, true) && <MoneyChip amount={row.faabAmount} kind="fab" />}
        {row.salary !== null && row.type !== "DROP" && row.type !== "TRADE" && <MoneyChip amount={row.salary} kind="salary" />}
        {dead > 0 && <MoneyChip amount={dead} kind="dead" />}
      </div>
      {row.description && <p className="mt-1 line-clamp-2 text-[13px] leading-[18px] text-muted">{row.description}</p>}
    </div>
  );
}

function deadNow(entries: unknown[]): number {
  const list = entries as { season: number; amount: number }[];
  if (!list.length) return 0;
  const first = Math.min(...list.map((d) => d.season));
  return list.filter((d) => d.season === first).reduce((a, d) => a + d.amount, 0);
}

function SingleEntry({ entry, fab, reveal }: { entry: LogEntry; fab: boolean; reveal: Reveal }) {
  return (
    <div className="space-y-2">
      {entry.rows.map((r) => (
        <RowLine key={r.id} row={r} fab={fab} reveal={reveal} />
      ))}
      {entry.declaredDrop && (
        <div className="flex min-w-0 items-center gap-1.5 text-[14px]">
          <Badge tone="red">Drop</Badge>
          <PosPill pos={entry.declaredDrop.position} />
          <PlayerName p={entry.declaredDrop} />
        </div>
      )}
      {entry.waiver && (entry.waiver.competing.length > 0 || entry.waiver.priority) && (
        <p className="text-[13px] leading-[18px] text-muted">
          {entry.waiver.priority ? <>Waiver priority #{entry.waiver.priority}. </> : null}
          {entry.waiver.tiebreak ? "Won on the tiebreaker. " : null}
          {entry.waiver.competing.length > 0 && (
            <>
              Other {fab ? "bids" : "claims"}:{" "}
              {entry.waiver.competing.map((c, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <span className="font-medium text-ink">{c.team?.name ?? "Unknown team"}</span>
                  {fab && reveal(c.team?.id, false) && <span className="numeral"> ${c.bid}</span>}
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function TradeEntry({ entry, myTeamId }: { entry: LogEntry; myTeamId: string | null }) {
  const t = entry.trade!;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          <ArrowLeftRight size={11} aria-hidden /> Trade
        </Badge>
        {t.status !== "COMPLETED" && <Badge tone={t.status === "REVERSED" ? "purple" : "red"}>{t.status === "REVERSED" ? "Reversed" : t.status.toLowerCase()}</Badge>}
        <Link href={`/trades/${t.id}`} className="-my-1 inline-flex min-h-8 items-center text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
          View trade
        </Link>
      </div>
      <ul className={cn("mt-1.5 grid gap-1.5", t.sides.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {t.sides.map((s) => (
          <li key={s.team.id} className="min-w-0 rounded-lg bg-sunken px-3 py-2">
            <div className={cn("mb-1 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold", s.team.id === myTeamId ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
              <TeamLogo team={s.team} size={18} />
              <span className="truncate">{s.team.abbrev} receives</span>
            </div>
            {s.receives.length ? (
              <ul className="space-y-1 text-[14px] leading-5">
                {s.receives.map((a) => (
                  <li key={a.key} className="flex min-w-0 items-center gap-1.5">
                    {a.kind === "PLAYER" && a.player ? (
                      <>
                        <PosPill pos={a.player.position} />
                        <PlayerName p={a.player} />
                        <span className="shrink-0 text-[13px] text-muted">{a.player.team ?? "FA"}</span>
                        {a.salary !== null && <MoneyChip amount={a.salary} kind="salary" />}
                      </>
                    ) : a.kind === "FAAB" ? (
                      <span className="font-medium text-win">{a.label}</span>
                    ) : (
                      <span className="min-w-0 truncate font-medium text-ink" title={a.label}>
                        {a.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Nothing</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
