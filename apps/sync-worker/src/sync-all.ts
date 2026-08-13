import { ApiFootballAdapter } from "@football-app/data-provider";
import { syncCompetitionSeason, syncCompetitions, syncSeasons } from "./sync-catalog";

// Job "cron đơn giản" cho Phase 1 (ROADMAP) — chạy 1 lượt đồng bộ toàn bộ danh mục cho các
// giải đấu đã cấu hình. CHƯA cần Step Functions/adaptive polling (đó là việc của Phase 2).
//
// SYNC_COMPETITION_IDS: danh sách external ID (theo API-Football) của các giải cần đồng bộ,
// phân tách bằng dấu phẩy — ví dụ "39,140" (Premier League, La Liga). Chưa hardcode ID thật
// vào code vì chưa verify với API key thật (xem ROADMAP Phase 0 — API-Football key còn pending).
// SYNC_SEASON_YEAR: năm season cần đồng bộ, ví dụ "2024".
export async function syncAll() {
  const apiKey = process.env.API_FOOTBALL_KEY ?? "";
  const competitionIds = (process.env.SYNC_COMPETITION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const seasonYear = process.env.SYNC_SEASON_YEAR ?? String(new Date().getFullYear());

  if (competitionIds.length === 0) {
    throw new Error(
      "SYNC_COMPETITION_IDS chưa set — cần ít nhất 1 external competition ID (API-Football) để sync",
    );
  }

  const adapter = new ApiFootballAdapter({ apiKey });

  const competitionsResult = await syncCompetitions(adapter);
  console.log(`synced ${competitionsResult.syncedCount} competitions (toàn bộ danh mục provider)`);

  const results = [];
  for (const competitionId of competitionIds) {
    const competitionExternalRef = { provider: adapter.providerName, id: competitionId };
    const seasonExternalRef = { provider: adapter.providerName, id: seasonYear };

    await syncSeasons(adapter, competitionExternalRef);
    const result = await syncCompetitionSeason(adapter, competitionExternalRef, seasonExternalRef);
    console.log(`competition ${competitionId} season ${seasonYear}:`, result);
    results.push({ competitionId, ...result });
  }

  return { competitionsResult, results };
}
