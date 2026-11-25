"use client";
// Team branding editor: name, abbreviation, motto, colors (with live preview + contrast check) and logo upload.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button, TeamLogo } from "@/components/ui/core";
import { updateTeamBrandingAction } from "@/lib/profiles/actions";
import { contrastRatio } from "@/lib/profiles/schema";
import { ImageUpload } from "@/components/community/image-upload";

export interface BrandingValues {
  teamId: string;
  name: string;
  abbrev: string;
  motto: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  // follow outside changes (picker, reset) without clobbering a half-typed hex value
  useEffect(() => {
    setText((t) => (t.toLowerCase() === value.toLowerCase() ? t : value));
  }, [value]);
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={HEX.test(value) ? value : "#000000"}
          onChange={(e) => {
            onChange(e.target.value);
            setText(e.target.value);
          }}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-control border border-line bg-panel p-0.5 sm:h-9 sm:w-11"
          aria-label={`${label} picker`}
        />
        <input
          className="input min-w-0 font-mono uppercase"
          value={text}
          maxLength={7}
          onChange={(e) => {
            let t = e.target.value.trim();
            if (t && !t.startsWith("#")) t = `#${t}`;
            setText(t);
            if (HEX.test(t)) onChange(t.toLowerCase());
          }}
          aria-label={`${label} hex value`}
          spellCheck={false}
        />
      </span>
    </label>
  );
}

export function BrandingForm({ initial, record }: { initial: BrandingValues; record: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof BrandingValues>(k: K, val: BrandingValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const dirty = useMemo(
    () => (["name", "abbrev", "motto", "primaryColor", "secondaryColor"] as const).some((k) => v[k] !== initial[k]),
    [v, initial],
  );
  const lowContrast = HEX.test(v.primaryColor) && contrastRatio(v.primaryColor, "#ffffff") < 3;
  const preview = { name: v.name || "Team", abbrev: v.abbrev || "TM", logoUrl: initial.logoUrl, primaryColor: v.primaryColor, secondaryColor: v.secondaryColor };
  const shield = { ...preview, logoUrl: null };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await updateTeamBrandingAction({ teamId: v.teamId, name: v.name, abbrev: v.abbrev, motto: v.motto, primaryColor: v.primaryColor, secondaryColor: v.secondaryColor });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved");
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* live preview */}
      <div className="overflow-hidden rounded-card ring-1 ring-line/70">
        <div className="flex items-center gap-3 bg-panel px-3 py-3">
          <TeamLogo team={preview} size={48} round />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold leading-tight tracking-[-0.01em] text-ink">{v.name || "Team name"}</div>
            <div className="truncate text-[13px] text-muted">{v.motto || (record ? `${record} · ${v.abbrev}` : v.abbrev)}</div>
          </div>
          <span className="flex shrink-0 overflow-hidden rounded-full ring-1 ring-line/70" aria-label="Team colors">
            <span className="h-6 w-4" style={{ background: v.primaryColor }} />
            <span className="h-6 w-4" style={{ background: v.secondaryColor }} />
          </span>
        </div>
        <div className="flex items-center gap-2 border-t border-line/70 bg-sunken/60 px-3 py-2 text-xs">
          <span className="text-muted">Ticker:</span>
          <span className="inline-block h-3 w-1 rounded-sm" style={{ background: v.primaryColor }} />
          <span className="font-bold">{v.abbrev || "TM"}</span>
          {record && <span className="text-muted">{record}</span>}
          <span className="ml-auto text-muted">Monogram:</span>
          <TeamLogo team={shield} size={22} />
        </div>
      </div>

      <ImageUpload
        target={{ kind: "logo", teamId: v.teamId }}
        current={initial.logoUrl}
        label="Team logo"
        fallback={<TeamLogo team={shield} size={72} />}
        size={72}
        hint="Square images look best · up to 2 MB. Without a logo your monogram shield is used."
      />

      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <label className="block">
            <span className="label">Team name</span>
            <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={40} required />
          </label>
          <label className="block">
            <span className="label">Abbrev.</span>
            <input className="input font-semibold uppercase" value={v.abbrev} onChange={(e) => set("abbrev", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={4} minLength={2} required />
          </label>
        </div>
        <label className="block">
          <span className="label">Team motto</span>
          <input className="input" value={v.motto} onChange={(e) => set("motto", e.target.value)} maxLength={100} placeholder="Shown on your team page" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <ColorField label="Primary color" value={v.primaryColor} onChange={(c) => set("primaryColor", c)} />
          <ColorField label="Secondary color" value={v.secondaryColor} onChange={(c) => set("secondaryColor", c)} />
        </div>
        {lowContrast && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={14} className="mt-px shrink-0" /> White text is hard to read on this primary color — pick a darker shade so your monogram and banners stay legible.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-xs font-semibold text-amber-600 dark:text-amber-400">Unsaved changes</span>}
          <Button type="button" variant="ghost" size="md" disabled={!dirty || pending} onClick={() => setV(initial)}>
            Reset
          </Button>
          <Button type="submit" size="md" disabled={!dirty || pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save branding
          </Button>
        </div>
      </form>
    </div>
  );
}
