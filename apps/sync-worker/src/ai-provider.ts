import type { LlmProvider } from "@football-app/ai-provider";
import { AnthropicAdapter } from "@football-app/ai-provider";

// Chọn LLM provider qua env LLM_PROVIDER, mirror hệt createAdapter() ở provider.ts (data
// provider). Chỉ có "anthropic" lúc này — gọi thẳng Anthropic API, KHÔNG qua AWS Bedrock (quyết
// định: Bedrock cần mở AWS account + xin quyền truy cập model, không có lợi ích thật cho quy mô
// app này, xem ROADMAP Phase 5). ANTHROPIC_API_KEY để trống hợp lệ lúc build/test — lỗi thật chỉ
// lộ ra lúc gọi generateText() (xem AnthropicAdapter's doc comment).
export function createLlmProvider(): LlmProvider {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";

  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        model: process.env.ANTHROPIC_MODEL,
      });
    default:
      throw new Error(`LLM_PROVIDER không hợp lệ: "${provider}" — chỉ hỗ trợ "anthropic"`);
  }
}
