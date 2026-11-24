"use client";
// "Message" button: opens (or creates) a direct-message channel with a manager.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";

export function DmButton({ userId, label = "Message", size = "sm", variant = "secondary", className }: { userId: string; label?: string; size?: "xs" | "sm" | "md"; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={busy}
      className={buttonClass(variant, size, className)}
      onClick={async () => {
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
      }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
      {label}
    </button>
  );
}
