"use client";
// Generic settings section editor driven by the settings catalog: live client validation (same zod schema +
// cross-field checks the server uses), change tracking and the floating save bar (→ review sheet with the list
// of changes, the league vote when one is needed, a history note and "notify managers").
// Layout (docs/DESIGN.md): one card per group with a 17px title (its description in the ⓘ), fields as label +
// control (each field's help text in its own ⓘ), toggles as a label ↔ switch row.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Badge, InfoButton, Panel } from "@/components/ui/core";
import type { LeagueSettings, RosterSlotDef } from "@/lib/settings/schema";
import { canonical, describeChange, groupChanges, settingsChanges, slotsStructureChanged } from "@/lib/commissioner/settings-logic";
import { SECTION_BY_KEY, fieldEnabled, getAt, setAt, type EditableSection, type FieldDef } from "@/lib/commissioner/settings-meta";
import { crossFieldIssues, parseSection, type Issue } from "@/lib/commissioner/settings-validate";
import { saveSettingsSection } from "@/lib/commissioner/settings-actions";
import { FieldControl, type TeamLite } from "./fields";
import { VoteFields, voteReady, type VoteValue } from "./vote-fields";
import { SaveChangesBar } from "./save-changes";

const WIDE = new Set(["list", "slots", "positionLimits", "rookieScale", "rivalries", "players", "teams", "numberList", "ordered"]);

export function SettingsSectionForm({
  section,
  initial,
  settings,
  teams,
  players,
  version,
  lock,
  notifyDefault,
  canEdit,
  readOnlyReason,
  week,
}: {
  section: EditableSection;
  initial: unknown;
  settings: LeagueSettings;
  teams: TeamLite[];
  players: Record<string, string>;
  version: number;
  lock: { locked: boolean; requiresVote: boolean };
  notifyDefault: boolean;
  canEdit: boolean;
  readOnlyReason?: string;
  week: number;
}) {
  const meta = SECTION_BY_KEY[section];
  const router = useRouter();
  const [value, setValue] = useState<unknown>(initial);
  const [note, setNote] = useState("");
  const [vote, setVote] = useState<VoteValue>({ yes: 0, no: 0 });
  const voters = teams.length;
  const threshold = settings.commissioner.voteThresholdPercent;
  const [notifyManagers, setNotify] = useState(notifyDefault);
  const [pending, start] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const editable = canEdit && !lock.locked;

  const full = useMemo(() => ({ ...settings, [section]: value }) as LeagueSettings, [settings, section, value]);
  const fields = useMemo(() => meta.groups.flatMap((g) => g.fields), [meta]);

  const { errors, warnings } = useMemo(() => {
    const parsed = parseSection(section, value);
    if (!parsed.ok) return { errors: parsed.issues, warnings: [] as string[] };
    return crossFieldIssues(section, { ...settings, [section]: parsed.data } as LeagueSettings, { teamIds: teams.map((t) => t.id) });
  }, [section, value, settings, teams]);

  const errorFor = useMemo(() => {
    const map = new Map<string, string>();
    const loose: Issue[] = [];
    for (const e of errors) {
      const f = [...fields].sort((a, b) => b.path.length - a.path.length).find((x) => e.path === x.path || e.path.startsWith(`${x.path}.`));
      if (f && !map.has(f.path)) map.set(f.path, e.message);
      else if (!f) loose.push(e);
    }
    return { map, loose };
  }, [errors, fields]);

  const changes = useMemo(() => settingsChanges(initial, value), [initial, value]);
  const dirty = changes.length > 0;
  const changedFields = useMemo(() => new Set(fields.filter((f) => JSON.stringify(canonical(getAt(initial, f.path))) !== JSON.stringify(canonical(getAt(value, f.path)))).map((f) => f.path)), [fields, initial, value]);
  // readable "Field: old → new" lines for the review sheet (one per catalog field, like the history)
  const described = useMemo(() => {
    if (!dirty) return [];
    const before = { ...settings, [section]: initial } as LeagueSettings;
    const raw = settingsChanges({ [section]: initial }, { [section]: value });
    const lk = { teams: new Map(teams.map((t) => [t.id, t.name])), players: new Map(Object.entries(players)), tz: settings.general.timezone };
    return groupChanges(raw, before, full).map((c) => describeChange(c, lk));
  }, [dirty, settings, section, initial, value, full, teams, players]);

  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  const lookups = { teams, tz: settings.general.timezone, players, full };

  const save = () => {
    setServerError(null);
    if (errors.length) {
      toast.error(errors[0].message);
      return;
    }
    if (lock.requiresVote && !voteReady(vote, voters, threshold)) {
      toast.error(`In-season ${meta.label.toLowerCase()} changes need a league vote: at least ${threshold}% of managers must vote yes.`);
      return;
    }
    start(async () => {
      const res = await saveSettingsSection({ section, value, note: note.trim() || undefined, vote: lock.requiresVote ? vote : undefined, notifyManagers, expectedVersion: version });
      if (!res.ok) {
        setServerError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      setNote("");
      router.refresh();
    });
  };

  const renderField = (f: FieldDef, groupId: string) => {
    const enabled = editable && fieldEnabled(f, value);
    const id = `f-${section}-${f.path.replace(/\./g, "-")}`;
    const err = errorFor.map.get(f.path);
    const changed = changedFields.has(f.path);
    const wide = WIDE.has(f.kind) || (f.kind === "text" && f.multiline);
    const head = (
      <span className="block min-w-0">
        <span className="flex min-w-0 items-center gap-1">
          <label htmlFor={f.kind === "toggle" ? undefined : id} className="inline-flex min-h-6 min-w-0 items-center text-[15px] font-semibold leading-5 text-ink sm:text-sm">
            {f.label}
          </label>
          {changed && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-400" title="Unsaved change" aria-label="changed" />}
          {f.help && (
            <InfoButton title={f.label} label={`About ${f.label}`}>
              <p>{f.help}</p>
            </InfoButton>
          )}
        </span>
        {/* on its own line so it never squeezes the label */}
        {f.notEnforced && (
          <Badge tone="amber" className="mt-0.5" title="Nothing on the site applies this setting yet (see ⓘ)">
            Not enforced
          </Badge>
        )}
      </span>
    );
    return (
      <div key={`${groupId}-${f.path}`} className={cn("min-w-0", wide && "sm:col-span-2", !fieldEnabled(f, value) && "opacity-60")}>
        {f.kind === "toggle" ? (
          // label ↔ switch on one row
          <div className="flex min-h-11 items-center justify-between gap-3">
            {head}
            <FieldControl field={f} value={getAt(value, f.path)} onChange={(v) => setValue((cur: unknown) => setAt(cur, f.path, v))} disabled={!enabled} lookups={lookups} id={id} />
          </div>
        ) : f.kind === "number" ? (
          // label ↔ number box on one row (a settings list, not a form wall)
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 pt-2 sm:pt-1.5">{head}</div>
            <div className="w-[9.5rem] shrink-0">
              <FieldControl field={f} value={getAt(value, f.path)} onChange={(v) => setValue((cur: unknown) => setAt(cur, f.path, v))} disabled={!enabled} lookups={lookups} id={id} inline />
            </div>
          </div>
        ) : (
          <>
            <div className="mb-1.5">{head}</div>
            <FieldControl field={f} value={getAt(value, f.path)} onChange={(v) => setValue((cur: unknown) => setAt(cur, f.path, v))} disabled={!enabled} lookups={lookups} id={id} />
          </>
        )}
        {f.kind === "slots" && slotsStructureChanged((getAt(initial, f.path) as RosterSlotDef[]) ?? [], (getAt(value, f.path) as RosterSlotDef[]) ?? []) && (
          <Alert tone="warn" icon className="mt-2 text-[13px]">
            Saving rebuilds every team&apos;s lineup for Week {week} (or Week {week + 1} if Week {week} games have kicked off) and all later weeks. Each team&apos;s last lineup carries forward into matching slots; new
            slots start empty, so remind managers to check their lineups.
          </Alert>
        )}
        {err && (
          <p role="alert" className="mt-1 text-[13px] font-semibold text-loss">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="pb-4">
      {(lock.locked || lock.requiresVote || !canEdit) && (
        <Alert tone={lock.locked || !canEdit ? "error" : "warn"} icon className="mb-3">
          {!canEdit
            ? readOnlyReason
            : lock.locked
              ? `${meta.label} settings are locked during the season. Unlock them under Commissioner › Setting locks.`
              : `In-season changes need a league vote: record it when you save (${threshold}% of ${voters} managers must vote yes).`}
        </Alert>
      )}

      <div className="space-y-4">
        {meta.groups.map((g) => (
          <Panel key={g.id} id={`g-${g.id}`} title={g.title} info={g.description ? <p>{g.description}</p> : undefined} className="scroll-mt-4">
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{g.fields.map((f) => renderField(f, g.id))}</div>
          </Panel>
        ))}
      </div>

      {(warnings.length > 0 || errorFor.loose.length > 0 || serverError) && (
        <Alert tone="warn" className="mt-4 space-y-1.5">
          {serverError && <p className="font-semibold text-loss">{serverError}</p>}
          {errorFor.loose.map((e, i) => (
            <p key={`e${i}`} className="font-semibold text-loss">
              {e.message}
            </p>
          ))}
          {warnings.map((w, i) => (
            <p key={i} className="flex gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
        </Alert>
      )}

      {editable && (
        <SaveChangesBar
          count={changes.length}
          issues={errors.length}
          pending={pending}
          title={`Save ${meta.label.toLowerCase()} settings`}
          saveLabel={`Save ${meta.label.toLowerCase()}`}
          changes={described}
          note={note}
          onNote={setNote}
          notify={notifyManagers}
          onNotify={setNotify}
          onReset={() => setValue(initial)}
          onSave={save}
          saveDisabled={lock.requiresVote && !voteReady(vote, voters, threshold)}
        >
          {lock.requiresVote && <VoteFields value={vote} onChange={setVote} voters={voters} threshold={threshold} />}
        </SaveChangesBar>
      )}
    </div>
  );
}
