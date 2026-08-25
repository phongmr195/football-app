/**
 * Backfill 1 lần: tính lại Standing + TopScorer/TopAssist cho các mùa giải ĐANG stale (từ trước
 * khi syncStandingsFromMatches()/refreshTopScorersIfNeeded() tự trigger ở sync-live-matches.ts)
 * — chạy:
 *   pnpm --filter @football-app/sync-worker recompute-season-stats [-- --season-id id]
 *
 * Không truyền --season-id -> tính lại cho MỌI season đang `isCurrent: true` (đúng đối tượng của
 * bug báo 2026-08-24: cả bảng xếp hạng lẫn thống kê cầu thủ của mùa giải hiện tại không tự cập
 * nhật). Chạy lại an toàn nhiều lần (idempotent, giống mọi hàm syncXxx khác trong sync-catalog.ts).
 *
 * TopScorer/TopAssist gọi thẳng syncTopScorers() (KHÔNG qua refreshTopScorersIfNeeded()'s
 * throttle — không cần thiết cho 1 lần chạy tay), skip season nào competition thiếu externalRef
 * hợp lệ hoặc provider khác DATA_PROVIDER hiện tại (không throw, log rồi tiếp tục season khác).
 */
import "../load-env";
import { prisma } from "@football-app/database";
import { createAdapter } from "../provider";
import { syncStandingsFromMatches, syncTopScorers } from "../sync-catalog";

function parseSeasonId(): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--season-id") return args[++i];
  }
  return undefined;
}

function readExternalRef(externalRef: unknown): { provider: string; id: string } | null {
  if (typeof externalRef !== "object" || externalRef === null) return null;
  const { provider, id } = externalRef as { provider?: unknown; id?: unknown };
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : null;
}

async function main() {
  const seasonId = parseSeasonId();
  const seasons = seasonId
    ? [await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })]
    : await prisma.season.findMany({ where: { isCurrent: true } });

  const adapter = createAdapter();

  for (const season of seasons) {
    const standingsResult = await syncStandingsFromMatches(season.id);
    console.log(`season ${season.id} (${season.name}) standings:`, standingsResult);

    const competition = await prisma.competition.findUniqueOrThrow({ where: { id: season.competitionId } });
    const competitionExternalRef = readExternalRef(competition.externalRef);
    if (!competitionExternalRef || competitionExternalRef.provider !== adapter.providerName) {
      console.warn(`season ${season.id}: bỏ qua top scorers (competition thiếu externalRef hợp lệ cho provider hiện tại)`);
      continue;
    }

    try {
      const topScorersResult = await syncTopScorers(adapter, competitionExternalRef, {
        provider: adapter.providerName,
        id: season.name,
      });
      console.log(`season ${season.id} (${season.name}) top scorers:`, topScorersResult);
    } catch (err) {
      console.warn(`season ${season.id}: syncTopScorers thất bại, bỏ qua`, err);
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error("recompute-season-stats failed:", err);
    process.exitCode = 1;
  });
