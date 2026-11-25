"use client";
// "Message" button: opens (or creates) a direct-message channel with a manager. `iconOnly` renders a 40px round
// icon button (list rows) with the label as its accessible name.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function DmButton({
  userId,
  label = "Message",
  size = "sm",
  variant = "secondary",
  className,
  iconOnly,
}: {
  userId: string;
  label?: string;
  size?: "xs" | "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  iconOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const open = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/chat/dm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userIds: [userId] }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Couldn't open the conversation");
      router.push(`/chat/${data.slug}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  if (iconOnly)
    return (
      <button
        type="button"
        disabled={busy}
        onClick={open}
        aria-label={label}
        title={label}
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-brand-600 transition-colors hover:bg-brand-600/[0.08] active:bg-brand-600/[0.12] disabled:opacity-60 dark:text-brand-400 dark:hover:bg-brand-400/10",
          className,
        )}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={19} />}
      </button>
    );
  return (
    <button type="button" disabled={busy} className={buttonClass(variant, size, className)} onClick={open}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
      {label}
    </button>
  );
}
