/**
 * Sinh AiPlayerSummary cho cầu thủ có PlayerStatistics (mùa gần nhất) nhưng chưa có summary — chạy:
 *   pnpm --filter @football-app/sync-worker backfill-player-summaries [limit]
 *
 * Khác backfill-match-summaries: không có "match FINISHED" trigger tương ứng cho cầu thủ, nên đây
 * là cách DUY NHẤT để sinh summary (không tự động). `limit` mặc định 5 — mỗi cầu thủ tốn 1 lần gọi
 * API thật (tính phí), không nên chạy không giới hạn khi mới test key. Chỉ chọn cầu thủ CHƯA có
 * summary — cầu thủ có summary đã hết TTL (7 ngày, xem player-summary.ts) cần refresh riêng, chưa
 * làm ở đây (piece này chỉ cần sinh mới).
 */
import { prisma } from "@football-app/database";
import { generatePlayerSummaryIfNeeded } from "../player-summary";

const DEFAULT_LIMIT = 5;

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

  for (const player of players) {
    try {
      await generatePlayerSummaryIfNeeded(player.id);
      console.log(`  ✓ ${player.id}`);
    } catch (err) {
      console.error(`  ✗ ${player.id}:`, err);
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
