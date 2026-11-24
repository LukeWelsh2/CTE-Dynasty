// League money table: dues (with the commissioner's paid toggle), empty-starter fines, add/drop fees and
// weekly high-score winnings. Used on /commissioner/members (editable) and the rulebook (read-only).
import type { LeagueSettings } from "@/lib/settings/schema";
import type { Ledger } from "@/lib/commissioner/ledger";
import { Badge } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { DuesToggle } from "./members-tools";

const money = (n: number) => `$${n.toLocaleString()}`;

export function LedgerTable({ ledger, settings, editable = false }: { ledger: Ledger; settings: LeagueSettings; editable?: boolean }) {
  const { show, totals } = ledger;
  // team + owes + one column per active charge; only scroll sideways on phones when there are many
  const cols = 2 + [show.dues, show.fines, show.fees, show.winnings, show.tax].filter(Boolean).length;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className={cn("tbl", cols > 3 ? "min-w-[560px]" : "min-w-[300px]")}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-sunken">Team</th>
              {show.dues && <th>Dues ({money(settings.general.leagueDues)})</th>}
              {show.fines && (
                <th className="num" title={`${money(settings.niche.emptyStarterFine)} per empty starting slot in a completed week`}>
                  Empty-slot fines
                </th>
              )}
              {show.fees && (
                <th className="num" title={`${money(settings.waivers.addDropFee)} per add or won waiver claim`}>
                  Add/drop fees
                </th>
              )}
              {show.winnings && (
                <th className="num" title={`${money(settings.niche.weeklyHighScorePrize)} for each week with the league's top score`}>
                  High-score wins
                </th>
              )}
              {show.tax && (
                <th className="num" title={`${settings.salaryCap.luxuryTaxRate}× every dollar of current payroll over the ${money(settings.salaryCap.cap)} soft cap`}>
                  Luxury tax
                </th>
              )}
              <th className="num">Owes</th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((r) => (
              <tr key={r.teamId}>
                <td className="sticky left-0 z-[5] bg-panel font-semibold">
                  <span className="hidden sm:inline">{r.team}</span>
                  <span className="sm:hidden">{r.abbrev}</span>
                </td>
                {show.dues && <td>{editable ? <DuesToggle teamId={r.teamId} paid={r.duesPaid} teamName={r.team} /> : <Badge tone={r.duesPaid ? "green" : "amber"}>{r.duesPaid ? "Paid" : "Unpaid"}</Badge>}</td>}
                {show.fines && (
                  <td className="num">
                    {r.fines ? money(r.fines) : <span className="text-muted">—</span>}
                    {r.emptySlots > 0 && <span className="block text-[11px] text-muted">{r.emptySlots} empty</span>}
                  </td>
                )}
                {show.fees && (
                  <td className="num">
                    {r.fees ? money(r.fees) : <span className="text-muted">—</span>}
                    {r.acquisitions > 0 && <span className="block text-[11px] text-muted">{r.acquisitions} moves</span>}
                  </td>
                )}
                {show.winnings && (
                  <td className="num">
                    {r.winnings ? <span className="font-semibold text-win">{money(r.winnings)}</span> : <span className="text-muted">—</span>}
                    {r.highScoreWeeks.length > 0 && <span className="block text-[11px] text-muted">Wk {r.highScoreWeeks.join(", ")}</span>}
                  </td>
                )}
                {show.tax && <td className="num">{r.luxuryTax ? money(r.luxuryTax) : <span className="text-muted">—</span>}</td>}
                <td className={cn("num font-bold", r.owed > 0 ? "text-loss" : "text-muted")}>{r.owed ? money(r.owed) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-3 py-2 text-xs text-muted">
        {show.dues && (
          <span>
            Dues collected <b className="text-ink">{money(totals.duesCollected)}</b> · outstanding <b className="text-ink">{money(totals.duesOutstanding)}</b>
          </span>
        )}
        {show.fines && (
          <span>
            Fines <b className="text-ink">{money(totals.fines)}</b>
          </span>
        )}
        {show.fees && (
          <span>
            Fees <b className="text-ink">{money(totals.fees)}</b>
          </span>
        )}
        {show.winnings && (
          <span>
            Weekly prizes paid out <b className="text-ink">{money(totals.winnings)}</b>
          </span>
        )}
        {show.tax && (
          <span>
            Luxury tax <b className="text-ink">{money(totals.tax)}</b>
          </span>
        )}
        <span>
          Pot (dues + fines + fees{show.tax ? " + tax" : ""}) <b className="text-ink">{money(totals.pot)}</b>
        </span>
      </div>
    </div>
  );
}
