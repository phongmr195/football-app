import { syncLiveMatches } from "./sync-live-matches";

// sleep() dùng setTimeout + abort listener thay vì sleep chặn thật — cho phép Ctrl-C (SIGINT/
// SIGTERM -> AbortController.abort() ở poll.ts) làm loop thoát gọn ngay lập tức thay vì phải
// chờ hết interval hiện tại.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface RunLivePollingLoopOptions {
  intervalMs?: number;
  signal?: AbortSignal;
}

// Polling cadence dùng long-running loop nội bộ (setInterval-style) thay vì EventBridge/Lambda —
// AWS chưa có account thật / terraform chưa apply, xem CLAUDE.md + plan Phase 2 Bước 1. Mỗi tick
// lỗi được catch riêng để 1 lần fetch thất bại (network, provider rate-limit...) không giết cả
// loop — tick kế tiếp vẫn chạy đúng lịch.
export async function runLivePollingLoop({ intervalMs = 30_000, signal }: RunLivePollingLoopOptions = {}) {
  while (!signal?.aborted) {
    try {
      const result = await syncLiveMatches();
      console.log("live poll tick", result);
    } catch (err) {
      console.error("live poll tick failed", err);
    }

    if (signal?.aborted) break;
    await sleep(intervalMs, signal);
  }
}
