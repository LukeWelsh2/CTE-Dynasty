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
    <main className="flex min-h-screen min-h-dvh items-center justify-center bg-surface px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="mx-auto mb-6 flex w-fit flex-col items-center gap-2.5" aria-label="CTE Dynasty home">
          <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-600 text-[17px] font-extrabold tracking-[-0.04em] text-white">CTE</span>
          <span className="text-[20px] font-bold tracking-[-0.02em] text-ink">CTE Dynasty</span>
        </Link>

        <div className="card px-6 py-8">
          <p className="numeral text-[72px] font-bold leading-none tracking-[-0.04em] text-ink" aria-hidden>
            404
          </p>
          <h1 className="mt-3 text-[24px] font-bold tracking-[-0.02em]">Page not found</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[15px] text-muted">Check the address, or head back to the league.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/" className={buttonClass("primary", "lg", "sm:h-10 sm:text-sm")}>
              <House size={16} aria-hidden /> League home
            </Link>
            <Link href="/login" className={buttonClass("secondary", "lg", "sm:h-10 sm:text-sm")}>
              <LogIn size={16} aria-hidden /> Sign in
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-muted">
            New to the league?{" "}
            <Link href="/signup" className="link inline-flex min-h-8 items-center">
              Join with your invite code
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
