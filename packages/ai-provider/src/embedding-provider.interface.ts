import type { EmbedResult } from "./embedding-types";

// Interface RIÊNG khỏi LlmProvider — embedding và generateText là 2 khả năng khác nhau của cùng 1
// nhà cung cấp (Gemini hỗ trợ cả 2 qua 2 action REST khác nhau), nhưng response shape hoàn toàn
// khác nhau (embedding trả 1 vector số, không có tokensInput/tokensOutput/candidates) — tách
// interface để không ép EmbedResult giả vờ giống GenerateTextResult. Mirror pattern LlmProvider
// (packages/ai-provider/src/provider.interface.ts): apps chỉ phụ thuộc interface này, không biết
// provider cụ thể.
export interface EmbeddingProvider {
  readonly providerName: string;
  embed(text: string): Promise<EmbedResult>;
}
