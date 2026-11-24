"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, MessageCircle, Repeat, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/team", label: "My Team", icon: Users },
  { href: "/scoring/my", label: "Matchup", icon: Trophy },
  { href: "/trades", label: "Trades", icon: Repeat },
  { href: "/chat", label: "Chat", icon: MessageCircle },
];

/** Bottom tab bar on phones (thumb-reachable primary actions) */
export function MobileTabBar() {
  const path = usePathname() ?? "/";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="grid grid-cols-5">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href.split("/").slice(0, 2).join("/"));
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold", active ? "text-brand-600 dark:text-brand-300" : "text-muted")}>
              <Icon size={20} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
