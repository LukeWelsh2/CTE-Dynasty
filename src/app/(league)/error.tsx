"use client";
// Error boundary for league pages. Renders inside the app shell (nav, ticker and chat stay usable) and
// offers a retry that re-fetches the server component tree, plus a way back to League Home.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { House, RotateCw, ShieldAlert } from "lucide-react";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export default function LeagueError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    console.error("[league] page error:", error);
  }, [error]);

  const retry = () => {
    setAttempts((n) => n + 1);
    // refresh() re-runs the server components; reset() re-renders this segment once the new payload lands
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  const devDetail = process.env.NODE_ENV !== "production" && error.message ? error.message : null;

  return (
    <div className="mx-auto max-w-xl py-6 sm:py-12">
      <section
        role="alert"
        aria-labelledby="league-error-title"
        className="card overflow-hidden text-center"
      >
        <div className="px-5 py-8 sm:px-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-loss/10 text-loss">
            <ShieldAlert size={28} aria-hidden />
          </span>
          <h1 id="league-error-title" className="mt-4 text-[24px] font-bold tracking-[-0.02em] text-ink">
            Something went wrong
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-[15px] leading-relaxed text-muted">Your lineup, roster and pending moves are safe. Try again, or go back home.</p>
          {attempts > 1 && !pending && (
            <p className="mx-auto mt-2 max-w-md text-xs text-muted">Still failing? Data syncs may be catching up — wait a minute and try again, or let the commissioner know.</p>
          )}

          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <button type="button" onClick={retry} disabled={pending} className={buttonClass("primary", "lg", "min-w-[9rem] sm:h-10 sm:text-sm")}>
              <RotateCw size={15} className={cn(pending && "animate-spin")} aria-hidden />
              {pending ? "Retrying…" : "Try again"}
            </button>
            <Link href="/" className={buttonClass("secondary", "lg", "min-w-[9rem] sm:h-10 sm:text-sm")}>
              <House size={15} aria-hidden /> League home
            </Link>
          </div>

          {(error.digest || devDetail) && (
            <div className="mt-6 space-y-1 border-t border-line/70 pt-4 text-left">
              {error.digest && (
                <p className="text-xs text-muted">
                  Error reference: <code className="kbd select-all">{error.digest}</code>
                </p>
              )}
              {devDetail && <pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-2.5 text-[11px] text-ink/80">{devDetail}</pre>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
