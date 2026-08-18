import type { GenerateTextOptions, GenerateTextResult } from "./types";

// apps/sync-worker chỉ phụ thuộc interface này, không biết provider cụ thể (Anthropic trực tiếp
// hay provider khác sau này) — đổi provider = thêm adapter mới, không đổi code gọi. Mirror chính
// xác pattern DataProviderAdapter ở packages/data-provider/src/provider.interface.ts.
export interface LlmProvider {
  readonly providerName: string;
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
}
