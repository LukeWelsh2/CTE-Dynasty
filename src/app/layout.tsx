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
  themeColor: "#0d2148",
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
      </head>
      <body
        className="min-h-screen font-sans"
        style={{ ["--font-sans" as string]: "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", ["--font-display" as string]: "'Barlow Condensed', 'Arial Narrow', 'Segoe UI', sans-serif" }}
      >
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
