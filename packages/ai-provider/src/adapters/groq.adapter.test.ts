import { describe, expect, it } from "vitest";
import { GroqAdapter } from "./groq.adapter";

// fetchImpl giả — không cần GROQ_API_KEY thật để test. Mirror style của gemini.adapter.test.ts.
function makeAdapter(response: { status: number; body: Record<string, unknown> }) {
  const fetchImpl = (async () => {
    const { status, body } = response;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;

  return new GroqAdapter({ apiKey: "test-key", fetchImpl });
}

describe("GroqAdapter", () => {
  it("map đúng content/model/tokens từ response thành công", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: {
        choices: [{ message: { content: "Man City thắng 3-0." } }],
        model: "llama-3.3-70b-versatile",
        usage: { prompt_tokens: 120, completion_tokens: 40 },
      },
    });

    const result = await adapter.generateText({ prompt: "Tóm tắt trận đấu" });

    expect(result).toEqual({
      content: "Man City thắng 3-0.",
      model: "llama-3.3-70b-versatile",
      tokensInput: 120,
      tokensOutput: 40,
    });
  });

  it("trả tokensInput/tokensOutput = 0 khi response thiếu field usage", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: { choices: [{ message: { content: "x" } }], model: "llama-3.3-70b-versatile" },
    });

    const result = await adapter.generateText({ prompt: "x" });
    expect(result.tokensInput).toBe(0);
    expect(result.tokensOutput).toBe(0);
  });

  it("throw kèm status + body khi response không 2xx", async () => {
    const adapter = makeAdapter({
      status: 401,
      body: { error: { message: "Invalid API Key" } },
    });

    await expect(adapter.generateText({ prompt: "x" })).rejects.toThrow(/401/);
  });
});
