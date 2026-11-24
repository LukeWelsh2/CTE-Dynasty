"use client";
// Player headshot <img> that falls back to the player's initials when the CDN has no photo
// (otherwise browsers render the alt text as broken-image text). Used by PlayerHeadshot in ./core.
import { useState } from "react";
import { cn, initials } from "@/lib/utils";

export function HeadshotImg({ src, name, size, className }: { src: string; name: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role="img"
        aria-label={name}
        className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full bg-sunken font-bold text-muted ring-1 ring-line", className)}
        style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
      >
        {initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
