import { createServer } from "node:http";
import { runLivePollingLoop } from "./poll-live-matches";

// Entrypoint chạy loop polling live-match dài hạn cho local dev / Docker (xem CLAUDE.md § Data
// provider — cadence 30s mặc định = 2 req/phút, dư margin so với giới hạn tự áp 8 req/phút).
const intervalMs = Number(process.env.LIVE_POLL_INTERVAL_MS ?? 30_000);

// PORT chỉ có khi chạy trên host free dạng "Web Service" (vd Render — free tier KHÔNG có
// Background Worker, chỉ Web Service có health-check HTTP mới miễn phí, xem plan deploy). Local
// dev/Docker (docker-compose.yml's sync-worker-live) không set PORT, không mở server này — hoàn
// toàn tách biệt khỏi poll loop, chỉ tồn tại để có endpoint cho keep-alive ping (UptimeRobot) và
// health-check của host, KHÔNG dùng http module cho logic gì khác.
const port = process.env.PORT;
if (port) {
  createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  }).listen(Number(port), () => {
    console.log(`health check server nghe ở port ${port}`);
  });
}

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
