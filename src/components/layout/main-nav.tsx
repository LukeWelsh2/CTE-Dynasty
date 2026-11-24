"use client";
// Desktop section navigation (md+): one navy chrome band with the top bar, a gold indicator under the current
// section and a raised menu card per section on hover / focus. Phones use the drawer + bottom tab bar instead.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeChildHref, navItemActive as isActive, visibleNav } from "./nav-config";

export function MainNav({ isCommish, hiddenHrefs = [] }: { isCommish: boolean; hiddenHrefs?: string[] }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setOpen(null), [path]);
  const items = visibleNav(isCommish, hiddenHrefs);
  return (
    <nav aria-label="Sections" className="hidden bg-chrome shadow-[inset_0_1px_0_rgb(255_255_255/0.07)] md:block">
      <div className="mx-auto flex max-w-[1400px] items-stretch gap-0.5 px-2 lg:px-3">
        {items.map((item) => {
          const active = isActive(item, path);
          const here = active && item.children ? activeChildHref(item.children, path) : null;
          return (
            <div
              key={item.label}
              className="relative"
              onMouseEnter={() => {
                if (timer.current) clearTimeout(timer.current);
                setOpen(item.label);
              }}
              onMouseLeave={() => {
                timer.current = setTimeout(() => setOpen((o) => (o === item.label ? null : o)), 120);
              }}
              onFocus={() => setOpen(item.label)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen((o) => (o === item.label ? null : o));
              }}
            >
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-haspopup={item.children ? "menu" : undefined}
                aria-expanded={item.children ? open === item.label : undefined}
                className={cn(
                  "relative flex h-11 items-center gap-1 rounded-t-md px-3 text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors duration-150",
                  active ? "text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white",
                  item.commishOnly && (active ? "text-gold-300" : "text-gold-300/80 hover:text-gold-300"),
                  active && "after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full after:bg-gold-400",
                )}
              >
                {item.label}
                {item.children && <ChevronDown size={13} className={cn("opacity-60 transition-transform duration-200", open === item.label && "rotate-180")} aria-hidden />}
              </Link>
              {item.children && open === item.label && (
                <div className="raised animate-menu absolute left-0 top-full z-50 mt-1 w-72 p-1.5" role="menu">
                  {item.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      role="menuitem"
                      aria-current={c.href === here ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-3 py-2 transition-colors hover:bg-ink/[0.05] dark:hover:bg-white/[0.06]",
                        c.href === here && "bg-brand-500/[0.08] dark:bg-brand-400/[0.12]",
                      )}
                    >
                      <div className={cn("text-sm font-semibold", c.href === here ? "text-brand-700 dark:text-brand-200" : "text-ink")}>{c.label}</div>
                      {c.description && <div className="text-xs text-muted">{c.description}</div>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
