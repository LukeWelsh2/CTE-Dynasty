"use client";
// Copies a value (e.g. the league invite code or join link) to the clipboard.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { buttonClass } from "@/components/ui/core";

export function CopyButton({ value, label = "Copy", absolute = false }: { value: string; label?: string; /** prefix with the site origin */ absolute?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "xs")}
      onClick={async () => {
        const text = absolute ? `${window.location.origin}${value}` : value;
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Couldn't copy — select the text and copy it manually.");
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {label}
    </button>
  );
}
