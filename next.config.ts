import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // the dev-only "N" indicator covers the mobile tab bar in screenshots
  devIndicators: false,
  // Long-running jobs (live scoring poller, waivers, recaps) run inside the Node server via src/instrumentation.ts
  serverExternalPackages: ["web-push", "nodemailer", "@prisma/client", "bcryptjs"],
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "sleepercdn.com" },
      { protocol: "https", hostname: "a.espncdn.com" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
