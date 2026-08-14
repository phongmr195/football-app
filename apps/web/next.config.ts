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
      {
        // Google sign-in avatar (Firebase Auth user.photoURL).
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        // Facebook sign-in avatar (Firebase Auth user.photoURL) — xác nhận thật (2026-08):
        // dạng https://graph.facebook.com/<id>/picture, KHÔNG phải platform-lookaside.fbsbx.com
        // như đoán ban đầu — giữ cả 2 host vì Facebook có thể trả dạng khác tuỳ trường hợp.
        protocol: "https",
        hostname: "graph.facebook.com",
      },
      {
        protocol: "https",
        hostname: "platform-lookaside.fbsbx.com",
      },
    ],
  },
};

export default nextConfig;
