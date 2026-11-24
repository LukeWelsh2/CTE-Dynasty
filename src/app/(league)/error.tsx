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
        className="overflow-hidden rounded-xl border border-line bg-panel text-center shadow-panel"
      >
        <div className="h-1.5 bg-gradient-to-r from-brand-700 via-gold-500 to-live" aria-hidden />
        <div className="px-5 py-8 sm:px-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-loss dark:bg-red-900/30 dark:text-red-300">
            <ShieldAlert size={28} aria-hidden />
          </span>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-600 dark:text-gold-400">Flag on the play</p>
          <h1 id="league-error-title" className="mt-1 font-display text-3xl font-extrabold uppercase tracking-wide text-ink">
            Something went wrong
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            This page hit an unexpected error while loading. Your lineup, roster and pending moves are safe — try again, or head back to
            League Home.
          </p>
          {attempts > 1 && !pending && (
            <p className="mx-auto mt-2 max-w-md text-xs text-muted">Still failing? Data syncs may be catching up — wait a minute and try again, or let the commissioner know.</p>
          )}

          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <button type="button" onClick={retry} disabled={pending} className={buttonClass("primary", "md", "min-w-[9rem]")}>
              <RotateCw size={15} className={cn(pending && "animate-spin")} aria-hidden />
              {pending ? "Retrying…" : "Try again"}
            </button>
            <Link href="/" className={buttonClass("secondary", "md", "min-w-[9rem]")}>
              <House size={15} aria-hidden /> League Home
            </Link>
          </div>

          {(error.digest || devDetail) && (
            <div className="mt-6 space-y-1 border-t border-line pt-4 text-left">
              {error.digest && (
                <p className="text-xs text-muted">
                  Error reference: <code className="kbd select-all">{error.digest}</code>
                </p>
              )}
              {devDetail && <pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunken p-2 text-[11px] text-ink/80">{devDetail}</pre>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
