import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// createPublisher() memoize qua biến module-level (xem realtime.ts) — mỗi test case cần
// vi.resetModules() + re-import "./realtime.js" để đọc lại process.env.REDIS_URL mới thay vì
// dùng singleton đã cache từ lần import trước. Cùng pattern với apps/api/src/routes/
// matches-live.test.ts's cách reset "../lib/redis" giữa các test case.

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

beforeEach(() => {
  delete process.env.REDIS_URL;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  }
  vi.resetModules();
});

describe("createPublisher", () => {
  it("memoize — gọi 2 lần trả về đúng 1 instance", async () => {
    const { createPublisher } = await import("./realtime.js");
    const first = createPublisher();
    const second = createPublisher();
    expect(first).toBe(second);
  });

  it("REDIS_URL không set -> trả no-op publisher (resolve êm, không throw)", async () => {
    expect(process.env.REDIS_URL).toBeUndefined();
    const { createPublisher } = await import("./realtime.js");
    const publisher = createPublisher();

    expect(publisher.transportName).toBe("noop");
    await expect(
      publisher.publish({
        matchId: "match-1",
        status: "LIVE",
        minute: 10,
        homeScore: 0,
        awayScore: 0,
        updatedAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });

  it("REALTIME_PUBLISHER không hợp lệ -> throw (không tạo connection Redis thật nào, invalid value bị chặn trước khi vào switch case 'redis')", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    process.env.REALTIME_PUBLISHER = "sqs";
    const { createPublisher } = await import("./realtime.js");
    expect(() => createPublisher()).toThrow(/REALTIME_PUBLISHER/);
    delete process.env.REALTIME_PUBLISHER;
  });
});
