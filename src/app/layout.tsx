import type { Metadata, Viewport } from "next";
import { AppToaster } from "@/components/ui/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CTE Dynasty", template: "%s · CTE Dynasty" },
  description: "CTE Dynasty — dynasty salary-cap fantasy football league",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CTE Dynasty", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // the navy top bar (light) / near-black chrome (dark) continue into the browser UI
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#091633" },
    { media: "(prefers-color-scheme: dark)", color: "#080d1b" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the saved theme before first paint to avoid a flash
const themeScript = `try{var t=localStorage.getItem('cte-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* the main text face (self-hosted, see globals.css) — preloaded so phones never flash the fallback */}
        <link rel="preload" href="/fonts/inter-latin-opsz.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-surface font-sans text-ink">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
