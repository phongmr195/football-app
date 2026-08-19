import type { LlmProvider } from "../provider.interface";
import type { GenerateTextOptions, GenerateTextResult } from "../types";

const PROVIDER_NAME = "groq";
const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
// Free tier thật (Groq Cloud, không cần thẻ tín dụng) — API OpenAI-compatible (khác REST riêng của
// Anthropic/Gemini), suy luận rất nhanh (LPU inference).
// Verify thật 2026-08-19 với GROQ_API_KEY thật: "llama-3.3-70b-versatile" (chọn lúc viết ban đầu,
// đoán theo model phổ biến hay nhắc tới) đã KHÔNG còn trong danh sách model của Groq nữa (404
// "model_not_found") — GET /openai/v1/models mới là nguồn đúng, danh mục model của Groq đổi khá
// thường xuyên. "openai/gpt-oss-20b" verify gọi thành công thật (trả lời đúng, có usage). Rate
// limit free tier tính theo model, xem https://console.groq.com/docs/rate-limits.
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const DEFAULT_MAX_TOKENS = 1024;

interface OpenAiCompatibleChatCompletionResponse {
  choices: { message: { content: string } }[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface GroqAdapterOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

// KHÔNG throw ở constructor nếu thiếu apiKey — cùng convention Anthropic/GeminiAdapter, lỗi
// thật chỉ lộ ra lúc gọi generateText().
export class GroqAdapter implements LlmProvider {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GroqAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const res = await this.fetchImpl(BASE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          ...(options.system ? [{ role: "system", content: options.system }] : []),
          { role: "user", content: options.prompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Groq request failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as OpenAiCompatibleChatCompletionResponse;
    const content = data.choices[0]?.message.content ?? "";

    return {
      content,
      model: data.model ?? this.model,
      tokensInput: data.usage?.prompt_tokens ?? 0,
      tokensOutput: data.usage?.completion_tokens ?? 0,
    };
  }
}
