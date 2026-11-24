// Core UI primitives (server-safe). Client-only widgets live in ./client.tsx.
// Recipes and when to use what: docs/DESIGN.md.
import Link from "next/link";
import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeadshotImg } from "./headshot-img";
import { InfoButton } from "./info-button";
import { ScrollRow } from "./scroll-row";

// v3 presentation primitives (SummaryStrip, Stat, StatGrid, StatRow, CompareBar, Ring, RankBar, Sparkline,
// SectionHeader, Collapsible, MatchupRow, …) and the ⓘ sheet button
export * from "./viz";
export { InfoButton } from "./info-button";

// ───────── Buttons ─────────
type BtnVariant = "primary" | "secondary" | "tinted" | "ghost" | "plain" | "danger" | "success" | "gold";
type BtnSize = "xs" | "sm" | "md" | "lg";

const btnBase =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-semibold tracking-[-0.005em] transition-[background-color,box-shadow,color,opacity,transform] duration-150 ease-out active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/50 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:pointer-events-none disabled:opacity-50";
const btnVariants: Record<BtnVariant, string> = {
  // v3: flat fills, the one interactive blue
  primary: "bg-brand-600 text-white shadow-btn hover:bg-brand-700 dark:hover:bg-brand-500",
  // white button with a hairline
  secondary: "bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken dark:bg-white/[0.06] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] dark:hover:bg-white/[0.1]",
  // blue-tinted (prominent secondary)
  tinted: "bg-brand-600/[0.08] text-brand-700 hover:bg-brand-600/[0.14] dark:bg-brand-400/15 dark:text-brand-300 dark:hover:bg-brand-400/25",
  ghost: "text-ink hover:bg-ink/[0.06]",
  plain: "text-brand-600 hover:bg-brand-600/[0.08] dark:text-brand-400 dark:hover:bg-brand-400/10",
  danger: "bg-[rgb(208_31_43)] text-white shadow-btn hover:bg-[rgb(178_24_36)]",
  success: "bg-green-700 text-white shadow-btn hover:bg-green-800",
  // retired in v3 (gold is for trophies only): renders as the primary blue so existing "one urgent CTA" buttons stay prominent
  gold: "bg-brand-600 text-white shadow-btn hover:bg-brand-700 dark:hover:bg-brand-500",
};
// sm / md are a little taller on phones (finger-sized targets); desktop keeps the dense CBS-style sizes
const btnSizes: Record<BtnSize, string> = {
  xs: "h-7 min-w-7 rounded-md px-2.5 text-[11px] sm:h-6 sm:min-w-6 sm:px-2",
  sm: "h-9 px-3 text-xs sm:h-8",
  md: "h-10 px-4 text-sm sm:h-9",
  lg: "h-11 px-5 text-[15px]",
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

type IconBtnVariant = "ghost" | "secondary" | "tinted" | "onDark";
const iconBtnVariants: Record<IconBtnVariant, string> = {
  ghost: "text-muted hover:bg-ink/[0.06] hover:text-ink",
  secondary: "bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken dark:bg-white/[0.06]",
  tinted: "bg-brand-600/[0.08] text-brand-700 hover:bg-brand-600/[0.14] dark:bg-brand-400/15 dark:text-brand-300",
  // legacy (v3 has no dark surfaces): same as ghost
  onDark: "text-muted hover:bg-ink/[0.06] hover:text-ink",
};

/** Icon-only button / link: always labelled (aria-label + tooltip), 40px on phones. */
export function IconButton({
  label,
  children,
  variant = "ghost",
  size = "md",
  href,
  className,
  ...rest
}: {
  label: string;
  children: React.ReactNode;
  variant?: IconBtnVariant;
  size?: "sm" | "md";
  href?: string;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  const cls = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.94] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/50 disabled:pointer-events-none disabled:opacity-50",
    size === "md" ? "h-10 w-10" : "h-9 w-9 sm:h-8 sm:w-8",
    iconBtnVariants[variant],
    className,
  );
  if (href)
    return (
      <Link href={href} aria-label={label} title={label} className={cls}>
        {children}
      </Link>
    );
  return (
    <button type="button" aria-label={label} title={label} className={cls} {...rest}>
      {children}
    </button>
  );
}

/** "View all ›" link for panel headers and list footers (32px tall hit area, header stays compact). */
export function MoreLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "-mx-1.5 -my-1.5 inline-flex min-h-8 items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 text-[13px] font-semibold text-brand-600 transition-colors hover:bg-brand-600/[0.08] dark:text-brand-400 dark:hover:bg-brand-400/10",
        className,
      )}
    >
      {children}
      <ChevronRight size={14} className="-mr-0.5" aria-hidden />
    </Link>
  );
}

// ───────── Panels (the card) ─────────
/**
 * White card with an optional bold sentence-case title (17px), one grey subline, an ⓘ `info` sheet and a header
 * action (usually `<MoreLink>`). No header rule: hierarchy comes from type and space. Body pads 16px (`noPad` for
 * tables / lists that bleed to the edges).
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  noPad,
  id,
  info,
  infoTitle,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
  id?: string;
  /** "how this works" content, opened from an ⓘ button next to the title (keeps explanations out of the flow) */
  info?: React.ReactNode;
  infoTitle?: string;
}) {
  return (
    <section id={id} className={cn("card overflow-hidden", className)}>
      {(title || actions) && (
        // wraps (actions drop below the title) instead of squeezing a long title down to "…" on phones
        <header className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3.5", noPad ? "pb-2.5" : "pb-0")}>
          <div className="min-w-0">
            {title && (
              <div className="flex min-w-0 items-center gap-1">
                <h2 className="truncate text-[17px] font-bold leading-6 tracking-[-0.01em] text-ink">{title}</h2>
                {info && <InfoButton title={infoTitle ?? (typeof title === "string" ? title : "About")}>{info}</InfoButton>}
              </div>
            )}
            {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!noPad && (title || actions ? "px-4 pb-4 pt-3" : "p-4"), bodyClassName)}>{children}</div>
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
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6", className)}>
      <div className="min-w-0">
        {kicker && <div className="eyebrow mb-1">{kicker}</div>}
        <h1 className="break-words text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[70ch] text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small uppercase heading for a group inside a card or above a list (optional right-side slot). */
export function SectionLabel({ children, right, className, as: Tag = "h3" }: { children: React.ReactNode; right?: React.ReactNode; className?: string; as?: "h2" | "h3" | "h4" | "div" }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <Tag className="eyebrow">{children}</Tag>
      {right}
    </div>
  );
}

// ───────── Badges ─────────
type Tone = "neutral" | "brand" | "gold" | "green" | "red" | "amber" | "purple" | "live";
const toneClass: Record<Tone, string> = {
  neutral: "bg-ink/[0.05] text-muted ring-ink/[0.08] dark:bg-white/[0.07] dark:ring-white/10",
  brand: "bg-brand-600/[0.08] text-brand-700 ring-brand-600/20 dark:bg-brand-400/15 dark:text-brand-300 dark:ring-brand-400/25",
  gold: "bg-gold-400/20 text-gold-800 ring-gold-500/30 dark:bg-gold-400/15 dark:text-gold-300 dark:ring-gold-400/25",
  green: "bg-green-500/10 text-green-700 ring-green-600/20 dark:bg-green-400/15 dark:text-green-300 dark:ring-green-400/20",
  red: "bg-red-500/10 text-red-700 ring-red-600/20 dark:bg-red-400/15 dark:text-red-300 dark:ring-red-400/20",
  amber: "bg-amber-400/15 text-amber-800 ring-amber-500/25 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/20",
  purple: "bg-purple-500/10 text-purple-700 ring-purple-500/20 dark:bg-purple-400/15 dark:text-purple-300 dark:ring-purple-400/20",
  live: "bg-live text-white ring-live",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] ring-1 ring-inset", toneClass[tone], className)}
    >
      {children}
    </span>
  );
}

/**
 * Position tag. v3: neutral grey chip (position is identity, not status) — only IR reads red. Fixed width so player
 * names line up in lists.
 */
// Positions are identity data: the same solid colours as the Roster / Matchup pattern's PosPill (docs/DESIGN.md §6),
// white text ≥ 4.8:1 in both themes. Slot-only keys (FLEX, SF, BN, TAXI) stay neutral; IR is red.
const POS_BADGE: Record<string, string> = {
  QB: "bg-pink-700 text-white",
  RB: "bg-emerald-700 text-white",
  WR: "bg-sky-700 text-white",
  TE: "bg-violet-600 text-white",
  K: "bg-amber-800 text-white",
  DEF: "bg-slate-600 text-white",
  DST: "bg-slate-600 text-white",
  DL: "bg-stone-600 text-white",
  LB: "bg-stone-600 text-white",
  DB: "bg-stone-600 text-white",
  IR: "bg-loss/10 text-loss",
};

export function PosBadge({ pos, className }: { pos: string | null | undefined; className?: string }) {
  const p = (pos ?? "?").toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-[30px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tracking-[0.01em]",
        POS_BADGE[p] ?? "bg-ink/[0.06] text-ink/75 dark:bg-white/[0.08] dark:text-ink/80",
        className,
      )}
    >
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
    <span title={status} className={cn("inline-flex h-4 shrink-0 items-center rounded-[4px] px-1 text-[10px] font-extrabold leading-none", tone, className)}>
      {label}
    </span>
  );
}

/** Pulsing live dot. Its background color pings outward; pass `className="bg-white"` on red fills. */
export function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn("live-dot h-2 w-2 bg-live", className)} />;
}

/** The game-state badge used by every matchup view: pulsing LIVE pill, Final, Upcoming. */
export function GameStatus({ status, label, className }: { status: string; label?: React.ReactNode; className?: string }) {
  if (status === "LIVE")
    return (
      <Badge tone="live" className={className}>
        <LiveDot className="h-1.5 w-1.5 bg-white" /> {label ?? "Live"}
      </Badge>
    );
  if (status === "FINAL")
    return (
      <Badge tone="neutral" className={className}>
        {label ?? "Final"}
      </Badge>
    );
  return (
    <Badge tone="neutral" className={className}>
      {label ?? "Upcoming"}
    </Badge>
  );
}

// ───────── Chips & segmented controls ─────────
/** Pill chip classes (use on client <button>s; the <Chip> component renders links / static chips). */
export function chipClass(active = false, size: "sm" | "md" = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/50",
    size === "md" ? "min-h-10 px-3.5 text-[13px] sm:min-h-8 sm:px-3" : "min-h-8 px-3 text-xs sm:min-h-7 sm:px-2.5",
    active
      ? "bg-brand-600 text-white"
      : "bg-panel text-ink shadow-[inset_0_0_0_1px_rgb(var(--c-line))] hover:bg-sunken dark:bg-white/[0.05] dark:hover:bg-white/[0.09]",
    className,
  );
}

export function Chip({
  href,
  active = false,
  count,
  icon,
  children,
  size = "md",
  className,
  title,
  scroll,
}: {
  href?: string;
  active?: boolean;
  count?: number | string | null;
  icon?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
  title?: string;
  /** passed to next/link (false keeps the scroll position when the chip only changes a filter) */
  scroll?: boolean;
}) {
  const inner = (
    <>
      {icon}
      {children}
      {count != null && count !== "" && (
        <span className={cn("numeral rounded-full px-1.5 text-[11px] font-bold leading-4", active ? "bg-white/20" : "bg-ink/[0.07] text-muted dark:bg-white/10")}>{count}</span>
      )}
    </>
  );
  if (href)
    return (
      <Link href={href} scroll={scroll} title={title} aria-current={active ? "page" : undefined} data-active={active || undefined} className={chipClass(active, size, className)}>
        {inner}
      </Link>
    );
  return (
    <span title={title} data-active={active || undefined} className={chipClass(active, size, className)}>
      {inner}
    </span>
  );
}

/**
 * iOS-style segmented control driven by links (URL state, server friendly). For 2–5 view / filter options;
 * `full` stretches it to the container width (phones). Scrolls sideways if it ever runs out of room.
 */
export function SegmentedLinks({
  options,
  active,
  full,
  className,
  ariaLabel,
  scroll,
}: {
  options: { key: string; label: React.ReactNode; href: string; title?: string }[];
  active: string;
  full?: boolean;
  className?: string;
  ariaLabel?: string;
  scroll?: boolean;
}) {
  return (
    <ScrollRow as="nav" snap={false} aria-label={ariaLabel} className={cn("segmented", full ? "segmented-full" : "w-fit max-w-full", className)}>
      {options.map((o) => (
        <Link key={o.key} href={o.href} scroll={scroll} title={o.title} aria-current={o.key === active ? "page" : undefined} className="segmented-item">
          {o.label}
        </Link>
      ))}
    </ScrollRow>
  );
}

/**
 * Link-based section tabs (server friendly). Pass `active` as the current key. The default is the underline
 * (2px blue indicator) for page sections; `variant="segmented"` renders a segmented control. On phones
 * the row scrolls sideways with snap, fades the edge with more tabs and scrolls the active tab into view.
 */
export function TabLinks({
  tabs,
  active,
  className,
  variant = "underline",
}: {
  tabs: { key: string; label: React.ReactNode; href: string }[];
  active: string;
  className?: string;
  variant?: "underline" | "segmented";
}) {
  if (variant === "segmented") return <SegmentedLinks options={tabs} active={active} className={cn("mb-3", className)} />;
  return (
    <ScrollRow as="nav" className={cn("-mx-1 mb-3 gap-1 border-b border-line px-1", className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "relative -mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 text-[15px] font-semibold transition-colors duration-150 sm:min-h-10 sm:text-sm",
            t.key === active
              ? "text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand-600 dark:after:bg-brand-400"
              : "text-muted hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </ScrollRow>
  );
}

// ───────── Numbers & live data ─────────
const SCORE_SIZES = {
  sm: "text-[15px] font-semibold",
  md: "text-[22px] font-semibold leading-none",
  lg: "text-[32px] font-semibold leading-none tracking-[-0.03em] sm:text-[40px]",
  xl: "text-[44px] font-semibold leading-none tracking-[-0.035em] sm:text-[52px]",
} as const;

/** Big tabular score / stat figure (the signature numeral). `dim` for the trailing side. */
export function ScoreNumber({
  value,
  decimals = 2,
  size = "md",
  dim,
  className,
  placeholder = "—",
}: {
  value: number | null | undefined;
  decimals?: number;
  size?: keyof typeof SCORE_SIZES;
  dim?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const text = value == null || Number.isNaN(value) ? placeholder : value.toFixed(decimals);
  return <span className={cn("numeral", SCORE_SIZES[size], dim ? "text-muted" : "text-ink", className)}>{text}</span>;
}

/**
 * Two-segment win-probability bar (left = first team). Rounded segments with a 3px gap in the two teams' colors
 * (`.wp-seg`). No glow in v3 (`glow` is accepted and ignored). Width changes animate.
 */
export function WinProbBar({
  left,
  leftColor = "#0b5cd5",
  rightColor = "#c3c8d0",
  size = "sm",
  glow = true,
  label,
  className,
}: {
  left: number;
  leftColor?: string;
  rightColor?: string;
  size?: "xs" | "sm" | "md";
  glow?: boolean;
  label?: string;
  className?: string;
}) {
  const p = Number.isFinite(left) ? Math.max(0, Math.min(1, left)) : 0.5;
  const pct = Math.round(p * 1000) / 10;
  const h = size === "xs" ? "h-1" : size === "md" ? "h-2.5" : "h-1.5";
  const leftLeads = p >= 0.5;
  const seg = "wp-seg h-full rounded-full transition-[width] duration-700 ease-out-expo";
  return (
    <div
      className={cn("flex w-full items-center gap-[3px]", h, className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label ?? "Win probability"}
    >
      {pct > 0 && (
        <span
          className={cn(seg, pct >= 100 ? "flex-1" : "shrink-0", glow && leftLeads && "wp-lead")}
          style={{ width: pct >= 100 ? undefined : `calc(${pct}% - 1.5px)`, minWidth: 3, ["--seg" as string]: leftColor }}
        />
      )}
      {pct < 100 && <span className={cn(seg, "min-w-[3px] flex-1", glow && !leftLeads && "wp-lead")} style={{ ["--seg" as string]: rightColor }} />}
    </div>
  );
}

// ───────── Layout helpers ─────────
/**
 * Save / bid / propose bar. Phones: a floating solid card 8px above the bottom tab bar (safe-area aware) that
 * renders its own spacer so the end of the page stays reachable. md+: sticky to the bottom of its container
 * (`desktop="static"` keeps it in flow, `"hidden"` hides it).
 */
export function StickyActionBar({
  children,
  className,
  innerClassName,
  desktop = "sticky",
  label = "Actions",
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  desktop?: "sticky" | "static" | "hidden";
  label?: string;
}) {
  return (
    <>
      <div aria-hidden className="h-20 md:hidden" />
      <div
        role="region"
        aria-label={label}
        className={cn(
          "fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 animate-rise pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]",
          desktop === "sticky" ? "md:sticky md:bottom-4 md:mt-4 md:px-0" : desktop === "static" ? "md:static md:mt-4 md:animate-none md:px-0" : "md:hidden",
          className,
        )}
      >
        <div className={cn("mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2 rounded-2xl bg-raised px-3 py-2.5 shadow-pop", innerClassName)}>{children}</div>
      </div>
    </>
  );
}

/** Shimmering placeholder block (loading states). `circle` for avatars / logos. */
export function Skeleton({ className, circle }: { className?: string; circle?: boolean }) {
  return <span aria-hidden className={cn("skeleton block", circle && "rounded-full", className)} />;
}

const METER_TONES = { brand: "bg-brand-600 dark:bg-brand-400", good: "bg-win", warn: "bg-amber-500", bad: "bg-loss", gold: "bg-gold-500", neutral: "bg-ink/40 dark:bg-white/40" } as const;

/**
 * Share of a whole (cap used, FAB spent, roster spots). Over 100% fills completely. With `caption` / `valueText` it
 * renders a labelled row: caption left, value right, bar under ("Cap used · $294 of $300").
 */
export function Meter({
  value,
  max,
  tone = "brand",
  size = "sm",
  label,
  caption,
  valueText,
  className,
}: {
  value: number;
  max: number;
  tone?: keyof typeof METER_TONES;
  size?: "sm" | "md";
  /** accessible name of the bar */
  label?: string;
  /** visible label above the bar (left) */
  caption?: React.ReactNode;
  /** visible value above the bar (right) */
  valueText?: React.ReactNode;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bar = (
    <div
      role="meter"
      aria-label={label ?? (typeof caption === "string" ? caption : undefined)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 100) / 100}
      className={cn("w-full overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]", size === "md" ? "h-2" : "h-1.5", !(caption || valueText) && className)}
    >
      <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-out-expo", METER_TONES[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
  if (!(caption || valueText)) return bar;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="truncate text-muted">{caption}</span>
        <span className="numeral shrink-0 font-semibold text-ink">{valueText}</span>
      </div>
      {bar}
    </div>
  );
}

/** The drag handle at the top of a phone bottom sheet (hidden from sm, where sheets become dialogs). */
export function SheetGrabber({ className }: { className?: string }) {
  return <span aria-hidden className={cn("absolute left-1/2 top-1.5 h-[5px] w-9 -translate-x-1/2 rounded-full bg-ink/15 sm:hidden dark:bg-white/20", className)} />;
}

/** Row classes for <Dropdown> menus (links and buttons): inset, rounded, 40px tall on phones. */
export const menuItemClass =
  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-ink/[0.05] active:bg-ink/[0.08] dark:hover:bg-white/[0.07] [&>svg]:shrink-0 [&>svg]:text-muted";
/** A non-interactive caption row at the top of a <Dropdown> menu. */
export const menuLabelClass = "mx-1.5 mb-1 border-b border-line/70 px-3 pb-2 pt-1.5 text-xs text-muted";

/** Inset grouped list (phones: the card-list alternative to a wide table). Children are <ListRow>s. */
export function ListGroup({
  title,
  right,
  footer,
  children,
  className,
  listClassName,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  listClassName?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <h2 className="truncate text-[17px] font-bold leading-6 tracking-[-0.01em] text-ink">{title}</h2>
          {right}
        </div>
      )}
      <ul className={cn("card divide-y divide-line/70 overflow-hidden", listClassName)}>{children}</ul>
      {footer && <p className="mt-1.5 px-1 text-[13px] text-muted">{footer}</p>}
    </section>
  );
}

/**
 * The list row (ESPN-style): leading logo / headshot · title + ONE grey subline · right-aligned primary number
 * (`value`, + a small grey `valueSub`) or any `trailing` node. ≥52px tall; titles truncate with a tooltip.
 */
export function ListRow({
  href,
  leading,
  title,
  subtitle,
  trailing,
  value,
  valueSub,
  valueTone,
  chevron,
  mine,
  className,
  titleText,
  as: Tag = "li",
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  /** the row's primary number, right-aligned (15px semibold tabular) */
  value?: React.ReactNode;
  valueSub?: React.ReactNode;
  valueTone?: "good" | "bad" | "muted";
  chevron?: boolean;
  /** my team / my player: blue title + blue leading edge */
  mine?: boolean;
  className?: string;
  /** tooltip for a truncated non-string title */
  titleText?: string;
  as?: "li" | "div";
}) {
  const inner = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span
          className={cn("block truncate text-[15px] font-semibold leading-5 sm:text-sm", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}
          title={titleText ?? (typeof title === "string" ? title : undefined)}
        >
          {title}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-muted">{subtitle}</span>}
      </span>
      {value != null && (
        <span className="shrink-0 text-right">
          <span className={cn("numeral block text-[15px] font-semibold leading-5", valueTone === "good" ? "text-win" : valueTone === "bad" ? "text-loss" : valueTone === "muted" ? "text-muted" : "text-ink")}>{value}</span>
          {valueSub != null && <span className="block text-[12px] leading-4 text-muted">{valueSub}</span>}
        </span>
      )}
      {trailing != null && <span className="shrink-0 text-right">{trailing}</span>}
      {chevron && <ChevronRight size={16} className="-mr-1 shrink-0 text-faint" aria-hidden />}
    </>
  );
  const cls = cn(
    "flex min-h-[52px] items-center gap-3 px-4 py-2",
    mine && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]",
    href && "transition-colors hover:bg-sunken/70 active:bg-sunken",
    className,
  );
  return <Tag>{href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}</Tag>;
}

// ───────── Misc ─────────
export function EmptyState({ title, children, icon, className }: { title: string; children?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-card bg-sunken px-4 py-8 text-center sm:px-6 sm:py-10", className)}>
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-panel text-muted shadow-card">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, sub, className, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className={cn("card min-w-0 px-4 py-3", className)}>
      <div className="eyebrow leading-tight">{label}</div>
      <div
        className={cn(
          "mt-1 break-words text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink tabular-nums sm:text-[26px]",
          tone === "good" && "text-win",
          tone === "bad" && "text-loss",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
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
    return <img src={src} alt={name} width={size} height={size} className={cn("shrink-0 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10", className)} style={{ width: size, height: size }} />;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-ink/[0.08] font-semibold text-ink dark:bg-white/[0.12]", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {initials}
    </span>
  );
}

export type TeamLike = { name: string; abbrev?: string | null; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null };

/** Fantasy team logo: uploaded logo or a colored monogram shield (a squircle at every size). */
export function TeamLogo({ team, size = 32, className, round }: { team: TeamLike; size?: number; className?: string; /** a circle (Matchup header, Roster header) */ round?: boolean }) {
  const radius = round ? size / 2 : Math.max(4, Math.round(size * 0.24));
  if (team.logoUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.logoUrl} alt={team.name} className={cn("shrink-0 object-cover", className)} style={{ width: size, height: size, borderRadius: radius }} />;
  const label = (team.abbrev || team.name.slice(0, 3)).toUpperCase().slice(0, 4);
  const primary = team.primaryColor ?? "#1f3fa1";
  return (
    <span
      className={cn("inline-flex shrink-0 select-none items-center justify-center font-bold leading-none tracking-[-0.02em]", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: label.length > 3 ? Math.max(7, size * 0.28) : Math.max(8, size * 0.34),
        background: `linear-gradient(135deg, ${primary} 0%, ${primary} 55%, ${team.secondaryColor ?? "#f5b301"} 55%)`,
        color: "#fff",
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 1px 0 rgb(255 255 255 / 0.22)",
        // a dark outline keeps white text readable over light secondary colors
        textShadow: "0 0 2px rgb(0 0 0 / 0.75), 0 1px 1px rgb(0 0 0 / 0.5)",
      }}
    >
      {label}
    </span>
  );
}

/** Team identity row: logo + truncating name (+ meta line). `mine` tints the name. */
export function TeamIdentity({
  team,
  size = 28,
  sub,
  href,
  mine,
  reverse,
  className,
  nameClassName,
}: {
  team: TeamLike;
  size?: number;
  sub?: React.ReactNode;
  href?: string | null;
  mine?: boolean;
  /** logo on the right, text right-aligned (the away side of a matchup) */
  reverse?: boolean;
  className?: string;
  nameClassName?: string;
}) {
  const body = (
    <>
      <TeamLogo team={team} size={size} />
      <span className={cn("min-w-0", reverse && "text-right")}>
        <span title={team.name} className={cn("block truncate font-semibold leading-tight", href && "group-hover:underline", mine ? "text-brand-700 dark:text-brand-400" : "text-ink", nameClassName)}>
          {team.name}
        </span>
        {sub && <span className="mt-0.5 block truncate text-xs leading-tight text-muted">{sub}</span>}
      </span>
    </>
  );
  const cls = cn("flex min-w-0 items-center gap-2.5", reverse && "flex-row-reverse", className);
  return href ? (
    <Link href={href} className={cn("group", cls)}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
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
      className={cn("shrink-0 rounded-full bg-sunken object-cover ring-1 ring-black/[0.06] dark:ring-white/10", player.position === "DEF" && "rounded-lg bg-white p-0.5", className)}
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
          <Link href={`/players/${player.id}`} title={player.fullName} className="truncate font-semibold text-ink hover:text-brand-600 hover:underline dark:hover:text-brand-400">
            {player.fullName}
          </Link>
          <InjuryTag status={player.injuryStatus} />
        </span>
        {showMeta && (
          <span className="block text-xs leading-tight text-muted">
            {player.position} {player.team ? `· ${player.team}` : "· FA"}
          </span>
        )}
      </span>
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("my-3 border-line/70", className)} />;
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

const ALERT_TONES = {
  info: "bg-brand-600/[0.06] text-ink ring-brand-600/15 dark:bg-brand-400/10 dark:text-brand-100 dark:ring-brand-400/20",
  warn: "bg-amber-400/[0.13] text-amber-900 ring-amber-500/25 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/20",
  error: "bg-red-500/[0.07] text-red-800 ring-red-500/20 dark:bg-red-400/10 dark:text-red-100 dark:ring-red-400/20",
  success: "bg-green-500/[0.08] text-green-800 ring-green-600/20 dark:bg-green-400/10 dark:text-green-100 dark:ring-green-400/20",
} as const;
const ALERT_ICONS = { info: Info, warn: TriangleAlert, error: CircleAlert, success: CircleCheck } as const;

/** Tinted message box. `icon` adds the tone's icon (or pass your own node). */
export function Alert({
  tone = "info",
  children,
  className,
  icon,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: React.ReactNode;
  className?: string;
  icon?: boolean | React.ReactNode;
}) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={cn("rounded-lg px-3.5 py-2.5 text-sm ring-1 ring-inset", ALERT_TONES[tone], className)}>
      {icon ? (
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0" aria-hidden>
            {icon === true ? <Icon size={16} /> : icon}
          </span>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
