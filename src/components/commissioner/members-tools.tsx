"use client";
// Client widgets for /commissioner/members: invite form, invite row actions, team edit / owner tools.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Loader2, Mail, Pencil, Plus, RefreshCw, Trash2, UserCog, UserMinus, UserPlus } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { Modal } from "@/components/ui/client";
import { cn } from "@/lib/utils";
import {
  addExpansionTeam,
  assignTeamOwner,
  changeMemberRole,
  createInvite,
  removeMember,
  replaceManager,
  resendInvite,
  resetLeagueInviteCode,
  revokeInvite,
  updateTeam,
} from "@/lib/commissioner/members-actions";
import { setDuesPaid } from "@/lib/commissioner/settings-actions";

type Result = { ok: boolean; error?: string; message?: string };

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: (r: Result) => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error ?? "Something went wrong");
        else {
          if (r.message) toast.success(r.message);
          after?.(r);
          router.refresh();
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  return { pending, run };
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn(buttonClass("secondary", "xs"), className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Couldn't copy — select the text instead.");
        }
      }}
      aria-label={`${label}: ${text}`}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}

export function InviteForm({ openTeams, canInviteCo }: { openTeams: { id: string; name: string }[]; canInviteCo: boolean }) {
  const { pending, run } = useAction();
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState(openTeams[0]?.id ?? "");
  const [role, setRole] = useState<"MANAGER" | "CO_COMMISSIONER">("MANAGER");
  const [expiresDays, setExpires] = useState(14);
  const [send, setSend] = useState(true);
  const [created, setCreated] = useState<{ code: string; link: string } | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createInvite({ email, teamId, role, expiresDays, sendEmail: send }),
          (r) => {
            const data = (r as { data?: { code: string; link: string } }).data;
            if (data) setCreated(data);
            setEmail("");
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Email (optional)</span>
          <input type="email" className="input py-1.5" placeholder="new.manager@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        </label>
        <label className="block">
          <span className="label">Team</span>
          <select className="input py-1.5" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">First unclaimed team</option>
            {openTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Role</span>
          <select className="input py-1.5" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="MANAGER">Manager</option>
            {canInviteCo && <option value="CO_COMMISSIONER">Co-commissioner</option>}
          </select>
        </label>
        <label className="block">
          <span className="label">Expires</span>
          <select className="input py-1.5" value={expiresDays} onChange={(e) => setExpires(Number(e.target.value))}>
            <option value={3}>In 3 days</option>
            <option value={7}>In 7 days</option>
            <option value={14}>In 14 days</option>
            <option value={30}>In 30 days</option>
            <option value={0}>Never</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={send} onChange={(e) => setSend(e.target.checked)} disabled={!email} />
          Email the invite link
        </label>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          {pending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} Create invite
        </button>
      </div>
      {!openTeams.length && <p className="text-xs text-amber-600 dark:text-amber-400">Every team has a manager. Invites only work once a team is unclaimed (use Replace manager on a team).</p>}
      {created && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-800 dark:bg-green-900/30 dark:text-green-100">
          <div className="font-semibold">Invite {created.code} is ready</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white/70 px-1.5 py-0.5 text-xs dark:bg-black/30">{created.link}</code>
            <CopyButton text={created.link} label="Copy link" />
          </div>
        </div>
      )}
    </form>
  );
}

export function InviteRowActions({ inviteId, link, hasEmail, usable, revocable }: { inviteId: string; link: string; hasEmail: boolean; usable: boolean; revocable: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {usable && <CopyButton text={link} label="Link" />}
      {usable && hasEmail && (
        <button type="button" className={buttonClass("secondary", "xs")} disabled={pending} onClick={() => run(() => resendInvite({ inviteId }))}>
          <Mail size={12} /> Resend
        </button>
      )}
      {revocable && (
        <button type="button" className={buttonClass("ghost", "xs", "text-loss")} disabled={pending} onClick={() => window.confirm("Revoke this invite? The link will stop working.") && run(() => revokeInvite({ inviteId }))}>
          <Trash2 size={12} /> Revoke
        </button>
      )}
    </div>
  );
}

export function LeagueCodeReset() {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      className={buttonClass("secondary", "xs")}
      disabled={pending}
      onClick={() => window.confirm("Generate a new league code? The old code stops working immediately (personal invites are unaffected).") && run(() => resetLeagueInviteCode())}
    >
      <RefreshCw size={12} className={pending ? "animate-spin" : undefined} /> New code
    </button>
  );
}

export function RoleSelect({ memberId, role, disabled }: { memberId: string; role: string; disabled?: boolean }) {
  const { pending, run } = useAction();
  if (role === "COMMISSIONER") return <span className="text-xs font-bold uppercase text-gold-600 dark:text-gold-400">Commissioner</span>;
  return (
    <select
      aria-label="Role"
      className="input w-auto py-1 text-xs"
      value={role}
      disabled={disabled || pending}
      onChange={(e) => run(() => changeMemberRole({ memberId, role: e.target.value as "MANAGER" | "CO_COMMISSIONER" }))}
    >
      <option value="MANAGER">Manager</option>
      <option value="CO_COMMISSIONER">Co-commish</option>
    </select>
  );
}

export function DuesToggle({ teamId, paid, teamName }: { teamId: string; paid: boolean; teamName: string }) {
  const { pending, run } = useAction();
  return (
    <button
      type="button"
      aria-pressed={paid}
      aria-label={`${teamName} dues ${paid ? "paid" : "unpaid"}`}
      disabled={pending}
      onClick={() => run(() => setDuesPaid({ teamId, paid: !paid }))}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase",
        paid ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300" : "border-line bg-sunken text-muted hover:text-ink",
      )}
    >
      {pending ? <Loader2 size={11} className="animate-spin" /> : paid ? <Check size={11} /> : null}
      {paid ? "Paid" : "Unpaid"}
    </button>
  );
}

interface TeamInfo {
  id: string;
  name: string;
  abbrev: string;
  primaryColor: string;
  secondaryColor: string;
  division: string | null;
  motto: string | null;
}

export function TeamActions({
  team,
  member,
  teamless,
  divisions,
  canFull,
  isSelf,
}: {
  team: TeamInfo;
  member: { id: string; name: string; role: string } | null;
  teamless: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  canFull: boolean;
  isSelf: boolean;
}) {
  const { pending, run } = useAction();
  const [modal, setModal] = useState<null | "edit" | "assign" | "replace">(null);
  const [form, setForm] = useState({ name: team.name, abbrev: team.abbrev, primaryColor: team.primaryColor, secondaryColor: team.secondaryColor, division: team.division ?? "", motto: team.motto ?? "" });
  const [assignTo, setAssignTo] = useState(teamless[0]?.id ?? "");
  const [replace, setReplace] = useState({ email: "", removeFromLeague: true, sendEmail: true });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const protectedMember = member?.role === "COMMISSIONER" || isSelf;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button type="button" className={buttonClass("secondary", "xs")} onClick={() => setModal("edit")} aria-label={`Edit ${team.name}`}>
        <Pencil size={12} /> Edit
      </button>
      {canFull && (
        <button type="button" className={buttonClass("secondary", "xs")} onClick={() => setModal("assign")} disabled={!teamless.length} title={teamless.length ? "Give this team to a member without a team" : "No members without a team"}>
          <UserCog size={12} /> Assign
        </button>
      )}
      {canFull && !protectedMember && (
        <button type="button" className={buttonClass("secondary", "xs")} onClick={() => setModal("replace")}>
          <UserPlus size={12} /> Replace
        </button>
      )}
      {canFull && member && !protectedMember && (
        <button
          type="button"
          className={buttonClass("ghost", "xs", "text-loss")}
          disabled={pending}
          onClick={() => window.confirm(`Remove ${member.name} from the league? ${team.name} becomes unowned (its roster, picks and history stay).`) && run(() => removeMember({ memberId: member.id }))}
        >
          <UserMinus size={12} /> Remove
        </button>
      )}

      <Modal
        open={modal === "edit"}
        onClose={() => setModal(null)}
        title={`Edit ${team.name}`}
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={pending}
              onClick={() => run(() => updateTeam({ teamId: team.id, ...form, division: form.division || null, motto: form.motto || null }), () => setModal(null))}
            >
              {pending && <Loader2 size={13} className="animate-spin" />} Save team
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="label">Team name</span>
            <input className="input" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Abbreviation</span>
            <input className="input uppercase" value={form.abbrev} maxLength={4} onChange={(e) => setForm({ ...form, abbrev: e.target.value.toUpperCase() })} />
          </label>
          <label className="block">
            <span className="label">Division</span>
            <select className="input" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}>
              <option value="">No division</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Primary color</span>
            <span className="flex gap-2">
              <input type="color" className="h-9 w-12 cursor-pointer rounded border border-line bg-panel" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} aria-label="Primary color picker" />
              <input className="input font-mono" value={form.primaryColor} maxLength={7} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
            </span>
          </label>
          <label className="block">
            <span className="label">Secondary color</span>
            <span className="flex gap-2">
              <input type="color" className="h-9 w-12 cursor-pointer rounded border border-line bg-panel" value={form.secondaryColor} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })} aria-label="Secondary color picker" />
              <input className="input font-mono" value={form.secondaryColor} maxLength={7} onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })} />
            </span>
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Motto</span>
            <input className="input" value={form.motto} maxLength={120} onChange={(e) => setForm({ ...form, motto: e.target.value })} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-md font-display text-xs font-extrabold text-white"
              style={{ background: `linear-gradient(135deg, ${form.primaryColor} 0%, ${form.primaryColor} 55%, ${form.secondaryColor} 55%)` }}
            >
              {form.abbrev || "?"}
            </span>
            <span className="text-xs text-muted">Logo preview</span>
          </div>
        </div>
      </Modal>

      <Modal
        open={modal === "assign"}
        onClose={() => setModal(null)}
        title={`Assign ${team.name}`}
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="button" className={buttonClass("primary", "sm")} disabled={pending || !assignTo} onClick={() => run(() => assignTeamOwner({ teamId: team.id, memberId: assignTo }), () => setModal(null))}>
              Assign team
            </button>
          </>
        }
      >
        <label className="block">
          <span className="label">Member</span>
          <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            {teamless.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {member && <p className="mt-2 text-xs text-muted">{member.name} stays in the league without a team.</p>}
      </Modal>

      <Modal
        open={modal === "replace"}
        onClose={() => {
          setModal(null);
          setInviteLink(null);
        }}
        title={`Replace ${team.name}'s manager`}
        footer={
          inviteLink ? (
            <button type="button" className={buttonClass("primary", "sm")} onClick={() => (setModal(null), setInviteLink(null))}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass("danger", "sm")}
                disabled={pending}
                onClick={() =>
                  run(
                    () => replaceManager({ teamId: team.id, ...replace }),
                    (r) => setInviteLink((r as { data?: { link: string } }).data?.link ?? null),
                  )
                }
              >
                {pending && <Loader2 size={13} className="animate-spin" />} Orphan team &amp; create invite
              </button>
            </>
          )
        }
      >
        {inviteLink ? (
          <div className="space-y-2 text-sm">
            <p>{team.name} is unowned and waiting for its new manager. Share this link:</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-sunken px-1.5 py-0.5 text-xs">{inviteLink}</code>
              <CopyButton text={inviteLink} label="Copy link" />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              {member ? `${member.name} will no longer manage ${team.name}.` : `${team.name} has no manager.`} The roster, contracts, picks and history stay with the team. A new invite (valid 14 days) is pre-assigned to this team.
            </p>
            <label className="block">
              <span className="label">New manager&apos;s email (optional)</span>
              <input type="email" className="input" value={replace.email} maxLength={200} onChange={(e) => setReplace({ ...replace, email: e.target.value })} />
            </label>
            {member && (
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={replace.removeFromLeague} onChange={(e) => setReplace({ ...replace, removeFromLeague: e.target.checked })} />
                Remove {member.name} from the league (otherwise they stay as a member without a team)
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={replace.sendEmail} disabled={!replace.email} onChange={(e) => setReplace({ ...replace, sendEmail: e.target.checked })} />
              Email the invite
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function AddTeamForm() {
  const { pending, run } = useAction();
  const [name, setName] = useState("");
  const [abbrev, setAbbrev] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addExpansionTeam({ name, abbrev }), () => (setName(""), setAbbrev("")));
      }}
    >
      <label className="block min-w-[12rem] flex-1">
        <span className="label">Team name</span>
        <input className="input py-1.5" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Expansion team" />
      </label>
      <label className="block w-24">
        <span className="label">Abbrev</span>
        <input className="input py-1.5 uppercase" value={abbrev} maxLength={4} onChange={(e) => setAbbrev(e.target.value.toUpperCase())} />
      </label>
      <button type="submit" className={buttonClass("secondary", "sm")} disabled={pending || name.trim().length < 2 || abbrev.length < 2}>
        {pending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add team
      </button>
    </form>
  );
}
