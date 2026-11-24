"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  forgotPasswordAction,
  joinLeagueAction,
  loginAction,
  resetPasswordAction,
  signupAction,
  type FormState,
} from "@/lib/auth/actions";
import { Alert } from "@/components/ui/core";
import { SubmitButton } from "@/components/ui/client";

function Msg({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase leading-tight tracking-[0.02em]">Sign in</h1>
      <Msg state={state} />
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required className="input" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      <SubmitButton className="w-full" size="lg" pendingText="Signing in…">Sign in</SubmitButton>
      <div className="flex flex-col items-center gap-x-4 text-sm sm:flex-row sm:justify-between">
        <Link href="/forgot" className="link inline-flex min-h-10 items-center">Forgot password?</Link>
        <Link href="/signup" className="link inline-flex min-h-10 items-center">Have an invite code? Sign up</Link>
      </div>
    </form>
  );
}

export function SignupForm({ code }: { code?: string }) {
  const [state, action] = useActionState(signupAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase leading-tight tracking-[0.02em]">Join CTE Dynasty</h1>
      <p className="text-sm text-muted">Use the invite code from your commissioner to claim your team.</p>
      <Msg state={state} />
      <label className="block">
        <span className="label">Invite code</span>
        <input name="code" defaultValue={code} required autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="input font-mono uppercase" />
      </label>
      <label className="block">
        <span className="label">Your name</span>
        <input name="name" required autoComplete="name" autoCapitalize="words" className="input" />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
      </label>
      <label className="block">
        <span className="label">Team name (optional)</span>
        <input name="teamName" maxLength={40} autoCapitalize="words" className="input" placeholder="You can change this later" />
      </label>
      <SubmitButton className="w-full" size="lg" pendingText="Creating account…">Create account</SubmitButton>
      <p className="flex min-h-10 items-center justify-center gap-1 text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="link inline-flex min-h-10 items-center">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState(forgotPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase leading-tight tracking-[0.02em]">Reset password</h1>
      <Msg state={state} />
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" />
      </label>
      <SubmitButton className="w-full" size="lg">Send reset link</SubmitButton>
      <p className="flex justify-center text-sm">
        <Link href="/login" className="link inline-flex min-h-10 items-center">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase leading-tight tracking-[0.02em]">Choose a new password</h1>
      <Msg state={state} />
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="label">New password</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" />
      </label>
      <label className="block">
        <span className="label">Confirm password</span>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="input" />
      </label>
      <SubmitButton className="w-full" size="lg">Update password</SubmitButton>
    </form>
  );
}

export function JoinForm() {
  const [state, action] = useActionState(joinLeagueAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <h1 className="font-display text-[26px] font-extrabold uppercase leading-tight tracking-[0.02em]">Join a league</h1>
      <p className="text-sm text-muted">You&apos;re signed in but not in a league yet. Enter an invite code from your commissioner.</p>
      <Msg state={state} />
      <label className="block">
        <span className="label">Invite code</span>
        <input name="code" required autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="input font-mono uppercase" />
      </label>
      <SubmitButton className="w-full" size="lg">Join league</SubmitButton>
    </form>
  );
}
