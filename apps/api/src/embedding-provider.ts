import type { EmbeddingProvider } from "@football-app/ai-provider";
import { GeminiEmbeddingAdapter } from "@football-app/ai-provider";

// Mirror apps/sync-worker/src/embedding-provider.ts — chỉ 1 provider (Gemini), quyết định đã chốt
// cho pgvector chat RAG (tái dùng GEMINI_API_KEY có sẵn, không thêm provider/credential mới, xem
// docs/architecture/PROJECT_PLAN.md).
export function createEmbeddingProvider(): EmbeddingProvider {
  return new GeminiEmbeddingAdapter({ apiKey: process.env.GEMINI_API_KEY ?? "" });
}
