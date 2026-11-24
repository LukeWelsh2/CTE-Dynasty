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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950 px-4 py-10 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 79px, rgba(255,255,255,0.08) 79px 80px), radial-gradient(ellipse at top, rgba(245,179,1,0.25), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-md text-center">
        <Link href="/" className="mx-auto mb-6 flex w-fit flex-col items-center gap-2" aria-label="CTE Dynasty home">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-500 font-display text-xl font-black text-brand-950 shadow-pop">CTE</span>
          <span className="font-display text-xl font-extrabold uppercase tracking-wider">CTE Dynasty</span>
        </Link>

        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-6 py-8 shadow-pop backdrop-blur-sm">
          <p className="font-display text-8xl font-black leading-none tracking-wider text-gold-400" aria-hidden>
            404
          </p>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.25em] text-gold-400/90">Out of bounds</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold uppercase tracking-wide">Page not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/75">
            That page isn&apos;t in the playbook. Check the address, or head back to the league.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/" className={buttonClass("gold", "md")}>
              <House size={15} aria-hidden /> League Home
            </Link>
            <Link href="/login" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-white/20 px-4 text-sm font-semibold text-white hover:bg-white/10">
              <LogIn size={15} aria-hidden /> Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-white/55">
            New to the league?{" "}
            <Link href="/signup" className="font-semibold text-gold-400 hover:underline">
              Join with your invite code
            </Link>
          </p>
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-white/40">Dynasty · Salary Cap · Est. Forever</p>
      </div>
    </main>
  );
}
