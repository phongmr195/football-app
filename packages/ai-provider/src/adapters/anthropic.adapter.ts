import type { LlmProvider } from "../provider.interface";
import type { GenerateTextOptions, GenerateTextResult } from "../types";

const PROVIDER_NAME = "anthropic";
const BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicMessageResponse {
  content: { type: string; text?: string }[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicAdapterOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

// KHÔNG throw ở constructor nếu thiếu apiKey — giống ApiFootballAdapter/FootballDataAdapter, lỗi
// thật chỉ lộ ra lúc gọi generateText(). Cho phép build/test code này trước khi có
// ANTHROPIC_API_KEY thật (xem plan "gắn API key sau").
export class AnthropicAdapter implements LlmProvider {
  readonly providerName = PROVIDER_NAME;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicAdapterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const res = await this.fetchImpl(BASE_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.system ? { system: options.system } : {}),
        messages: [{ role: "user", content: options.prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic request failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as AnthropicMessageResponse;
    const content = data.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");

    return {
      content,
      model: data.model,
      tokensInput: data.usage.input_tokens,
      tokensOutput: data.usage.output_tokens,
    };
  }
}
