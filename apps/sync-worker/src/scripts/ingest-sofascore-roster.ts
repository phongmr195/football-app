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

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ingest-sofascore-roster failed:", err);
    process.exit(1);
  });
