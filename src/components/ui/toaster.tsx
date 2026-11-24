"use client";
// App-wide toasts (sonner). Follows the site's class-based dark mode (sonner only knows the OS setting) and,
// on phones, sits below the notch / status bar: top of the screen, clear of the bottom tab bar and of sticky
// save / bid bars that live above it.
import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function AppToaster() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setDark(html.classList.contains("dark"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return (
    <Toaster
      richColors
      closeButton
      position="top-center"
      theme={dark ? "dark" : "light"}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: "12px", right: "12px" }}
    />
  );
}
