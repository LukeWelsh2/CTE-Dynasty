"use client";
// Select that navigates to a precomputed href per option (keeps the news filters URL-driven).
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function NewsFilterSelect({ label, value, options, hrefs }: { label: string; value: string; options: { value: string; label: string }[]; hrefs: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="min-w-0 flex-1 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const h = hrefs[e.target.value];
          if (h) start(() => router.push(h, { scroll: false }));
        }}
        className="input h-8 w-full py-1 pr-7 text-xs font-semibold sm:w-auto"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
