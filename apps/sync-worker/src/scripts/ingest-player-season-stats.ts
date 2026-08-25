/**
 * Đọc output JSON (sinh bởi apps/scraper-sofascore/scrape-player-season-stats.py) và ghi vào
 * Postgres — chạy:
 *   pnpm --filter @football-app/sync-worker ingest-player-season-stats <outputPath>
 */
import "../load-env";
import { ingestPlayerSeasonStats } from "../ingest-player-season-stats";

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error("Usage: pnpm --filter @football-app/sync-worker ingest-player-season-stats <outputPath>");
    process.exit(1);
  }
  const summary = await ingestPlayerSeasonStats(outputPath);
  console.log("ingest-player-season-stats summary:", summary);

  // Dòng có prefix riêng, dễ parse bằng regex — apps/api's scraper-orchestrator.ts đọc dòng này từ
  // stdout khi spawn script này như subprocess, cùng convention scripts/ingest-sofascore.ts.
  console.log(`INGEST_SUMMARY_JSON ${JSON.stringify(summary)}`);
}

// `process.exitCode` (KHÔNG `process.exit()`) — process.exit() thoát ngay, có thể cắt cụt
// console.log("INGEST_SUMMARY_JSON ...") ở trên nếu output lớn (vd unmatchedPlayers dài) chưa
// flush hết ra pipe (stdout khi spawn làm subprocess luôn non-blocking, KHÔNG như TTY) — bug thật
// đã gặp (2026-08-20): scraper-orchestrator.ts's parseIngestSummary() nhận JSON bị cắt cụt, throw
// SyntaxError không được catch đúng chỗ, khiến ScraperRun kẹt RUNNING vĩnh viễn. Set exitCode và để
// Node tự thoát khi event loop rỗng — đảm bảo mọi stdout write đã flush xong trước khi exit thật.
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("ingest-player-season-stats failed:", err);
    process.exitCode = 1;
  });
