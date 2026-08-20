/**
 * Đọc roster-output/ (sinh bởi apps/scraper-sofascore/backfill-roster.py) và ghi vào Postgres — chạy:
 *   pnpm --filter @football-app/sync-worker ingest-sofascore-roster [outputDir]
 */
import { ingestSofascoreRosters } from "../ingest-sofascore-roster";

async function main() {
  const outputDir = process.argv[2] ?? "../scraper-sofascore/roster-output";
  const summary = await ingestSofascoreRosters(outputDir);
  console.log("ingest-sofascore-roster summary:", summary);
}

// `process.exitCode` (KHÔNG `process.exit()`) — xem comment ở
// apps/sync-worker/src/scripts/ingest-player-season-stats.ts (cùng bug class).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("ingest-sofascore-roster failed:", err);
    process.exitCode = 1;
  });
