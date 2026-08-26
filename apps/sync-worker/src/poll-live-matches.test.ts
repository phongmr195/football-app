import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeNextInterval } from "./adaptive-interval";
import { runLivePollingLoop } from "./poll-live-matches";
import { syncLiveMatches } from "./sync-live-matches";

vi.mock("./sync-live-matches", () => ({
  syncLiveMatches: vi.fn(),
}));

// computeNextInterval() được gọi trực tiếp bên trong runLivePollingLoop() (không nhận qua tham
// số) — mock cả module "./adaptive-interval" cùng style với "./sync-live-matches" ở trên, để
// control cadence trả về mà không cần Postgres thật (xem adaptive-interval.test.ts cho test
// query DB thật của chính computeNextInterval()).
vi.mock("./adaptive-interval", () => ({
  computeNextInterval: vi.fn(),
}));

const mockedSyncLiveMatches = vi.mocked(syncLiveMatches);
const mockedComputeNextInterval = vi.mocked(computeNextInterval);

beforeEach(() => {
  vi.useFakeTimers();
  mockedSyncLiveMatches.mockReset();
  mockedComputeNextInterval.mockReset();
  // Mặc định trả về đúng giá trị intervalMs cố định mà đa số test hiện có đang dùng (1000ms) —
  // test riêng cho adaptive cadence (tight/idle/thay đổi giữa chừng/reject) tự override bằng
  // mockResolvedValueOnce/mockRejectedValueOnce bên dưới.
  mockedComputeNextInterval.mockResolvedValue(1000);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Helper: chạy hết microtask queue hiện tại (await Promise.resolve() nhiều lần) để các `await`
// bên trong loop (syncLiveMatches(), sleep() promise) settle trước khi advance fake timer tiếp.
async function flushMicrotasks(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("runLivePollingLoop", () => {
  it("gọi syncLiveMatches() lại đúng theo interval (cadence)", async () => {
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 0, reconciledCount: 0 });
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 1000, signal: controller.signal });

    await flushMicrotasks(); // tick đầu tiên chạy ngay khi vào loop
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(3);

    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await loopPromise;
  });

  it("lỗi 1 tick không làm dừng loop — tick kế tiếp vẫn chạy", async () => {
    mockedSyncLiveMatches
      .mockRejectedValueOnce(new Error("provider tạm lỗi"))
      .mockResolvedValue({ syncedCount: 2, reconciledCount: 0 });
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 1000, signal: controller.signal });

    await flushMicrotasks();
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1); // tick lỗi

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2); // tick kế tiếp vẫn chạy, không bị chặn

    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await loopPromise;
  });

  it("abort signal dừng loop kịp thời, không chờ hết interval hiện tại", async () => {
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 0, reconciledCount: 0 });
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 30_000, signal: controller.signal });
    await flushMicrotasks();
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    // Abort giữa chừng interval dài (30s) — loop phải thoát ngay, không cần advance hết 30s.
    controller.abort();
    await flushMicrotasks();
    await loopPromise; // phải resolve mà không cần advance timer thêm

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1); // không có tick thêm sau abort
  });
});

describe("runLivePollingLoop — adaptive cadence (Phase 2 Bước 4)", () => {
  it("computeNextInterval() trả 15s (tight) -> loop dùng đúng 15s cho sleep, không dùng intervalMs cố định", async () => {
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 1, reconciledCount: 0 });
    mockedComputeNextInterval.mockResolvedValue(15_000);
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 30_000, signal: controller.signal });
    await flushMicrotasks();
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    // Chưa đủ 15s -> chưa có tick tiếp theo.
    await vi.advanceTimersByTimeAsync(14_000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    // Đủ 15s (đúng giá trị computeNextInterval trả về, KHÔNG phải 30s của intervalMs) -> tick tiếp theo.
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(15_000);
    await loopPromise;
  });

  it("computeNextInterval() trả 300s (idle) -> loop dùng đúng 300s cho sleep", async () => {
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 0, reconciledCount: 0 });
    mockedComputeNextInterval.mockResolvedValue(300_000);
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 30_000, signal: controller.signal });
    await flushMicrotasks();
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(299_000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(300_000);
    await loopPromise;
  });

  it("cadence đổi giữa chừng — tick kế tiếp dùng ngay giá trị computeNextInterval mới, không cần restart loop", async () => {
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 1, reconciledCount: 0 });
    mockedComputeNextInterval
      .mockResolvedValueOnce(15_000) // sau tick 1 (tight)
      .mockResolvedValueOnce(300_000); // sau tick 2 (idle)
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 30_000, signal: controller.signal });
    await flushMicrotasks();
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000); // dùng cadence tight sau tick 1
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2);

    // Cadence đổi sang idle (300s) ngay sau tick 2 — 15s nữa (giống cadence cũ) KHÔNG đủ để có tick 3.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(285_000); // đủ 300s kể từ tick 2
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(3);

    controller.abort();
    await vi.advanceTimersByTimeAsync(300_000);
    await loopPromise;
  });

  it("computeNextInterval() reject -> fallback về intervalMs truyền vào, log lỗi, không throw ra ngoài loop", async () => {
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 0, reconciledCount: 0 });
    mockedComputeNextInterval.mockRejectedValue(new Error("DB tạm lỗi"));
    const controller = new AbortController();

    const loopPromise = runLivePollingLoop({ intervalMs: 5000, signal: controller.signal });
    await flushMicrotasks();
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    // Fallback đúng intervalMs=5000 (không phải cadence mặc định khác) dù computeNextInterval reject.
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockedSyncLiveMatches).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await loopPromise; // loop không bị crash bởi computeNextInterval() reject
  });
});
