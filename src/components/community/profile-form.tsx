"use client";
// "About you" editor for /settings/profile — every ManagerProfile field plus name, time zone, phone and privacy.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button, NflLogo } from "@/components/ui/core";
import { Toggle } from "@/components/ui/client";
import { updateProfileAction } from "@/lib/profiles/actions";
import { MANAGER_STYLES, SOCIAL_FIELDS, TIMEZONES, type ProfileInput } from "@/lib/profiles/schema";
import { NFL_TEAMS } from "@/lib/nfl/teams";

export interface ProfileFormValues {
  name: string;
  displayName: string;
  bio: string;
  motto: string;
  location: string;
  favoriteNflTeam: string;
  favoritePlayer: string;
  yearsPlaying: string;
  managerStyle: string;
  timezone: string;
  phone: string;
  showEmail: boolean;
  showPhone: boolean;
  socials: Record<string, string>;
}

const nflSorted = [...NFL_TEAMS].sort((a, b) => `${a.city} ${a.name}`.localeCompare(`${b.city} ${b.name}`));

function Counter({ value, max }: { value: string; max: number }) {
  const n = value.length;
  return <span className={n > max ? "text-loss" : n > max * 0.9 ? "text-amber-600" : "text-muted"}>{n}/{max}</span>;
}

export function ProfileForm({ initial, email, playerSuggestions }: { initial: ProfileFormValues; email: string; playerSuggestions: string[] }) {
  const router = useRouter();
  const [v, setV] = useState<ProfileFormValues>(initial);
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(v) !== JSON.stringify(initial), [v, initial]);
  const set = <K extends keyof ProfileFormValues>(k: K, val: ProfileFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const zones = TIMEZONES.includes(v.timezone) ? TIMEZONES : [v.timezone, ...TIMEZONES];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const input: ProfileInput = { ...v };
      const res = await updateProfileAction(input);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? "Saved");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Identity</legend>
        <label className="block">
          <span className="label">Full name</span>
          <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required autoComplete="name" />
        </label>
        <label className="block">
          <span className="label">Display name</span>
          <input className="input" value={v.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={40} placeholder={v.name || "Nickname shown around the league"} />
          <span className="mt-1 block text-xs text-muted">Shown instead of your name on profiles and history.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="label flex justify-between">
            Motto <Counter value={v.motto} max={100} />
          </span>
          <input className="input" value={v.motto} onChange={(e) => set("motto", e.target.value)} maxLength={100} placeholder="“Trust the process”" />
        </label>
        <label className="block sm:col-span-2">
          <span className="label flex justify-between">
            Bio <Counter value={v.bio} max={1000} />
          </span>
          <textarea className="input min-h-[110px] py-2" value={v.bio} onChange={(e) => set("bio", e.target.value)} maxLength={1000} placeholder="How you got into fantasy, your league rivalries, your proudest trade…" />
        </label>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="eyebrow mb-2">Fan profile</legend>
        <label className="block">
          <span className="label">Favorite NFL team</span>
          <span className="flex items-center gap-2">
            {v.favoriteNflTeam ? <NflLogo abbr={v.favoriteNflTeam} size={28} /> : <span className="h-7 w-7 shrink-0 rounded-full bg-sunken" />}
            <select className="input" value={v.favoriteNflTeam} onChange={(e) => set("favoriteNflTeam", e.target.value)}>
              <option value="">No favorite</option>
              {nflSorted.map((t) => (
                <option key={t.abbr} value={t.abbr}>
                  {t.city} {t.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="block">
          <span className="label">Favorite player</span>
          <input className="input" list="fav-player-list" value={v.favoritePlayer} onChange={(e) => set("favoritePlayer", e.target.value)} maxLength={60} placeholder="All-time or current" />
          <datalist id="fav-player-list">
            {playerSuggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="label">Manager style</span>
          <input className="input" list="manager-style-list" value={v.managerStyle} onChange={(e) => set("managerStyle", e.target.value)} maxLength={40} placeholder="Pick one or write your own" />
          <datalist id="manager-style-list">
            {MANAGER_STYLES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="label">Years playing fantasy</span>
          <input className="input" type="number" inputMode="numeric" min={0} max={70} value={v.yearsPlaying} onChange={(e) => set("yearsPlaying", e.target.value)} placeholder="e.g. 12" />
        </label>
        <label className="block">
          <span className="label">Location</span>
          <input className="input" value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={60} placeholder="City, State" autoComplete="address-level2" />
        </label>
        <label className="block">
          <span className="label">Time zone</span>
          <select className="input" value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">Used for quiet hours on phone alerts.</span>
        </label>
      </fieldset>

      <fieldset>
        <legend className="eyebrow mb-2">Contact & privacy</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-line bg-sunken/50 p-3">
            <div className="label">Email</div>
            <div className="truncate text-sm font-semibold">{email}</div>
            <div className="mt-2">
              <Toggle checked={v.showEmail} onChange={(c) => set("showEmail", c)} label={<span className="text-xs">Show on my profile</span>} />
            </div>
          </div>
          <div className="rounded-md border border-line bg-sunken/50 p-3">
            <label className="block">
              <span className="label">Mobile number</span>
              <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 123-4567" />
            </label>
            <div className="mt-2">
              <Toggle checked={v.showPhone} onChange={(c) => set("showPhone", c)} label={<span className="text-xs">Show on my profile</span>} />
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted">Only league members can see your profile. Your number is also used for the optional text-message fallback for touchdown alerts.</p>
      </fieldset>

      <details id="socials" className="group/soc -mx-4 scroll-mt-16 border-y border-line/70" open={Object.values(initial.socials).some((x) => !!x) || undefined}>
        <summary className="flex min-h-12 cursor-pointer select-none list-none items-center gap-3 px-4 text-[15px] font-semibold hover:bg-sunken/70 sm:text-sm [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">Socials</span>
          <span className="shrink-0 text-[13px] font-medium text-muted">{Object.values(v.socials).filter((x) => !!x).length} added</span>
          <ChevronDown size={18} className="shrink-0 text-faint transition-transform duration-200 group-open/soc:rotate-180" aria-hidden />
        </summary>
        <div className="grid gap-3 px-4 pb-4 pt-1 sm:grid-cols-2">
          {SOCIAL_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="label">{f.label}</span>
              <span className="relative block">
                {f.kind === "handle" && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">@</span>}
                <input
                  className={f.kind === "handle" ? "input pl-6" : "input"}
                  value={v.socials[f.key] ?? ""}
                  onChange={(e) => set("socials", { ...v.socials, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  inputMode={f.kind === "url" ? "url" : "text"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </span>
            </label>
          ))}
        </div>
      </details>

      {/* sticks above the phone tab bar (--tabbar-h is 0 from md) */}
      <div className="sticky bottom-[var(--tabbar-h)] z-10 -mx-4 -mb-4 flex items-center justify-end gap-2 rounded-b-card border-t border-line/70 bg-panel px-4 py-2.5">
        {dirty && <span className="mr-auto text-[13px] font-semibold text-amber-800 dark:text-amber-300">Unsaved changes</span>}
        <Button type="button" variant="ghost" size="md" disabled={!dirty || pending} onClick={() => setV(initial)}>
          Reset
        </Button>
        <Button type="submit" size="md" disabled={pending || !dirty}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save profile
        </Button>
      </div>
    </form>
  );
}
