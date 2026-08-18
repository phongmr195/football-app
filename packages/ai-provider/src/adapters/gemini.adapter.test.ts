import { describe, expect, it } from "vitest";
import { GeminiAdapter } from "./gemini.adapter";

// fetchImpl giả — không gọi network thật, không cần GEMINI_API_KEY thật để test. Mirror style của
// anthropic.adapter.test.ts.
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

  return new GeminiAdapter({ apiKey: "test-key", fetchImpl });
}

describe("GeminiAdapter", () => {
  it("map đúng content/model/tokens từ response thành công", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: "Man City thắng 3-0." }] } }],
        modelVersion: "gemini-2.5-flash-lite",
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
      },
    });

    const result = await adapter.generateText({ prompt: "Tóm tắt trận đấu" });

    expect(result).toEqual({
      content: "Man City thắng 3-0.",
      model: "gemini-2.5-flash-lite",
      tokensInput: 120,
      tokensOutput: 40,
    });
  });

  it("nối nhiều part nếu response có nhiều phần tử parts", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: "Đoạn 1." }, { text: "Đoạn 2." }] } }],
        modelVersion: "gemini-2.5-flash-lite",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    });

    const result = await adapter.generateText({ prompt: "x" });
    expect(result.content).toBe("Đoạn 1.\nĐoạn 2.");
  });

  it("throw kèm status + body khi response không 2xx", async () => {
    const adapter = makeAdapter({
      status: 401,
      body: { error: { code: 401, message: "API key not valid", status: "UNAUTHENTICATED" } },
    });

    await expect(adapter.generateText({ prompt: "x" })).rejects.toThrow(/401/);
  });
});
