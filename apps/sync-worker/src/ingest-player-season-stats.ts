import { readFileSync } from "node:fs";
import { prisma } from "@football-app/database";
import type { Prisma } from "@football-app/database";

interface ScrapedPlayerSeasonStats {
  playerId: string;
  appearances?: number;
  goals?: number;
  assists?: number;
  yellowCards?: number;
  redCards?: number;
  rating?: number;
  expectedGoals?: number;
  expectedAssists?: number;
  tackles?: number;
  interceptions?: number;
  keyPasses?: number;
  successfulDribbles?: number;
  kilometersCovered?: number;
  topSpeed?: number;
  saves?: number;
  cleanSheet?: number;
  raw: unknown;
}

interface ScrapedOutput {
  seasonId: string;
  players: ScrapedPlayerSeasonStats[];
  unmatchedPlayers: string[];
}

// Field đặt tên riêng (KHÔNG dùng chung "unmatchedPlayers"/"processedFiles" như IngestSummary của
// ingest-sofascore.ts) — 2 summary có thể bị gộp CHUNG vào 1 ScraperRun.ingestSummary khi admin
// chọn cả loại match-level VÀ playerSeasonStats trong cùng 1 run (xem
// apps/api/src/scraper-orchestrator.ts's Object.assign) — trùng tên field sẽ khiến bên chạy SAU
// đè mất giá trị của bên chạy TRƯỚC.
export interface IngestPlayerSeasonStatsSummary {
  playerSeasonStatsUpserted: number;
  playerSeasonStatsUnmatchedPlayers: string[];
}

const OPTIONAL_NUMBER_FIELDS = [
  "appearances",
  "goals",
  "assists",
  "yellowCards",
  "redCards",
  "rating",
  "expectedGoals",
  "expectedAssists",
  "tackles",
  "interceptions",
  "keyPasses",
  "successfulDribbles",
  "kilometersCovered",
  "topSpeed",
  "saves",
  "cleanSheet",
] as const;

// Field NOT NULL sẵn có (@default(0)) — cần giá trị cụ thể khi TẠO row mới (Sofascore không quan
// sát được thì mặc định 0, đúng nghĩa "chưa biết" như football-data.org's syncTopScorers() vẫn
// làm). Khi UPDATE row đã tồn tại, chỉ set field nào Sofascore THẬT SỰ quan sát được cho cầu thủ
// này (tránh đè `undefined` lên giá trị đúng đã có từ football-data.org) — đây là lý do KHÔNG dùng
// `?? 0` khi build updateData.
const NOT_NULL_DEFAULTS: Record<string, number> = {
  appearances: 0,
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
};

// Đọc output JSON (sinh bởi apps/scraper-sofascore/scrape-player-season-stats.py) và upsert vào
// PlayerStatistics — MỞ RỘNG model đã có (không tạo model riêng) để trang player detail
// (apps/web/src/app/players/[id]/page.tsx) tự động có data mới không cần đổi API/UI. Chỉ set field
// nào Sofascore THẬT quan sát được cho từng cầu thủ (1 người có thể lọt category này, không lọt
// category khác — xem CLAUDE.md § Scraper) — field vắng mặt giữ nguyên giá trị cũ khi update.
export async function ingestPlayerSeasonStats(outputPath: string): Promise<IngestPlayerSeasonStatsSummary> {
  const data = JSON.parse(readFileSync(outputPath, "utf-8")) as ScrapedOutput;
  const summary: IngestPlayerSeasonStatsSummary = {
    playerSeasonStatsUpserted: 0,
    playerSeasonStatsUnmatchedPlayers: data.unmatchedPlayers,
  };

  for (const player of data.players) {
    const updateData: Record<string, unknown> = { raw: player.raw as Prisma.InputJsonValue };
    const createData: Record<string, unknown> = {
      playerId: player.playerId,
      seasonId: data.seasonId,
      raw: player.raw as Prisma.InputJsonValue,
    };
    for (const field of OPTIONAL_NUMBER_FIELDS) {
      const value = player[field];
      if (value !== undefined) {
        updateData[field] = value;
        createData[field] = value;
      } else if (field in NOT_NULL_DEFAULTS) {
        createData[field] = NOT_NULL_DEFAULTS[field];
      }
    }

    await prisma.playerStatistics.upsert({
      where: { playerId_seasonId: { playerId: player.playerId, seasonId: data.seasonId } },
      create: createData as unknown as Prisma.PlayerStatisticsUncheckedCreateInput,
      update: updateData as Prisma.PlayerStatisticsUncheckedUpdateInput,
    });
    summary.playerSeasonStatsUpserted++;
  }

  return summary;
}
