"use client";
// Client widgets for /commissioner/rosters: inline roster editor, force add, FAB adjust, pick ownership.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2, Minus, Plus, Save, UserMinus, UserPlus } from "lucide-react";
import { Badge, InjuryTag, PosBadge, buttonClass } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
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

function Row({ r, teams, teamId, season, amnesty }: { r: RosterRow; teams: TeamOpt[]; teamId: string; season: number; amnesty: AmnestyStatus }) {
  const { pending, run } = useRun();
  const [v, setV] = useState({ salary: r.salary, contractYears: r.contractYears, status: r.status, isRookieContract: r.isRookieContract, isFranchiseTagged: r.isFranchiseTagged });
  const [modal, setModal] = useState<null | "move" | "drop">(null);
  const [moveTo, setMoveTo] = useState(teams.find((t) => t.id !== teamId)?.id ?? "");
  const [drop, setDrop] = useState<{ mode: "RULES" | "NONE" | "AMNESTY"; toWaivers: boolean }>({ mode: "RULES", toWaivers: true });
  const dirty = v.salary !== r.salary || v.contractYears !== r.contractYears || v.status !== r.status || v.isRookieContract !== r.isRookieContract || v.isFranchiseTagged !== r.isFranchiseTagged;
  const valid = Number.isInteger(v.salary) && v.salary >= 0 && Number.isInteger(v.contractYears) && v.contractYears >= 1;
  return (
    <tr className={cn(dirty && "bg-gold-300/10")}>
      <td className="sticky left-0 z-[5] bg-panel">
        <span className="flex items-center gap-2">
          <PosBadge pos={r.position === "DEF" ? "DEF" : r.position} />
          <span className="min-w-0">
            <span className="flex items-center gap-1">
              <a href={`/players/${r.playerId}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
                {r.name}
              </a>
              <InjuryTag status={r.injuryStatus} />
              {r.undroppable && <Badge tone="purple">Undroppable</Badge>}
            </span>
            <span className="block text-[11px] text-muted">
              {r.nflTeam ?? "FA"} · via {r.acquiredVia.replace(/_/g, " ").toLowerCase()} {r.acquired}
            </span>
          </span>
        </span>
      </td>
      <td>
        <select aria-label={`${r.name} status`} className="input w-[5.5rem] py-1 text-xs" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as RosterRow["status"] })}>
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
        <span className="mt-0.5 block text-[10px] text-muted">thru {season + (Number.isFinite(v.contractYears) ? v.contractYears : 1) - 1}</span>
      </td>
      <td className="text-center">
        <input type="checkbox" aria-label={`${r.name} rookie contract`} className="h-4 w-4 accent-brand-600" checked={v.isRookieContract} onChange={(e) => setV({ ...v, isRookieContract: e.target.checked })} />
      </td>
      <td className="text-center">
        <input type="checkbox" aria-label={`${r.name} franchise tag`} className="h-4 w-4 accent-brand-600" checked={v.isFranchiseTagged} onChange={(e) => setV({ ...v, isFranchiseTagged: e.target.checked })} />
      </td>
      <td>
        <div className="flex justify-end gap-1">
          {dirty && (
            <button type="button" className={buttonClass("primary", "xs")} disabled={pending || !valid} onClick={() => run(() => updateRosterSpot({ spotId: r.spotId, ...v }))}>
              {pending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
          )}
          <button type="button" className={buttonClass("secondary", "xs")} onClick={() => setModal("move")} aria-label={`Move ${r.name}`}>
            <ArrowRightLeft size={12} /> Move
          </button>
          <button type="button" className={buttonClass("ghost", "xs", "text-loss")} onClick={() => setModal("drop")} aria-label={`Drop ${r.name}`}>
            <UserMinus size={12} /> Drop
          </button>
        </div>
        <Modal
          open={modal === "move"}
          onClose={() => setModal(null)}
          title={`Move ${r.name}`}
          size="sm"
          footer={
            <>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className={buttonClass("primary", "sm")} disabled={pending || !moveTo} onClick={() => run(() => movePlayerToTeam({ playerId: r.playerId, toTeamId: moveTo }), () => setModal(null))}>
                {pending && <Loader2 size={13} className="animate-spin" />} Move player
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
          <p className="mt-2 text-xs text-muted">The contract (${r.salary}, {r.contractYears} yr{r.contractYears === 1 ? "" : "s"}) moves with him. He comes off both teams&apos; future lineups. No dead money.</p>
        </Modal>
        <Modal
          open={modal === "drop"}
          onClose={() => setModal(null)}
          title={`Drop ${r.name}`}
          size="sm"
          footer={
            <>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass("danger", "sm")}
                disabled={pending}
                onClick={() => run(() => forceDropPlayer({ teamId, playerId: r.playerId, deadMoney: drop.mode === "RULES", amnesty: drop.mode === "AMNESTY", toWaivers: drop.toWaivers }), () => setModal(null))}
              >
                {pending && <Loader2 size={13} className="animate-spin" />} Drop player
              </button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {r.undroppable && <p className="rounded-md bg-purple-50 px-2 py-1 text-xs text-purple-800 dark:bg-purple-900/30 dark:text-purple-200">League rules list {r.name} as undroppable; the commissioner can override.</p>}
            <fieldset className="space-y-2">
              <legend className="label">Dead money</legend>
              <label className="flex items-start gap-2">
                <input type="radio" name={`dead-${r.spotId}`} className="mt-0.5 h-4 w-4 accent-brand-600" checked={drop.mode === "RULES"} onChange={() => setDrop({ ...drop, mode: "RULES" })} />
                <span>
                  Per league rules
                  <span className="block text-xs text-muted">
                    {r.dead.total ? `${r.dead.bySeason.map((d) => `$${d.amount} in ${d.season}`).join(", ")} (total $${r.dead.total})` : r.dead.reason ?? "No dead money"}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name={`dead-${r.spotId}`} className="mt-0.5 h-4 w-4 accent-brand-600" checked={drop.mode === "NONE"} onChange={() => setDrop({ ...drop, mode: "NONE" })} />
                <span>
                  No dead money
                  <span className="block text-xs text-muted">Commissioner override, logged in the action log.</span>
                </span>
              </label>
              {amnesty.allowed > 0 && (
                <label className={cn("flex items-start gap-2", !amnesty.remaining && "opacity-60")}>
                  <input
                    type="radio"
                    name={`dead-${r.spotId}`}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                    disabled={!amnesty.remaining}
                    checked={drop.mode === "AMNESTY"}
                    onChange={() => setDrop({ ...drop, mode: "AMNESTY" })}
                  />
                  <span>
                    Use an amnesty cut
                    <span className="block text-xs text-muted">
                      {amnesty.remaining ? `${amnesty.remaining} of ${amnesty.allowed} left for this team; no dead money.` : `All ${amnesty.allowed} amnesty cuts are used.`}
                    </span>
                  </span>
                </label>
              )}
            </fieldset>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={drop.toWaivers} onChange={(e) => setDrop({ ...drop, toWaivers: e.target.checked })} />
              <span>
                Put him on waivers
                <span className="block text-xs text-muted">Off = straight to free agency.</span>
              </span>
            </label>
          </div>
        </Modal>
      </td>
    </tr>
  );
}

export function RosterEditor({ rows, teams, teamId, season, amnesty }: { rows: RosterRow[]; teams: TeamOpt[]; teamId: string; season: number; amnesty: AmnestyStatus }) {
  return (
    <div className="max-h-[75vh] overflow-auto">
      <table className="tbl min-w-[860px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-20 bg-sunken">Player</th>
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
            <Row key={`${r.spotId}-${r.salary}-${r.contractYears}-${r.status}-${r.isRookieContract}-${r.isFranchiseTagged}`} r={r} teams={teams} teamId={teamId} season={season} amnesty={amnesty} />
          ))}
        </tbody>
      </table>
    </div>
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
        <div className="space-y-3 rounded-md border border-line bg-sunken/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-semibold">{player.name}</span> <span className="text-xs text-muted">{player.position} · {player.nflTeam ?? "FA"}</span> <InjuryTag status={player.injuryStatus} />
            </span>
            {player.rosteredBy && <Badge tone="amber">On {player.rosteredBy.abbrev} (${player.rosteredBy.salary})</Badge>}
          </div>
          {player.rosteredBy ? (
            player.rosteredBy.teamId === teamId ? (
              <p className="text-sm text-muted">Already on {teamName}.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted">He&apos;s on another roster. Move him with his contract instead:</p>
                <button type="button" className={buttonClass("primary", "sm")} disabled={pending} onClick={() => run(() => movePlayerToTeam({ playerId: player.id, toTeamId: teamId }), () => setPlayer(null))}>
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
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.isRookieContract} onChange={(e) => setF({ ...f, isRookieContract: e.target.checked })} />
                  Rookie deal
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setPlayer(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={buttonClass("primary", "sm")}
                  disabled={pending || !Number.isInteger(f.salary) || !Number.isInteger(f.contractYears)}
                  onClick={() => run(() => forceAddPlayer({ teamId, playerId: player.id, ...f }), () => setPlayer(null))}
                >
                  {pending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Add to {teamName}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <p className="text-xs text-muted">Commissioner adds skip waivers and roster limits (you&apos;ll be warned about any problems). Defaults: league minimum salary, {defaults.years}-year contract.</p>
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
        <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Add or remove">
          <button type="button" aria-pressed={sign === 1} className={cn("px-2.5 py-1.5 text-xs font-semibold", sign === 1 ? "bg-win text-white" : "bg-panel text-muted")} onClick={() => setSign(1)}>
            <Plus size={12} className="inline" /> Add
          </button>
          <button type="button" aria-pressed={sign === -1} className={cn("px-2.5 py-1.5 text-xs font-semibold", sign === -1 ? "bg-loss text-white" : "bg-panel text-muted")} onClick={() => setSign(-1)}>
            <Minus size={12} className="inline" /> Remove
          </button>
        </div>
        <NumberInput ariaLabel="FAB amount" value={amount} min={1} max={100000} int prefix="$" className="w-28" onChange={setAmount} />
        <input className="input min-w-[10rem] flex-1 py-1.5" placeholder="Reason (required)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Reason" />
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending || !delta || note.trim().length < 3}>
          {pending && <Loader2 size={13} className="animate-spin" />} Apply
        </button>
      </div>
      <p className="text-xs text-muted">
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
        className="input w-auto py-1 text-xs"
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
