import { describe, expect, it } from "vitest";
import { ApiFootballAdapter } from "./api-football.adapter";
import { RateLimiter } from "../rate-limiter";

// fetchImpl giả — không gọi network thật. RateLimiter dùng maxRequests lớn để test không
// bị chờ (đã có test riêng cho logic throttle ở rate-limiter.test.ts).
function makeAdapter(responses: Array<Record<string, unknown>>) {
  let call = 0;
  const fetchImpl = (async () => {
    const body = responses[call] ?? responses[responses.length - 1];
    call++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;

  return new ApiFootballAdapter({
    apiKey: "test-key",
    fetchImpl,
    rateLimiter: new RateLimiter({ maxRequests: 1000, windowMs: 1000 }),
  });
}

describe("ApiFootballAdapter — xử lý lỗi trong body (HTTP 200 + errors)", () => {
  it("không throw khi errors là mảng/object rỗng (response bình thường)", async () => {
    const adapter = makeAdapter([{ response: [], errors: [] }]);
    await expect(adapter.fetchCompetitions()).resolves.toEqual([]);
  });

  it("throw khi errors có nội dung dù HTTP status là 200 (bug thật: hết quota ngày)", async () => {
    const adapter = makeAdapter([
      { response: [], errors: { requests: "You have reached the request limit for the day" } },
    ]);
    await expect(adapter.fetchCompetitions()).rejects.toThrow(/requests/);
  });
});
