import type { EmbeddingProvider } from "@football-app/ai-provider";
import { GeminiEmbeddingAdapter } from "@football-app/ai-provider";

// Chỉ 1 provider (Gemini) — khác createLlmProvider() (ai-provider.ts) không cần chọn qua env, vì
// đây là quyết định đã chốt cho Phase 1 chat RAG (tái dùng GEMINI_API_KEY có sẵn, không thêm
// provider/credential mới, xem docs/architecture/PROJECT_PLAN.md).
export function createEmbeddingProvider(): EmbeddingProvider {
  return new GeminiEmbeddingAdapter({ apiKey: process.env.GEMINI_API_KEY ?? "" });
}
