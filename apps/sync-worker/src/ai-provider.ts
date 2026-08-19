import type { LlmProvider } from "@football-app/ai-provider";
import { AnthropicAdapter, FallbackLlmProvider, GeminiAdapter, GroqAdapter } from "@football-app/ai-provider";

// Chọn LLM provider qua env LLM_PROVIDER, mirror hệt createAdapter() ở provider.ts (data
// provider). KHÔNG qua AWS Bedrock (quyết định: Bedrock cần mở AWS account + xin quyền truy cập
// model, không có lợi ích thật cho quy mô app này, xem ROADMAP Phase 5). API key để trống hợp lệ
// lúc build/test — lỗi thật chỉ lộ ra lúc gọi generateText() (xem từng adapter's doc comment).
// "gemini" dùng free tier (Google AI Studio, không cần thẻ) — xem CLAUDE.md § AI.
function createBaseLlmProvider(provider: string): LlmProvider {
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        model: process.env.ANTHROPIC_MODEL,
      });
    case "gemini":
      return new GeminiAdapter({
        apiKey: process.env.GEMINI_API_KEY ?? "",
        model: process.env.GEMINI_MODEL,
      });
    case "groq":
      return new GroqAdapter({
        apiKey: process.env.GROQ_API_KEY ?? "",
        model: process.env.GROQ_MODEL,
      });
    default:
      throw new Error(`LLM provider không hợp lệ: "${provider}" — chỉ hỗ trợ "anthropic"/"gemini"/"groq"`);
  }
}

// LLM_FALLBACK_PROVIDER (optional) — khi set, wrap provider chính (LLM_PROVIDER) trong
// FallbackLlmProvider: primary fail thì tự chuyển qua provider này, throw lỗi gộp nếu CẢ 2 đều
// fail. Case thật đã gặp (2026-08-19): Gemini free tier rate limit 15 req/phút, set
// LLM_FALLBACK_PROVIDER=groq để job dài (backfill) không bị chặn hoàn toàn giữa chừng.
export function createLlmProvider(): LlmProvider {
  const primary = createBaseLlmProvider(process.env.LLM_PROVIDER ?? "anthropic");
  const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER;
  if (!fallbackProvider) return primary;
  return new FallbackLlmProvider(primary, createBaseLlmProvider(fallbackProvider));
}
