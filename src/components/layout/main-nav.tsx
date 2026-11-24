"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV, type NavItem } from "./nav-config";

function isActive(item: NavItem, path: string) {
  if (item.href === "/") return path === "/";
  return (item.match ?? [item.href]).some((m) => path === m || path.startsWith(m + "/") || path.startsWith(m + "?") || (m.endsWith("$") ? false : path.startsWith(m)));
}

export function MainNav({ isCommish }: { isCommish: boolean }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setOpen(null), [path]);
  const items = MAIN_NAV.filter((i) => !i.commishOnly || isCommish);
  return (
    <nav className="hidden border-b border-brand-950 bg-brand-800 md:block dark:bg-brand-900">
      <div className="mx-auto flex max-w-[1400px] items-stretch px-2">
        {items.map((item) => {
          const active = isActive(item, path);
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
            >
              <Link
                href={item.href}
                className={cn(
                  "flex h-10 items-center gap-1 border-b-[3px] px-3 text-[13px] font-semibold uppercase tracking-wide transition-colors",
                  active ? "border-gold-500 bg-brand-900/60 text-white" : "border-transparent text-white/80 hover:bg-brand-900/40 hover:text-white",
                  item.commishOnly && "text-gold-300",
                )}
              >
                {item.label}
                {item.children && <ChevronDown size={13} className="opacity-70" />}
              </Link>
              {item.children && open === item.label && (
                <div className="absolute left-0 top-full z-50 w-64 overflow-hidden rounded-b-lg border border-line bg-panel py-1 shadow-pop">
                  {item.children.map((c) => (
                    <Link key={c.href} href={c.href} className="block px-3 py-2 hover:bg-sunken">
                      <div className="text-sm font-semibold text-ink">{c.label}</div>
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
