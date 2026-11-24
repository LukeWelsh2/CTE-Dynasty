export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-950 px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 79px, rgba(255,255,255,0.08) 79px 80px), radial-gradient(ellipse at top, rgba(245,179,1,0.25), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-500 font-display text-2xl font-black text-brand-950 shadow-pop">CTE</div>
          <h1 className="font-display text-4xl font-extrabold uppercase tracking-wider text-white">CTE Dynasty</h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-[0.25em] text-gold-400">Dynasty · Salary Cap · Est. Forever</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-panel p-6 shadow-pop">{children}</div>
      </div>
    </div>
  );
}
