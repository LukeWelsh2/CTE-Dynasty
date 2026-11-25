"use client";
// Form controls for the commissioner settings editor (one per catalog field kind).
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Toggle } from "@/components/ui/client";
import { chipClass } from "@/components/ui/core";
import type { LeagueSettings, RosterSlotDef } from "@/lib/settings/schema";
import { POSITION_OPTIONS, TIMEZONES, WEEKDAY_OPTIONS, type FieldDef, type ItemField, type Opt } from "@/lib/commissioner/settings-meta";
import { SLOT_TEMPLATES, uniqueId } from "@/lib/commissioner/settings-logic";
import { isoToLocalInput, localInputToIso } from "@/lib/commissioner/time";
import { searchPlayersAction, type PlayerSearchRow } from "@/lib/commissioner/settings-actions";

export interface TeamLite {
  id: string;
  name: string;
  abbrev: string;
}

export interface FieldLookups {
  teams: TeamLite[];
  tz: string;
  players: Record<string, string>;
  /** full proposed settings (rookie scale needs rounds, slot editor needs IDP flag) */
  full: LeagueSettings;
}

const IDP = ["DL", "LB", "DB"];
// 36px on phones (finger-sized), 28px from sm
const iconBtn = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel text-muted shadow-[inset_0_0_0_1px_rgb(var(--c-line))] transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40 sm:h-7 sm:w-7 dark:bg-white/[0.04]";
/** "+ Add …" buttons under lists */
export const addBtnClass = chipClass(false, "sm");

// ───────────────────────────── primitives ─────────────────────────────

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  int,
  prefix,
  suffix,
  disabled,
  id,
  className,
  ariaLabel,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  int?: boolean;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null || value === undefined || Number.isNaN(value) ? "" : String(value));
  const last = useRef<number | null>(value);
  useEffect(() => {
    if (value !== last.current && !(Number.isNaN(value) && Number.isNaN(last.current))) {
      setText(value === null || value === undefined || Number.isNaN(value) ? "" : String(value));
      last.current = value;
    }
  }, [value]);
  const shownPrefix = prefix === "Wk" ? "Week" : prefix;
  return (
    <div className={cn("flex items-stretch overflow-hidden rounded-control border border-line bg-panel focus-within:border-brand-600 focus-within:ring-4 focus-within:ring-brand-600/15 dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-brand-400", disabled && "opacity-60", className)}>
      {shownPrefix && <span className="flex items-center border-r border-line bg-sunken px-2 text-[13px] font-semibold text-muted dark:border-white/10">{shownPrefix}</span>}
      <input
        id={id}
        type="number"
        inputMode={int ? "numeric" : "decimal"}
        aria-label={ariaLabel}
        className="w-full min-w-0 bg-transparent px-2.5 py-2 text-base tabular-nums text-ink outline-none placeholder:text-muted/60 sm:py-1.5 sm:text-sm"
        value={text}
        min={min}
        max={max}
        step={step ?? (int ? 1 : "any")}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.value.trim() === "" ? NaN : Number(e.target.value);
          last.current = n;
          onChange(n);
        }}
      />
      {suffix && suffix !== ":00" && <span className="flex items-center whitespace-nowrap border-l border-line bg-sunken px-2 text-[13px] font-semibold text-muted dark:border-white/10">{suffix}</span>}
      {suffix === ":00" && <span className="flex items-center whitespace-nowrap border-l border-line bg-sunken px-2 text-[13px] font-semibold text-muted dark:border-white/10">{hourText(value)}</span>}
    </div>
  );
}

function hourText(v: number | null) {
  if (v === null || Number.isNaN(v)) return "h";
  const h = ((Math.round(v) % 24) + 24) % 24;
  return h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export function Chips({ options, value, onChange, disabled, ariaLabel }: { options: Opt[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.filter((o) => !o.legacy || value.includes(o.value)).map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={chipClass(on, "sm", "disabled:opacity-50")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Legacy (kept-for-compatibility) option values are only offered while they are the stored value. */
function Select({ value, options, onChange, disabled, id, ariaLabel, className }: { value: string; options: Opt[]; onChange: (v: string) => void; disabled?: boolean; id?: string; ariaLabel?: string; className?: string }) {
  return (
    <select id={id} aria-label={ariaLabel} className={cn("input py-1.5", className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.filter((o) => !o.legacy || o.value === value).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TeamSelect({ value, teams, onChange, disabled, ariaLabel }: { value: string; teams: TeamLite[]; onChange: (v: string) => void; disabled?: boolean; ariaLabel?: string }) {
  return (
    <select aria-label={ariaLabel} className="input py-1.5" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a team…</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function RowActions({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (from: number, to: number) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" className={iconBtn} disabled={index === 0} onClick={() => onMove(index, index - 1)} aria-label={`Move ${label} up`}>
        <ArrowUp size={13} />
      </button>
      <button type="button" className={iconBtn} disabled={index === count - 1} onClick={() => onMove(index, index + 1)} aria-label={`Move ${label} down`}>
        <ArrowDown size={13} />
      </button>
      <button type="button" className={cn(iconBtn, "hover:text-loss")} onClick={onRemove} aria-label={`Remove ${label}`}>
        <X size={13} />
      </button>
    </div>
  );
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const out = [...arr];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

// ───────────────────────────── field renderer ─────────────────────────────

export function FieldControl({
  field,
  value,
  onChange,
  disabled,
  lookups,
  id,
  inline,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
  lookups: FieldLookups;
  id: string;
  /** the control sits to the right of its label (numbers): fill the given column */
  inline?: boolean;
}) {
  switch (field.kind) {
    case "number": {
      const isNull = value === null;
      return (
        <div className="space-y-1.5">
          <NumberInput
            id={id}
            value={isNull ? null : (value as number)}
            onChange={onChange}
            min={field.min}
            max={field.max}
            step={field.step}
            int={field.int}
            prefix={field.prefix}
            suffix={field.suffix}
            disabled={disabled || isNull}
            className={inline ? "w-full" : "max-w-[16rem]"}
          />
          {field.nullable && (
            <label className="flex min-h-8 w-fit items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={isNull} disabled={disabled} onChange={(e) => onChange(e.target.checked ? null : Math.max(field.min, Math.min(field.max, field.min)))} />
              {field.nullLabel ?? "None"}
            </label>
          )}
        </div>
      );
    }
    case "toggle":
      return (
        <div className={cn(disabled && "pointer-events-none opacity-50")}>
          <Toggle checked={!!value} onChange={(v) => onChange(v)} label={<span className="text-[13px] text-muted">{value ? "On" : "Off"}</span>} />
        </div>
      );
    case "select":
      return <Select id={id} value={String(value)} options={field.options} onChange={onChange} disabled={disabled} className="max-w-md" />;
    case "weekday":
      return <Select id={id} value={String(value)} options={WEEKDAY_OPTIONS} onChange={onChange} disabled={disabled} className="max-w-[12rem]" />;
    case "timezone": {
      const zones = TIMEZONES.includes(String(value)) ? TIMEZONES : [String(value), ...TIMEZONES];
      return <Select id={id} value={String(value)} options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} onChange={onChange} disabled={disabled} className="max-w-xs" />;
    }
    case "multi": {
      const arr = ((value as unknown[]) ?? []).map(String);
      return (
        <Chips
          ariaLabel={field.label}
          options={field.options}
          value={arr}
          disabled={disabled}
          onChange={(v) => {
            const ordered = field.options.map((o) => o.value).filter((x) => v.includes(x));
            onChange(field.numeric ? ordered.map(Number) : ordered);
          }}
        />
      );
    }
    case "teams": {
      const arr = (value as string[]) ?? [];
      return (
        <div className="space-y-1.5">
          <Chips ariaLabel={field.label} options={lookups.teams.map((t) => ({ value: t.id, label: t.abbrev }))} value={arr} disabled={disabled} onChange={(v) => onChange(v)} />
          <p className="text-[13px] text-muted">
            {arr.length} of {lookups.teams.length} teams
          </p>
        </div>
      );
    }
    case "ordered":
      return <OrderedEditor options={field.options} value={(value as string[]) ?? []} onChange={onChange} disabled={disabled} label={field.label} />;
    case "text":
      return field.multiline ? (
        <div>
          <textarea
            id={id}
            className="input min-h-[84px]"
            rows={field.maxLength > 2000 ? 8 : 3}
            maxLength={field.maxLength}
            value={String(value ?? "")}
            placeholder={field.placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="mt-0.5 text-right text-[12px] text-muted">
            {String(value ?? "").length.toLocaleString()} / {field.maxLength.toLocaleString()}
          </div>
        </div>
      ) : (
        <input id={id} className="input max-w-md py-1.5" maxLength={field.maxLength} value={String(value ?? "")} placeholder={field.placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      );
    case "datetime":
      return (
        <div className="flex max-w-md items-center gap-2">
          <input
            id={id}
            type="datetime-local"
            className="input py-1.5"
            value={isoToLocalInput(value as string | null, lookups.tz)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value ? localInputToIso(e.target.value, lookups.tz) : null)}
          />
          {value ? (
            <button type="button" className={iconBtn} onClick={() => onChange(null)} disabled={disabled} aria-label={`Clear ${field.label}`}>
              <X size={13} />
            </button>
          ) : (
            <span className="whitespace-nowrap text-[13px] text-muted">Not set</span>
          )}
        </div>
      );
    case "numberList":
      return <NumberListEditor field={field} value={(value as number[]) ?? []} onChange={onChange} disabled={disabled} full={lookups.full} />;
    case "list":
      return <ListEditor field={field} value={(value as Record<string, unknown>[]) ?? []} onChange={onChange} disabled={disabled} teams={lookups.teams} />;
    case "rivalries":
      return <RivalryEditor value={(value as [string, string][]) ?? []} onChange={onChange} teams={lookups.teams} disabled={disabled} />;
    case "players":
      return <PlayerPicker value={(value as string[]) ?? []} onChange={onChange} names={lookups.players} disabled={disabled} />;
    case "slots":
      return <SlotEditor value={(value as RosterSlotDef[]) ?? []} onChange={onChange} idp={lookups.full.roster.idpEnabled} disabled={disabled} />;
    case "positionLimits":
      return <PositionLimitsEditor value={(value as Record<string, { min: number; max: number | null }>) ?? {}} onChange={onChange} idp={lookups.full.roster.idpEnabled} disabled={disabled} />;
    case "rookieScale":
      return <RookieScaleEditor value={(value as Record<string, number[]>) ?? {}} onChange={onChange} full={lookups.full} teamCount={lookups.teams.length || lookups.full.general.teamCount} disabled={disabled} />;
  }
}

// ───────────────────────────── composite editors ─────────────────────────────

function OrderedEditor({ options, value, onChange, disabled, label }: { options: Opt[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; label: string }) {
  const remaining = options.filter((o) => !value.includes(o.value) && !o.legacy);
  const name = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="space-y-1.5">
      <ol className="space-y-1">
        {value.map((v, i) => (
          <li key={v} className="flex min-h-11 items-center gap-2 rounded-lg bg-sunken px-2 py-1 sm:min-h-9">
            <span className="numeral w-5 text-center text-[13px] font-bold text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] sm:text-sm" title={name(v)}>
              {name(v)}
            </span>
            {!disabled && <RowActions index={i} count={value.length} label={name(v)} onMove={(a, b) => onChange(move(value, a, b))} onRemove={() => onChange(value.filter((x) => x !== v))} />}
          </li>
        ))}
      </ol>
      {remaining.length > 0 && !disabled && (
        <select aria-label={`Add to ${label}`} className="input max-w-xs py-1.5 sm:text-xs" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">+ Add…</option>
          {remaining.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function NumberListEditor({ field, value, onChange, disabled, full }: { field: Extract<FieldDef, { kind: "numberList" }>; value: number[]; onChange: (v: number[]) => void; disabled?: boolean; full: LeagueSettings }) {
  const sum = value.reduce((a, x) => a + (Number.isFinite(x) ? x : 0), 0);
  const isLottery = field.path === "rookie.lottery.odds";
  const target = isLottery ? full.draft.rookie.lottery.teams : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="numeral w-7 text-right text-[12px] font-semibold text-muted">#{i + 1}</span>
            <NumberInput value={v} min={field.min} max={field.max} step={field.step} suffix={field.suffix} disabled={disabled} className="w-28" ariaLabel={`${field.label} ${i + 1}`} onChange={(n) => onChange(value.map((x, j) => (j === i ? n : x)))} />
            <button type="button" className={cn(iconBtn, "hover:text-loss")} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove value ${i + 1}`}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {value.length < field.maxItems && (
          <button type="button" className={addBtnClass} disabled={disabled} onClick={() => onChange([...value, 0])}>
            <Plus size={12} /> Add
          </button>
        )}
        {isLottery && target !== null && value.length !== target && (
          <button
            type="button"
            className={addBtnClass}
            disabled={disabled}
            onClick={() => {
              // descending odds that sum to 100
              const n = target;
              const weights = Array.from({ length: n }, (_, i) => n - i);
              const tot = weights.reduce((a, b) => a + b, 0);
              const odds = weights.map((w) => Math.round((w / tot) * 1000) / 10);
              odds[0] = Math.round((odds[0] + 100 - odds.reduce((a, b) => a + b, 0)) * 10) / 10;
              onChange(odds);
            }}
          >
            Generate odds for {target} teams
          </button>
        )}
        {field.suffix === "%" && (
          <span className={cn("font-semibold tabular-nums", isLottery && Math.abs(sum - 100) > 0.01 ? "text-loss" : "text-muted")}>Total {Math.round(sum * 100) / 100}%</span>
        )}
      </div>
    </div>
  );
}

function defaultItem(item: ItemField[], teams: TeamLite[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const i of item) {
    if (i.kind === "text") row[i.key] = "";
    else if (i.kind === "number") row[i.key] = i.nullable ? null : i.min;
    else if (i.kind === "toggle") row[i.key] = true;
    else if (i.kind === "team") row[i.key] = teams[0]?.id ?? "";
    else row[i.key] = i.options[0]?.value ?? "";
  }
  return row;
}

function ListEditor({ field, value, onChange, disabled, teams }: { field: Extract<FieldDef, { kind: "list" }>; value: Record<string, unknown>[]; onChange: (v: Record<string, unknown>[]) => void; disabled?: boolean; teams: TeamLite[] }) {
  const set = (i: number, key: string, v: unknown) => onChange(value.map((row, j) => (j === i ? { ...row, [key]: v } : row)));
  const wide = field.item.some((i) => i.kind === "text" && i.multiline);
  return (
    <div className="space-y-2">
      {!value.length && <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[13px] text-muted">{field.emptyText}</p>}
      {value.map((row, i) => (
        <div key={(field.autoId ? String(row[field.autoId]) : "") + i} className="rounded-lg bg-sunken p-2.5">
          <div className="flex items-start gap-2">
            <div className={cn("grid min-w-0 flex-1 gap-2", wide ? "grid-cols-1 sm:grid-cols-[1fr_8rem_6rem]" : "grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]")}>
              {field.item.map((it) => (
                <label key={it.key} className={cn("block min-w-0", it.kind === "text" && it.multiline && "sm:col-span-3")}>
                  <span className="eyebrow mb-1 block truncate">{it.label}</span>
                  {it.kind === "text" &&
                    (it.multiline ? (
                      <textarea className="input min-h-[60px] py-1.5" rows={2} maxLength={it.maxLength} value={String(row[it.key] ?? "")} placeholder={it.placeholder} disabled={disabled} onChange={(e) => set(i, it.key, e.target.value)} />
                    ) : (
                      <input className="input py-1.5" maxLength={it.maxLength} value={String(row[it.key] ?? "")} placeholder={it.placeholder} disabled={disabled} onChange={(e) => set(i, it.key, e.target.value)} />
                    ))}
                  {it.kind === "number" && (
                    <div className="space-y-1">
                      <NumberInput
                        value={row[it.key] === null || row[it.key] === undefined ? null : Number(row[it.key])}
                        min={it.min}
                        max={it.max}
                        step={it.step}
                        int={it.int}
                        prefix={it.prefix}
                        suffix={it.suffix}
                        disabled={disabled}
                        placeholder={it.nullable ? "—" : undefined}
                        onChange={(n) => set(i, it.key, it.nullable && Number.isNaN(n) ? null : n)}
                      />
                    </div>
                  )}
                  {it.kind === "toggle" && (
                    <div className="pt-1">
                      <Toggle checked={!!row[it.key]} onChange={(v) => set(i, it.key, v)} />
                    </div>
                  )}
                  {it.kind === "team" && <TeamSelect value={String(row[it.key] ?? "")} teams={teams} onChange={(v) => set(i, it.key, v)} disabled={disabled} />}
                  {it.kind === "select" && <Select value={String(row[it.key] ?? "")} options={it.options} onChange={(v) => set(i, it.key, v)} disabled={disabled} />}
                </label>
              ))}
            </div>
            {!disabled && <RowActions index={i} count={value.length} label={`row ${i + 1}`} onMove={(a, b) => onChange(move(value, a, b))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />}
          </div>
        </div>
      ))}
      {value.length < field.maxItems && !disabled && (
        <button
          type="button"
          className={addBtnClass}
          onClick={() => {
            const row = defaultItem(field.item, teams);
            if (field.autoId) row[field.autoId] = uniqueId(field.path.replace(/s$/, ""), value.map((r) => String(r[field.autoId!])));
            onChange([...value, row]);
          }}
        >
          <Plus size={12} /> {field.addLabel}
        </button>
      )}
    </div>
  );
}

function RivalryEditor({ value, onChange, teams, disabled }: { value: [string, string][]; onChange: (v: [string, string][]) => void; teams: TeamLite[]; disabled?: boolean }) {
  const used = new Set(value.flat());
  const free = teams.filter((t) => !used.has(t.id));
  return (
    <div className="space-y-2">
      {!value.length && <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[13px] text-muted">No rivalries yet.</p>}
      {value.map(([a, b], i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2">
            <TeamSelect ariaLabel={`Rivalry ${i + 1} team A`} value={a} teams={teams} disabled={disabled} onChange={(v) => onChange(value.map((p, j) => (j === i ? [v, p[1]] : p)))} />
            <span className="text-[13px] font-bold text-muted">vs</span>
            <TeamSelect ariaLabel={`Rivalry ${i + 1} team B`} value={b} teams={teams} disabled={disabled} onChange={(v) => onChange(value.map((p, j) => (j === i ? [p[0], v] : p)))} />
          </div>
          {!disabled && (
            <button type="button" className={cn(iconBtn, "hover:text-loss")} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove rivalry ${i + 1}`}>
              <X size={13} />
            </button>
          )}
        </div>
      ))}
      {free.length >= 2 && !disabled && (
        <button type="button" className={addBtnClass} onClick={() => onChange([...value, [free[0].id, free[1].id]])}>
          <Plus size={12} /> Add rivalry
        </button>
      )}
    </div>
  );
}

export function PlayerSearchBox({ onPick, placeholder = "Search players…", exclude = [] }: { onPick: (p: PlayerSearchRow) => void; placeholder?: string; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PlayerSearchRow[]>([]);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const listId = useId();
  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    const t = setTimeout(() => {
      start(async () => {
        const r = await searchPlayersAction(q);
        if (r.ok) {
          setRows((r.data ?? []).filter((p) => !exclude.includes(p.id)));
          setOpen(true);
        }
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="relative max-w-md">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input py-1.5 pl-8"
          placeholder={placeholder}
          value={q}
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-controls={listId}
          aria-label={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => rows.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {pending && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      {open && rows.length > 0 && (
        <ul id={listId} role="listbox" className="raised absolute z-30 mt-1 max-h-72 w-full overflow-y-auto overscroll-contain py-1">
          {rows.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[15px] hover:bg-sunken sm:min-h-9 sm:text-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(p);
                  setQ("");
                  setRows([]);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{p.name}</span> <span className="text-[13px] text-muted">{p.position} · {p.nflTeam ?? "FA"}</span>
                </span>
                <span className="shrink-0 text-[12px] text-muted">{p.rosteredBy ? `${p.rosteredBy.abbrev} · $${p.rosteredBy.salary}` : "Free agent"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlayerPicker({ value, onChange, names, disabled }: { value: string[]; onChange: (v: string[]) => void; names: Record<string, string>; disabled?: boolean }) {
  const [local, setLocal] = useState<Record<string, string>>({});
  const label = (id: string) => local[id] ?? names[id] ?? id;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {!value.length && <span className="text-[13px] text-muted">No undroppable players.</span>}
        {value.map((id) => (
          <span key={id} className="chip max-w-full py-1 text-[13px]">
            {label(id)}
            {!disabled && (
              <button type="button" className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-ink/[0.06] hover:text-loss" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Remove ${label(id)}`}>
                <X size={13} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <PlayerSearchBox
          exclude={value}
          placeholder="Add an undroppable player…"
          onPick={(p) => {
            setLocal((m) => ({ ...m, [p.id]: p.name }));
            onChange([...value, p.id]);
          }}
        />
      )}
    </div>
  );
}

function SlotEditor({ value, onChange, idp, disabled }: { value: RosterSlotDef[]; onChange: (v: RosterSlotDef[]) => void; idp: boolean; disabled?: boolean }) {
  const posOptions = POSITION_OPTIONS.filter((p) => idp || !IDP.includes(p.value));
  const starters = value.reduce((a, s) => a + (Number.isFinite(s.count) ? s.count : 0), 0);
  const set = (i: number, patch: Partial<RosterSlotDef>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const templates = SLOT_TEMPLATES.filter((t) => (idp || !t.eligible.some((p) => IDP.includes(p))) && !value.some((s) => s.key === t.key));
  return (
    <div className="space-y-2">
      <div className="eyebrow hidden grid-cols-[6rem_8rem_5.5rem_1fr] gap-2 px-2.5 sm:grid" aria-hidden>
        <span>Key</span>
        <span>Label</span>
        <span>Count</span>
        <span>Eligible positions</span>
      </div>
      <ol className="space-y-1.5">
        {value.map((s, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_5.5rem] gap-2 rounded-lg bg-sunken p-2.5 sm:grid-cols-[6rem_8rem_5.5rem_1fr] sm:items-center">
            {/* phones: a micro-label over each box (desktop has the column heads) */}
            <span className="min-w-0">
              <span className={cn("eyebrow mb-1 sm:hidden", i === 0 ? "block" : "hidden")} aria-hidden>
                Key
              </span>
              <input
                aria-label={`Slot ${i + 1} key`}
                placeholder="KEY"
                className="input py-1.5 font-mono uppercase sm:py-1 sm:text-xs"
                value={s.key}
                maxLength={12}
                disabled={disabled}
                onChange={(e) => set(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
              />
            </span>
            <span className="min-w-0">
              <span className={cn("eyebrow mb-1 sm:hidden", i === 0 ? "block" : "hidden")} aria-hidden>
                Label
              </span>
              <input aria-label={`Slot ${i + 1} label`} placeholder="Label" className="input py-1.5 sm:py-1 sm:text-xs" value={s.label} maxLength={16} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} />
            </span>
            <span className="min-w-0">
              <span className={cn("eyebrow mb-1 sm:hidden", i === 0 ? "block" : "hidden")} aria-hidden>
                Count
              </span>
              <NumberInput ariaLabel={`Slot ${i + 1} count`} value={s.count} min={1} max={10} int disabled={disabled} onChange={(n) => set(i, { count: n })} />
            </span>
            <div className="col-span-3 flex items-start justify-between gap-2 sm:col-span-1">
              <Chips ariaLabel={`Slot ${i + 1} eligible positions`} options={posOptions} value={s.eligible} disabled={disabled} onChange={(v) => set(i, { eligible: POSITION_OPTIONS.map((p) => p.value).filter((p) => v.includes(p)) })} />
              {!disabled && (
                <div className="shrink-0">
                  <RowActions index={i} count={value.length} label={s.label || `slot ${i + 1}`} onMove={(a, b) => onChange(move(value, a, b))} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[13px] font-semibold text-muted">{starters} starters · add:</span>
        {!disabled &&
          templates.map((t) => (
            <button key={t.key} type="button" className={addBtnClass} onClick={() => onChange([...value, { ...t, eligible: [...t.eligible] }])}>
              <Plus size={11} /> {t.label}
            </button>
          ))}
        {!disabled && (
          <button type="button" className={addBtnClass} onClick={() => onChange([...value, { key: uniqueId("CUSTOM", value.map((s) => s.key)).toUpperCase().replace(/-/g, "_"), label: "Custom", count: 1, eligible: ["RB", "WR", "TE"] }])}>
            <Plus size={11} /> Custom slot
          </button>
        )}
      </div>
    </div>
  );
}

function PositionLimitsEditor({ value, onChange, idp, disabled }: { value: Record<string, { min: number; max: number | null }>; onChange: (v: Record<string, { min: number; max: number | null }>) => void; idp: boolean; disabled?: boolean }) {
  const positions = POSITION_OPTIONS.filter((p) => idp || !IDP.includes(p.value) || value[p.value]);
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-line/80">
      <table className="tbl tbl-compact min-w-[300px]">
        <thead>
          <tr>
            <th>Position</th>
            <th className="w-14 text-center">Limit</th>
            <th className="w-[5.25rem] sm:w-32">Min</th>
            <th className="w-[5.25rem] sm:w-32">Max</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const lim = value[p.value];
            return (
              <tr key={p.value}>
                <td className="font-semibold">{p.label}</td>
                <td className="text-center">
                  <label className="inline-flex h-9 w-9 cursor-pointer items-center justify-center sm:h-7 sm:w-7">
                  <input
                    type="checkbox"
                    aria-label={`Limit ${p.label}`}
                    className="h-4 w-4 accent-brand-600"
                    checked={!!lim}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = { ...value };
                      if (e.target.checked) next[p.value] = { min: 0, max: null };
                      else delete next[p.value];
                      onChange(next);
                    }}
                  />
                  </label>
                </td>
                <td>{lim ? <NumberInput ariaLabel={`${p.label} minimum`} value={lim.min} min={0} max={40} int disabled={disabled} onChange={(n) => onChange({ ...value, [p.value]: { ...lim, min: n } })} /> : <span className="text-[13px] text-muted">—</span>}</td>
                <td>
                  {lim ? (
                    <NumberInput
                      ariaLabel={`${p.label} maximum`}
                      value={lim.max}
                      min={0}
                      max={60}
                      int
                      placeholder="Any"
                      disabled={disabled}
                      onChange={(n) => onChange({ ...value, [p.value]: { ...lim, max: Number.isNaN(n) ? null : n } })}
                    />
                  ) : (
                    <span className="whitespace-nowrap text-[13px] text-muted">No limit</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RookieScaleEditor({ value, onChange, full, teamCount, disabled }: { value: Record<string, number[]>; onChange: (v: Record<string, number[]>) => void; full: LeagueSettings; teamCount: number; disabled?: boolean }) {
  const rounds = Math.max(full.draft.rookie.rounds, ...Object.keys(value).map(Number).filter(Number.isFinite), 1);
  const picks = Math.max(teamCount, ...Object.values(value).map((a) => a.length));
  const min = full.salaryCap.minSalary;
  const [fillFrom, setFillFrom] = useState<Record<number, { a: number; b: number }>>({});
  const setRound = (r: number, arr: number[] | null) => {
    const next = { ...value };
    if (arr) next[String(r)] = arr;
    else delete next[String(r)];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <div className="scroll-thin overflow-x-auto rounded-lg ring-1 ring-inset ring-line/80">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th className="tbl-sticky">Round</th>
              {Array.from({ length: picks }, (_, i) => (
                <th key={i} className="num">
                  .{String(i + 1).padStart(2, "0")}
                </th>
              ))}
              <th>Fill</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, ri) => {
              const r = ri + 1;
              const arr = value[String(r)];
              const beyond = r > full.draft.rookie.rounds;
              return (
                <tr key={r} className={beyond ? "opacity-60" : undefined}>
                  <td className="tbl-sticky whitespace-nowrap font-semibold">
                    Rd {r}
                    {beyond && <span className="ml-1 text-[12px] font-normal text-muted">(unused)</span>}
                  </td>
                  {arr ? (
                    Array.from({ length: picks }, (_, pi) => (
                      <td key={pi} className="px-1">
                        <NumberInput
                          ariaLabel={`Round ${r} pick ${pi + 1} salary`}
                          className="w-16"
                          value={arr[pi] ?? null}
                          min={0}
                          max={100000}
                          int
                          placeholder={String(min)}
                          disabled={disabled}
                          onChange={(n) => {
                            const next = Array.from({ length: Math.max(arr.length, pi + 1) }, (_, k) => (k === pi ? n : arr[k] ?? min));
                            setRound(r, next);
                          }}
                        />
                      </td>
                    ))
                  ) : (
                    <td colSpan={picks} className="text-[13px] text-muted">
                      No scale (picks sign at the ${min} minimum).{" "}
                      {!disabled && (
                        <button type="button" className="link" onClick={() => setRound(r, Array.from({ length: picks }, () => min))}>
                          Add round {r} scale
                        </button>
                      )}
                    </td>
                  )}
                  <td className="whitespace-nowrap">
                    {arr && !disabled && (
                      <div className="flex items-center gap-1">
                        <NumberInput ariaLabel={`Round ${r} first pick salary`} className="w-16" value={fillFrom[r]?.a ?? arr[0] ?? min} min={0} max={100000} int onChange={(n) => setFillFrom((f) => ({ ...f, [r]: { a: n, b: f[r]?.b ?? arr[arr.length - 1] ?? min } }))} />
                        <span className="text-[13px] text-muted">→</span>
                        <NumberInput ariaLabel={`Round ${r} last pick salary`} className="w-16" value={fillFrom[r]?.b ?? arr[arr.length - 1] ?? min} min={0} max={100000} int onChange={(n) => setFillFrom((f) => ({ ...f, [r]: { a: f[r]?.a ?? arr[0] ?? min, b: n } }))} />
                        <button
                          type="button"
                          className={addBtnClass}
                          onClick={() => {
                            const a = fillFrom[r]?.a ?? arr[0] ?? min;
                            const b = fillFrom[r]?.b ?? arr[arr.length - 1] ?? min;
                            setRound(r, Array.from({ length: picks }, (_, k) => Math.round(a + ((b - a) * k) / Math.max(1, picks - 1))));
                          }}
                        >
                          Fill
                        </button>
                        <button type="button" className={cn(iconBtn, "hover:text-loss")} onClick={() => setRound(r, null)} aria-label={`Remove round ${r} scale`}>
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-muted">Pick salaries in whole dollars. Rounds come from Drafts › Rookie draft rounds ({full.draft.rookie.rounds}).</p>
    </div>
  );
}
