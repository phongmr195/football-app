/**
 * So sánh retrieval pgvector (Knowledge corpus embedded — xem
 * apps/sync-worker/src/scripts/backfill-embeddings.ts) với "RAG-lite" ILIKE hiện có
 * (apps/api/src/chat-retrieval.ts) trên vài câu hỏi mẫu — chạy:
 *   pnpm --filter @football-app/api compare-retrieval
 *
 * Phase 1 chat RAG (2026-08-21, xem docs/architecture/PROJECT_PLAN.md) — script DÙNG 1 LẦN, KHÔNG
 * phải tính năng admin lâu dài. Không sửa/gọi buildChatContext() theo cách khác thường — import
 * thẳng, chạy read-only, không đổi hành vi /chat/messages.
 *
 * Câu hỏi mẫu lấy từ dữ liệu THẬT trong DB (không hardcode tên có thể không tồn tại) — 1 cầu thủ
 * có AiPlayerSummary, 1 trận có AiMatchSummary, 1 cặp có AiPlayerComparison sẵn.
 */
import { prisma } from "@football-app/database";
import { GeminiEmbeddingAdapter } from "@football-app/ai-provider";
import { buildChatContext } from "../chat-retrieval";

const embeddingProvider = new GeminiEmbeddingAdapter({ apiKey: process.env.GEMINI_API_KEY ?? "" });
const VECTOR_RESULT_LIMIT = 5;

interface VectorMatch {
  sourceType: string;
  sourceId: string;
  content: string;
  similarity: number;
}

async function vectorSearch(query: string): Promise<VectorMatch[]> {
  const { embedding } = await embeddingProvider.embed(query);
  const vectorLiteral = JSON.stringify(embedding);
  return prisma.$queryRaw<VectorMatch[]>`
    SELECT "sourceType", "sourceId", "content", 1 - ("embedding" <=> ${vectorLiteral}::vector) AS similarity
    FROM "embeddings"
    WHERE "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${vectorLiteral}::vector
    LIMIT ${VECTOR_RESULT_LIMIT}
  `;
}

async function buildSampleQueries(): Promise<string[]> {
  const [playerSummary, matchWithSummary, comparison] = await Promise.all([
    prisma.aiPlayerSummary.findFirst({ include: { player: { select: { name: true } } } }),
    prisma.match.findFirst({
      where: { aiSummary: { isNot: null } },
      include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    }),
    prisma.aiPlayerComparison.findFirst({
      include: { playerA: { select: { name: true } }, playerB: { select: { name: true } } },
    }),
  ]);

  const queries: string[] = [];
  if (playerSummary) queries.push(`${playerSummary.player.name} dạo này đá thế nào?`);
  if (matchWithSummary) queries.push(`Cho tôi biết về trận ${matchWithSummary.homeTeam.name} gặp ${matchWithSummary.awayTeam.name}`);
  if (comparison) queries.push(`So sánh ${comparison.playerA.name} và ${comparison.playerB.name}`);
  // Câu hỏi không match được gì cả (cầu thủ/đội không tồn tại) — kiểm tra 2 phía xử lý "không có
  // dữ liệu" ra sao, không chỉ test happy path.
  queries.push("Ronaldinho hiện tại chơi cho đội nào?");
  return queries;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

async function main() {
  const queries = await buildSampleQueries();

  for (const query of queries) {
    console.log("\n" + "=".repeat(80));
    console.log(`QUERY: ${query}`);
    console.log("=".repeat(80));

    console.log("\n--- vector (pgvector cosine similarity, top 5) ---");
    try {
      const vectorResults = await vectorSearch(query);
      if (vectorResults.length === 0) {
        console.log("(không có embedding nào trong DB)");
      } else {
        for (const r of vectorResults) {
          console.log(`[${r.similarity.toFixed(3)}] ${r.sourceType}:${r.sourceId} — ${truncate(r.content, 120)}`);
        }
      }
    } catch (err) {
      console.error("vector search lỗi:", err);
    }

    console.log("\n--- ILIKE (buildChatContext() hiện tại) ---");
    try {
      const context = await buildChatContext(query);
      console.log(context || "(không khớp được gì)");
    } catch (err) {
      console.error("buildChatContext lỗi:", err);
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("compare-retrieval failed:", err);
    process.exitCode = 1;
  });
