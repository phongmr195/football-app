import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLivePollingLoop } from "./poll-live-matches";
import { syncLiveMatches } from "./sync-live-matches";

vi.mock("./sync-live-matches", () => ({
  syncLiveMatches: vi.fn(),
}));

const mockedSyncLiveMatches = vi.mocked(syncLiveMatches);

beforeEach(() => {
  vi.useFakeTimers();
  mockedSyncLiveMatches.mockReset();
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
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 0 });
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
      .mockResolvedValue({ syncedCount: 2 });
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
    mockedSyncLiveMatches.mockResolvedValue({ syncedCount: 0 });
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
