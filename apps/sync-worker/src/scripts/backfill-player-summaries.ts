/**
 * Sinh AiPlayerSummary cho cầu thủ có PlayerStatistics (mùa gần nhất) nhưng chưa có summary — chạy:
 *   pnpm --filter @football-app/sync-worker backfill-player-summaries [limit]
 *
 * Khác backfill-match-summaries: không có "match FINISHED" trigger tương ứng cho cầu thủ, nên đây
 * là cách DUY NHẤT để sinh summary (không tự động). `limit` mặc định 5 — mỗi cầu thủ tốn 1 lần gọi
 * API thật (tính phí), không nên chạy không giới hạn khi mới test key. Chỉ chọn cầu thủ CHƯA có
 * summary — cầu thủ có summary đã hết TTL (7 ngày, xem player-summary.ts) cần refresh riêng, chưa
 * làm ở đây (piece này chỉ cần sinh mới).
 *
 * Delay giữa mỗi request để tránh free-tier rate limit của Gemini (verify thật 2026-08-19: chạy
 * limit=100 không delay, chỉ 18/99 thành công trước khi bị 429 RESOURCE_EXHAUSTED —
 * `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` = 15 req/phút cho `gemini-3.5-flash-lite`).
 * `AnthropicAdapter`/`GeminiAdapter` không tự throttle (khác `packages/data-provider`'s adapter),
 * nên throttle ở tầng script này. 4.5s/request an toàn dưới 15 req/phút.
 */
import { prisma } from "@football-app/database";
import { generatePlayerSummaryIfNeeded } from "../player-summary";

const DEFAULT_LIMIT = 5;
const DELAY_BETWEEN_REQUESTS_MS = 4500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number(limitArg) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error("Usage: pnpm --filter @football-app/sync-worker backfill-player-summaries [limit]");
    process.exit(1);
  }

  const players = await prisma.player.findMany({
    where: { statistics: { some: { appearances: { gt: 0 } } }, aiSummary: null },
    select: { id: true },
    take: limit,
  });

  console.log(`backfill-player-summaries: tìm thấy ${players.length} cầu thủ (limit=${limit}), bắt đầu...`);

  for (const [index, player] of players.entries()) {
    try {
      await generatePlayerSummaryIfNeeded(player.id);
      console.log(`  ✓ ${player.id}`);
    } catch (err) {
      console.error(`  ✗ ${player.id}:`, err);
    }
    if (index < players.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  console.log("backfill-player-summaries: xong.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-player-summaries failed:", err);
    process.exit(1);
  });
