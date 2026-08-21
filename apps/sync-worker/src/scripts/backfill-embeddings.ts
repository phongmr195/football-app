/**
 * Sinh embedding pgvector cho toàn bộ Knowledge corpus (AiMatchSummary/AiPlayerSummary/
 * AiPlayerComparison) chưa được embed — chạy:
 *   pnpm --filter @football-app/sync-worker backfill-embeddings [limit]
 *
 * Phase 1 chat RAG (2026-08-21, xem docs/architecture/PROJECT_PLAN.md) — chỉ embed Knowledge, KHÔNG
 * đụng /chat/messages (vẫn dùng "RAG-lite" ILIKE, xem apps/api/src/chat-retrieval.ts). Mục đích
 * DUY NHẤT của script này là populate đủ corpus để apps/api/src/scripts/compare-retrieval.ts có dữ
 * liệu thật so sánh — quyết định có wire vào chat thật hay không nằm ở bước đó, không phải ở đây.
 *
 * `limit` mặc định KHÔNG giới hạn (khác backfill-match-summaries.ts/backfill-player-summaries.ts/
 * backfill-player-comparisons.ts — DEFAULT_LIMIT=5, vì mỗi lần gọi LLM tốn tiền thật và các script
 * đó cố ý sinh nhỏ giọt): mục tiêu ở đây là fill hết ~661 dòng hiện có để so sánh có ý nghĩa, không
 * phải nhỏ giọt. Dùng `limit` để smoke-test adapter/key trước khi chạy full (~50 phút với 661 dòng
 * × 4.5s/dòng): `pnpm --filter @football-app/sync-worker backfill-embeddings 5`.
 *
 * Delay giữa mỗi request — cùng giá trị/lý do các script backfill khác (Gemini free tier 15
 * req/phút, xem CLAUDE.md § AI) — endpoint embedContent chưa verify quota riêng, dùng chung giá trị
 * an toàn này cho tới khi có lý do đổi.
 */
import { prisma } from "@football-app/database";
import { createEmbeddingProvider } from "../embedding-provider";

const DELAY_BETWEEN_REQUESTS_MS = 4500;
const EMBEDDING_MODEL = "gemini-embedding-001";

// Mỗi source giữ 1 hàm fetch riêng (thay vì truyền thẳng model delegate) — union các Prisma model
// delegate không unify được kiểu gọi hàm chung, mỗi arrow function tự resolve kiểu trả về riêng.
const SOURCES = [
  {
    sourceType: "match_summary",
    fetchRows: () => prisma.aiMatchSummary.findMany({ select: { id: true, content: true } }),
  },
  {
    sourceType: "player_summary",
    fetchRows: () => prisma.aiPlayerSummary.findMany({ select: { id: true, content: true } }),
  },
  {
    sourceType: "player_comparison",
    fetchRows: () => prisma.aiPlayerComparison.findMany({ select: { id: true, content: true } }),
  },
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PendingRow {
  sourceType: string;
  sourceId: string;
  content: string;
}

async function findPendingRows(): Promise<PendingRow[]> {
  const pending: PendingRow[] = [];

  for (const { sourceType, fetchRows } of SOURCES) {
    const [rows, embedded] = await Promise.all([
      fetchRows(),
      prisma.embedding.findMany({ where: { sourceType }, select: { sourceId: true } }),
    ]);
    const embeddedIds = new Set(embedded.map((e: { sourceId: string }) => e.sourceId));
    for (const row of rows) {
      if (!embeddedIds.has(row.id)) {
        pending.push({ sourceType, sourceId: row.id, content: row.content });
      }
    }
  }

  return pending;
}

async function embedRow(row: PendingRow): Promise<void> {
  const embeddingProvider = createEmbeddingProvider();
  const result = await embeddingProvider.embed(row.content);

  // Unsupported("vector(768)")? field không xuất hiện trong create/update input types của Prisma
  // Client — upsert phần typed (id/content/model/createdAt) qua Prisma như bình thường, rồi set
  // riêng cột vector qua $executeRaw. JSON.stringify(number[]) đúng luôn là text input format của
  // pgvector cho cast ::vector, không cần helper serialize riêng.
  const saved = await prisma.embedding.upsert({
    where: { sourceType_sourceId: { sourceType: row.sourceType, sourceId: row.sourceId } },
    create: { sourceType: row.sourceType, sourceId: row.sourceId, content: row.content, model: result.model },
    update: { content: row.content, model: result.model },
  });
  await prisma.$executeRaw`UPDATE "embeddings" SET "embedding" = ${JSON.stringify(result.embedding)}::vector WHERE "id" = ${saved.id}`;
}

async function main() {
  const limitArg = process.argv[2];
  const limit = limitArg ? Number(limitArg) : undefined;
  if (limitArg && (!Number.isInteger(limit) || limit! <= 0)) {
    console.error("Usage: pnpm --filter @football-app/sync-worker backfill-embeddings [limit]");
    process.exitCode = 1;
    return;
  }

  const allPending = await findPendingRows();
  const pending = limit ? allPending.slice(0, limit) : allPending;

  console.log(
    `backfill-embeddings: ${allPending.length} dòng chưa embed, xử lý ${pending.length} dòng ` +
      `(model=${EMBEDDING_MODEL})...`,
  );

  let done = 0;
  for (const [index, row] of pending.entries()) {
    try {
      await embedRow(row);
      done++;
      console.log(`  ✓ (${done}/${pending.length}) ${row.sourceType}:${row.sourceId}`);
    } catch (err) {
      console.error(`  ✗ ${row.sourceType}:${row.sourceId}:`, err);
    }
    if (index < pending.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  console.log(`backfill-embeddings: xong — embed thành công ${done}/${pending.length} dòng.`);
}

// `process.exitCode` (KHÔNG `process.exit()`) — xem comment ở
// apps/sync-worker/src/scripts/ingest-player-season-stats.ts (cùng bug class).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("backfill-embeddings failed:", err);
    process.exitCode = 1;
  });
