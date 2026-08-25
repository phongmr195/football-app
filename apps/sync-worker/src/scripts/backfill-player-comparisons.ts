/**
 * Sinh AiPlayerComparison cho các cặp cầu thủ ngẫu nhiên (có PlayerStatistics, mùa gần nhất) chưa
 * có comparison còn trong TTL — chạy:
 *   pnpm --filter @football-app/sync-worker backfill-player-comparisons [limit]
 *
 * Khác apps/api's compareTwoPlayers() (route /players/compare, user tự chọn cặp, cap 20/user/24h
 * qua AiUsageLog): đây là job hệ thống sinh corpus, không có user thật để gán quota — xem comment
 * ở player-comparison.ts. Cặp chọn ngẫu nhiên (Fisher-Yates) trong nhóm cầu thủ có statistics, ghép
 * liên tiếp sau khi xáo trộn — không cần cùng vị trí/giải đấu, prompt tự nêu rõ nếu khác mùa/giải.
 *
 * Delay giữa mỗi request — cùng lý do/giá trị đã áp dụng ở backfill-match-summaries.ts/
 * backfill-player-summaries.ts (Gemini free tier 15 req/phút, xem CLAUDE.md § AI).
 */
import "../load-env";
import { prisma } from "@football-app/database";
import { generatePlayerComparisonIfNeeded } from "../player-comparison";

const DEFAULT_LIMIT = 5;
const DELAY_BETWEEN_REQUESTS_MS = 4500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

async function main() {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number(limitArg) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error("Usage: pnpm --filter @football-app/sync-worker backfill-player-comparisons [limit]");
    process.exit(1);
  }

  const candidates = await prisma.player.findMany({
    where: { statistics: { some: { appearances: { gt: 0 } } } },
    select: { id: true },
  });
  const pool = shuffle(candidates.map((p) => p.id));

  console.log(`backfill-player-comparisons: pool ${pool.length} cầu thủ, mục tiêu ${limit} comparison mới...`);

  let generated = 0;
  let skipped = 0;
  let i = 0;
  while (generated < limit && i + 1 < pool.length) {
    const a = pool[i]!;
    const b = pool[i + 1]!;
    i += 2;
    try {
      const didGenerate = await generatePlayerComparisonIfNeeded(a, b);
      if (didGenerate) {
        generated++;
        console.log(`  ✓ (${generated}/${limit}) ${a} vs ${b}`);
        if (generated < limit) await sleep(DELAY_BETWEEN_REQUESTS_MS);
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`  ✗ ${a} vs ${b}:`, err);
    }
  }

  console.log(`backfill-player-comparisons: xong — tạo mới ${generated}/${limit}, bỏ qua ${skipped} cặp.`);
}

// `process.exitCode` (KHÔNG `process.exit()`) — xem comment ở
// apps/sync-worker/src/scripts/ingest-player-season-stats.ts (cùng bug class).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("backfill-player-comparisons failed:", err);
    process.exitCode = 1;
  });
