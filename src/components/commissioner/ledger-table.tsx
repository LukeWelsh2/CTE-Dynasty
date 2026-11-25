// League money table: dues (with the commissioner's paid toggle), empty-starter fines, add/drop fees and
// weekly high-score winnings. Used on /commissioner/members (editable) and the rulebook (read-only).
// Phones: one row per team (name, dues status, the charges that apply, what they owe); md+: the full table.
import type { LeagueSettings } from "@/lib/settings/schema";
import type { Ledger } from "@/lib/commissioner/ledger";
import { Badge } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { DuesToggle } from "./members-tools";

const money = (n: number) => `$${n.toLocaleString()}`;

export function LedgerTable({ ledger, settings, editable = false, topRule = false }: { ledger: Ledger; settings: LeagueSettings; editable?: boolean; /** hairline above the rows (inside a titled card) */ topRule?: boolean }) {
  const { show, totals } = ledger;
  const dues = (r: Ledger["rows"][number]) =>
    editable ? <DuesToggle teamId={r.teamId} paid={r.duesPaid} teamName={r.team} /> : <Badge tone={r.duesPaid ? "green" : "amber"}>{r.duesPaid ? "Paid" : "Unpaid"}</Badge>;
  return (
    <div>
      {/* phones */}
      <ul className={cn("divide-y divide-line/70 md:hidden", topRule && "border-t border-line/70")}>
        {ledger.rows.map((r) => {
          const parts = [
            show.fines && r.fines ? `Fines ${money(r.fines)}${r.emptySlots ? ` (${r.emptySlots} empty)` : ""}` : null,
            show.fees && r.fees ? `Fees ${money(r.fees)}${r.acquisitions ? ` (${r.acquisitions} moves)` : ""}` : null,
            show.tax && r.luxuryTax ? `Tax ${money(r.luxuryTax)}` : null,
          ].filter(Boolean);
          return (
            <li key={r.teamId} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold leading-5 text-ink" title={r.team}>
                  {r.team}
                </div>
                {(parts.length > 0 || (show.winnings && r.winnings > 0)) && (
                  <div className="mt-0.5 text-[13px] leading-[18px] text-muted">
                    {parts.join(" · ")}
                    {show.winnings && r.winnings > 0 && (
                      <span className="text-win">
                        {parts.length ? " · " : ""}Won {money(r.winnings)}
                        {r.highScoreWeeks.length ? ` (Wk ${r.highScoreWeeks.join(", ")})` : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {show.dues && <div className="shrink-0">{dues(r)}</div>}
              <div className="shrink-0 text-right">
                <div className={cn("numeral text-[15px] font-semibold leading-5", r.owed > 0 ? "text-loss" : "text-muted")}>{r.owed ? money(r.owed) : "—"}</div>
                <div className="text-[12px] leading-4 text-muted">owes</div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* md+ */}
      <div className={cn("hidden overflow-x-auto md:block", topRule && "border-t border-line/70")}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Team</th>
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
                <td className="font-semibold">{r.team}</td>
                {show.dues && <td>{dues(r)}</td>}
                {show.fines && (
                  <td className="num">
                    {r.fines ? money(r.fines) : <span className="text-muted">—</span>}
                    {r.emptySlots > 0 && <span className="block text-[12px] text-muted">{r.emptySlots} empty</span>}
                  </td>
                )}
                {show.fees && (
                  <td className="num">
                    {r.fees ? money(r.fees) : <span className="text-muted">—</span>}
                    {r.acquisitions > 0 && <span className="block text-[12px] text-muted">{r.acquisitions} moves</span>}
                  </td>
                )}
                {show.winnings && (
                  <td className="num">
                    {r.winnings ? <span className="font-semibold text-win">{money(r.winnings)}</span> : <span className="text-muted">—</span>}
                    {r.highScoreWeeks.length > 0 && <span className="block text-[12px] text-muted">Wk {r.highScoreWeeks.join(", ")}</span>}
                  </td>
                )}
                {show.tax && <td className="num">{r.luxuryTax ? money(r.luxuryTax) : <span className="text-muted">—</span>}</td>}
                <td className={cn("num font-bold", r.owed > 0 ? "text-loss" : "text-muted")}>{r.owed ? money(r.owed) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line/70 px-4 py-2.5 text-[13px] text-muted">
        {show.dues && (
          <div>
            Dues in <b className="numeral text-ink">{money(totals.duesCollected)}</b> · out <b className="numeral text-ink">{money(totals.duesOutstanding)}</b>
          </div>
        )}
        {show.fines && (
          <div>
            Fines <b className="numeral text-ink">{money(totals.fines)}</b>
          </div>
        )}
        {show.fees && (
          <div>
            Fees <b className="numeral text-ink">{money(totals.fees)}</b>
          </div>
        )}
        {show.winnings && (
          <div>
            Prizes paid <b className="numeral text-ink">{money(totals.winnings)}</b>
          </div>
        )}
        {show.tax && (
          <div>
            Luxury tax <b className="numeral text-ink">{money(totals.tax)}</b>
          </div>
        )}
        <div title={`Pot = dues + fines + fees${show.tax ? " + tax" : ""}`}>
          Pot <b className="numeral text-ink">{money(totals.pot)}</b>
        </div>
      </dl>
    </div>
  );
}
