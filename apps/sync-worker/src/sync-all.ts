import { createAdapter } from "./provider";
import { syncCompetitionSeason, syncCompetitions, syncSeasons } from "./sync-catalog";

// Job "cron đơn giản" cho Phase 1 (ROADMAP) — chạy 1 lượt đồng bộ toàn bộ danh mục cho các
// giải đấu đã cấu hình. CHƯA cần Step Functions/adaptive polling (đó là việc của Phase 2).
//
// SYNC_COMPETITION_IDS: danh sách external ID (theo provider đang chọn qua DATA_PROVIDER, xem
// ./provider.ts) của các giải cần đồng bộ, phân tách bằng dấu phẩy — ví dụ "2021,2014"
// (Premier League, La Liga theo football-data.org) hoặc "39,140" (theo api-football).
// SYNC_SEASON_YEAR: năm season cần đồng bộ, ví dụ "2024".
export async function syncAll() {
  const competitionIds = (process.env.SYNC_COMPETITION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const seasonYear = process.env.SYNC_SEASON_YEAR ?? String(new Date().getFullYear());

  if (competitionIds.length === 0) {
    throw new Error(
      "SYNC_COMPETITION_IDS chưa set — cần ít nhất 1 external competition ID (theo provider đang chọn qua DATA_PROVIDER) để sync",
    );
  }

  const adapter = createAdapter();

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
