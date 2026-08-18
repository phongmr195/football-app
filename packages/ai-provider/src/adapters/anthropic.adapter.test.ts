import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.adapter";

// fetchImpl giả — không gọi network thật, không cần ANTHROPIC_API_KEY thật để test (xem plan
// "gắn API key sau"). Mirror style của football-data.adapter.test.ts.
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

  return new AnthropicAdapter({ apiKey: "test-key", fetchImpl });
}

describe("AnthropicAdapter", () => {
  it("map đúng content/model/tokens từ response thành công", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: {
        content: [{ type: "text", text: "Man City thắng 3-0." }],
        model: "claude-haiku-4-5-20251001",
        usage: { input_tokens: 120, output_tokens: 40 },
      },
    });

    const result = await adapter.generateText({ prompt: "Tóm tắt trận đấu" });

    expect(result).toEqual({
      content: "Man City thắng 3-0.",
      model: "claude-haiku-4-5-20251001",
      tokensInput: 120,
      tokensOutput: 40,
    });
  });

  it("nối nhiều text block nếu response có nhiều phần tử content", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: {
        content: [
          { type: "text", text: "Đoạn 1." },
          { type: "text", text: "Đoạn 2." },
        ],
        model: "claude-haiku-4-5-20251001",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });

    const result = await adapter.generateText({ prompt: "x" });
    expect(result.content).toBe("Đoạn 1.\nĐoạn 2.");
  });

  it("throw kèm status + body khi response không 2xx", async () => {
    const adapter = makeAdapter({
      status: 401,
      body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
    });

    await expect(adapter.generateText({ prompt: "x" })).rejects.toThrow(/401/);
  });
});
