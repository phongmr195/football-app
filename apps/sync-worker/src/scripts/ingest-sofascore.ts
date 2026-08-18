/**
 * Đọc output/ (sinh bởi apps/scraper-sofascore/scraper.py) và ghi vào Postgres — chạy:
 *   pnpm --filter @football-app/sync-worker ingest-sofascore [outputDir]
 */
import { ingestSofascoreOutputs } from "../ingest-sofascore";

async function main() {
  const outputDir = process.argv[2] ?? "../scraper-sofascore/output";
  const summary = await ingestSofascoreOutputs(outputDir);

  console.log("ingest-sofascore summary:", {
    processedFiles: summary.processedFiles,
    eventsCreated: summary.eventsCreated,
    lineupsUpserted: summary.lineupsUpserted,
    ratingsUpserted: summary.ratingsUpserted,
    statisticsUpserted: summary.statisticsUpserted,
  });
  if (summary.unmatchedPlayers.length > 0) {
    console.warn(`${summary.unmatchedPlayers.length} cầu thủ không khớp được (bỏ qua):`);
    for (const line of summary.unmatchedPlayers) console.warn(`  - ${line}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ingest-sofascore failed:", err);
    process.exit(1);
  });
