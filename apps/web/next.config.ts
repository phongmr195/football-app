import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Team/competition logos — API-Football data (competition id "39" etc).
        protocol: "https",
        hostname: "media.api-sports.io",
      },
      {
        // Team/competition logos — football-data.org data (default provider, competition id "2021" etc).
        protocol: "https",
        hostname: "crests.football-data.org",
      },
    ],
  },
};

export default nextConfig;
