import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Team/competition logos from the seeded data provider (API-Football).
        protocol: "https",
        hostname: "media.api-sports.io",
      },
    ],
  },
};

export default nextConfig;
