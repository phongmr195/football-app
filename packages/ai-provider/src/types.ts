export interface GenerateTextOptions {
  /** System prompt — hướng dẫn vai trò/giọng văn, tách khỏi nội dung thật (prompt). */
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface GenerateTextResult {
  content: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
}
