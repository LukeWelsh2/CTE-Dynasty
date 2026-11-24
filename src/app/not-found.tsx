// Site-wide 404 for URLs that match no route. Rendered by the root layout only (no league shell), so it
// carries its own CTE Dynasty branding, matching the sign-in screens. It stays static (no cookies /
// session lookup) so it can be prerendered; League Home sends signed-out visitors to sign in anyway.
import type { Metadata } from "next";
import Link from "next/link";
import { House, LogIn } from "lucide-react";
import { buttonClass } from "@/components/ui/core";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="hero-surface relative flex min-h-screen min-h-dvh items-center justify-center overflow-hidden px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="relative w-full max-w-md text-center">
        <Link href="/" className="mx-auto mb-6 flex w-fit flex-col items-center gap-2.5" aria-label="CTE Dynasty home">
          <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-b from-gold-300 to-gold-500 font-display text-xl font-black text-brand-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_10px_30px_-8px_rgb(245_179_1/0.55)]">
            CTE
          </span>
          <span className="font-display text-xl font-extrabold uppercase tracking-[0.06em]">CTE Dynasty</span>
        </Link>

        <div className="rounded-2xl bg-raised px-6 py-8 text-ink shadow-pop">
          <p className="numeral font-display text-[88px] font-black leading-none tracking-[0.02em] text-gold-500" aria-hidden>
            404
          </p>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.24em] text-gold-700 dark:text-gold-400">Out of bounds</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold uppercase tracking-[0.02em]">Page not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">That page isn&apos;t in the playbook. Check the address, or head back to the league.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/" className={buttonClass("primary", "lg", "sm:h-10 sm:text-sm")}>
              <House size={16} aria-hidden /> League Home
            </Link>
            <Link href="/login" className={buttonClass("secondary", "lg", "sm:h-10 sm:text-sm")}>
              <LogIn size={16} aria-hidden /> Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted">
            New to the league?{" "}
            <Link href="/signup" className="link inline-flex min-h-8 items-center">
              Join with your invite code
            </Link>
          </p>
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Dynasty · Salary Cap · Est. Forever</p>
      </div>
    </main>
  );
}
