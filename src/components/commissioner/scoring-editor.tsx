"use client";
// Scoring rules editor: presets, every stat in the catalog with position overrides, milestone and long-TD
// bonuses, FG distance tiers, DST points/yards allowed tiers, preview impact, save (+ optional re-score).
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, BarChart3, Loader2, Lock, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, buttonClass } from "@/components/ui/core";
import { DEFAULT_SETTINGS, type BonusRule, type LeagueSettings } from "@/lib/settings/schema";
import { STAT_CATALOG, STAT_GROUPS, type StatGroup } from "@/lib/settings/stat-catalog";
import { COMBO_STATS, detectPreset, parseScoring, scoringIssues } from "@/lib/commissioner/settings-validate";
import { applyScoringPreset, settingsChanges, uniqueId } from "@/lib/commissioner/settings-logic";
import { previewScoringImpact, saveScoringSettings } from "@/lib/commissioner/settings-actions";
import type { ScoringPreview } from "@/lib/commissioner/scoring-preview";
import { Chips, NumberInput } from "./fields";

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
const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded border border-line bg-panel text-muted hover:bg-sunken hover:text-loss";

function Section({ title, subtitle, children, actions, id }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-32 overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/70 px-3 py-2">
        <div>
          <h2 className="font-display text-[15px] font-bold uppercase tracking-wide text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

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
    <div className="space-y-1.5">
      <table className="tbl tbl-compact max-w-md">
        <thead>
          <tr>
            <th>{unit} range</th>
            <th className="w-32">Up to</th>
            <th className="w-28">Points</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, idx) => {
            const lo = idx === 0 ? 0 : sorted[idx - 1].max + 1;
            return (
              <tr key={t.i}>
                <td className="whitespace-nowrap text-xs text-muted">{idx === sorted.length - 1 && t.max >= 999 ? `${lo}+` : `${lo}–${t.max}`}</td>
                <td>
                  <NumberInput ariaLabel={`${unit} up to`} value={t.max} min={0} max={99999} int disabled={disabled} onChange={(n) => onChange(tiers.map((x, j) => (j === t.i ? { ...x, max: n } : x)))} />
                </td>
                <td>
                  <NumberInput ariaLabel={`${unit} tier points`} value={t.points} min={-100} max={100} step={0.5} disabled={disabled} onChange={(n) => onChange(tiers.map((x, j) => (j === t.i ? { ...x, points: n } : x)))} />
                </td>
                <td>
                  {!disabled && (
                    <button type="button" className={iconBtn} onClick={() => onChange(tiers.filter((_, j) => j !== t.i))} aria-label="Remove tier">
                      <X size={12} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!disabled && tiers.length < 20 && (
        <button type="button" className="chip hover:bg-sunken" onClick={() => onChange([...tiers, { max: (sorted[sorted.length - 1]?.max ?? 0) + 7, points: 0 }])}>
          <Plus size={12} /> Add tier
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
  canEdit,
  week,
}: {
  initial: Scoring;
  idpEnabled: boolean;
  version: number;
  notifyDefault: boolean;
  locked: boolean;
  requiresVote: boolean;
  canEdit: boolean;
  week: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Scoring>(initial);
  const [group, setGroup] = useState<StatGroup>("Passing");
  const [applyMode, setApplyMode] = useState<"CURRENT_AND_FUTURE" | "WHOLE_SEASON">("CURRENT_AND_FUTURE");
  const [note, setNote] = useState("");
  const [notifyManagers, setNotify] = useState(notifyDefault);
  const [preview, setPreview] = useState<ScoringPreview | null>(null);
  const [previewing, startPreview] = useTransition();
  const [saving, startSave] = useTransition();
  const [newOverride, setNewOverride] = useState({ pos: "TE", stat: "rec", value: 1.5 });
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
  const changes = useMemo(() => settingsChanges(initial, value).length, [initial, value]);
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
    if (requiresVote && !note.trim()) return toast.error("Record the league vote result in the note to change scoring in season.");
    if (applyMode === "WHOLE_SEASON" && !window.confirm("Re-score every completed week with the new rules? Final scores, results and standings can change.")) return;
    startSave(async () => {
      const r = await saveScoringSettings({ scoring: value, applyMode, note: note.trim() || undefined, notifyManagers, expectedVersion: version });
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

  return (
    <div className="space-y-4 pb-4">
      {(locked || requiresVote || !canEdit) && (
        <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", locked || !canEdit ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100")}>
          <Lock size={16} className="mt-0.5 shrink-0" />
          {!canEdit ? "Co-commissioners can view but not change scoring." : locked ? "Scoring is locked during the season (Settings › Commissioner › Setting locks)." : "In-season scoring changes need a league vote: record the result in the note when saving."}
        </div>
      )}

      <Section title="Basics" subtitle="Start from a preset, then fine-tune any value below.">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="label">Preset</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["PPR", "HALF_PPR", "STANDARD"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={!editable}
                  onClick={() => window.confirm(`Reset every per-stat value to the ${p === "HALF_PPR" ? "Half PPR" : p} preset? Bonuses, tiers and position overrides are kept.`) && setValue(applyScoringPreset(value, p))}
                  className={cn(buttonClass(value.preset === p ? "primary" : "secondary", "sm"))}
                >
                  {p === "HALF_PPR" ? "Half PPR" : p === "PPR" ? "PPR" : "Standard"}
                </button>
              ))}
              {value.preset === "CUSTOM" && <Badge tone="gold">Custom</Badge>}
            </div>
          </div>
          <label className="block">
            <span className="label">Decimal places</span>
            <NumberInput value={value.decimals} min={0} max={3} int disabled={!editable} className="w-24" onChange={(n) => set({ decimals: n })} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={value.roundToDecimals} disabled={!editable} onChange={(e) => set({ roundToDecimals: e.target.checked })} />
            Round player totals to {value.decimals} decimals
          </label>
          <div>
            <span className="label">Negative points floor</span>
            <div className="flex items-center gap-2">
              <NumberInput value={value.negativePointsFloor} min={-100} max={0} step={0.5} disabled={!editable || value.negativePointsFloor === null} className="w-28" onChange={(n) => set({ negativePointsFloor: n })} />
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={value.negativePointsFloor === null} disabled={!editable} onChange={(e) => set({ negativePointsFloor: e.target.checked ? null : 0 })} />
                No floor
              </label>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Points per stat"
        id="stats"
        subtitle={
          <>
            Base points for every stat. Position columns override the base for that position only (blank = use base). Decimals and negatives are allowed.
          </>
        }
      >
        <div className="scroll-thin -mx-1 mb-3 flex gap-1 overflow-x-auto px-1">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold", g === group ? "border-brand-600 bg-brand-600 text-white" : "border-line text-muted hover:text-ink")}
              aria-pressed={g === group}
            >
              {g} <span className={cn("ml-0.5 tabular-nums", g === group ? "text-white/80" : "text-muted")}>{nonZero(g)}</span>
            </button>
          ))}
        </div>
        {group === "Kicking" && (
          <p className="mb-2 text-xs text-muted">
            {value.useFieldGoalDistance
              ? "Field goals are scored by distance (see the FG distance table below); the flat “Field Goals Made” value only applies to field goals without a distance."
              : "Distance scoring is off: every made field goal earns the flat “Field Goals Made” value plus any distance-bucket values below."}
          </p>
        )}
        {group === "Team Defense" && <p className="mb-2 text-xs text-muted">Points and yards allowed are scored with the tier tables below.</p>}
        <div className="max-h-[70vh] overflow-auto rounded-md border border-line">
          <table className="tbl tbl-compact min-w-[560px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-sunken">Stat</th>
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
                    <td className="sticky left-0 z-[5] bg-panel">
                      <div className="text-[13px] font-semibold text-ink">{s.label}</div>
                      <div className="font-mono text-[10px] text-muted">{s.key}</div>
                    </td>
                    {isTier ? (
                      <td colSpan={1 + groupPositions.length} className="text-xs text-muted">
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
                                className={cn(ov !== undefined && "border-gold-500 bg-gold-300/10")}
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

      <Section title="Position overrides" subtitle="Every position-specific value in one place (TE premium, 6-point QB touchdowns, RB carry points…).">
        {overrideList.length ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {overrideList.map((o) => (
              <span key={`${o.pos}-${o.k}`} className="chip">
                <b>{posLabel(o.pos)}</b> {STAT_CATALOG.find((s) => s.key === o.k)?.label ?? o.k}: {o.v}
                <span className="text-muted">(base {value.rules[o.k] ?? 0})</span>
                {editable && (
                  <button type="button" className="text-muted hover:text-loss" onClick={() => setOverride(o.pos, o.k, null)} aria-label={`Remove ${o.pos} ${o.k} override`}>
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted">No position overrides: every position scores the base values.</p>
        )}
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <label>
              <span className="label">Position</span>
              <select className="input py-1.5" value={newOverride.pos} onChange={(e) => setNewOverride((o) => ({ ...o, pos: e.target.value }))}>
                {positions.map((p) => (
                  <option key={p} value={p}>
                    {posLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[12rem] flex-1 sm:flex-none">
              <span className="label">Stat</span>
              <select className="input py-1.5" value={newOverride.stat} onChange={(e) => setNewOverride((o) => ({ ...o, stat: e.target.value, value: value.rules[e.target.value] ?? 0 }))}>
                {STAT_CATALOG.filter((s) => !TIER_KEYS.has(s.key)).map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.group}: {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Points</span>
              <NumberInput value={newOverride.value} min={-100} max={100} step={0.01} className="w-28" onChange={(n) => setNewOverride((o) => ({ ...o, value: n }))} />
            </label>
            <button type="button" className={buttonClass("secondary", "sm", "mb-0.5")} disabled={Number.isNaN(newOverride.value)} onClick={() => setOverride(newOverride.pos, newOverride.stat, newOverride.value)}>
              <Plus size={13} /> Add override
            </button>
          </div>
        )}
      </Section>

      <Section title="Milestone bonuses" subtitle="One-time (or repeating) bonuses for reaching a stat threshold in a game. Combined stats like rushing + receiving yards are supported.">
        {value.bonuses.length ? (
          <div className="space-y-2">
            {value.bonuses.map((b, i) => (
              <div key={b.id} className="grid gap-2 rounded-md border border-line bg-sunken/40 p-2 sm:grid-cols-[1.2fr_1.4fr_6.5rem_6rem_7rem_auto]">
                <label className="block min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Label</span>
                  <input className="input py-1.5" value={b.label} maxLength={60} disabled={!editable} onChange={(e) => setBonus(i, { label: e.target.value })} />
                </label>
                <label className="block min-w-0">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Stat</span>
                  <select className="input py-1.5" value={b.stat} disabled={!editable} onChange={(e) => setBonus(i, { stat: e.target.value })}>
                    {bonusStatOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Threshold</span>
                  <NumberInput value={b.threshold} min={0} max={10000} step={1} disabled={!editable} onChange={(n) => setBonus(i, { threshold: n })} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Points</span>
                  <NumberInput value={b.points} min={-100} max={100} step={0.5} disabled={!editable} onChange={(n) => setBonus(i, { points: n })} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Repeat every</span>
                  <NumberInput value={b.repeatEvery ?? null} min={0} max={10000} placeholder="Once" disabled={!editable} onChange={(n) => setBonus(i, { repeatEvery: Number.isNaN(n) || n === 0 ? null : n })} />
                </label>
                <div className="flex items-end justify-end">
                  {editable && (
                    <button type="button" className={iconBtn} onClick={() => set({ bonuses: value.bonuses.filter((_, j) => j !== i) })} aria-label={`Remove bonus ${b.label}`}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="sm:col-span-6">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">Positions (none selected = all)</span>
                  <Chips options={positions.map((p) => ({ value: p, label: posLabel(p) }))} value={b.positions ?? []} disabled={!editable} onChange={(v) => setBonus(i, { positions: v })} ariaLabel={`${b.label} positions`} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No milestone bonuses.</p>
        )}
        {editable && value.bonuses.length < 60 && (
          <button
            type="button"
            className="chip mt-2 hover:bg-sunken"
            onClick={() => set({ bonuses: [...value.bonuses, { id: uniqueId("bonus", value.bonuses.map((b) => b.id)), label: "100+ rush + rec yards", stat: "rush_rec_yd", threshold: 100, points: 1, positions: [], repeatEvery: null }] })}
          >
            <Plus size={12} /> Add bonus
          </button>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Long touchdown bonuses" subtitle="Extra points for any offensive TD of 40+ or 50+ yards (on top of the TD itself).">
          <div className="space-y-2">
            {([40, 50] as const).map((y) => {
              const lt = longTd(y);
              return (
                <div key={y} className="flex flex-wrap items-center gap-3">
                  <label className="flex w-36 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!lt} disabled={!editable} onChange={(e) => setLongTd(y, e.target.checked ? 1 : null)} />
                    {y}+ yard TD
                  </label>
                  {lt && <NumberInput ariaLabel={`${y}+ yard TD bonus`} value={lt.points} min={-100} max={100} step={0.5} suffix="pts" className="w-32" disabled={!editable} onChange={(n) => setLongTd(y, n)} />}
                </div>
              );
            })}
            <p className="text-xs text-muted">A 55-yard TD earns both bonuses when both are on.</p>
          </div>
        </Section>

        <Section title="Kicking: field goal distance" subtitle="Points for made field goals by distance.">
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={value.useFieldGoalDistance} disabled={!editable} onChange={(e) => set({ useFieldGoalDistance: e.target.checked })} />
            Score field goals by distance
          </label>
          {value.useFieldGoalDistance && (
            <div className="space-y-1.5">
              <table className="tbl tbl-compact max-w-md">
                <thead>
                  <tr>
                    <th className="w-24">From</th>
                    <th className="w-24">To</th>
                    <th className="w-28">Points</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {value.fieldGoalsByDistance.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <NumberInput ariaLabel="FG from yards" value={r.min} min={0} max={99} int disabled={!editable} onChange={(n) => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.map((x, j) => (j === i ? { ...x, min: n } : x)) })} />
                      </td>
                      <td>
                        <NumberInput ariaLabel="FG to yards" value={r.max} min={0} max={99} int disabled={!editable} onChange={(n) => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.map((x, j) => (j === i ? { ...x, max: n } : x)) })} />
                      </td>
                      <td>
                        <NumberInput ariaLabel="FG points" value={r.points} min={-100} max={100} step={0.5} disabled={!editable} onChange={(n) => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.map((x, j) => (j === i ? { ...x, points: n } : x)) })} />
                      </td>
                      <td>
                        {editable && (
                          <button type="button" className={iconBtn} onClick={() => set({ fieldGoalsByDistance: value.fieldGoalsByDistance.filter((_, j) => j !== i) })} aria-label="Remove range">
                            <X size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable && value.fieldGoalsByDistance.length < 12 && (
                <button
                  type="button"
                  className="chip hover:bg-sunken"
                  onClick={() => {
                    const last = [...value.fieldGoalsByDistance].sort((a, b) => a.max - b.max).pop();
                    const min = Math.min(98, (last?.max ?? -1) + 1);
                    set({ fieldGoalsByDistance: [...value.fieldGoalsByDistance, { min, max: Math.min(99, min + 9), points: (last?.points ?? 2) + 1 }] });
                  }}
                >
                  <Plus size={12} /> Add range
                </button>
              )}
            </div>
          )}
        </Section>
      </div>

      <div id="def-tiers" className="grid scroll-mt-32 gap-4 lg:grid-cols-2">
        <Section title="Team defense: points allowed" subtitle="Points awarded to a DST based on points allowed (inclusive upper bounds).">
          <TierEditor tiers={value.pointsAllowedTiers} unit="Points allowed" disabled={!editable} onChange={(t) => set({ pointsAllowedTiers: t })} />
        </Section>
        <Section title="Team defense: yards allowed" subtitle="Points awarded to a DST based on total yards allowed.">
          <TierEditor tiers={value.yardsAllowedTiers} unit="Yards allowed" disabled={!editable} onChange={(t) => set({ yardsAllowedTiers: t })} />
        </Section>
      </div>

      <Section
        title="Preview impact"
        id="preview"
        subtitle={`Re-scores this season's real stats (Weeks 1-${week}) under the current and proposed rules.`}
        actions={
          <button type="button" className={buttonClass("secondary", "sm")} onClick={runPreview} disabled={previewing || errors.length > 0}>
            {previewing ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />} {preview ? "Refresh preview" : "Preview impact"}
          </button>
        }
      >
        {!preview ? (
          <p className="text-sm text-muted">{dirty ? "Preview the effect of your changes on the top players, every position and completed matchups before saving." : "Change a value to compare against the current rules."}</p>
        ) : (
          <PreviewResults p={preview} />
        )}
      </Section>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
          {errors.map((e, i) => (
            <p key={`e${i}`} className="font-semibold text-loss">
              {e}
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
        <div className={cn("rounded-lg border bg-panel/95 p-2.5", dirty ? "sticky bottom-[60px] z-30 border-gold-500 shadow-pop backdrop-blur md:bottom-2" : "border-line")}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              {dirty ? (
                <span className="font-semibold">
                  {changes} unsaved change{changes === 1 ? "" : "s"}
                  {errors.length > 0 && <span className="ml-2 text-loss">· {errors.length} to fix</span>}
                </span>
              ) : (
                <span className="text-muted">No unsaved changes · version {version}</span>
              )}
            </div>
            {dirty && (
              <>
                <fieldset className="flex flex-wrap items-center gap-3 text-xs">
                  <legend className="sr-only">Apply to</legend>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="applyMode" className="accent-brand-600" checked={applyMode === "CURRENT_AND_FUTURE"} onChange={() => setApplyMode("CURRENT_AND_FUTURE")} />
                    Current &amp; future weeks
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="applyMode" className="accent-brand-600" checked={applyMode === "WHOLE_SEASON"} onChange={() => setApplyMode("WHOLE_SEASON")} />
                    Re-score the whole season
                  </label>
                </fieldset>
                <input className="input order-last w-full py-1.5 text-xs sm:order-none sm:w-56" placeholder={requiresVote ? "League vote result (required)" : "Note (optional)"} value={note} maxLength={500} aria-label="Change note" onChange={(e) => setNote(e.target.value)} />
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={notifyManagers} onChange={(e) => setNotify(e.target.checked)} />
                  Notify managers
                </label>
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setValue(initial)} disabled={saving}>
                  <RotateCcw size={13} /> Reset
                </button>
              </>
            )}
            <button type="button" className={buttonClass("primary", "sm")} disabled={!dirty || saving || errors.length > 0} onClick={save}>
              {saving && <Loader2 size={13} className="animate-spin" />} Save scoring
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}`;

function PreviewResults({ p }: { p: ScoringPreview }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-line px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-muted">Weeks of stats</div>
          <div className="font-display text-xl font-bold">{p.weeks}</div>
        </div>
        <div className="rounded-md border border-line px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-muted">Completed matchups that flip</div>
          <div className={cn("font-display text-xl font-bold", p.flips.length && "text-loss")}>
            {p.flips.length} <span className="text-sm font-normal text-muted">of {p.matchupsCompared}</span>
          </div>
        </div>
        <div className="rounded-md border border-line px-3 py-2">
          <div className="text-[11px] font-semibold uppercase text-muted">Avg. margin swing</div>
          <div className="font-display text-xl font-bold">{p.avgMatchupSwing.toFixed(2)} pts</div>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">By position (season average of the top players)</h3>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>Pos</th>
                <th className="num">Players</th>
                <th className="num">Current</th>
                <th className="num">Proposed</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {p.positions.map((r) => (
                <tr key={r.position}>
                  <td className="font-semibold">{posLabel(r.position)}</td>
                  <td className="num">{r.depth}</td>
                  <td className="num">{r.current.toFixed(2)}</td>
                  <td className="num">{r.proposed.toFixed(2)}</td>
                  <td className={cn("num font-semibold", r.delta > 0 ? "text-win" : r.delta < 0 ? "text-loss" : "text-muted")}>
                    {signed(r.delta)} <span className="text-[11px] font-normal">({r.pct > 0 ? "+" : ""}{r.pct}%)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Top 30 players under the proposed rules</h3>
        <div className="max-h-[480px] overflow-auto rounded-md border border-line">
          <table className="tbl tbl-compact min-w-[560px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="num">#</th>
                <th>Player</th>
                <th>Team</th>
                <th className="num">Current</th>
                <th className="num">Proposed</th>
                <th className="num">Change</th>
                <th className="num">Rank</th>
              </tr>
            </thead>
            <tbody>
              {p.players.map((r) => (
                <tr key={r.playerId}>
                  <td className="num text-muted">{r.proposedRank}</td>
                  <td>
                    <a href={`/players/${r.playerId}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      {r.name}
                    </a>{" "}
                    <span className="text-[11px] text-muted">
                      {posLabel(r.position)} · {r.nflTeam ?? "FA"}
                    </span>
                  </td>
                  <td className="text-xs">{r.fantasyTeam ?? <span className="text-muted">FA</span>}</td>
                  <td className="num">{r.current.toFixed(2)}</td>
                  <td className="num font-semibold">{r.proposed.toFixed(2)}</td>
                  <td className={cn("num", r.delta > 0 ? "text-win" : r.delta < 0 ? "text-loss" : "text-muted")}>{signed(r.delta)}</td>
                  <td className="num text-xs">
                    {r.currentRank === r.proposedRank ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={r.proposedRank < r.currentRank ? "text-win" : "text-loss"}>
                        {r.currentRank} → {r.proposedRank}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Completed matchups with a different winner</h3>
        {p.flips.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Matchup</th>
                  <th className="num">Current</th>
                  <th className="num">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {p.flips.map((f, i) => (
                  <Fragment key={i}>
                    <tr>
                      <td>Wk {f.week}</td>
                      <td>
                        {f.away} @ {f.home}
                      </td>
                      <td className="num">
                        {f.currentAway.toFixed(2)} – {f.currentHome.toFixed(2)}
                      </td>
                      <td className="num font-semibold">
                        {f.proposedAway.toFixed(2)} – {f.proposedHome.toFixed(2)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-1.5 text-xs text-muted">Results only change if you save with “Re-score the whole season”.</p>
          </div>
        ) : (
          <p className="text-sm text-muted">No completed matchup would change winner.</p>
        )}
      </div>
    </div>
  );
}
