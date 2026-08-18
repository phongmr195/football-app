/**
 * Sinh AiMatchSummary cho các match FINISHED chưa có summary — chạy:
 *   pnpm --filter @football-app/sync-worker backfill-match-summaries [limit]
 *
 * Cần thiết vì generateMatchSummaryIfNeeded() chỉ trigger tự động khi sync-live-matches.ts hoặc
 * sync-catalog.ts's syncMatches() BẮT ĐƯỢC thời điểm match chuyển sang FINISHED — match đã
 * FINISHED từ trước khi tính năng này tồn tại sẽ không bao giờ tự trigger. `limit` mặc định 5 —
 * mỗi match tốn 1 lần gọi API thật (tính phí), không nên chạy không giới hạn khi mới test key.
 */
import { prisma } from "@football-app/database";
import { generateMatchSummaryIfNeeded } from "../match-summary";

const DEFAULT_LIMIT = 5;

async function main() {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number(limitArg) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error("Usage: pnpm --filter @football-app/sync-worker backfill-match-summaries [limit]");
    process.exit(1);
  }

  const matches = await prisma.match.findMany({
    where: { status: "FINISHED", aiSummary: null },
    select: { id: true },
    take: limit,
    orderBy: { kickoffAt: "desc" },
  });

  console.log(`backfill-match-summaries: tìm thấy ${matches.length} match (limit=${limit}), bắt đầu...`);

  for (const match of matches) {
    try {
      await generateMatchSummaryIfNeeded(match.id);
      console.log(`  ✓ ${match.id}`);
    } catch (err) {
      console.error(`  ✗ ${match.id}:`, err);
    }
  }

  console.log("backfill-match-summaries: xong.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-match-summaries failed:", err);
    process.exit(1);
  });
