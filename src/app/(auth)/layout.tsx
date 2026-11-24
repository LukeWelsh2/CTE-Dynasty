// Sign-in / sign-up / reset screens: the navy hero backdrop with the league mark, and a solid raised card.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hero-surface relative flex min-h-screen min-h-dvh items-center justify-center overflow-hidden px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))] shadow-none">
      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3.5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-b from-gold-300 to-gold-500 font-display text-2xl font-black text-brand-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_10px_30px_-8px_rgb(245_179_1/0.55)]">
            CTE
          </div>
          <p className="font-display text-[40px] font-extrabold uppercase leading-none tracking-[0.02em] text-white">CTE Dynasty</p>
          <p className="mt-2 text-balance text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-400 sm:text-xs sm:tracking-[0.24em]">Dynasty · Salary Cap · Est. Forever</p>
        </div>
        <div className="rounded-2xl bg-raised p-5 text-ink shadow-pop sm:p-7">{children}</div>
      </div>
    </div>
  );
}
