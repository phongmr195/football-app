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
    commentaryCreated: summary.commentaryCreated,
    shotsCreated: summary.shotsCreated,
    highlightsCreated: summary.highlightsCreated,
    averagePositionsUpserted: summary.averagePositionsUpserted,
    momentumCreated: summary.momentumCreated,
    oddsUpserted: summary.oddsUpserted,
  });
  if (summary.unmatchedPlayers.length > 0) {
    console.warn(`${summary.unmatchedPlayers.length} cầu thủ không khớp được (bỏ qua):`);
    for (const line of summary.unmatchedPlayers) console.warn(`  - ${line}`);
  }

  // Dòng có prefix riêng, dễ parse bằng regex — apps/api's scraper-orchestrator.ts đọc dòng này từ
  // stdout khi spawn script này như subprocess (trang admin Sofascore scraper), thay vì phải parse
  // toàn bộ log text phía trên.
  console.log(`INGEST_SUMMARY_JSON ${JSON.stringify(summary)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ingest-sofascore failed:", err);
    process.exit(1);
  });
