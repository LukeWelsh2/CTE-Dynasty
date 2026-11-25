// Draft Center building blocks (server-safe, no hooks): the rookie order as phone rows (tap for the details), the
// drafts list and the live-draft banner. docs/DESIGN.md §4–5: list rows on phones, the dense table from md.
import Link from "next/link";
import { ChevronDown, ChevronRight, Gavel, ListOrdered } from "lucide-react";
import { Badge, StatGrid, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";

type TeamLite = { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };

export interface OrderPickCell {
  round: number;
  label: string;
  /** current owner when the pick was traded */
  owner: TeamLite | null;
  missing: boolean;
  used: boolean;
}

export interface OrderListRow {
  team: TeamLite;
  slot: number;
  record: string | null;
  pointsFor: string | null;
  potential: string | null;
  basis: string | null;
  group: "LOTTERY" | "PLAYOFF" | "BONUS" | string | null;
  picks: OrderPickCell[];
}

const GROUP_LABEL: Record<string, string> = { LOTTERY: "Lottery", PLAYOFF: "Playoffs", BONUS: "Consolation champ" };

/** The pick label with the new owner under it ("2.01" / "→ LO"). */
function PickCell({ c, compact }: { c: OrderPickCell; compact?: boolean }) {
  if (c.missing) return <span className="text-[13px] text-faint">—</span>;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={cn("numeral text-[15px] font-semibold sm:text-sm", c.owner ? "text-muted line-through decoration-1" : "text-ink", c.used && "text-muted")}>{c.label}</span>
      {c.owner && (
        <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-600 dark:text-brand-400" title={`Owned by ${c.owner.name}`}>
          <TeamLogo team={c.owner} size={14} />
          {!compact && c.owner.abbrev}
        </span>
      )}
    </span>
  );
}

/** Phone list of the rookie order: slot · team · up to 3 round picks; tap a row for record, points and every pick. */
export function DraftOrderList({ rows, myTeamId, rounds }: { rows: OrderListRow[]; myTeamId: string | null; rounds: number }) {
  const shown = Math.min(rounds, 3);
  return (
    <div>
      <div className="flex items-center gap-2.5 border-y border-line/70 bg-sunken/60 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted sm:px-4">
        <span className="w-6 text-center">#</span>
        <span className="w-[30px]" aria-hidden />
        <span className="flex-1">Team</span>
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className="w-11 text-right">
            R{i + 1}
          </span>
        ))}
        <span className="w-4" aria-hidden />
      </div>
      <ul className="divide-y divide-line/70">
        {rows.map((r) => {
          const mine = r.team.id === myTeamId;
          const sub = [r.record, r.group ? GROUP_LABEL[r.group] ?? null : null].filter(Boolean).join(" · ");
          return (
            <li key={r.team.id}>
              <details className={cn("group", mine && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]")}>
                <summary className={cn("flex min-h-[60px] cursor-pointer list-none items-center gap-2.5 px-3 py-2 sm:px-4 [&::-webkit-details-marker]:hidden", mine && "bg-brand-600/[0.05] dark:bg-brand-400/[0.08]")}>
                  <span className="numeral w-6 shrink-0 text-center text-[17px] font-semibold text-ink">{r.slot}</span>
                  <TeamLogo team={r.team} size={30} />
                  <span className="min-w-0 flex-1">
                    <span title={r.team.name} className={cn("block truncate text-[15px] font-semibold leading-5", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                      {r.team.name}
                    </span>
                    {sub && <span className="block truncate text-[13px] leading-[18px] text-muted">{sub}</span>}
                  </span>
                  {r.picks.slice(0, shown).map((c) => (
                    <span key={c.round} className="flex w-11 shrink-0 justify-end">
                      <PickCell c={c} compact />
                    </span>
                  ))}
                  <ChevronDown size={16} className="w-4 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
                </summary>
                <div className="space-y-3 border-t border-line/70 bg-sunken px-4 py-3">
                  <StatGrid
                    cols={3}
                    items={[
                      { label: "Record", value: r.record ?? "—" },
                      { label: "PF", value: r.pointsFor ?? "—" },
                      { label: "Max PF", value: r.potential ?? "—" },
                    ]}
                  />
                  {r.basis && <p className="text-[13px] text-muted">{r.basis}</p>}
                  <ul className="divide-y divide-line/70 rounded-lg bg-panel px-3">
                    {r.picks.map((c) => (
                      <li key={c.round} className="flex min-h-10 items-center justify-between gap-3 text-[14px]">
                        <span className="text-muted">Round {c.round}</span>
                        <span className="numeral font-semibold text-ink">
                          {c.missing ? "No pick" : c.label}
                          {c.owner && (
                            <span className="ml-2 inline-flex items-center gap-1 font-semibold text-brand-600 dark:text-brand-400">
                              <TeamLogo team={c.owner} size={16} /> {c.owner.name}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Desktop order table (md+): every column at once. */
export function DraftOrderTable({ rows, myTeamId, rounds }: { rows: OrderListRow[]; myTeamId: string | null; rounds: number }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="tbl tbl-compact">
        <thead>
          <tr>
            <th className="num w-12">Slot</th>
            <th>Team</th>
            <th className="num">Record</th>
            <th className="num">PF</th>
            <th className="num" title="Sum of each week's best possible lineup">
              Max PF
            </th>
            <th className="hidden xl:table-cell">Basis</th>
            {Array.from({ length: rounds }, (_, i) => (
              <th key={i} className="num">
                R{i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id} className={cn(r.team.id === myTeamId && "row-mine")}>
              <td className="num text-[15px] font-semibold">{r.slot}</td>
              <td className="max-w-[240px]">
                <span className="flex min-w-0 items-center gap-2">
                  <TeamLogo team={r.team} size={24} />
                  <span title={r.team.name} className={cn("truncate font-semibold", r.team.id === myTeamId && "text-brand-600 dark:text-brand-400")}>
                    {r.team.name}
                  </span>
                  {r.group && GROUP_LABEL[r.group] && (
                    <Badge tone={r.group === "PLAYOFF" ? "brand" : r.group === "BONUS" ? "green" : "neutral"} className="shrink-0">
                      {GROUP_LABEL[r.group]}
                    </Badge>
                  )}
                </span>
              </td>
              <td className="num">{r.record ?? "—"}</td>
              <td className="num">{r.pointsFor ?? "—"}</td>
              <td className="num">{r.potential ?? "—"}</td>
              <td className="hidden max-w-[260px] truncate text-muted xl:table-cell" title={r.basis ?? undefined}>
                {r.basis ?? "—"}
              </td>
              {r.picks.map((c) => (
                <td key={c.round} className="num">
                  <span className="flex justify-end">
                    <PickCell c={c} />
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "2026 Salary Auction is live — Enter room" banner (white card, red live edge). */
export function LiveDraftBanner({ href, name, status, sub }: { href: string; name: string; status: string; sub: string }) {
  const live = status === "LIVE";
  return (
    <Link
      href={href}
      className={cn(
        "card flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken/70",
        live ? "shadow-[inset_3px_0_0_rgb(var(--c-live)),var(--shadow-card)]" : "shadow-[inset_3px_0_0_theme(colors.amber.500),var(--shadow-card)]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("eyebrow flex items-center gap-1.5", live ? "text-live" : "text-amber-700 dark:text-amber-300")}>
          {live && <span aria-hidden className="live-dot h-2 w-2 bg-live" />}
          {live ? "Live now" : "Paused"}
        </span>
        <span className="block truncate text-[17px] font-bold leading-6 text-ink">{name}</span>
        <span className="block truncate text-[13px] text-muted">{sub}</span>
      </span>
      <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-control bg-brand-600 px-4 text-sm font-semibold text-white">
        Enter room <ChevronRight size={16} />
      </span>
    </Link>
  );
}

export function DraftKindIcon({ type, label }: { type: string; label: string }) {
  const Icon = type === "AUCTION" ? Gavel : ListOrdered;
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-brand-600 dark:text-brand-400" role="img" aria-label={label} title={label}>
      <Icon size={18} />
    </span>
  );
}
