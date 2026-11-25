"use client";
// Scoring rules editor: presets, every stat in the catalog with position overrides, milestone and long-TD
// bonuses, FG distance tiers, DST points/yards allowed tiers, preview impact, save (+ optional re-score).
// Phones: the per-stat table becomes a list with a column switcher (Base / QB / RB …: which value the boxes edit);
// md+ keeps the full grid. Explanations sit in each card's ⓘ; saving goes through the review sheet.
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BarChart3, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Badge, buttonClass, chipClass, Panel, StatGrid } from "@/components/ui/core";
import { SegmentedControl, Toggle } from "@/components/ui/client";
import { DEFAULT_SETTINGS, type BonusRule, type LeagueSettings } from "@/lib/settings/schema";
import { STAT_CATALOG, STAT_GROUPS, type StatGroup } from "@/lib/settings/stat-catalog";
import { COMBO_STATS, detectPreset, parseScoring, scoringIssues } from "@/lib/commissioner/settings-validate";
import { applyScoringPreset, describeChange, groupChanges, settingsChanges, uniqueId } from "@/lib/commissioner/settings-logic";
import { previewScoringImpact, saveScoringSettings } from "@/lib/commissioner/settings-actions";
import type { ScoringPreview } from "@/lib/commissioner/scoring-preview";
import { addBtnClass, Chips, NumberInput } from "./fields";
import { VoteFields, voteReady, type VoteValue } from "./vote-fields";
import { SaveChangesBar } from "./save-changes";

type Scoring = LeagueSettings["scoring"];

const GROUP_POSITIONS: Record<StatGroup, string[]> = {
  Passing: ["QB", "RB", "WR", "TE"],
  Rushing: ["QB", "RB", "WR", "TE"],
  Receiving: ["RB", "WR", "TE"],
  "Misc Offense": ["QB", "RB", "WR", "TE"],
  Kicking: ["K"],
  "Team Defense": ["DEF"],
  "Special Teams": ["RB", "WR", "TE", "DEF"],
  IDP: ["DL", "LB", "DB"],
};
const TIER_KEYS = new Set(["pts_allow", "yds_allow"]);
const ALL_POS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const posLabel = (p: string) => (p === "DEF" ? "DST" : p);
// 36px on phones, 28px from sm
const iconBtn = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-muted shadow-[inset_0_0_0_1px_rgb(var(--c-line))] transition-colors hover:bg-sunken hover:text-loss sm:h-7 sm:w-7 dark:bg-white/[0.04]";

/** A scoring card: 17px title, its explanation in the ⓘ, optional header action. */
function Section({ title, info, children, actions, id }: { title: string; info?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <Panel id={id} title={title} info={info ? <p>{info}</p> : undefined} actions={actions} className="scroll-mt-4">
      {children}
    </Panel>
  );
}

/** Range rows (DST points / yards allowed): "0–6 · up to [6] · [10] pts · ×" — fits a 360px phone. */
function TierEditor({
  tiers,
  onChange,
  unit,
  disabled,
}: {
  tiers: { max: number; points: number }[];
  onChange: (t: { max: number; points: number }[]) => void;
  unit: string;
  disabled?: boolean;
}) {
  const sorted = tiers.map((t, i) => ({ ...t, i })).sort((a, b) => a.max - b.max);
  return (
    <div className="space-y-2">
      <div className="eyebrow grid grid-cols-[4.25rem_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 sm:grid-cols-[5rem_8rem_7rem_1.75rem]" aria-hidden>
        <span>Range</span>
        <span>Up to</span>
        <span>Points</span>
        <span />
      </div>
      <ul className="space-y-1.5">
        {sorted.map((t, idx) => {
          const lo = idx === 0 ? 0 : sorted[idx - 1].max + 1;
          return (
            <li key={t.i} className="grid grid-cols-[4.25rem_minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-2 sm:grid-cols-[5rem_8rem_7rem_1.75rem]">
              <span className="numeral truncate text-[13px] text-muted">{idx === sorted.length - 1 && t.max >= 999 ? `${lo}+` : `${lo}–${t.max}`}</span>
              <NumberInput ariaLabel={`${unit} up to`} value={t.max} min={0} max={99999} int disabled={disabled} onChange={(n) => onChange(tiers.map((x, j) => (j === t.i ? { ...x, max: n } : x)))} />
              <NumberInput ariaLabel={`${unit} tier points`} value={t.points} min={-100} max={100} step={0.5} disabled={disabled} onChange={(n) => onChange(tiers.map((x, j) => (j === t.i ? { ...x, points: n } : x)))} />
              {!disabled ? (
                <button type="button" className={iconBtn} onClick={() => onChange(tiers.filter((_, j) => j !== t.i))} aria-label="Remove tier">
                  <X size={13} />
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
      {!disabled && tiers.length < 20 && (
        <button type="button" className={addBtnClass} onClick={() => onChange([...tiers, { max: (sorted[sorted.length - 1]?.max ?? 0) + 7, points: 0 }])}>
          <Plus size={13} /> Add tier
        </button>
      )}
    </div>
  );
}

export function ScoringEditor({
  initial,
  idpEnabled,
  version,
  notifyDefault,
  locked,
  requiresVote,
  voters,
  voteThreshold,
  canEdit,
  week,
}: {
  initial: Scoring;
  idpEnabled: boolean;
  version: number;
  notifyDefault: boolean;
  locked: boolean;
  requiresVote: boolean;
  /** managers eligible to vote on in-season rule changes */
  voters: number;
  voteThreshold: number;
  canEdit: boolean;
  week: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Scoring>(initial);
  const [group, setGroup] = useState<StatGroup>("Passing");
  // phones: which column the per-stat boxes edit (the base value or one position's override)
  const [col, setCol] = useState<string>("base");
  const [applyMode, setApplyMode] = useState<"CURRENT_AND_FUTURE" | "WHOLE_SEASON">("CURRENT_AND_FUTURE");
  const [note, setNote] = useState("");
  const [vote, setVote] = useState<VoteValue>({ yes: 0, no: 0 });
  const [notifyManagers, setNotify] = useState(notifyDefault);
  const [preview, setPreview] = useState<ScoringPreview | null>(null);
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();
  const [newOverride, setNewOverride] = useState({ pos: "TE", stat: "rec", value: 1.5 });
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const editable = canEdit && !locked;

  const groups = STAT_GROUPS.filter((g) => g !== "IDP" || idpEnabled);
  const positions = ALL_POS.filter((p) => idpEnabled || !["DL", "LB", "DB"].includes(p));

  const set = (patch: Partial<Scoring>) =>
    setValue((cur) => {
      const next = { ...cur, ...patch };
      if (patch.rules) next.preset = detectPreset(next.rules, DEFAULT_SETTINGS.scoring.rules);
      return next;
    });

  const setRule = (key: string, n: number) => set({ rules: { ...value.rules, [key]: n } });
  const setOverride = (pos: string, key: string, n: number | null) => {
    const po = { ...value.positionOverrides };
    const m = { ...(po[pos] ?? {}) };
    if (n === null || Number.isNaN(n)) delete m[key];
    else m[key] = n;
    if (Object.keys(m).length) po[pos] = m;
    else delete po[pos];
    set({ positionOverrides: po });
  };

  const { errors, warnings } = useMemo(() => {
    const parsed = parseScoring(value);
    if (!parsed.ok) return { errors: parsed.issues.map((i) => i.message), warnings: [] as string[] };
    const r = scoringIssues(parsed.data);
    return { errors: r.errors.map((e) => e.message), warnings: r.warnings };
  }, [value]);
  // compare canonical forms (empty bonus positions, overrides equal to the base value) so no-op edits don't count
  const changeList = useMemo(() => {
    const a = parseScoring(initial);
    const b = parseScoring(value);
    const before = a.ok ? a.data : initial;
    const after = b.ok ? b.data : value;
    const raw = settingsChanges({ scoring: before }, { scoring: after });
    return groupChanges(raw, { scoring: before } as unknown as LeagueSettings, { scoring: after } as unknown as LeagueSettings).map((c) => describeChange(c));
  }, [initial, value]);
  const changes = useMemo(() => {
    const a = parseScoring(initial);
    const b = parseScoring(value);
    return settingsChanges(a.ok ? a.data : initial, b.ok ? b.data : value).length;
  }, [initial, value]);
  const dirty = changes > 0;

  useEffect(() => {
    setPreview(null);
  }, [value]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const runPreview = () =>
    startPreview(async () => {
      const r = await previewScoringImpact({ scoring: value });
      if (!r.ok) toast.error(r.error);
      else {
        setPreview(r.data ?? null);
        setTimeout(() => document.getElementById("preview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    });

  const save = () => {
    if (errors.length) return toast.error(errors[0]);
    if (requiresVote && !voteReady(vote, voters, voteThreshold)) return toast.error(`In-season scoring changes need a league vote: at least ${voteThreshold}% of managers must vote yes.`);
    if (applyMode === "WHOLE_SEASON" && !window.confirm("Re-score every completed week with the new rules? Final scores, results and standings can change.")) return;
    startSave(async () => {
      const r = await saveScoringSettings({ scoring: value, applyMode, note: note.trim() || undefined, vote: requiresVote ? vote : undefined, notifyManagers, expectedVersion: version });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Scoring saved");
      setNote("");
      router.refresh();
    });
  };

  const stats = STAT_CATALOG.filter((s) => s.group === group);
  const groupPositions = GROUP_POSITIONS[group].filter((p) => positions.includes(p));
  const nonZero = (g: StatGroup) => STAT_CATALOG.filter((s) => s.group === g && !TIER_KEYS.has(s.key) && (value.rules[s.key] ?? 0) !== 0).length;
  const overrideList = Object.entries(value.positionOverrides).flatMap(([pos, m]) => Object.entries(m).map(([k, v]) => ({ pos, k, v })));
  const bonusStatOptions = [...COMBO_STATS.map((c) => ({ value: c.key, label: `${c.label} (combined)` })), ...STAT_CATALOG.filter((s) => !TIER_KEYS.has(s.key)).map((s) => ({ value: s.key, label: `${s.group}: ${s.label}` }))];

  const setBonus = (i: number, patch: Partial<BonusRule>) => set({ bonuses: value.bonuses.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const longTd = (yards: 40 | 50) => value.longTdBonuses.find((l) => l.minYards === yards);
  const setLongTd = (yards: 40 | 50, pts: number | null) => {
    const rest = value.longTdBonuses.filter((l) => l.minYards !== yards);
    set({ longTdBonuses: pts === null ? rest : [...rest, { minYards: yards, points: pts }].sort((a, b) => a.minYards - b.minYards) });
  };

  // phones: the column switcher (Base + this group's positions); a stale choice falls back to Base
  const phoneCol = col === "base" || groupPositions.includes(col) ? col : "base";

  return (
    <div className="space-y-4 pb-4">
      {(locked || requiresVote || !canEdit) && (
        <Alert tone={locked || !canEdit ? "error" : "warn"} icon>
          {!canEdit
            ? "Co-commissioners can view but not change scoring."
            : locked
              ? "Scoring is locked during the season (Settings › Commissioner › Setting locks)."
              : `In-season scoring changes need a league vote: record it when you save (${voteThreshold}% of ${voters} managers must vote yes).`}
        </Alert>
      )}

      <Section title="Basics" info="Start from a preset, then fine-tune any value below. Applying a preset resets every per-stat value; bonuses, tiers and position overrides are kept.">
        <div className="space-y-4">
          <div>
            <div className="label">Preset</div>
            <div className="flex flex-wrap items-center gap-2">
              {(["PPR", "HALF_PPR", "STANDARD"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!editable}
                  aria-pressed={value.preset === p}
                  onClick={() => window.confirm(`Reset every per-stat value to the ${p === "HALF_PPR" ? "Half PPR" : p} preset? Bonuses, tiers and position overrides are kept.`) && setValue(applyScoringPreset(value, p))}
                  className={chipClass(value.preset === p, "md", "disabled:opacity-50")}
                >
                  {p === "HALF_PPR" ? "Half PPR" : p === "PPR" ? "PPR" : "Standard"}
                </button>
              ))}
              {value.preset === "CUSTOM" && <Badge tone="brand">Custom</Badge>}
            </div>
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-semibold text-ink sm:text-sm">Decimal places</span>
              <NumberInput ariaLabel="Decimal places" value={value.decimals} min={0} max={3} int disabled={!editable} className="w-[9.5rem] shrink-0" onChange={(n) => set({ decimals: n })} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="text-[15px] font-semibold text-ink sm:text-sm">Round player totals</span>
              <span className={cn(!editable && "pointer-events-none opacity-50")}>
                <Toggle checked={value.roundToDecimals} onChange={(v) => set({ roundToDecimals: v })} label={<span className="sr-only">Round player totals to {value.decimals} decimals</span>} />
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="pt-2 text-[15px] font-semibold text-ink sm:pt-1.5 sm:text-sm">Negative points floor</span>
              <div className="w-[9.5rem] shrink-0 space-y-1">
                <NumberInput ariaLabel="Negative points floor" value={value.negativePointsFloor} min={-100} max={0} step={0.5} disabled={!editable || value.negativePointsFloor === null} className="w-full" onChange={(n) => set({ negativePointsFloor: n })} />
                <label className="flex min-h-8 items-center gap-2 text-[13px] text-muted">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={value.negativePointsFloor === null} disabled={!editable} onChange={(e) => set({ negativePointsFloor: e.target.checked ? null : 0 })} />
                  No floor
                </label>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Points per stat"
        id="stats"
        info="Base points for every stat. A position column overrides the base for that position only (blank = use the base). Decimals and negatives are allowed. On a phone, pick the column to edit with the Base / position switch."
      >
        <div className="scroll-thin -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-0.5" role="group" aria-label="Stat group">
          {groups.map((g) => (
            <button key={g} type="button" onClick={() => setGroup(g)} className={chipClass(g === group, "sm")} aria-pressed={g === group}>
              {g}
              <span className={cn("numeral rounded-full px-1.5 text-[11px] font-bold leading-4", g === group ? "bg-white/20" : "bg-ink/[0.07] text-muted dark:bg-white/10")}>{nonZero(g)}</span>
            </button>
          ))}
        </div>
        {group === "Kicking" && (
          <p className="mb-2 text-[13px] text-muted">
            {value.useFieldGoalDistance ? "Field goals are scored by distance (table below); the flat “Field Goals Made” value only applies without a distance." : "Distance scoring is off: every made field goal earns the flat “Field Goals Made” value plus any distance-bucket values."}
          </p>
        )}
        {group === "Team Defense" && <p className="mb-2 text-[13px] text-muted">Points and yards allowed are scored with the tier tables below.</p>}

        {/* phones: one value column at a time */}
        <div className="md:hidden">
          {groupPositions.length > 0 && (
            <SegmentedControl
              ariaLabel="Column to edit"
              full
              className="mb-2"
              value={phoneCol}
              onChange={setCol}
              options={[{ value: "base", label: "Base" }, ...groupPositions.map((p) => ({ value: p, label: posLabel(p), title: `${posLabel(p)} override` }))]}
            />
          )}
          <ul className="-mx-4 divide-y divide-line/70 border-y border-line/70">
            {stats.map((s) => {
              const isTier = TIER_KEYS.has(s.key);
              const base = value.rules[s.key] ?? 0;
              const ov = phoneCol === "base" ? undefined : value.positionOverrides[phoneCol]?.[s.key];
              const overrides = groupPositions.filter((p) => value.positionOverrides[p]?.[s.key] !== undefined);
              return (
                <li key={s.key} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-5 text-ink">{s.label}</span>
                    <span className="block truncate text-[12px] leading-4 text-muted">
                      {phoneCol === "base" ? (overrides.length ? `${overrides.map(posLabel).join(", ")} override` : s.key) : `Base ${base}`}
                    </span>
                  </span>
                  {isTier ? (
                    <a href="#def-tiers" className="link shrink-0 text-[13px]">
                      Tiers ↓
                    </a>
                  ) : phoneCol === "base" ? (
                    <NumberInput ariaLabel={`${s.label} points`} value={base} min={-100} max={100} step={0.01} disabled={!editable} className="w-28 shrink-0" onChange={(n) => setRule(s.key, n)} />
                  ) : (
                    <NumberInput
                      ariaLabel={`${posLabel(phoneCol)} ${s.label} override`}
                      value={ov ?? null}
                      min={-100}
                      max={100}
                      step={0.01}
                      placeholder={String(base)}
                      disabled={!editable}
                      className={cn("w-28 shrink-0", ov !== undefined && "border-brand-600 dark:border-brand-400")}
                      onChange={(n) => setOverride(phoneCol, s.key, Number.isNaN(n) ? null : n)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* md+: the whole grid */}
        <div className="hidden max-h-[70vh] overflow-auto rounded-lg ring-1 ring-inset ring-line/80 md:block">
          <table className="tbl tbl-compact min-w-[560px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="tbl-sticky !z-20">Stat</th>
                <th className="w-28">Base pts</th>
                {groupPositions.map((p) => (
                  <th key={p} className="w-24">
                    {posLabel(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const isTier = TIER_KEYS.has(s.key);
                return (
                  <tr key={s.key}>
                    <td className="tbl-sticky">
                      <div className="text-[13px] font-semibold text-ink">{s.label}</div>
                      <div className="font-mono text-[12px] text-muted">{s.key}</div>
                    </td>
                    {isTier ? (
                      <td colSpan={1 + groupPositions.length} className="text-[13px] text-muted">
                        <a href="#def-tiers" className="link">
                          Scored by tiers ↓
                        </a>
                      </td>
                    ) : (
                      <>
                        <td>
                          <NumberInput ariaLabel={`${s.label} points`} value={value.rules[s.key] ?? 0} min={-100} max={100} step={0.01} disabled={!editable} onChange={(n) => setRule(s.key, n)} />
                        </td>
                        {groupPositions.map((p) => {
                          const ov = value.positionOverrides[p]?.[s.key];
                          return (
                            <td key={p}>
                              <NumberInput
                                ariaLabel={`${posLabel(p)} ${s.label} override`}
                                value={ov ?? null}
                                min={-100}
                                max={100}
                                step={0.01}
                                placeholder={String(value.rules[s.key] ?? 0)}
                                disabled={!editable}
                                className={cn(ov !== undefined && "border-brand-600 dark:border-brand-400")}
                                onChange={(n) => setOverride(p, s.key, Number.isNaN(n) ? null : n)}
                              />
                            </td>
                          );
                        })}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Position overrides" info="Every position-specific value in one place (TE premium, 6-point QB touchdowns, RB carry points…).">
        {overrideList.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {overrideList.map((o) => (
              <span key={`${o.pos}-${o.k}`} className="chip max-w-full py-1 text-[13px]">
                <span className="min-w-0 truncate">
                  <b>{posLabel(o.pos)}</b> {STAT_CATALOG.find((s) => s.key === o.k)?.label ?? o.k}: <span className="numeral">{o.v}</span> <span className="numeral text-muted">(base {value.rules[o.k] ?? 0})</span>
                </span>
                {editable && (
                  <button type="button" className="-my-1 -mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-loss" onClick={() => setOverride(o.pos, o.k, null)} aria-label={`Remove ${o.pos} ${o.k} override`}>
                    <X size={13} />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-[15px] text-muted sm:text-sm">None: every position scores the base values.</p>
        )}
        {editable && (
          <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 sm:flex sm:flex-wrap sm:items-end">
            <label className="block">
              <span className="label">Position</span>
              <select className="input py-1.5" value={newOverride.pos} onChange={(e) => setNewOverride((o) => ({ ...o, pos: e.target.value }))}>
                {positions.map((p) => (
                  <option key={p} value={p}>
                    {posLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 sm:w-64">
              <span className="label">Stat</span>
              <select className="input py-1.5" value={newOverride.stat} onChange={(e) => setNewOverride((o) => ({ ...o, stat: e.target.value, value: value.rules[e.target.value] ?? 0 }))}>
                {STAT_CATALOG.filter((s) => !TIER_KEYS.has(s.key)).map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.group}: {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Points</span>
              <NumberInput ariaLabel="Override points" value={newOverride.value} min={-100} max={100} step={0.01} className="sm:w-28" onChange={(n) => setNewOverride((o) => ({ ...o, value: n }))} />
            </label>
            <button type="button" className={buttonClass("secondary", "md", "self-end")} disabled={Number.isNaN(newOverride.value)} onClick={() => setOverride(newOverride.pos, newOverride.stat, newOverride.value)}>
              <Plus size={14} /> Add override
            </button>
          </div>
        )}
      </Section>

      <Section title="Milestone bonuses" actions={value.bonuses.length ? <span className="text-[13px] text-muted">Tap one to edit</span> : undefined} info="One-time (or repeating) bonuses for reaching a stat threshold in a game. Combined stats like rushing + receiving yards are supported. With no positions selected a bonus applies to every position.">
        {value.bonuses.length ? (
          <div className="space-y-2">
            {value.bonuses.map((b, i) => (
              // one summary row per bonus; tap to edit it (a new bonus opens straight away)
              <details key={b.id} className="group rounded-lg bg-sunken" open={b.id === justAdded || undefined}>
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{b.label || "Untitled bonus"}</span>
                    <span className="block truncate text-[13px] leading-[18px] text-muted">
                      {bonusStatOptions.find((o) => o.value === b.stat)?.label.replace(/^[^:]+: /, "") ?? b.stat} ≥ {b.threshold}
                      {b.repeatEvery ? ` · every ${b.repeatEvery}` : ""} · {b.positions?.length ? b.positions.map(posLabel).join(", ") : "all positions"}
                    </span>
                  </span>
                  <span className="numeral shrink-0 text-[15px] font-semibold text-ink">
                    {b.points > 0 ? "+" : ""}
                    {b.points}
                  </span>
                  <ChevronDown size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                </summary>
              <div className="grid grid-cols-3 gap-2 border-t border-line/70 p-2.5 sm:grid-cols-[1.2fr_1.4fr_6.5rem_6rem_7rem_auto]">
                <label className="col-span-3 block min-w-0 sm:col-span-1">
                  <span className="eyebrow mb-1 block">Label</span>
                  <input className="input py-1.5" value={b.label} maxLength={60} disabled={!editable} onChange={(e) => setBonus(i, { label: e.target.value })} />
                </label>
                <label className="col-span-3 block min-w-0 sm:col-span-1">
                  <span className="eyebrow mb-1 block">Stat</span>
                  <select className="input py-1.5" value={b.stat} disabled={!editable} onChange={(e) => setBonus(i, { stat: e.target.value })}>
                    {bonusStatOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="eyebrow mb-1 block truncate">Threshold</span>
                  <NumberInput ariaLabel={`${b.label} threshold`} value={b.threshold} min={0} max={10000} step={1} disabled={!editable} onChange={(n) => setBonus(i, { threshold: n })} />
                </label>
                <label className="block min-w-0">
                  <span className="eyebrow mb-1 block truncate">Points</span>
                  <NumberInput ariaLabel={`${b.label} points`} value={b.points} min={-100} max={100} step={0.5} disabled={!editable} onChange={(n) => setBonus(i, { points: n })} />
                </label>
                <label className="block min-w-0">
                  <span className="eyebrow mb-1 block truncate" title="Repeat every">
                    Repeat
                  </span>
                  <NumberInput ariaLabel={`${b.label} repeat every`} value={b.repeatEvery ?? null} min={0} max={10000} placeholder="Once" disabled={!editable} onChange={(n) => setBonus(i, { repeatEvery: Number.isNaN(n) || n === 0 ? null : n })} />
                </label>
                <div className="order-last flex items-end justify-end sm:order-none">
                  {editable && (
                    <button type="button" className={iconBtn} onClick={() => set({ bonuses: value.bonuses.filter((_, j) => j !== i) })} aria-label={`Remove bonus ${b.label}`}>
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="col-span-2 sm:col-span-6">
                  <span className="eyebrow mb-1 block">Positions</span>
                  <Chips options={positions.map((p) => ({ value: p, label: posLabel(p) }))} value={b.positions ?? []} disabled={!editable} onChange={(v) => setBonus(i, { positions: v })} ariaLabel={`${b.label} positions`} />
                </div>
              </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-muted sm:text-sm">No milestone bonuses.</p>
        )}
        {editable && value.bonuses.length < 60 && (
          <button
            type="button"
            className={cn(addBtnClass, "mt-3")}
            onClick={() => {
              const id = uniqueId("bonus", value.bonuses.map((b) => b.id));
              setJustAdded(id);
              set({ bonuses: [...value.bonuses, { id, label: "100+ rush + rec yards", stat: "rush_rec_yd", threshold: 100, points: 1, positions: [], repeatEvery: null }] });
            }}
          >
            <Plus size={13} /> Add bonus
          </button>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Long touchdown bonuses" info="Extra points for any offensive TD of 40+ or 50+ yards, on top of the TD itself. A 55-yard TD earns both bonuses when both are on.">
          <div className="divide-y divide-line/70">
            {([40, 50] as const).map((y) => {
              const lt = longTd(y);
              return (
                <div key={y} className="flex min-h-[52px] items-center justify-between gap-3 py-1.5">
                  <span className={cn("flex items-center gap-3", !editable && "pointer-events-none opacity-60")}>
                    <Toggle checked={!!lt} onChange={(v) => setLongTd(y, v ? 1 : null)} label={<span className="text-[15px] font-semibold text-ink sm:text-sm">{y}+ yard TD</span>} />
                  </span>
                  {lt && <NumberInput ariaLabel={`${y}+ yard TD bonus`} value={lt.points} min={-100} max={100} step={0.5} suffix="pts" className="w-32 shrink-0" disabled={!editable} onChange={(n) => setLongTd(y, n)} />}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Field goal distance" info="Points for made field goals by distance. When off, every made field goal earns the flat “Field Goals Made” value.">
          <div className={cn("mb-3 flex min-h-11 items-center", !editable && "pointer-events-none opacity-60")}>
            <Toggle checked={value.useFieldGoalDistance} onChange={(v) => set({ useFieldGoalDistance: v })} label={<span className="text-[15px] font-semibold text-ink sm:text-sm">Score field goals by distance</span>} />
          </div>
          {value.useFieldGoalDistance && (
            <div className="space-y-2">
              <div className="eyebrow grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 sm:grid-cols-[6rem_6rem_7rem_1.75rem]" aria-hidden>
                <span>From</span>
                <span>To</span>
                <span>Points</span>
                <span />
              </div>
              <ul className="space-y-1.5">
                {value.fieldGoalsByDistance.map((r, i) => (
                  <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-2 sm:grid-cols-[6rem_6rem_7rem_1.75rem]">
                    <NumberInput ariaLabel="FG from yards" value={r.min} min={0} max={99} int disabled={!editable} onChange={(n) => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.map((x, j) => (j === i ? { ...x, min: n } : x)) })} />
                    <NumberInput ariaLabel="FG to yards" value={r.max} min={0} max={99} int disabled={!editable} onChange={(n) => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.map((x, j) => (j === i ? { ...x, max: n } : x)) })} />
                    <NumberInput ariaLabel="FG points" value={r.points} min={-100} max={100} step={0.5} disabled={!editable} onChange={(n) => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.map((x, j) => (j === i ? { ...x, points: n } : x)) })} />
                    {editable ? (
                      <button type="button" className={iconBtn} onClick={() => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.filter((_, j) => j !== i) })} aria-label="Remove range">
                        <X size={13} />
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
              {editable && value.fieldGoalsByDistance.length < 12 && (
                <button
                  type="button"
                  className={addBtnClass}
                  onClick={() => {
                    const last = [...value.fieldGoalsByDistance].sort((a, b) => a.max - b.max).pop();
                    const min = Math.min(98, (last?.max ?? -1) + 1);
                    set({ fieldGoalsByDistance: [...value.fieldGoalsByDistance, { min, max: Math.min(99, min + 9), points: (last?.points ?? 2) + 1 }] });
                  }}
                >
                  <Plus size={13} /> Add range
                </button>
              )}
            </div>
          )}
        </Section>
      </div>

      <div id="def-tiers" className="grid scroll-mt-4 grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="DST points allowed" info="Points awarded to a team defense based on points allowed (inclusive upper bounds).">
          <TierEditor tiers={value.pointsAllowedTiers} unit="Points allowed" disabled={!editable} onChange={(t) => set({ pointsAllowedTiers: t })} />
        </Section>
        <Section title="DST yards allowed" info="Points awarded to a team defense based on total yards allowed (inclusive upper bounds).">
          <TierEditor tiers={value.yardsAllowedTiers} unit="Yards allowed" disabled={!editable} onChange={(t) => set({ yardsAllowedTiers: t })} />
        </Section>
      </div>

      <Section
        title="Preview impact"
        id="preview"
        info={`Re-scores this season's real stats (Weeks 1-${week}) under the current and proposed rules: top players, every position and completed matchups.`}
        actions={
          <button type="button" className={buttonClass("secondary", "sm")} onClick={runPreview} disabled={previewing || errors.length > 0}>
            {previewing ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />} {preview ? "Refresh" : "Preview"}
          </button>
        }
      >
        {!preview ? <p className="text-[15px] text-muted sm:text-sm">{dirty ? "See how your changes move players and results before saving." : "Change a value to compare against the current rules."}</p> : <PreviewResults p={preview} />}
      </Section>

      {(errors.length > 0 || warnings.length > 0) && (
        <Alert tone="warn" className="space-y-1">
          {errors.map((e, i) => (
            <p key={`e${i}`} className="font-semibold text-loss">
              {e}
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
          count={changes}
          issues={errors.length}
          pending={saving}
          title="Save scoring"
          saveLabel={applyMode === "WHOLE_SEASON" ? "Save & re-score" : "Save scoring"}
          changes={changeList}
          note={note}
          onNote={setNote}
          notify={notifyManagers}
          onNotify={setNotify}
          onReset={() => setValue(initial)}
          onSave={save}
          saveDisabled={requiresVote && !voteReady(vote, voters, voteThreshold)}
        >
          <fieldset>
            <legend className="label">Apply to</legend>
            <SegmentedControl
              full
              ariaLabel="Apply to"
              value={applyMode}
              onChange={setApplyMode}
              options={[
                { value: "CURRENT_AND_FUTURE", label: "This week on" },
                { value: "WHOLE_SEASON", label: "Re-score season" },
              ]}
            />
            <p className="mt-1.5 text-[13px] text-muted">
              {applyMode === "WHOLE_SEASON" ? "Every completed week is re-scored: final scores, results and standings can change." : `Week ${week} and later use the new rules; completed weeks keep their results.`}
            </p>
          </fieldset>
          {requiresVote && <VoteFields value={vote} onChange={setVote} voters={voters} threshold={voteThreshold} />}
        </SaveChangesBar>
      )}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;

function PreviewResults({ p }: { p: ScoringPreview }) {
  return (
    <div className="space-y-5">
      <StatGrid
        cols={3}
        items={[
          { label: "Weeks", value: p.weeks, sub: "of stats" },
          { label: "Flips", value: p.flips.length, tone: p.flips.length ? "bad" : undefined, sub: `of ${p.matchupsCompared} games` },
          { label: "Avg swing", value: p.avgMatchupSwing.toFixed(2), sub: "pts per game" },
        ]}
      />

      <div>
        <h3 className="eyebrow mb-1.5">By position · top players&apos; season avg</h3>
        <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-line/80">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="num">Now</th>
                <th className="num">New</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {p.positions.map((r) => (
                <tr key={r.position}>
                  <td className="font-semibold">
                    {posLabel(r.position)} <span className="text-[12px] font-normal text-muted">top {r.depth}</span>
                  </td>
                  <td className="num">{r.current.toFixed(2)}</td>
                  <td className="num">{r.proposed.toFixed(2)}</td>
                  <td className={cn("num whitespace-nowrap font-semibold", r.delta > 0 ? "text-win" : r.delta < 0 ? "text-loss" : "text-muted")}>
                    {signed(r.delta)} <span className="text-[12px] font-normal">({r.pct > 0 ? "+" : ""}{r.pct}%)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="eyebrow mb-1.5">Top 30 under the new rules</h3>
        <ol className="max-h-[480px] divide-y divide-line/70 overflow-auto rounded-lg ring-1 ring-inset ring-line/80">
          {p.players.map((r) => (
            <li key={r.playerId} className="flex min-h-[52px] items-center gap-3 px-3 py-2">
              <span className="numeral w-6 shrink-0 text-center text-[13px] font-semibold text-muted">{r.proposedRank}</span>
              <span className="min-w-0 flex-1">
                <a href={`/players/${r.playerId}`} className="block truncate text-[15px] font-semibold text-ink hover:text-brand-600 hover:underline sm:text-sm dark:hover:text-brand-400">
                  {r.name}
                </a>
                <span className="block truncate text-[12px] text-muted">
                  {posLabel(r.position)} · {r.nflTeam ?? "FA"} · {r.fantasyTeam ?? "Free agent"}
                  {r.currentRank !== r.proposedRank && (
                    <span className={r.proposedRank < r.currentRank ? "text-win" : "text-loss"}>
                      {" "}
                      · rank {r.currentRank} → {r.proposedRank}
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="numeral block text-[15px] font-semibold leading-5 text-ink">{r.proposed.toFixed(2)}</span>
                <span className={cn("numeral block text-[12px] leading-4", r.delta > 0 ? "text-win" : r.delta < 0 ? "text-loss" : "text-muted")} title={`Now ${r.current.toFixed(2)}`}>
                  {signed(r.delta)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h3 className="eyebrow mb-1.5">Completed games with a different winner</h3>
        {p.flips.length ? (
          <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-line/80">
            <ul className="divide-y divide-line/70">
              {p.flips.map((f, i) => (
                <Fragment key={i}>
                  <li className="flex min-h-[52px] items-center gap-3 px-3 py-2 text-[14px]">
                    <span className="numeral w-10 shrink-0 text-[13px] text-muted">Wk {f.week}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                      {f.away} @ {f.home}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="numeral block font-semibold">
                        {f.proposedAway.toFixed(2)}–{f.proposedHome.toFixed(2)}
                      </span>
                      <span className="numeral block text-[12px] text-muted">
                        now {f.currentAway.toFixed(2)}–{f.currentHome.toFixed(2)}
                      </span>
                    </span>
                  </li>
                </Fragment>
              ))}
            </ul>
            <p className="border-t border-line/70 px-3 py-2 text-[13px] text-muted">Results only change if you save with “Re-score season”.</p>
          </div>
        ) : (
          <p className="text-[15px] text-muted sm:text-sm">No completed game would change winner.</p>
        )}
      </div>
    </div>
  );
}
