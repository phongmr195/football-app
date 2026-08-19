import type { LlmProvider } from "./provider.interface";
import type { GenerateTextOptions, GenerateTextResult } from "./types";

// Compose 2 LlmProvider: gọi `primary` trước, nếu fail (network lỗi, 4xx/5xx, rate limit...) thì
// tự chuyển qua gọi `fallback`; nếu CẢ 2 đều fail thì throw 1 lỗi gộp (giữ message của cả 2, dễ
// debug provider nào fail vì lý do gì). Dùng khi provider chính (Gemini free tier) có rate limit
// chật (verify thật 2026-08-19: backfill-player-summaries gặp 429 RESOURCE_EXHAUSTED giữa chừng) —
// fallback qua provider khác (vd GroqAdapter) để job không bị chặn hoàn toàn.
export class FallbackLlmProvider implements LlmProvider {
  readonly providerName: string;

  constructor(
    private readonly primary: LlmProvider,
    private readonly fallback: LlmProvider,
  ) {
    this.providerName = `${primary.providerName}(fallback:${fallback.providerName})`;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    try {
      return await this.primary.generateText(options);
    } catch (primaryError) {
      console.warn(
        `FallbackLlmProvider: primary "${this.primary.providerName}" failed, thử "${this.fallback.providerName}"`,
        primaryError,
      );
      try {
        return await this.fallback.generateText(options);
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `Cả 2 LLM provider đều fail — primary (${this.primary.providerName}): ${primaryMessage}; ` +
            `fallback (${this.fallback.providerName}): ${fallbackMessage}`,
        );
      }
    }
  }
}
