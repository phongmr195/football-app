import { computeNextInterval } from "./adaptive-interval";
import { logError } from "./logger";
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
      void logError("live poll tick failed", err);
    }

    if (signal?.aborted) break;

    // Adaptive polling (Phase 2 Bước 4) — computeNextInterval() query DB để rút ngắn/giãn cadence
    // theo trận có LIVE/HALFTIME/sắp kickoff hay không, thay vì intervalMs cố định. intervalMs
    // tham số vẫn giữ vai trò fallback: nếu computeNextInterval() throw (DB tạm lỗi...), dùng lại
    // giá trị cố định, log lỗi, không throw ra ngoài loop, không hang.
    let nextInterval = intervalMs;
    try {
      nextInterval = await computeNextInterval();
    } catch (err) {
      void logError("computeNextInterval thất bại, dùng intervalMs mặc định", err);
    }
    console.log("live poll next interval", nextInterval);
    await sleep(nextInterval, signal);
  }
}
