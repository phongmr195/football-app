import type { DataProviderAdapter } from "@football-app/data-provider";
import { ApiFootballAdapter, FootballDataAdapter } from "@football-app/data-provider";

// Chọn adapter provider cho sync-worker qua env DATA_PROVIDER ("football-data" | "api-football").
// Mặc định "football-data": free tier football-data.org (10 req/phút, KHÔNG giới hạn/ngày, 13
// giải lớn) — API-Football free tier bị suspend nhiều lần thật (3 key khác nhau), không còn đủ
// tin cậy để làm default, xem CLAUDE.md § Data provider. ApiFootballAdapter vẫn giữ nguyên,
// chọn qua DATA_PROVIDER=api-football khi cần (ví dụ đã nâng plan trả phí).
export function createAdapter(): DataProviderAdapter {
  const provider = process.env.DATA_PROVIDER ?? "football-data";

  switch (provider) {
    case "football-data":
      return new FootballDataAdapter({ apiKey: process.env.FOOTBALL_DATA_API_KEY ?? "" });
    case "api-football":
      return new ApiFootballAdapter({ apiKey: process.env.API_FOOTBALL_KEY ?? "" });
    default:
      throw new Error(
        `DATA_PROVIDER không hợp lệ: "${provider}" — chỉ hỗ trợ "football-data" hoặc "api-football"`,
      );
  }
}
