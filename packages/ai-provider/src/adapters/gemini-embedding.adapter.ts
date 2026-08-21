import type { EmbeddingProvider } from "../embedding-provider.interface";
import type { EmbedResult } from "../embedding-types";

const PROVIDER_NAME = "gemini-embedding";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// "text-embedding-004" (đoán theo training data lúc viết ban đầu) đã KHÔNG còn tồn tại — verify
// thật 2026-08-21: request trả 404 "is not found ... or is not supported for embedContent". Gọi
// GET /v1beta/models (kèm x-goog-api-key) lọc supportedGenerationMethods chứa "embedContent" mới
// là nguồn đúng để tra model đang khả dụng — cùng bài học đã gặp với Groq (xem groq.adapter.ts).
// Model thật khả dụng: "gemini-embedding-001" (default 3072 chiều) — verify thật đã gọi thành công.
const DEFAULT_MODEL = "gemini-embedding-001";
// 768 chiều — chọn cho Phase 1 chat RAG (Knowledge corpus, xem docs/architecture/PROJECT_PLAN.md),
// đủ cho corpus nhỏ hiện tại, tránh lưu vector 3072 chiều không cần thiết. gemini-embedding-001 hỗ
// trợ tham số `outputDimensionality` để rút gọn output — verify thật: truyền 768 trả đúng 768 số.
const OUTPUT_DIMENSIONALITY = 768;

interface GeminiEmbedContentResponse {
  embedding: { values: number[] };
}

export interface GeminiEmbeddingAdapterOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

// KHÔNG throw ở constructor nếu thiếu apiKey — cùng convention GeminiAdapter/AnthropicAdapter, lỗi
// thật chỉ lộ ra lúc gọi embed().
//
// Field `model` trong request body :embedContent CẦN format đầy đủ `"models/{model}"` (khác
// :generateContent vốn chỉ cần tên model trong URL path, không lặp lại trong body) — verify thật
// đã gọi thành công với format này.
export class GeminiEmbeddingAdapter implements EmbeddingProvider {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiEmbeddingAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(text: string): Promise<EmbedResult> {
    const res = await this.fetchImpl(`${BASE_URL}/${this.model}:embedContent`, {
      method: "POST",
      headers: {
        // Header (không phải query param ?key=) — cùng lý do GeminiAdapter, tránh key lộ vào log.
        "x-goog-api-key": this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: OUTPUT_DIMENSIONALITY,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini embedContent request failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as GeminiEmbedContentResponse;
    return { embedding: data.embedding.values, model: this.model };
  }
}
