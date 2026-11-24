// Manager profile + team branding + notification preference schemas. Pure and client-safe.
import { z } from "zod";
import { NFL_TEAMS } from "@/lib/nfl/teams";

export const MANAGER_STYLES = ["Win-now", "Rebuilder", "Contender", "Trade addict", "Waiver hawk", "Analytics nerd", "Gut feel", "Set it and forget it", "Tank commander", "Dynasty builder"];

export interface SocialField {
  key: string;
  label: string;
  placeholder: string;
  /** builds the public URL from the stored handle */
  url: (v: string) => string;
  kind: "handle" | "url";
}

export const SOCIAL_FIELDS: SocialField[] = [
  { key: "x", label: "X / Twitter", placeholder: "handle", url: (v) => `https://x.com/${v}`, kind: "handle" },
  { key: "instagram", label: "Instagram", placeholder: "handle", url: (v) => `https://instagram.com/${v}`, kind: "handle" },
  { key: "threads", label: "Threads", placeholder: "handle", url: (v) => `https://www.threads.net/@${v}`, kind: "handle" },
  { key: "tiktok", label: "TikTok", placeholder: "handle", url: (v) => `https://www.tiktok.com/@${v}`, kind: "handle" },
  { key: "youtube", label: "YouTube", placeholder: "handle", url: (v) => `https://www.youtube.com/@${v}`, kind: "handle" },
  { key: "twitch", label: "Twitch", placeholder: "handle", url: (v) => `https://www.twitch.tv/${v}`, kind: "handle" },
  { key: "website", label: "Website", placeholder: "https://…", url: (v) => v, kind: "url" },
];

const handle = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?[^/]+\/@?/i, "").replace(/\/+$/, ""))
  .pipe(z.string().max(40, "Handles are at most 40 characters").regex(/^[A-Za-z0-9._-]*$/, "Handles may only use letters, numbers, . _ and -"));

const websiteUrl = z
  .string()
  .trim()
  .max(200, "Website URL is too long")
  .refine((v) => !v || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v), "Website must start with http:// or https://");

export const socialsSchema = z.object(Object.fromEntries(SOCIAL_FIELDS.map((f) => [f.key, (f.kind === "url" ? websiteUrl : handle).optional().default("")]))).transform((o) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "string" && v) out[k] = v;
  return out;
});

/** Normalise stored socials JSON into { key: value } for known networks only. */
export function readSocials(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const f of SOCIAL_FIELDS) {
    const v = (raw as Record<string, unknown>)[f.key] ?? (f.key === "x" ? (raw as Record<string, unknown>).twitter : undefined);
    if (typeof v === "string" && v.trim()) out[f.key] = v.trim();
  }
  return out;
}

export function socialLinks(raw: unknown): { key: string; label: string; value: string; href: string }[] {
  const s = readSocials(raw);
  return SOCIAL_FIELDS.filter((f) => s[f.key]).flatMap((f) => {
    const href = f.url(s[f.key]);
    if (!/^https?:\/\//i.test(href)) return [];
    return [{ key: f.key, label: f.label, value: f.kind === "url" ? s[f.key].replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "") : `@${s[f.key]}`, href }];
  });
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is limited to ${max} characters`)
    .transform((v) => v || null);

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC",
];

/** Loose E.164-ish phone normaliser: keeps a leading + and digits. US 10-digit numbers get +1. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const digits = t.replace(/[^\d]/g, "");
  if (t.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : "invalid";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "invalid";
}

export const phoneSchema = z
  .string()
  .max(32)
  .transform((v) => normalizePhone(v))
  .refine((v) => v !== "invalid", "Enter a valid mobile number, e.g. (555) 123-4567 or +44 7700 900123");

const NFL_ABBRS = NFL_TEAMS.map((t) => t.abbr);

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(60, "Name is limited to 60 characters"),
  displayName: optionalText(40, "Display name"),
  bio: optionalText(1000, "Bio"),
  motto: optionalText(100, "Motto"),
  location: optionalText(60, "Location"),
  favoriteNflTeam: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || NFL_ABBRS.includes(v), "Choose an NFL team"),
  favoritePlayer: optionalText(60, "Favorite player"),
  yearsPlaying: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 70), "Years playing must be a whole number from 0 to 70"),
  managerStyle: optionalText(40, "Manager style"),
  timezone: z.string().trim().refine(isValidTimezone, "Choose a valid time zone"),
  phone: phoneSchema,
  showEmail: z.boolean(),
  showPhone: z.boolean(),
  socials: socialsSchema,
});

export type ProfileInput = z.input<typeof profileSchema>;

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colors must be hex values like #1f3fa1")
  .transform((v) => v.toLowerCase());

export const brandingSchema = z.object({
  teamId: z.string().min(1).max(64),
  name: z.string().trim().min(2, "Team name must be at least 2 characters").max(40, "Team name is limited to 40 characters"),
  abbrev: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,4}$/, "Abbreviation must be 2–4 letters or numbers")),
  motto: optionalText(100, "Team motto"),
  primaryColor: hexColor,
  secondaryColor: hexColor,
});

/** Relative luminance contrast between two hex colors (WCAG). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ───────────────────────────── Notification preferences ─────────────────────────────

export const TD_SCOPES = [
  { value: "MY_STARTERS", label: "My starters", hint: "Only players in your starting lineup" },
  { value: "MY_ROSTER", label: "My whole roster", hint: "Starters, bench, IR and taxi" },
  { value: "MY_MATCHUP", label: "My matchup", hint: "Your starters plus your opponent's" },
  { value: "LEAGUE", label: "Entire league", hint: "Every rostered player in the league" },
  { value: "OFF", label: "Off", hint: "No touchdown alerts" },
] as const;

export type TdScope = (typeof TD_SCOPES)[number]["value"];

export interface ChannelPref {
  push: boolean;
  email: boolean;
  inApp: boolean;
}

/** Merge stored prefs over defaults for every known notification type. */
export function resolvePrefs<T extends string>(defaults: Record<T, ChannelPref & { label: string }>, stored: unknown): Record<T, ChannelPref> {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, Partial<ChannelPref>>;
  const out = {} as Record<T, ChannelPref>;
  for (const key of Object.keys(defaults) as T[]) {
    const d = defaults[key];
    const v = s[key] ?? {};
    out[key] = {
      push: typeof v.push === "boolean" ? v.push : d.push,
      email: typeof v.email === "boolean" ? v.email : d.email,
      inApp: typeof v.inApp === "boolean" ? v.inApp : d.inApp,
    };
  }
  return out;
}

const hour = z.number().int().min(0).max(23);

export const notificationPrefsSchema = z
  .object({
    prefs: z.record(z.string(), z.object({ push: z.boolean(), email: z.boolean(), inApp: z.boolean() })),
    tdScope: z.enum(["MY_STARTERS", "MY_ROSTER", "MY_MATCHUP", "LEAGUE", "OFF"]),
    quietHours: z.boolean(),
    quietStart: hour,
    quietEnd: hour,
    weeklyRecapEmail: z.boolean(),
    smsEnabled: z.boolean(),
    phone: phoneSchema,
  })
  .refine((v) => !v.quietHours || v.quietStart !== v.quietEnd, { message: "Quiet hours need different start and end times", path: ["quietEnd"] })
  .refine((v) => !v.smsEnabled || !!v.phone, { message: "Add a mobile number to use the text-message fallback", path: ["phone"] });

export function hourLabel(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const v = h % 12 === 0 ? 12 : h % 12;
  return `${v}:00 ${suffix}`;
}

/** Friendly device label from a user-agent string. */
export function deviceLabel(ua: string | null | undefined): { device: string; browser: string; icon: "phone" | "tablet" | "desktop" } {
  const s = ua ?? "";
  let device = "Unknown device";
  let icon: "phone" | "tablet" | "desktop" = "desktop";
  if (/iPhone/i.test(s)) {
    device = "iPhone";
    icon = "phone";
  } else if (/iPad/i.test(s)) {
    device = "iPad";
    icon = "tablet";
  } else if (/Android/i.test(s)) {
    device = /Mobile/i.test(s) ? "Android phone" : "Android tablet";
    icon = /Mobile/i.test(s) ? "phone" : "tablet";
  } else if (/Macintosh|Mac OS X/i.test(s)) device = "Mac";
  else if (/Windows/i.test(s)) device = "Windows PC";
  else if (/CrOS/i.test(s)) device = "Chromebook";
  else if (/Linux/i.test(s)) device = "Linux";
  let browser = "Browser";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\//i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Firefox|FxiOS/i.test(s)) browser = "Firefox";
  else if (/CriOS|Chrome/i.test(s)) browser = "Chrome";
  else if (/Safari/i.test(s)) browser = /iPhone|iPad/i.test(s) && !/Version\//i.test(s) ? "Home Screen app" : "Safari";
  return { device, browser, icon };
}
