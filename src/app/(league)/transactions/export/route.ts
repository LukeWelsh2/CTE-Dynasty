// CSV export of the transaction log with the same filters as /transactions.
import { getLeagueContextOrNull } from "@/lib/league";
import { exportTransactions, parseTxQuery } from "@/lib/waivers/transactions";
import { describeTransactionType, toCsv } from "@/lib/waivers/tx-logic";
import { bidVisible } from "@/lib/waivers/logic";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getLeagueContextOrNull();
  if (!ctx) return new Response("Sign in to a league to export transactions.", { status: 401 });
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const q = parseTxQuery(sp, { season: ctx.league.season });
  const rows = await exportTransactions(ctx.league.id, { ...q, page: 1 });
  const viewer = { teamId: ctx.myTeam?.id ?? null, isCommish: ctx.isCommish };
  const tz = ctx.settings.general.timezone;
  const fmt = (d: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
  };
  const csv = toCsv([
    ["Date (" + tz + ")", "Season", "Week", "Type", "Team", "Other team", "Player", "Position", "NFL team", "FAB", "Salary", "Description", "Trade ID"],
    ...rows.map((r) => [
      fmt(r.createdAt),
      r.season,
      r.week,
      describeTransactionType(r.type),
      r.team?.name ?? "",
      r.relatedTeam?.name ?? "",
      r.player?.fullName ?? "",
      r.player?.position ?? "",
      r.player?.team ?? "",
      // winning FAB bids follow settings.waivers.revealBids, like the log page
      r.type === "WAIVER" && r.faabAmount !== null && !bidVisible(ctx.settings, { teamId: r.teamId ?? "", won: true }, viewer) ? "" : r.faabAmount,
      r.salary,
      r.description,
      r.tradeId ?? "",
    ]),
  ]);
  const name = `${slugify(ctx.league.name)}-transactions-${q.season ?? "all"}${q.type !== "all" ? "-" + q.type : ""}.csv`;
  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
