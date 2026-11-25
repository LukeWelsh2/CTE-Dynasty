"use client";
// Opens the collapsed <details> section a URL hash points at (/rules#scoring) and scrolls it into view —
// browsers don't reliably expand a closed <details> on fragment navigation. Renders nothing.
import { useEffect } from "react";

export function DetailsHashOpener() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      const d = el instanceof HTMLDetailsElement ? el : (el.querySelector("details") ?? el.closest("details"));
      if (d && !d.open) d.open = true;
      requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
