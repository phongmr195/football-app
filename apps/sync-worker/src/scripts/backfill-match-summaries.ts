/**
 * Sinh AiMatchSummary cho các match FINISHED chưa có summary — chạy:
 *   pnpm --filter @football-app/sync-worker backfill-match-summaries [limit]
 *
 * Cần thiết vì generateMatchSummaryIfNeeded() chỉ trigger tự động khi sync-live-matches.ts hoặc
 * sync-catalog.ts's syncMatches() BẮT ĐƯỢC thời điểm match chuyển sang FINISHED — match đã
 * FINISHED từ trước khi tính năng này tồn tại sẽ không bao giờ tự trigger. `limit` mặc định 5 —
 * mỗi match tốn 1 lần gọi API thật (tính phí), không nên chạy không giới hạn khi mới test key.
 *
 * Delay giữa mỗi request để tránh free-tier rate limit (cùng lý do/giá trị đã áp dụng ở
 * backfill-player-summaries.ts — verify thật 2026-08-19: Gemini free tier 15 req/phút, chạy không
 * delay bị 429 RESOURCE_EXHAUSTED giữa chừng). `AnthropicAdapter`/`GeminiAdapter`/`GroqAdapter`
 * không tự throttle, nên throttle ở tầng script này. 4.5s/request an toàn dưới 15 req/phút.
 */
import "../load-env";
import { prisma } from "@football-app/database";
import { generateMatchSummaryIfNeeded } from "../match-summary";

const DEFAULT_LIMIT = 5;
const DELAY_BETWEEN_REQUESTS_MS = 4500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  for (const [index, match] of matches.entries()) {
    try {
      await generateMatchSummaryIfNeeded(match.id);
      console.log(`  ✓ ${match.id}`);
    } catch (err) {
      console.error(`  ✗ ${match.id}:`, err);
    }
    if (index < matches.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  console.log("backfill-match-summaries: xong.");
}

// `process.exitCode` (KHÔNG `process.exit()`) — xem comment ở
// apps/sync-worker/src/scripts/ingest-player-season-stats.ts (cùng bug class).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("backfill-match-summaries failed:", err);
    process.exitCode = 1;
  });
