"use client";
// Client widgets for /commissioner/rosters: inline roster editor, force add, FAB adjust, pick ownership.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, ChevronUp, Loader2, Lock, Minus, Pencil, Plus, Save, UserMinus, UserPlus } from "lucide-react";
import { Alert, Badge, InjuryTag, PosBadge, buttonClass } from "@/components/ui/core";
import { Modal, Toggle } from "@/components/ui/client";
import { BarTotal, RosterRow as RosterRowView, RosterStat, SectionBar } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { adjustTeamFaab, changePickOwner, forceAddPlayer, forceDropPlayer, movePlayerToTeam, updateRosterSpot } from "@/lib/commissioner/roster-actions";
import type { PlayerSearchRow } from "@/lib/commissioner/settings-actions";
import type { AmnestyStatus, DeadMoneyPreview } from "@/lib/commissioner/roster-logic";
import { NumberInput, PlayerSearchBox } from "./fields";

type Result = { ok: boolean; error?: string; message?: string };

function useRun() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error ?? "Something went wrong");
        else {
          toast.success(r.message ?? "Saved");
          after?.();
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

export interface RosterRow {
  spotId: string;
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  status: "ACTIVE" | "IR" | "TAXI";
  salary: number;
  contractYears: number;
  isRookieContract: boolean;
  isFranchiseTagged: boolean;
  acquiredVia: string;
  acquired: string;
  dead: DeadMoneyPreview;
  irEligible: boolean;
  taxiEligible: boolean;
  undroppable: boolean;
}

interface TeamOpt {
  id: string;
  name: string;
  abbrev: string;
}

const STATUS_LABEL: Record<RosterRow["status"], string> = { ACTIVE: "Active", IR: "IR", TAXI: "Taxi" };
/** "Joe Burrow" → "J. Burrow" (phone rows, like the Roster pattern) */
const shortName = (n: string) => {
  const p = n.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]!.charAt(0)}. ${p.slice(1).join(" ")}` : n;
};

/** Edit state + the Move / Drop sheets for one roster spot (shared by the phone row and the table row). */
function useSpotEditor({ r, teams, teamId, amnesty }: { r: RosterRow; teams: TeamOpt[]; teamId: string; amnesty: AmnestyStatus }) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ salary: r.salary, contractYears: r.contractYears, status: r.status, isRookieContract: r.isRookieContract, isFranchiseTagged: r.isFranchiseTagged });
  const [modal, setModal] = useState<null | "move" | "drop">(null);
  const [moveTo, setMoveTo] = useState(teams.find((t) => t.id !== teamId)?.id ?? "");
  const [drop, setDrop] = useState<{ mode: "RULES" | "NONE" | "AMNESTY"; toWaivers: boolean }>({ mode: "RULES", toWaivers: true });
  const dirty = v.salary !== r.salary || v.contractYears !== r.contractYears || v.status !== r.status || v.isRookieContract !== r.isRookieContract || v.isFranchiseTagged !== r.isFranchiseTagged;
  const valid = Number.isInteger(v.salary) && v.salary >= 0 && Number.isInteger(v.contractYears) && v.contractYears >= 1;
  const save = () => run(() => updateRosterSpot({ spotId: r.spotId, ...v }));
  const sheetBtn = "sm:h-9 sm:px-4 sm:text-sm";
  const modals = (
    <>
      <Modal
        open={modal === "move"}
        onClose={() => setModal(null)}
        title={`Move ${r.name}`}
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "lg", sheetBtn)} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary", "lg", cn("flex-1 sm:flex-none", sheetBtn))} disabled={pending || !moveTo} onClick={() => run(() => movePlayerToTeam({ playerId: r.playerId, toTeamId: moveTo }), () => setModal(null))}>
              {pending && <Loader2 size={14} className="animate-spin" />} Move player
            </button>
          </>
        }
      >
        <label className="block">
          <span className="label">New team</span>
          <select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {teams
              .filter((t) => t.id !== teamId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <p className="mt-2 text-[13px] text-muted">
          The contract (${r.salary}, {r.contractYears} yr{r.contractYears === 1 ? "" : "s"}) moves with him. He comes off both teams&apos; future lineups. No dead money.
        </p>
      </Modal>
      <Modal
        open={modal === "drop"}
        onClose={() => setModal(null)}
        title={`Drop ${r.name}`}
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "lg", sheetBtn)} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={buttonClass("danger", "lg", cn("flex-1 sm:flex-none", sheetBtn))}
              disabled={pending}
              onClick={() => run(() => forceDropPlayer({ teamId, playerId: r.playerId, deadMoney: drop.mode === "RULES", amnesty: drop.mode === "AMNESTY", toWaivers: drop.toWaivers }), () => setModal(null))}
            >
              {pending && <Loader2 size={14} className="animate-spin" />} Drop player
            </button>
          </>
        }
      >
        <div className="space-y-3 text-[15px] sm:text-sm">
          {r.undroppable && (
            <Alert tone="warn" className="text-[13px]">
              League rules list {r.name} as undroppable; the commissioner can override.
            </Alert>
          )}
          <fieldset className="space-y-1">
            <legend className="label">Dead money</legend>
            <label className="flex min-h-11 items-start gap-2.5 py-1">
              <input type="radio" name={`dead-${r.spotId}`} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={drop.mode === "RULES"} onChange={() => setDrop({ ...drop, mode: "RULES" })} />
              <span>
                Per league rules
                <span className="block text-[13px] text-muted">
                  {r.dead.total ? `${r.dead.bySeason.map((d) => `$${d.amount} in ${d.season}`).join(", ")} (total $${r.dead.total})` : r.dead.reason ?? "No dead money"}
                </span>
              </span>
            </label>
            <label className="flex min-h-11 items-start gap-2.5 py-1">
              <input type="radio" name={`dead-${r.spotId}`} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={drop.mode === "NONE"} onChange={() => setDrop({ ...drop, mode: "NONE" })} />
              <span>
                No dead money
                <span className="block text-[13px] text-muted">Commissioner override, logged in the action log.</span>
              </span>
            </label>
            {amnesty.allowed > 0 && (
              <label className={cn("flex min-h-11 items-start gap-2.5 py-1", !amnesty.remaining && "opacity-60")}>
                <input
                  type="radio"
                  name={`dead-${r.spotId}`}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                  disabled={!amnesty.remaining}
                  checked={drop.mode === "AMNESTY"}
                  onChange={() => setDrop({ ...drop, mode: "AMNESTY" })}
                />
                <span>
                  Use an amnesty cut
                  <span className="block text-[13px] text-muted">{amnesty.remaining ? `${amnesty.remaining} of ${amnesty.allowed} left for this team; no dead money.` : `All ${amnesty.allowed} amnesty cuts are used.`}</span>
                </span>
              </label>
            )}
          </fieldset>
          <label className="flex min-h-11 items-start gap-2.5 py-1">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" checked={drop.toWaivers} onChange={(e) => setDrop({ ...drop, toWaivers: e.target.checked })} />
            <span>
              Put him on waivers
              <span className="block text-[13px] text-muted">Off = straight to free agency.</span>
            </span>
          </label>
        </div>
      </Modal>
    </>
  );
  return { v, setV, dirty, valid, pending, save, setModal, modals };
}

/** Phone: a Roster-pattern row (position pill, headshot, name, contract columns); tap Edit for the inline editor. */
function PhoneRow({ r, teams, teamId, season, amnesty }: { r: RosterRow; teams: TeamOpt[]; teamId: string; season: number; amnesty: AmnestyStatus }) {
  const e = useSpotEditor({ r, teams, teamId, amnesty });
  const [open, setOpen] = useState(false);
  const thru = season + (Number.isFinite(e.v.contractYears) ? e.v.contractYears : 1) - 1;
  const tags = [r.isRookieContract && "Rookie deal", r.isFranchiseTagged && "Tagged"].filter(Boolean).join(" · ");
  return (
    <RosterRowView
      className={cn("px-4", (open || e.dirty) && "bg-sunken/60")}
      slot={null}
      player={{ id: r.playerId, name: r.name, short: r.position === "DEF" ? r.name : shortName(r.name), position: r.position, nflTeam: r.nflTeam, injury: r.injuryStatus }}
      href={`/players/${r.playerId}`}
      nameExtra={r.undroppable ? <Lock size={13} className="shrink-0 text-muted" aria-label="Undroppable" /> : undefined}
      opp={
        <span className="truncate text-[13px] text-muted">
          {r.acquiredVia.charAt(0) + r.acquiredVia.slice(1).replace(/_/g, " ").toLowerCase()} · {r.acquired}
          {tags ? ` · ${tags}` : ""}
        </span>
      }
      stats={
        <>
          <RosterStat label="Sal" value={`$${r.salary}`} />
          <RosterStat label="Yrs" value={r.contractYears} title={`Through ${season + r.contractYears - 1}`} />
        </>
      }
      trailing={
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Close" : "Edit"} ${r.name}`}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          {open ? <ChevronUp size={18} /> : <Pencil size={16} />}
        </button>
      }
      after={
        <>
          {open && (
            <div className="mb-3 space-y-3 rounded-xl bg-panel p-3 shadow-card">
              <div className="grid grid-cols-3 gap-2">
                <label className="block min-w-0">
                  <span className="label">Status</span>
                  <select aria-label={`${r.name} status`} className="input px-2 py-2" value={e.v.status} onChange={(ev) => e.setV({ ...e.v, status: ev.target.value as RosterRow["status"] })}>
                    <option value="ACTIVE">Active</option>
                    <option value="IR">IR{!r.irEligible ? " (!)" : ""}</option>
                    <option value="TAXI">Taxi{!r.taxiEligible ? " (!)" : ""}</option>
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="label">Salary</span>
                  <NumberInput ariaLabel={`${r.name} salary`} value={e.v.salary} min={0} max={100000} int prefix="$" onChange={(n) => e.setV({ ...e.v, salary: n })} />
                </label>
                <label className="block min-w-0">
                  <span className="label">Years</span>
                  <NumberInput ariaLabel={`${r.name} contract years`} value={e.v.contractYears} min={1} max={15} int onChange={(n) => e.setV({ ...e.v, contractYears: n })} />
                </label>
              </div>
              <p className="-mt-1 text-right text-[12px] text-muted">Through {thru}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex min-h-11 items-center rounded-lg bg-sunken px-3">
                  <Toggle checked={e.v.isRookieContract} onChange={(x) => e.setV({ ...e.v, isRookieContract: x })} label={<span className="text-[14px]">Rookie deal</span>} />
                </div>
                <div className="flex min-h-11 items-center rounded-lg bg-sunken px-3">
                  <Toggle checked={e.v.isFranchiseTagged} onChange={(x) => e.setV({ ...e.v, isFranchiseTagged: x })} label={<span className="text-[14px]">Tagged</span>} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className={buttonClass("primary", "md", "flex-1")} disabled={!e.dirty || e.pending || !e.valid} onClick={e.save}>
                  {e.pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                </button>
                <button type="button" className={buttonClass("secondary", "md")} onClick={() => e.setModal("move")}>
                  <ArrowRightLeft size={14} /> Move
                </button>
                <button type="button" className={buttonClass("secondary", "md", "text-loss")} onClick={() => e.setModal("drop")}>
                  <UserMinus size={14} /> Drop
                </button>
              </div>
            </div>
          )}
          {e.modals}
        </>
      }
    />
  );
}

/** md+: one table row with inline inputs. */
function Row({ r, teams, teamId, season, amnesty }: { r: RosterRow; teams: TeamOpt[]; teamId: string; season: number; amnesty: AmnestyStatus }) {
  const e = useSpotEditor({ r, teams, teamId, amnesty });
  const { v, setV } = e;
  return (
    <tr className={cn(e.dirty && "row-mine")}>
      <td className="tbl-sticky">
        <span className="flex items-center gap-2">
          <PosBadge pos={r.position === "DEF" ? "DEF" : r.position} />
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <a href={`/players/${r.playerId}`} className="truncate font-semibold text-ink hover:text-brand-600 hover:underline dark:hover:text-brand-400">
                {r.name}
              </a>
              <InjuryTag status={r.injuryStatus} />
              {r.undroppable && <Badge tone="purple">Undroppable</Badge>}
            </span>
            <span className="block text-[12px] text-muted">
              {r.nflTeam ?? "FA"} · via {r.acquiredVia.replace(/_/g, " ").toLowerCase()} {r.acquired}
            </span>
          </span>
        </span>
      </td>
      <td>
        <select aria-label={`${r.name} status`} className="input w-[5.5rem] py-1 sm:text-xs" value={v.status} onChange={(ev) => setV({ ...v, status: ev.target.value as RosterRow["status"] })}>
          <option value="ACTIVE">Active</option>
          <option value="IR">IR{!r.irEligible ? " (!)" : ""}</option>
          <option value="TAXI">Taxi{!r.taxiEligible ? " (!)" : ""}</option>
        </select>
      </td>
      <td>
        <NumberInput ariaLabel={`${r.name} salary`} value={v.salary} min={0} max={100000} int prefix="$" className="w-24" onChange={(n) => setV({ ...v, salary: n })} />
      </td>
      <td>
        <NumberInput ariaLabel={`${r.name} contract years`} value={v.contractYears} min={1} max={15} int className="w-16" onChange={(n) => setV({ ...v, contractYears: n })} />
        <span className="mt-0.5 block text-[12px] text-muted">thru {season + (Number.isFinite(v.contractYears) ? v.contractYears : 1) - 1}</span>
      </td>
      <td className="text-center">
        <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center">
          <input type="checkbox" aria-label={`${r.name} rookie contract`} className="h-4 w-4 accent-brand-600" checked={v.isRookieContract} onChange={(ev) => setV({ ...v, isRookieContract: ev.target.checked })} />
        </label>
      </td>
      <td className="text-center">
        <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center">
          <input type="checkbox" aria-label={`${r.name} franchise tag`} className="h-4 w-4 accent-brand-600" checked={v.isFranchiseTagged} onChange={(ev) => setV({ ...v, isFranchiseTagged: ev.target.checked })} />
        </label>
      </td>
      <td>
        <div className="flex justify-end gap-1">
          {e.dirty && (
            <button type="button" className={buttonClass("primary", "xs")} disabled={e.pending || !e.valid} onClick={e.save}>
              {e.pending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
          )}
          <button type="button" className={buttonClass("secondary", "xs")} onClick={() => e.setModal("move")} aria-label={`Move ${r.name}`}>
            <ArrowRightLeft size={12} /> Move
          </button>
          <button type="button" className={buttonClass("ghost", "xs", "text-loss")} onClick={() => e.setModal("drop")} aria-label={`Drop ${r.name}`}>
            <UserMinus size={12} /> Drop
          </button>
        </div>
        {e.modals}
      </td>
    </tr>
  );
}

export function RosterEditor({ rows, teams, teamId, season, amnesty, limits }: { rows: RosterRow[]; teams: TeamOpt[]; teamId: string; season: number; amnesty: AmnestyStatus; /** "25/27" style counts for the phone section bars */ limits?: Partial<Record<RosterRow["status"], string>> }) {
  const key = (r: RosterRow) => `${r.spotId}-${r.salary}-${r.contractYears}-${r.status}-${r.isRookieContract}-${r.isFranchiseTagged}`;
  const all = (["ACTIVE", "IR", "TAXI"] as const).map((st) => ({ st, rows: rows.filter((r) => r.status === st) }));
  const groups = all.filter((g) => g.rows.length);
  const empty = all.filter((g) => !g.rows.length);
  return (
    <>
      {/* phones: Roster-pattern rows grouped by status; empty IR / Taxi as half bars at the end */}
      <div className="space-y-2 px-3 pb-3 md:hidden">
        {groups.map((g) => (
          <section key={g.st}>
            <SectionBar title={STATUS_LABEL[g.st]} right={limits?.[g.st] ? <BarTotal label="Spots" value={limits[g.st]} /> : `${g.rows.length}`} />
            <div className="-mx-3">
              {g.rows.map((r) => (
                <PhoneRow key={key(r)} r={r} teams={teams} teamId={teamId} season={season} amnesty={amnesty} />
              ))}
            </div>
          </section>
        ))}
        {empty.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {empty.map((g) => (
              <SectionBar key={g.st} as="h3" title={STATUS_LABEL[g.st]} right={limits?.[g.st] ? <span className="numeral font-semibold text-ink">{limits[g.st]}</span> : "0"} />
            ))}
          </div>
        )}
      </div>
      {/* md+: the editable table */}
      <div className="hidden max-h-[75vh] overflow-auto md:block">
        <table className="tbl min-w-[860px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="tbl-sticky !z-20">Player</th>
              <th>Status</th>
              <th>Salary</th>
              <th>Years</th>
              <th className="text-center">Rookie</th>
              <th className="text-center">Tag</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={key(r)} r={r} teams={teams} teamId={teamId} season={season} amnesty={amnesty} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ForceAdd({ teamId, teamName, defaults }: { teamId: string; teamName: string; defaults: { salary: number; years: number; maxYears: number } }) {
  const { pending, run } = useRun();
  const [player, setPlayer] = useState<PlayerSearchRow | null>(null);
  const [f, setF] = useState({ salary: defaults.salary, contractYears: defaults.years, status: "ACTIVE" as "ACTIVE" | "IR" | "TAXI", isRookieContract: false });
  return (
    <div className="space-y-3">
      <PlayerSearchBox placeholder="Search any NFL player…" onPick={(p) => setPlayer(p)} />
      {player && (
        <div className="space-y-3 rounded-lg bg-sunken p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="font-semibold">{player.name}</span> <span className="text-[13px] text-muted">{player.position} · {player.nflTeam ?? "FA"}</span> <InjuryTag status={player.injuryStatus} />
            </span>
            {player.rosteredBy && <Badge tone="amber">On {player.rosteredBy.abbrev} (${player.rosteredBy.salary})</Badge>}
          </div>
          {player.rosteredBy ? (
            player.rosteredBy.teamId === teamId ? (
              <p className="text-[15px] text-muted sm:text-sm">Already on {teamName}.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] text-muted sm:text-sm">He&apos;s on another roster. Move him with his contract instead:</p>
                <button type="button" className={buttonClass("primary", "md")} disabled={pending} onClick={() => run(() => movePlayerToTeam({ playerId: player.id, toTeamId: teamId }), () => setPlayer(null))}>
                  <ArrowRightLeft size={13} /> Move to {teamName}
                </button>
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block">
                  <span className="label">Salary</span>
                  <NumberInput ariaLabel="Salary" value={f.salary} min={0} max={100000} int prefix="$" onChange={(n) => setF({ ...f, salary: n })} />
                </label>
                <label className="block">
                  <span className="label">Years</span>
                  <NumberInput ariaLabel="Contract years" value={f.contractYears} min={1} max={15} int onChange={(n) => setF({ ...f, contractYears: n })} />
                </label>
                <label className="block">
                  <span className="label">Status</span>
                  <select className="input py-1.5" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
                    <option value="ACTIVE">Active</option>
                    <option value="IR">IR</option>
                    <option value="TAXI">Taxi</option>
                  </select>
                </label>
                <label className="flex min-h-10 items-center gap-2 self-end text-[15px] sm:text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.isRookieContract} onChange={(e) => setF({ ...f, isRookieContract: e.target.checked })} />
                  Rookie deal
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className={buttonClass("secondary", "md")} onClick={() => setPlayer(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={buttonClass("primary", "md", "min-w-0 flex-1 sm:flex-none")}
                  disabled={pending || !Number.isInteger(f.salary) || !Number.isInteger(f.contractYears)}
                  onClick={() => run(() => forceAddPlayer({ teamId, playerId: player.id, ...f }), () => setPlayer(null))}
                >
                  {pending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} <span className="truncate">Add to {teamName}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <p className="text-[13px] text-muted">Skips waivers and roster limits (you&apos;re warned about problems). Defaults: league minimum salary, {defaults.years}-year deal.</p>
    </div>
  );
}

export function FaabAdjust({ teamId, balance }: { teamId: string; balance: number }) {
  const { pending, run } = useRun();
  const [amount, setAmount] = useState(5);
  const [sign, setSign] = useState<1 | -1>(1);
  const [note, setNote] = useState("");
  const delta = sign * (Number.isFinite(amount) ? amount : 0);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => adjustTeamFaab({ teamId, amount: delta, note }), () => setNote(""));
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="segmented" role="group" aria-label="Add or remove">
          <button type="button" aria-pressed={sign === 1} className="segmented-item gap-1" onClick={() => setSign(1)}>
            <Plus size={13} aria-hidden /> Add
          </button>
          <button type="button" aria-pressed={sign === -1} className="segmented-item gap-1" onClick={() => setSign(-1)}>
            <Minus size={13} aria-hidden /> Remove
          </button>
        </div>
        <NumberInput ariaLabel="FAB amount" value={amount} min={1} max={100000} int prefix="$" className="w-28" onChange={setAmount} />
        <input className="input min-w-[10rem] flex-1 py-1.5" placeholder="Reason (required)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Reason" />
        <button type="submit" className={buttonClass("primary", "md", "w-full sm:w-auto")} disabled={pending || !delta || note.trim().length < 3}>
          {pending && <Loader2 size={14} className="animate-spin" />} Apply
        </button>
      </div>
      <p className="text-[13px] text-muted">
        Balance ${balance} → <b className={cn(balance + delta < 0 && "text-loss")}>${balance + delta}</b>
      </p>
    </form>
  );
}

export function PickOwnerSelect({ pickId, ownerId, teams, label }: { pickId: string; ownerId: string; teams: TeamOpt[]; label: string }) {
  const { pending, run } = useRun();
  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label={`Owner of ${label}`}
        className="input w-auto max-w-[11rem] py-1 sm:text-xs"
        value={ownerId}
        disabled={pending}
        onChange={(e) => {
          const to = teams.find((t) => t.id === e.target.value);
          if (to && window.confirm(`Give the ${label} pick to ${to.name}?`)) run(() => changePickOwner({ pickId, toTeamId: to.id }));
        }}
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.abbrev} — {t.name}
          </option>
        ))}
      </select>
      {pending && <Loader2 size={12} className="animate-spin text-muted" />}
    </span>
  );
}
