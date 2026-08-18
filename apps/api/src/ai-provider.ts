import type { LlmProvider } from "@football-app/ai-provider";
import { AnthropicAdapter, GeminiAdapter } from "@football-app/ai-provider";

// Copy riêng từ apps/sync-worker/src/ai-provider.ts (không export dùng chung giữa 2 app) — chỉ
// dùng cho player-compare (routes/player-compare.ts), route DUY NHẤT trong apps/api gọi LLM đồng
// bộ trong request (xem comment ở player-compare.ts về vì sao phá lệ "apps/api không gọi LLM").
export function createLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";

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
    default:
      throw new Error(`LLM_PROVIDER không hợp lệ: "${provider}" — chỉ hỗ trợ "anthropic" hoặc "gemini"`);
  }
}
