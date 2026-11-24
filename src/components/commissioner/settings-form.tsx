"use client";
// Generic settings section editor driven by the settings catalog: live client validation (same zod
// schema + cross-field checks the server uses), change tracking and a sticky save bar.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Lock, RotateCcw, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/core";
import type { LeagueSettings, RosterSlotDef } from "@/lib/settings/schema";
import { canonical, settingsChanges, slotsStructureChanged } from "@/lib/commissioner/settings-logic";
import { SECTION_BY_KEY, fieldEnabled, getAt, setAt, type EditableSection, type FieldDef } from "@/lib/commissioner/settings-meta";
import { crossFieldIssues, parseSection, type Issue } from "@/lib/commissioner/settings-validate";
import { saveSettingsSection } from "@/lib/commissioner/settings-actions";
import { FieldControl, type TeamLite } from "./fields";

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
    if (lock.requiresVote && !note.trim()) {
      toast.error("Record the league vote result in the note to save this section in season.");
      return;
    }
    start(async () => {
      const res = await saveSettingsSection({ section, value, note: note.trim() || undefined, notifyManagers, expectedVersion: version });
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
    return (
      <div key={`${groupId}-${f.path}`} className={cn("min-w-0 rounded-md px-1 py-1.5", wide && "sm:col-span-2", !fieldEnabled(f, value) && "opacity-60")}>
        <div className="mb-1 flex items-start justify-between gap-2">
          <label htmlFor={id} className="text-[13px] font-semibold leading-tight text-ink">
            {f.label}
            {changed && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-500 align-middle" title="Unsaved change" aria-label="changed" />}
          </label>
        </div>
        {f.help && <p className="mb-1.5 text-xs leading-snug text-muted">{f.help}</p>}
        <FieldControl field={f} value={getAt(value, f.path)} onChange={(v) => setValue((cur: unknown) => setAt(cur, f.path, v))} disabled={!enabled} lookups={lookups} id={id} />
        {f.kind === "slots" && slotsStructureChanged((getAt(initial, f.path) as RosterSlotDef[]) ?? [], (getAt(value, f.path) as RosterSlotDef[]) ?? []) && (
          <p className="mt-2 flex gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            Saving rebuilds every team&apos;s lineup for Week {week} (or Week {week + 1} if Week {week} games have kicked off) and all later weeks. Each team&apos;s last lineup carries
            forward into matching slots; new slots start empty, so remind managers to check their lineups.
          </p>
        )}
        {err && (
          <p role="alert" className="mt-1 text-xs font-semibold text-loss">
            {err}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="pb-4">
      {(lock.locked || lock.requiresVote || !canEdit) && (
        <div className={cn("mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm", lock.locked || !canEdit ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100")}>
          {lock.locked || !canEdit ? <Lock size={16} className="mt-0.5 shrink-0" /> : <Vote size={16} className="mt-0.5 shrink-0" />}
          <div>
            {!canEdit
              ? readOnlyReason
              : lock.locked
                ? `${meta.label} settings are locked during the season. Unlock them under Commissioner › Setting locks.`
                : `In-season changes to ${meta.label.toLowerCase()} need a league vote. Record the vote result in the note when you save.`}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {meta.groups.map((g) => (
          <a key={g.id} href={`#g-${g.id}`} className="chip hover:bg-sunken">
            {g.title}
          </a>
        ))}
      </div>

      <div className="space-y-4">
        {meta.groups.map((g) => (
          <section key={g.id} id={`g-${g.id}`} className="scroll-mt-32 overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
            <header className="border-b border-line bg-sunken/70 px-3 py-2">
              <h2 className="font-display text-[15px] font-bold uppercase tracking-wide text-ink">{g.title}</h2>
              {g.description && <p className="text-xs text-muted">{g.description}</p>}
            </header>
            <div className="grid gap-x-6 gap-y-2 p-3 sm:grid-cols-2">{g.fields.map((f) => renderField(f, g.id))}</div>
          </section>
        ))}
      </div>

      {(warnings.length > 0 || errorFor.loose.length > 0 || serverError) && (
        <div className="mt-4 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          {serverError && <p className="font-semibold text-loss">{serverError}</p>}
          {errorFor.loose.map((e, i) => (
            <p key={`e${i}`} className="font-semibold text-loss">
              {e.message}
            </p>
          ))}
          {warnings.map((w, i) => (
            <p key={i} className="flex gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      {editable && (
        <div className={cn("mt-4 rounded-lg border bg-panel/95 p-2.5", dirty ? "sticky bottom-[60px] z-30 border-gold-500 shadow-pop backdrop-blur md:bottom-2" : "border-line")}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              {dirty ? (
                <span className="font-semibold text-ink">
                  {changes.length} unsaved change{changes.length === 1 ? "" : "s"}
                  {errors.length > 0 && <span className="ml-2 text-loss">· {errors.length} to fix</span>}
                </span>
              ) : (
                <span className="text-muted">No unsaved changes · version {version}</span>
              )}
            </div>
            {dirty && (
              <>
                <input
                  className="input order-last w-full py-1.5 text-xs sm:order-none sm:w-64"
                  placeholder={lock.requiresVote ? "League vote result (required)" : "Note for the history (optional)"}
                  value={note}
                  maxLength={500}
                  aria-label="Change note"
                  onChange={(e) => setNote(e.target.value)}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={notifyManagers} onChange={(e) => setNotify(e.target.checked)} />
                  Notify managers
                </label>
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setValue(initial)} disabled={pending}>
                  <RotateCcw size={13} /> Reset
                </button>
              </>
            )}
            <button type="button" className={buttonClass("primary", "sm")} onClick={save} disabled={!dirty || pending || errors.length > 0}>
              {pending && <Loader2 size={13} className="animate-spin" />} Save {meta.label.toLowerCase()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
