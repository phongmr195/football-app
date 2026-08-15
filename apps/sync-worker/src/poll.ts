import { runLivePollingLoop } from "./poll-live-matches";

// Entrypoint chạy loop polling live-match dài hạn cho local dev / Docker (xem CLAUDE.md § Data
// provider — cadence 30s mặc định = 2 req/phút, dư margin so với giới hạn tự áp 8 req/phút).
const intervalMs = Number(process.env.LIVE_POLL_INTERVAL_MS ?? 30_000);

const controller = new AbortController();

function shutdown(signal: string) {
  console.log(`${signal} nhận được, đang dừng live polling loop...`);
  controller.abort();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

runLivePollingLoop({ intervalMs, signal: controller.signal })
  .then(() => {
    console.log("live polling loop đã dừng");
    process.exit(0);
  })
  .catch((err) => {
    console.error("live polling loop crashed", err);
    process.exit(1);
  });
