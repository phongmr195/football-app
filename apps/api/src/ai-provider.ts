import type { LlmProvider } from "@football-app/ai-provider";
import { AnthropicAdapter, FallbackLlmProvider, GeminiAdapter, GroqAdapter } from "@football-app/ai-provider";

// Copy riêng từ apps/sync-worker/src/ai-provider.ts (không export dùng chung giữa 2 app) — dùng
// cho mọi route gọi LLM đồng bộ trong request (player-compare, chat — xem CLAUDE.md § AI).
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
// fail. Mirror hệt apps/sync-worker/src/ai-provider.ts, xem comment ở đó.
export function createLlmProvider(): LlmProvider {
  const primary = createBaseLlmProvider(process.env.LLM_PROVIDER ?? "anthropic");
  const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER;
  if (!fallbackProvider) return primary;
  return new FallbackLlmProvider(primary, createBaseLlmProvider(fallbackProvider));
}
