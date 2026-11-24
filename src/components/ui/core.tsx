// Core UI primitives (server-safe). Client-only widgets live in ./client.tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HeadshotImg } from "./headshot-img";

// ───────── Buttons ─────────
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "gold";
type BtnSize = "xs" | "sm" | "md" | "lg";

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500",
  secondary: "border border-line bg-panel text-ink hover:bg-sunken",
  ghost: "text-ink hover:bg-sunken",
  danger: "bg-loss text-white hover:bg-red-700",
  success: "bg-win text-white hover:bg-green-700",
  gold: "bg-gold-500 text-brand-950 hover:bg-gold-400",
};
const btnSizes: Record<BtnSize, string> = {
  xs: "h-6 px-2 text-[11px]",
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function buttonClass(variant: BtnVariant = "primary", size: BtnSize = "md", className?: string) {
  return cn(btnBase, btnVariants[variant], btnSizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: { href: string; variant?: BtnVariant; size?: BtnSize; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

// ───────── Panels (the CBS-style "module" box) ─────────
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  noPad,
  id,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("overflow-hidden rounded-lg border border-line bg-panel shadow-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line bg-sunken/70 px-3 py-2">
          <div className="min-w-0">
            {title && <h2 className="truncate font-display text-[15px] font-bold uppercase tracking-wide text-ink">{title}</h2>}
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!noPad && "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  kicker,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  kicker?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {kicker && <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">{kicker}</div>}
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────── Badges ─────────
type Tone = "neutral" | "brand" | "gold" | "green" | "red" | "amber" | "purple" | "live";
const toneClass: Record<Tone, string> = {
  neutral: "bg-sunken text-muted border-line",
  brand: "bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:border-brand-800",
  gold: "bg-gold-300/30 text-gold-600 border-gold-400/50 dark:text-gold-300",
  green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800",
  live: "bg-live text-white border-live",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-bold uppercase leading-4 tracking-wide", toneClass[tone], className)}>
      {children}
    </span>
  );
}

const POS_COLORS: Record<string, string> = {
  QB: "bg-rose-600",
  RB: "bg-emerald-600",
  WR: "bg-sky-600",
  TE: "bg-amber-500",
  K: "bg-violet-600",
  DEF: "bg-slate-600",
  DL: "bg-orange-700",
  LB: "bg-teal-700",
  DB: "bg-indigo-700",
  FLEX: "bg-brand-600",
  SFLEX: "bg-fuchsia-700",
  BN: "bg-slate-400",
  IR: "bg-red-700",
  TAXI: "bg-yellow-700",
};

export function PosBadge({ pos, className }: { pos: string | null | undefined; className?: string }) {
  const p = (pos ?? "?").toUpperCase();
  return (
    <span className={cn("inline-flex h-5 min-w-[30px] items-center justify-center rounded px-1 text-[10px] font-bold text-white", POS_COLORS[p] ?? "bg-slate-500", className)}>
      {p === "SFLEX" ? "SF" : p}
    </span>
  );
}

/** Injury designation tag: Q / D / O / IR / PUP / SUS */
export function InjuryTag({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  let label = status;
  let tone = "bg-amber-500 text-white";
  if (s.startsWith("q")) label = "Q";
  else if (s.startsWith("d")) { label = "D"; tone = "bg-orange-600 text-white"; }
  else if (s === "out" || s === "o") { label = "O"; tone = "bg-red-600 text-white"; }
  else if (s.includes("ir") || s.includes("reserve")) { label = "IR"; tone = "bg-red-800 text-white"; }
  else if (s.includes("pup")) { label = "PUP"; tone = "bg-red-800 text-white"; }
  else if (s.includes("sus")) { label = "SUS"; tone = "bg-zinc-700 text-white"; }
  else if (s === "na" || s === "cov") { label = status.toUpperCase(); tone = "bg-zinc-600 text-white"; }
  return (
    <span title={status} className={cn("inline-flex h-4 items-center rounded-sm px-1 text-[9px] font-extrabold leading-none", tone, className)}>
      {label}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn("inline-block h-2 w-2 animate-pulseDot rounded-full bg-live", className)} />;
}

// ───────── Misc ─────────
export function EmptyState({ title, children, icon, className }: { title: string; children?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-panel/60 px-6 py-10 text-center", className)}>
      {icon && <div className="mb-2 text-muted">{icon}</div>}
      <div className="font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, sub, className, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className={cn("rounded-lg border border-line bg-panel px-3 py-2.5", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-0.5 font-display text-2xl font-bold tabular-nums", tone === "good" && "text-win", tone === "bad" && "text-loss")}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Link-based tabs (server friendly). Pass `active` as the current key. */
export function TabLinks({ tabs, active, className }: { tabs: { key: string; label: React.ReactNode; href: string }[]; active: string; className?: string }) {
  return (
    <nav className={cn("scroll-thin -mx-1 mb-3 flex gap-1 overflow-x-auto border-b border-line px-1", className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
            t.key === active ? "border-gold-500 text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  if (src)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-bold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {initials}
    </span>
  );
}

/** Fantasy team logo: uploaded logo or a colored monogram shield */
export function TeamLogo({
  team,
  size = 32,
  className,
}: {
  team: { name: string; abbrev?: string | null; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null };
  size?: number;
  className?: string;
}) {
  if (team.logoUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.logoUrl} alt={team.name} className={cn("shrink-0 rounded-md object-cover", className)} style={{ width: size, height: size }} />;
  const label = (team.abbrev || team.name.slice(0, 3)).toUpperCase().slice(0, 4);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md font-display font-extrabold tracking-tight", className)}
      style={{
        width: size,
        height: size,
        // four-letter abbreviations shrink below the 9px floor so they stay inside small badges
        fontSize: label.length > 3 ? Math.max(6, (size - 2) / 2.6) : Math.max(9, size * 0.34),
        background: `linear-gradient(135deg, ${team.primaryColor ?? "#1f3fa1"} 0%, ${team.primaryColor ?? "#1f3fa1"} 55%, ${team.secondaryColor ?? "#f5b301"} 55%)`,
        color: "#fff",
        // a dark outline keeps white text readable over light secondary colors
        textShadow: "0 0 2px rgb(0 0 0 / 0.75), 0 1px 1px rgb(0 0 0 / 0.5)",
      }}
    >
      {label}
    </span>
  );
}

/** NFL team logo from ESPN CDN */
export function NflLogo({ abbr, size = 20, className }: { abbr: string | null | undefined; size?: number; className?: string }) {
  if (!abbr) return null;
  const code = abbr === "WAS" ? "wsh" : abbr.toLowerCase();
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`} alt={abbr} width={size} height={size} className={cn("shrink-0 object-contain", className)} loading="lazy" />;
}

export function headshotUrl(player: { id: string; position?: string | null; espnId?: string | null }): string {
  if (player.position === "DEF") {
    const code = player.id === "WAS" ? "wsh" : player.id.toLowerCase();
    return `https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png`;
  }
  return `https://sleepercdn.com/content/nfl/players/thumb/${player.id}.jpg`;
}

export function PlayerHeadshot({ player, size = 36, className }: { player: { id: string; fullName: string; position?: string | null }; size?: number; className?: string }) {
  return (
    <HeadshotImg
      src={headshotUrl(player)}
      name={player.fullName}
      size={size}
      className={cn("shrink-0 rounded-full bg-sunken object-cover ring-1 ring-line", player.position === "DEF" && "rounded-md bg-white p-0.5", className)}
    />
  );
}

/** Player name link with position/team and injury tag (CBS style "Name  WR | LAR") */
export function PlayerLink({
  player,
  showMeta = true,
  showHeadshot = false,
  className,
  size = 28,
}: {
  player: { id: string; fullName: string; position: string; team: string | null; injuryStatus?: string | null };
  showMeta?: boolean;
  showHeadshot?: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      {showHeadshot && <PlayerHeadshot player={player} size={size} />}
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <Link href={`/players/${player.id}`} className="truncate font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {player.fullName}
          </Link>
          <InjuryTag status={player.injuryStatus} />
        </span>
        {showMeta && (
          <span className="block text-[11px] leading-tight text-muted">
            {player.position} {player.team ? `· ${player.team}` : "· FA"}
          </span>
        )}
      </span>
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("my-3 border-line", className)} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Alert({ tone = "info", children, className }: { tone?: "info" | "warn" | "error" | "success"; children: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100",
    warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100",
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-100",
    success: "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-100",
  };
  return <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)}>{children}</div>;
}
