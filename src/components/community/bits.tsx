// Small shared pieces for the League / community pages (server-safe).
import Link from "next/link";
import { Avatar, TabLinks, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function LeagueTabs({ active }: { active: "hub" | "managers" | "suggestions" | "history" | "chat" }) {
  return (
    <TabLinks
      active={active}
      tabs={[
        { key: "hub", label: "League Hub", href: "/league" },
        { key: "chat", label: "Chat", href: "/chat" },
        { key: "managers", label: "Managers", href: "/managers" },
        { key: "rules", label: "Rulebook", href: "/rules" },
        { key: "suggestions", label: "Rule Suggestions", href: "/rules/suggestions" },
        { key: "history", label: "History & Records", href: "/history" },
      ]}
    />
  );
}

export function ResultPill({ result, className }: { result: "W" | "L" | "T"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-extrabold text-white",
        result === "W" ? "bg-win" : result === "L" ? "bg-loss" : "bg-slate-500",
        className,
      )}
      aria-label={result === "W" ? "Win" : result === "L" ? "Loss" : "Tie"}
    >
      {result}
    </span>
  );
}

export interface ManagerLike {
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  team?: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string } | null;
}

/** Avatar + name (+ team) that links to the manager profile when the manager is known. */
export function ManagerChip({ m, size = 28, showTeam = true, className }: { m: ManagerLike; size?: number; showTeam?: boolean; className?: string }) {
  const inner = (
    <>
      <Avatar name={m.name} src={m.avatarUrl} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink">{m.name}</span>
        {showTeam && m.team && (
          <span className="flex items-center gap-1 truncate text-[11px] text-muted">
            <TeamLogo team={m.team} size={12} className="rounded-[3px]" /> {m.team.name}
          </span>
        )}
      </span>
    </>
  );
  return m.userId ? (
    <Link href={`/managers/${m.userId}`} className={cn("flex min-w-0 items-center gap-2 hover:[&_span.block]:underline", className)}>
      {inner}
    </Link>
  ) : (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>{inner}</span>
  );
}

export function fmtRecord(w: number, l: number, t = 0) {
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

export function pct3(p: number) {
  return p.toFixed(3).replace(/^0/, "");
}

export function signed(n: number, d = 1) {
  const v = n.toFixed(d);
  return n > 0 ? `+${v}` : v;
}

/** Sticky in-page section navigation (anchor links) for long pages. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="scroll-thin sticky top-0 z-20 -mx-3 mb-3 flex gap-1 overflow-x-auto border-b border-line bg-surface/95 px-3 py-1.5 backdrop-blur sm:-mx-4 sm:px-4">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className="whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold text-muted hover:bg-panel hover:text-ink">
          {i.label}
        </a>
      ))}
    </nav>
  );
}
