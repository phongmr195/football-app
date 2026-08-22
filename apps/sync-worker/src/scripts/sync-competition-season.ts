/**
 * Đồng bộ toàn bộ 1 competition+season (teams/players/standings/matches/topScorers) từ data
 * provider — chạy:
 *   pnpm --filter @football-app/sync-worker sync-competition-season -- --competition-id id
 *     --season-id id
 *
 * Nhận ID THẬT của DB (cuid), KHÔNG phải externalRef — apps/api's sync-orchestrator.ts (trang admin
 * /admin/data-sync) resolve từ dropdown Competition/Season đã có trong DB rồi truyền cuid xuống đây,
 * cùng convention generate-sofascore-manifest.ts's --competition-id/--season-id. KHÔNG gọi
 * syncCompetitions() (bootstrap phát hiện giải MỚI chưa có trong DB) — có chủ đích, xem CLAUDE.md/
 * plan feature này: chỉ re-sync 1 competition+season ĐÃ TỒN TẠI, không phải discover giải mới.
 */
import { prisma } from "@football-app/database";
import { createAdapter } from "../provider";
import { syncCompetitionSeason, syncSeasons } from "../sync-catalog";

function parseArgs() {
  const args = process.argv.slice(2);
  let competitionId: string | undefined;
  let seasonId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--competition-id") competitionId = args[++i];
    if (args[i] === "--season-id") seasonId = args[++i];
  }
  if (!competitionId || !seasonId) {
    throw new Error("Cần truyền --competition-id và --season-id");
  }
  return { competitionId, seasonId };
}

function readExternalRef(externalRef: unknown): { provider: string; id: string } | null {
  if (typeof externalRef !== "object" || externalRef === null) return null;
  const { provider, id } = externalRef as { provider?: unknown; id?: unknown };
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : null;
}

async function main() {
  const { competitionId, seasonId } = parseArgs();

  const competition = await prisma.competition.findUniqueOrThrow({ where: { id: competitionId } });
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  if (season.competitionId !== competition.id) {
    throw new Error(`season ${seasonId} không thuộc competition ${competitionId}`);
  }

  const adapter = createAdapter();
  const competitionExternalRef = readExternalRef(competition.externalRef);
  if (!competitionExternalRef) {
    throw new Error(`competition "${competition.name}" chưa có externalRef hợp lệ`);
  }
  if (competitionExternalRef.provider !== adapter.providerName) {
    throw new Error(
      `competition "${competition.name}" được sync từ provider "${competitionExternalRef.provider}", ` +
        `nhưng DATA_PROVIDER hiện tại là "${adapter.providerName}" — đổi env DATA_PROVIDER hoặc chọn giải khác`,
    );
  }
  // seasonExternalRef.id === Season.name (năm bắt đầu) — cùng convention findSeason() trong
  // sync-catalog.ts dùng cho mọi lookup season theo externalRef.
  const seasonExternalRef = { provider: adapter.providerName, id: season.name };

  await syncSeasons(adapter, competitionExternalRef);
  const result = await syncCompetitionSeason(adapter, competitionExternalRef, seasonExternalRef);

  console.log(`SYNC_SUMMARY_JSON ${JSON.stringify(result)}`);
}

// process.exitCode (KHÔNG process.exit()) — house style, xem CLAUDE.md/comment ở
// generate-sofascore-manifest.ts cho lý do (process.exit() có thể cắt cụt stdout đang pending khi
// bị pipe qua process khác, ở đây là apps/api's spawn() đọc SYNC_SUMMARY_JSON từ stdout).
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("sync-competition-season failed:", err);
    process.exitCode = 1;
  });
