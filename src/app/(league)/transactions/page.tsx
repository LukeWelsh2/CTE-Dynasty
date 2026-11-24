// Transaction log (CBS-style): every add, drop, waiver claim, trade, draft pick, keeper, contract and
// commissioner move — filter by type / team / season / week / player, trades grouped into one entry.
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Download } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Badge, ButtonLink, EmptyState, PageHeader, PlayerLink, TeamLogo, buttonClass } from "@/components/ui/core";
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
        kicker="Transactions"
        title="Transaction Log"
        subtitle="Adds, drops, waiver claims, trades, drafts, keepers and commissioner moves"
        actions={
          <a href={qs(q, 1, "/transactions/export", league.season)} className={buttonClass("secondary", "sm")} download>
            <Download size={14} /> Export CSV
          </a>
        }
      />
      <TxNav active="log" />

      <TxFilters
        options={{
          types: TX_FILTERS.map((f) => ({ value: f.key, label: f.label })),
          teams: [{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))],
          seasons: [...seasons.map((s) => ({ value: String(s), label: String(s) })), { value: "all", label: "All seasons" }],
          weeks: [{ value: "", label: "All weeks" }, ...Array.from(new Set([0, ...opts.weeks, ctx.week])).sort((a, b) => a - b).map((w) => ({ value: String(w), label: weekLabel(w) }))],
        }}
        values={{ type: q.type, team: q.teamId ?? "", season: q.season === null ? "all" : String(q.season), week: q.week === null ? "" : String(q.week), q: q.q }}
      />

      <div className="mb-2 mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {result.total} {result.total === 1 ? "entry" : "entries"}
          {teamName ? ` for ${teamName}` : ""}
          {q.season !== null ? ` in ${q.season}` : " across all seasons"}
          {result.truncated ? " (showing the most recent)" : ""}
        </span>
        {filtered && (
          <Link href="/transactions" className="link">
            Reset filters
          </Link>
        )}
      </div>

      {result.entries.length ? (
        <div className="overflow-clip rounded-lg border border-line bg-panel shadow-panel">
          <div className="sticky top-0 z-10 hidden grid-cols-[110px_minmax(160px,220px)_minmax(0,1fr)_86px] gap-3 border-b border-line bg-sunken px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted md:grid">
            <span>Time</span>
            <span>Team</span>
            <span>Activity</span>
            <span className="text-right">Effective</span>
          </div>
          {groups.map((g) => (
            <section key={g.day}>
              <h2 className="border-b border-line bg-brand-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white dark:bg-brand-950">{g.day}</h2>
              <ul className="divide-y divide-line/70">
                {g.entries.map((e) => (
                  <li key={e.key} className={cn("grid grid-cols-1 gap-x-3 gap-y-1.5 px-3 py-2.5 md:grid-cols-[110px_minmax(160px,220px)_minmax(0,1fr)_86px]", e.team?.id === myTeam?.id && "bg-gold-300/10")}>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted md:block">
                      <span className="tabular-nums">{fmtTime(e.at, tz)}</span>
                      <span className="md:hidden">
                        {e.season} · {weekLabel(e.week)}
                      </span>
                    </div>
                    <EntryTeam entry={e} />
                    <div className="min-w-0">{e.kind === "trade" && e.trade ? <TradeEntry entry={e} myTeamId={myTeam?.id ?? null} /> : <SingleEntry entry={e} fab={settings.waivers.type === "FAB"} reveal={reveal} />}</div>
                    <div className="hidden text-right text-xs text-muted md:block">
                      <div>{weekLabel(e.week)}</div>
                      <div>{e.season}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState title="No transactions for this period">
          {filtered ? "Nothing matches these filters — try another type, team or week." : `No moves have been made in ${league.season} yet.`}
        </EmptyState>
      )}

      {result.pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Pages">
          {result.page > 1 && (
            <ButtonLink href={qs(q, result.page - 1, "/transactions", league.season)} variant="secondary" size="sm">
              Newer
            </ButtonLink>
          )}
          <span className="text-xs text-muted">
            Page {result.page} of {result.pages}
          </span>
          {result.page < result.pages && (
            <ButtonLink href={qs(q, result.page + 1, "/transactions", league.season)} variant="secondary" size="sm">
              Older
            </ButtonLink>
          )}
        </nav>
      )}
    </div>
  );
}

function EntryTeam({ entry }: { entry: LogEntry }) {
  if (entry.kind === "trade" && entry.trade) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex -space-x-1.5">
          {entry.trade.sides.map((s) => (
            <TeamLogo key={s.team.id} team={s.team} size={24} className="ring-2 ring-panel" />
          ))}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold text-ink">{entry.trade.sides.map((s) => s.team.abbrev).join(" ⇄ ")}</span>
      </div>
    );
  }
  if (!entry.team) return <span className="text-sm text-muted">League</span>;
  return (
    <Link href={`/teams/${entry.team.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
      <TeamLogo team={entry.team} size={24} />
      <span className="truncate text-sm font-semibold text-ink">{entry.team.name}</span>
    </Link>
  );
}

type Reveal = (teamId: string | null | undefined, won: boolean) => boolean;

function RowLine({ row, fab, reveal }: { row: LogRow; fab: boolean; reveal: Reveal }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={txTone(row.type)}>{describeTransactionType(row.type)}</Badge>
        {row.player && <PlayerLink player={row.player} showMeta={false} />}
        {row.player && (
          <span className="text-[11px] text-muted">
            {row.player.position} · {row.player.team ?? "FA"}
          </span>
        )}
        {fab && row.faabAmount !== null && row.type === "WAIVER" && reveal(row.team?.id, true) && <MoneyChip amount={row.faabAmount} kind="fab" />}
        {row.salary !== null && row.type !== "DROP" && row.type !== "TRADE" && <MoneyChip amount={row.salary} kind="salary" />}
        {row.type === "DROP" && Array.isArray(row.details.deadMoney) && deadNow(row.details.deadMoney) > 0 && <MoneyChip amount={deadNow(row.details.deadMoney)} kind="dead" />}
      </div>
      <p className="mt-0.5 text-xs text-muted">{row.description}</p>
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
    <div className="space-y-1.5">
      {entry.rows.map((r) => (
        <RowLine key={r.id} row={r} fab={fab} reveal={reveal} />
      ))}
      {entry.declaredDrop && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="red">Drop</Badge>
          <PlayerLink player={entry.declaredDrop} showMeta={false} />
        </div>
      )}
      {entry.waiver && (entry.waiver.competing.length > 0 || entry.waiver.priority) && (
        <p className="text-[11px] text-muted">
          {entry.waiver.priority ? <>Waiver priority #{entry.waiver.priority}. </> : null}
          {entry.waiver.tiebreak ? "Won on the tiebreaker. " : null}
          {entry.waiver.competing.length > 0 && (
            <>
              Other {fab ? "bids" : "claims"}:{" "}
              {entry.waiver.competing.map((c, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <span className="font-medium text-ink">{c.team?.name ?? "Unknown team"}</span>
                  {fab && reveal(c.team?.id, false) && <span className="tabular-nums"> ${c.bid}</span>}
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
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          <ArrowLeftRight size={10} /> Trade
        </Badge>
        {t.status !== "COMPLETED" && <Badge tone={t.status === "REVERSED" ? "purple" : "red"}>{t.status === "REVERSED" ? "Reversed" : t.status.toLowerCase()}</Badge>}
        <Link href={`/trades/${t.id}`} className="link text-xs font-semibold">
          View trade
        </Link>
      </div>
      <div className={cn("grid gap-2", t.sides.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {t.sides.map((s) => (
          <div key={s.team.id} className={cn("rounded-md border border-line bg-sunken/50 px-2 py-1.5", s.team.id === myTeamId && "border-gold-400/60")}>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink">
              <TeamLogo team={s.team} size={16} />
              <span className="truncate">{s.team.name} receive</span>
            </div>
            {s.receives.length ? (
              <ul className="space-y-0.5 text-sm">
                {s.receives.map((a) => (
                  <li key={a.key} className="flex flex-wrap items-center gap-1.5">
                    {a.kind === "PLAYER" && a.player ? (
                      <>
                        <PlayerLink player={a.player} showMeta={false} />
                        <span className="text-[11px] text-muted">
                          {a.player.position} · {a.player.team ?? "FA"}
                        </span>
                        {a.salary !== null && <MoneyChip amount={a.salary} kind="salary" />}
                      </>
                    ) : a.kind === "FAAB" ? (
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">{a.label}</span>
                    ) : (
                      <span className="font-medium text-ink">{a.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Nothing</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
