"use client";
// Change password (uses the foundation changePasswordAction).
import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/core";
import { SubmitButton } from "@/components/ui/client";
import { changePasswordAction, type FormState } from "@/lib/auth/actions";

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, undefined);
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const mismatch = confirm.length > 0 && pw !== confirm;

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Password updated");
      form.current?.reset();
      setPw("");
      setConfirm("");
    }
  }, [state]);

  return (
    <form
      ref={form}
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        if (pw !== confirm) {
          e.preventDefault();
          toast.error("The new passwords don't match.");
        }
      }}
    >
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <label className="block">
        <span className="label">Current password</span>
        <input className="input" type={show ? "text" : "password"} name="current" autoComplete="current-password" required />
      </label>
      <label className="block">
        <span className="label">New password</span>
        <span className="relative block">
          <input className="input pr-11" type={show ? "text" : "password"} name="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:text-ink" aria-label={show ? "Hide passwords" : "Show passwords"}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
        <span className="mt-1 block text-xs text-muted">At least 8 characters.</span>
      </label>
      <label className="block">
        <span className="label">Confirm new password</span>
        <input className="input" type={show ? "text" : "password"} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        {mismatch && <span className="mt-1 block text-xs text-loss">Passwords don&apos;t match yet.</span>}
      </label>
      <div className="flex justify-end">
        <SubmitButton size="md" pendingText="Updating…" disabled={mismatch || pw.length < 8}>
          Update password
        </SubmitButton>
      </div>
    </form>
  );
}
