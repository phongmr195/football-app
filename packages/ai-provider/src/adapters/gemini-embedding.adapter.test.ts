import { describe, expect, it } from "vitest";
import { GeminiEmbeddingAdapter } from "./gemini-embedding.adapter";

// fetchImpl giả — không gọi network thật, không cần GEMINI_API_KEY thật để test. Mirror style của
// gemini.adapter.test.ts.
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

  return new GeminiEmbeddingAdapter({ apiKey: "test-key", fetchImpl });
}

describe("GeminiEmbeddingAdapter", () => {
  it("map đúng embedding/model từ response thành công", async () => {
    const adapter = makeAdapter({
      status: 200,
      body: { embedding: { values: [0.1, 0.2, 0.3] } },
    });

    const result = await adapter.embed("Man City thắng 3-0.");

    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], model: "gemini-embedding-001" });
  });

  it("throw kèm status + body khi response không 2xx", async () => {
    const adapter = makeAdapter({
      status: 401,
      body: { error: { code: 401, message: "API key not valid", status: "UNAUTHENTICATED" } },
    });

    await expect(adapter.embed("x")).rejects.toThrow(/401/);
  });
});
