// Sign-in / sign-up / reset screens: the light-grey page with the league mark and wordmark above one white card
// (v3: no dark heroes — white, blue, light grey, black).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen min-h-dvh items-center justify-center bg-surface px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-[16px] bg-brand-600 text-[19px] font-extrabold tracking-[-0.04em] text-white">CTE</div>
          <p className="text-[28px] font-bold leading-none tracking-[-0.02em] text-ink">CTE Dynasty</p>
          <p className="mt-2 text-[13px] text-muted">Dynasty · Salary cap · Est. forever</p>
        </div>
        <div className="card p-5 sm:p-7">{children}</div>
      </div>
    </div>
  );
}
