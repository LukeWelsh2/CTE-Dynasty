// Fantasy presentation kit — the canonical "Matchup" and "Roster" patterns (docs/DESIGN.md §6). Server-safe: no
// hooks, so server pages and client components share the same rows. Live pieces (tweening scores) are passed in as
// nodes by client callers; the header with live numbers is `MatchupHeader` (./matchup-header, client).
import Link from "next/link";
import { Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";
import { NflLogo, PlayerHeadshot } from "./core";

// ───────────────────────────── Numbers ─────────────────────────────

/** Fantasy points without trailing zeros, like a box score: 26 · 7.75 · 63.9 · 0 (max 2 decimals). */
export function fmtPoints(v: number, maxDecimals = 2): string {
  const f = 10 ** maxDecimals;
  const r = Math.round((Number.isFinite(v) ? v : 0) * f) / f;
  return Object.is(r, -0) ? "0" : String(r);
}

// ───────────────────────────── Position + slot colours ─────────────────────────────
// Positions are identity data (like team colours): a solid pill with white text (≥ 4.8:1 in both themes). Slots are
// the same hues as outlined pills. Red is NOT a position colour (it means live / loss / injury); QB is pink.

const POS_SOLID: Record<string, string> = {
  QB: "bg-pink-700",
  RB: "bg-emerald-700",
  WR: "bg-sky-700",
  TE: "bg-violet-600",
  K: "bg-amber-800",
  DEF: "bg-slate-600",
  DL: "bg-stone-600",
  LB: "bg-stone-600",
  DB: "bg-stone-600",
  IDP: "bg-stone-600",
};

const SLOT_OUTLINE: Record<string, string> = {
  QB: "text-pink-700 dark:text-pink-400",
  RB: "text-emerald-700 dark:text-emerald-400",
  WR: "text-sky-700 dark:text-sky-400",
  TE: "text-violet-600 dark:text-violet-400",
  K: "text-amber-800 dark:text-amber-400",
  DEF: "text-slate-600 dark:text-slate-400",
  FLEX: "text-orange-700 dark:text-orange-400",
  SF: "text-fuchsia-700 dark:text-fuchsia-400",
  IDP: "text-stone-600 dark:text-stone-400",
  BN: "text-zinc-500 dark:text-zinc-400",
  IR: "text-red-700 dark:text-red-400",
  TAXI: "text-stone-500 dark:text-stone-400",
};

/** "SFLEX" → "SF", "W/R/T" → "FLEX", "BENCH" → "BN"; anything unknown stays as written. */
export function slotKey(slot: string): string {
  const s = slot.toUpperCase();
  if (s === "SFLEX" || s === "SUPERFLEX" || s === "OP" || s === "Q/W/R/T") return "SF";
  if (s === "FLEX" || s === "W/R/T" || s === "W/R" || s === "R/W" || s === "WRT" || s === "W/T" || s === "REC_FLEX") return "FLEX";
  if (s === "BN" || s === "BENCH") return "BN";
  if (s === "DST" || s === "D/ST") return "DEF";
  if (s === "TX" || s === "TAXI") return "TAXI";
  if (s === "IDP_FLEX" || s === "DL" || s === "LB" || s === "DB") return SLOT_OUTLINE[s] ? s : "IDP";
  return s;
}

/** Solid position pill ("QB" in pink, "RB" in green …) — the player's real position. */
export function PosPill({ pos, className }: { pos: string | null | undefined; className?: string }) {
  const p = (pos ?? "?").toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[26px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none tracking-[0.02em] text-white",
        POS_SOLID[p] ?? "bg-zinc-500",
        className,
      )}
    >
      {p === "DST" ? "DEF" : p}
    </span>
  );
}

/** Outlined slot pill (QB / RB / WR / TE / FLEX / SF / K / DEF / BN / IR / TAXI), coloured by slot. */
export function SlotPill({ slot, label, className, active }: { slot: string; label?: string; className?: string; /** selected for a move */ active?: boolean }) {
  const k = slotKey(slot);
  return (
    <span
      className={cn(
        "inline-flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-current font-score text-[16px] font-bold leading-none tracking-[0.01em]",
        SLOT_OUTLINE[k] ?? "text-zinc-500 dark:text-zinc-400",
        active && "bg-sunken ring-2 ring-current ring-offset-2 ring-offset-panel",
        className,
      )}
    >
      {label ?? (k === "TAXI" ? "TX" : k)}
    </span>
  );
}

/** Injury designation as a red letter after the NFL team ("PHI Q"). */
export function InjuryLetter({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const label = s.startsWith("q")
    ? "Q"
    : s.startsWith("d")
      ? "D"
      : s === "out" || s === "o"
        ? "O"
        : s.includes("ir") || s.includes("reserve")
          ? "IR"
          : s.includes("pup")
            ? "PUP"
            : s.includes("sus")
              ? "SUS"
              : status.toUpperCase().slice(0, 3);
  return (
    <span title={status} className={cn("shrink-0 font-bold text-loss", className)}>
      {label}
    </span>
  );
}

// ───────────────────────────── Structure ─────────────────────────────

/** The week label at the top of a matchup: a full-width blue rounded bar. */
export function WeekBanner({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-9 items-center justify-center gap-2 rounded-full bg-brand-600 px-4 text-[15px] font-semibold text-white", className)}>
      {children}
    </div>
  );
}

/** The small "VS" badge between the two scores. */
export function VsBadge({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[9px] bg-brand-600 font-score font-bold leading-none text-white", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      VS
    </span>
  );
}

/** Light-grey rounded section bar ("Active players · PROJ 91.0", "Bench", "IR", "Taxi"). */
export function SectionBar({ title, right, className, as: As = "h2", id }: { title: React.ReactNode; right?: React.ReactNode; className?: string; as?: "h2" | "h3" | "div"; id?: string }) {
  return (
    <div id={id} className={cn("flex min-h-10 items-center justify-between gap-3 rounded-[10px] bg-sunken px-4 py-2", className)}>
      <As className="min-w-0 truncate text-[15px] font-semibold text-ink">{title}</As>
      {right && <div className="shrink-0 text-[13px] text-muted">{right}</div>}
    </div>
  );
}

/** "PROJ: 91.0" for a section bar. */
export function BarTotal({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <span className="uppercase tracking-[0.02em]">{label}:</span> <span className="numeral text-[15px] font-semibold text-ink">{value}</span>
    </span>
  );
}

// ───────────────────────────── Matchup pattern: side-by-side rows ─────────────────────────────

export interface H2HPlayer {
  id: string;
  /** "J. Allen" (phones) */
  short: string;
  /** "Josh Allen" (sm+ and title) */
  name: string;
  position: string;
  nflTeam: string | null;
  injury: string | null;
  /** grey game line: "Sun 1:00 PM vs MIA", "Q3 4:21 · 14-10 vs MIA", "26-9 vs MIA (F)" */
  game: React.ReactNode;
  /** the game is in progress (red tint on the game line, set by the caller) */
  playing?: boolean;
  /** extra grey line, e.g. "Auto-sub for X" */
  note?: React.ReactNode;
}

/** One player's name block in a side-by-side row (right side mirrors). */
export function H2HPlayerBlock({ p, align, empty }: { p: H2HPlayer | null; align: "left" | "right"; empty?: string }) {
  const right = align === "right";
  if (!p) return <div className={cn("flex min-w-0 items-center py-3 text-[14px] font-semibold", empty ? "text-loss" : "text-muted", right && "justify-end")}>{empty ?? ""}</div>;
  return (
    <div className={cn("min-w-0 py-3", right && "text-right")}>
      <Link href={`/players/${p.id}`} title={p.name} className="block truncate text-[15px] font-bold leading-5 text-ink hover:underline">
        <span className="sm:hidden">{p.short}</span>
        <span className="hidden sm:inline">{p.name}</span>
      </Link>
      <div className={cn("mt-1 flex items-center gap-1.5 text-[13px] leading-4 text-ink", right && "justify-end")}>
        <PosPill pos={p.position} />
        <span className="font-medium">{p.position === "DEF" ? "" : (p.nflTeam ?? "FA")}</span>
        <InjuryLetter status={p.injury} />
      </div>
      <div className="mt-1 truncate text-[13px] leading-4 text-muted">{p.game}</div>
      {p.note && <div className="mt-0.5 truncate text-[12px] font-semibold leading-4 text-brand-600 dark:text-brand-400">{p.note}</div>}
    </div>
  );
}

/** Points (big condensed numeral) over the projection (small grey). */
export function PointsStack({ points, projected, align, dim, className }: { points: React.ReactNode; projected: React.ReactNode; align: "left" | "right"; dim?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col py-3", align === "right" ? "items-end text-right" : "items-start text-left", className)}>
      <span className={cn("font-score text-[26px] font-bold leading-[26px] tracking-[0.005em]", dim ? "text-faint" : "text-ink")}>{points}</span>
      <span className="numeral mt-1 text-[13px] leading-4 text-muted" title="Projected">
        {projected}
      </span>
    </div>
  );
}

// ───────────────────────────── Roster pattern ─────────────────────────────

/** Headshot with a small NFL logo badge on its lower-left. */
export function HeadshotBadge({ player, nflTeam, size = 48, className }: { player: { id: string; fullName: string; position?: string | null }; nflTeam: string | null; size?: number; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <PlayerHeadshot player={player} size={size} />
      {nflTeam && player.position !== "DEF" && (
        <span className="absolute -bottom-0.5 -left-1 inline-flex items-center justify-center rounded-full bg-panel p-[2px] shadow-[0_0_0_1px_rgb(var(--c-line))]">
          <NflLogo abbr={nflTeam} size={Math.round(size * 0.36)} />
        </span>
      )}
    </span>
  );
}

/** One right-aligned stat column in a roster row: grey label over the number. */
export function RosterStat({ label, value, tone, className, title }: { label: string; value: React.ReactNode; tone?: "good" | "bad" | "muted"; className?: string; title?: string }) {
  return (
    <div title={title} className={cn("flex w-12 shrink-0 flex-col items-end text-right sm:w-14", className)}>
      <span className="text-[11px] font-medium uppercase leading-4 tracking-[0.04em] text-muted">{label}</span>
      <span className={cn("numeral text-[17px] font-semibold leading-6", tone === "good" ? "text-win" : tone === "bad" ? "text-loss" : tone === "muted" ? "text-muted" : "text-ink")}>{value}</span>
    </div>
  );
}

/** Opponent line: "@ DAL Thu 4:30 PM" — the opponent bold, tinted by matchup difficulty (green easy, red hard). */
export function OppLine({ opp, when, difficulty, className }: { opp: string | null; when?: React.ReactNode; difficulty?: "easy" | "hard" | null; className?: string }) {
  if (!opp || opp === "BYE") return <span className={cn("truncate text-[13px] font-semibold text-muted", className)}>BYE</span>;
  // "@BUF" / "@ BUF" / "vs KC"
  const m = /^(@|vs\.?)\s*(.+)$/i.exec(opp.trim());
  const [pre, abbr] = m ? [m[1]!, m[2]!] : ["", opp];
  return (
    <span className={cn("truncate text-[13px] text-muted", className)}>
      {pre && <span className={cn("font-semibold", difficulty === "easy" ? "text-win" : difficulty === "hard" ? "text-loss" : "text-ink")}>{pre} </span>}
      <span className={cn("font-bold", difficulty === "easy" ? "text-win" : difficulty === "hard" ? "text-loss" : "text-ink")}>{abbr}</span>
      {when && <> {when}</>}
    </span>
  );
}

/**
 * A roster row (the Roster pattern): slot pill · headshot with NFL badge · name (+ news icon, red injury letter) /
 * position pill + NFL team / opponent line · right-aligned stat columns. `slot` is a node so the lineup editor can
 * pass a button; `stats` are `RosterStat`s (scroll sideways on phones when there are many).
 */
export function RosterRow({
  slot,
  player,
  href,
  opp,
  stats,
  news,
  className,
  highlight,
  dim,
  after,
  nameExtra,
  trailing,
}: {
  slot: React.ReactNode;
  player: { id: string; name: string; short?: string; position: string; nflTeam: string | null; injury: string | null } | null;
  href?: string;
  opp?: React.ReactNode;
  stats?: React.ReactNode;
  /** show the news icon (recent news) */
  news?: boolean;
  className?: string;
  /** e.g. a move target */
  highlight?: boolean;
  /** locked / not editable */
  dim?: boolean;
  /** anything under the row (inline controls) */
  after?: React.ReactNode;
  nameExtra?: React.ReactNode;
  /** row actions after the stats (⋯ menu) */
  trailing?: React.ReactNode;
}) {
  return (
    <div className={cn("border-b border-line/70 last:border-b-0", highlight && "bg-brand-600/[0.05] dark:bg-brand-400/10", className)}>
      <div className="flex min-h-[76px] items-center gap-2.5 py-2.5 sm:gap-3">
        <div className="shrink-0">{slot}</div>
        {player ? (
          <>
            <HeadshotBadge player={{ id: player.id, fullName: player.name, position: player.position }} nflTeam={player.nflTeam} size={44} className={cn(dim && "opacity-60")} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                {href ? (
                  <Link href={href} title={player.name} className="truncate text-[15px] font-bold leading-5 text-ink hover:underline">
                    <span className="sm:hidden">{player.short ?? player.name}</span>
                    <span className="hidden sm:inline">{player.name}</span>
                  </Link>
                ) : (
                  <span title={player.name} className="truncate text-[15px] font-bold leading-5 text-ink">
                    <span className="sm:hidden">{player.short ?? player.name}</span>
                    <span className="hidden sm:inline">{player.name}</span>
                  </span>
                )}
                {news && <Newspaper size={14} className="shrink-0 text-amber-600 dark:text-amber-400" aria-label="Recent news" />}
                {nameExtra}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] leading-4 text-ink">
                <PosPill pos={player.position} />
                <span className="font-medium">{player.position === "DEF" ? "" : (player.nflTeam ?? "FA")}</span>
                <InjuryLetter status={player.injury} />
              </div>
              {opp && <div className="mt-1 flex min-w-0 text-[13px] leading-4">{opp}</div>}
            </div>
            {stats && <div className="flex shrink-0 items-center gap-1">{stats}</div>}
          </>
        ) : (
          <div className="min-w-0 flex-1 text-[14px] font-semibold text-muted">Empty</div>
        )}
        {trailing && <div className="-mr-1 flex shrink-0 items-center">{trailing}</div>}
      </div>
      {after}
    </div>
  );
}
