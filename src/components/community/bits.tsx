// Small shared pieces for the League / community pages (server-safe).
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Avatar, ResultPill as KitResultPill, TabLinks, TeamLogo, chipClass } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";

export function LeagueTabs({ active }: { active: "hub" | "managers" | "suggestions" | "history" | "chat" | "rules" }) {
  return (
    <TabLinks
      active={active}
      tabs={[
        { key: "hub", label: "League hub", href: "/league" },
        { key: "chat", label: "Chat", href: "/chat" },
        { key: "managers", label: "Managers", href: "/managers" },
        { key: "rules", label: "Rulebook", href: "/rules" },
        { key: "suggestions", label: "Rule votes", href: "/rules/suggestions" },
        { key: "history", label: "History", href: "/history" },
      ]}
    />
  );
}

/** W / L / T pill — the kit's ResultPill with an accessible name. */
export function ResultPill({ result, className }: { result: "W" | "L" | "T"; className?: string }) {
  return (
    <span role="img" aria-label={result === "W" ? "Win" : result === "L" ? "Loss" : "Tie"} className="inline-flex">
      <KitResultPill result={result} className={className} />
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
        <span className="block truncate font-semibold text-ink" title={m.name}>
          {m.name}
        </span>
        {showTeam && m.team && (
          <span className="flex min-w-0 items-center gap-1 text-[12px] leading-4 text-muted" title={m.team.name}>
            <TeamLogo team={m.team} size={12} className="shrink-0 rounded-[3px]" /> <span className="truncate">{m.team.name}</span>
          </span>
        )}
      </span>
    </>
  );
  return m.userId ? (
    <Link href={`/managers/${m.userId}`} className={cn("flex min-h-8 min-w-0 items-center gap-2 hover:[&_span.block]:underline", className)}>
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

/** Sticky in-page section navigation (anchor chips) for long pages: scrolls sideways with a fade on phones. */
export function SectionNav({ items, className }: { items: { id: string; label: string }[]; className?: string }) {
  return (
    <div className={cn("sticky top-0 z-20 -mx-3 mb-4 border-b border-line/70 bg-surface sm:-mx-4", className)}>
      <ScrollRow as="nav" snap={false} aria-label="On this page" className="gap-2 px-3 py-2 sm:px-4">
        {items.map((i) => (
          <a key={i.id} href={`#${i.id}`} className={chipClass(false, "md")}>
            {i.label}
          </a>
        ))}
      </ScrollRow>
    </div>
  );
}

/**
 * A list row that expands in place (server-safe <details>, the Standings pattern): the summary is the row (≥56px,
 * chevron on the right), the body renders below on a sunken band — use it for the columns a phone can't show.
 */
export function ExpandRow({ summary, children, mine, className }: { summary: React.ReactNode; children: React.ReactNode; mine?: boolean; className?: string }) {
  return (
    <li>
      <details className="group">
        <summary
          className={cn(
            "flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70 [&::-webkit-details-marker]:hidden",
            mine && "shadow-[inset_3px_0_0_rgb(var(--c-accent))]",
            className,
          )}
        >
          {summary}
          <ChevronDown size={16} className="-mr-1 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <div className="bg-sunken px-4 py-3">{children}</div>
      </details>
    </li>
  );
}
