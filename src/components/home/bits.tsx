// Small presentational pieces shared by the League Home modules (server-safe).
import { CircleAlert } from "lucide-react";
import { Panel } from "@/components/ui/core";
import { cn } from "@/lib/utils";

/** "View all ›" link for panel headers (the kit's MoreLink, re-exported for the home modules) */
export { MoreLink, WinProbBar } from "@/components/ui/core";

/** Rendered in place of a module whose data failed to load */
export function ModuleError({ title, className }: { title: string; className?: string }) {
  return (
    <Panel title={title} className={className}>
      <div className="flex items-start gap-2 text-sm text-muted" role="status">
        <CircleAlert size={16} className="mt-0.5 shrink-0 text-loss" aria-hidden />
        <span>This section couldn&apos;t load right now. Refresh the page to try again.</span>
      </div>
    </Panel>
  );
}

/** Inline empty message for small panels */
export function PanelEmpty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-1 py-5 text-center text-sm text-muted">
      <p>{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Uppercase mini heading inside a panel */
export function SubHeading({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn("mb-1.5 flex items-center justify-between gap-2", className)}>
      <h3 className="eyebrow">{children}</h3>
      {right}
    </div>
  );
}

/** Ensure a team color reads on both themes (falls back for missing / invalid values) */
export function safeColor(c: string | null | undefined, fallback = "#1f3fa1"): string {
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback;
}

/** When two team colors are nearly identical, use the second team's secondary color for contrast */
export function contrastPair(a: { primaryColor: string; secondaryColor: string }, b: { primaryColor: string; secondaryColor: string }): [string, string] {
  const ca = safeColor(a.primaryColor);
  let cb = safeColor(b.primaryColor, "#f5b301");
  if (colorDistance(ca, cb) < 60) cb = safeColor(b.secondaryColor, "#f5b301");
  if (colorDistance(ca, cb) < 60) cb = "#94a3b8";
  return [ca, cb];
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
