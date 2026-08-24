/**
 * Backfill 1 lần: tính lại Standing cho các mùa giải ĐANG stale (từ trước khi
 * syncStandingsFromMatches() tự trigger ở sync-live-matches.ts) — chạy:
 *   pnpm --filter @football-app/sync-worker recompute-standings [-- --season-id id]
 *
 * Không truyền --season-id -> tính lại cho MỌI season đang `isCurrent: true` (đúng đối tượng của
 * bug báo 2026-08-24: bảng xếp hạng mùa giải hiện tại không tự cập nhật). Chạy lại an toàn nhiều
 * lần (idempotent, giống mọi hàm syncXxx khác trong sync-catalog.ts).
 */
import { prisma } from "@football-app/database";
import { syncStandingsFromMatches } from "../sync-catalog";

function parseSeasonId(): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--season-id") return args[++i];
  }
  return undefined;
}

async function main() {
  const seasonId = parseSeasonId();
  const seasons = seasonId
    ? [await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })]
    : await prisma.season.findMany({ where: { isCurrent: true } });

  for (const season of seasons) {
    const result = await syncStandingsFromMatches(season.id);
    console.log(`season ${season.id} (${season.name}):`, result);
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("recompute-standings failed:", err);
    process.exitCode = 1;
  });
