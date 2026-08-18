import type { LlmProvider } from "../provider.interface";
import type { GenerateTextOptions, GenerateTextResult } from "../types";

const PROVIDER_NAME = "gemini";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Free tier (Google AI Studio, không cần thẻ tín dụng) — model rẻ/nhanh nhất, xem CLAUDE.md § AI.
// Đủ cho việc tóm tắt trận đấu (viết lại vài dữ kiện, không cần model mạnh).
// "gemini-2.5-flash-lite" (chọn lúc nghiên cứu ban đầu) đã bị Google deprecate cho user mới —
// verify thật lúc gắn key thật (2026-08-18): request 404 kèm message trực tiếp từ Google báo dùng
// "gemini-3.5-flash-lite" thay thế. Đổi theo đúng chỉ dẫn đó, không phải đoán.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_MAX_TOKENS = 1024;

interface GeminiGenerateContentResponse {
  candidates: { content: { parts: { text?: string }[] } }[];
  modelVersion?: string;
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
}

export interface GeminiAdapterOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

// KHÔNG throw ở constructor nếu thiếu apiKey — cùng convention AnthropicAdapter/ApiFootballAdapter,
// lỗi thật chỉ lộ ra lúc gọi generateText().
//
// LƯU Ý CASING CHƯA VERIFY THẬT (chưa có API key để test lúc viết — xem CLAUDE.md § AI): tài liệu
// chính thức của Google KHÔNG nhất quán — `generationConfig.maxOutputTokens` xác nhận là camelCase
// (REST reference chính thức), nhưng field top-level `system_instruction` lại là snake_case theo
// đúng ví dụ REST chính thức trong repo google-gemini/cookbook (khác hẳn convention camelCase còn
// lại của cùng API). Đã cố tình theo đúng ví dụ chính thức thay vì đoán theo pattern chung — verify
// lại field `system_instruction` đầu tiên khi có GEMINI_API_KEY thật nếu request lỗi 400.
export class GeminiAdapter implements LlmProvider {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const res = await this.fetchImpl(`${BASE_URL}/${this.model}:generateContent`, {
      method: "POST",
      headers: {
        // Header (không phải query param ?key=) — tránh key lộ ra URL (có thể bị log lại ở proxy/
        // access log), đúng khuyến nghị chính thức của Google.
        "x-goog-api-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(options.system ? { system_instruction: { parts: [{ text: options.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        generationConfig: { maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini request failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const content = (data.candidates[0]?.content.parts ?? [])
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text))
      .join("\n");

    return {
      content,
      model: data.modelVersion ?? this.model,
      tokensInput: data.usageMetadata.promptTokenCount,
      tokensOutput: data.usageMetadata.candidatesTokenCount,
    };
  }
}
