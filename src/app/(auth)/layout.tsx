export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen min-h-dvh items-center justify-center overflow-hidden bg-brand-950 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 79px, rgba(255,255,255,0.08) 79px 80px), radial-gradient(ellipse at top, rgba(245,179,1,0.25), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="mb-5 text-center sm:mb-6">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-500 font-display text-xl font-black text-brand-950 shadow-pop sm:h-16 sm:w-16 sm:text-2xl">CTE</div>
          <p className="font-display text-4xl font-extrabold uppercase tracking-wider text-white">CTE Dynasty</p>
          <p className="mt-1 text-balance text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-400 sm:text-sm sm:tracking-[0.25em]">Dynasty · Salary Cap · Est. Forever</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-panel p-5 text-ink shadow-pop sm:p-6">{children}</div>
      </div>
    </div>
  );
}
