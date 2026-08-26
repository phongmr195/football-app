import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@football-app/database";
import type { MatchEventType, Prisma } from "@football-app/database";

interface ScrapedEvent {
  seq: number;
  minute: number;
  type: MatchEventType;
  teamId: string | null;
  playerId: string | null;
  relatedPlayerId: string | null;
  detail: unknown;
}

interface ScrapedLineupSide {
  teamId: string;
  formation: string | null;
  players: { playerId: string; position: string | null; shirtNumber: number | null; isStarting: boolean }[];
}

interface ScrapedRating {
  playerId: string;
  rating: number;
  stats: unknown;
}

interface ScrapedStatSide {
  teamId: string;
  possession?: number;
  raw: unknown;
}

interface ScrapedComment {
  minute: number;
  seq: number;
  text: string;
}

interface ScrapedShot {
  teamId: string;
  playerId: string | null;
  minute: number;
  shotType: string;
  situation: string | null;
  bodyPart: string | null;
  xg: number | null;
  xgot: number | null;
  x: number;
  y: number;
  raw: unknown;
}

interface ScrapedHighlight {
  title: string;
  url: string;
  thumbnailUrl: string | null;
}

interface ScrapedAveragePosition {
  teamId: string;
  playerId: string;
  averageX: number;
  averageY: number;
}

interface ScrapedMomentumPoint {
  minute: number;
  value: number;
}

interface ScrapedOdds {
  sofascoreMarketId: number;
  marketName: string;
  raw: unknown;
}

// TẤT CẢ field data (kể cả 3 loại cũ events/lineups/ratings/statistics) đều OPTIONAL — từ piece
// này, scraper.py's process_match() chỉ gọi endpoint/ghi key cho loại data ĐANG được admin chọn
// (`ScraperRun.dataTypes`), không còn cố định gọi cả 3 như trước. Vắng mặt = KHÔNG được chọn cho
// run này; có mặt nhưng `null`/mảng rỗng = ĐÃ chọn nhưng không lấy được data thật (xem
// scraper.py's process_match()) — 2 trạng thái khác nhau, ingest phải phân biệt đúng.
interface ScrapedMatchOutput {
  ourMatchId: string;
  sofascoreGameId: number;
  events?: ScrapedEvent[];
  lineups?: { home: ScrapedLineupSide; away: ScrapedLineupSide } | null;
  ratings?: ScrapedRating[];
  statistics?: { home: ScrapedStatSide; away: ScrapedStatSide } | null;
  commentary?: ScrapedComment[];
  shotmap?: ScrapedShot[];
  highlights?: ScrapedHighlight[];
  averagePositions?: ScrapedAveragePosition[];
  momentum?: ScrapedMomentumPoint[];
  odds?: ScrapedOdds[];
  unmatchedPlayers: string[];
}

export interface IngestSummary {
  processedFiles: number;
  eventsCreated: number;
  lineupsUpserted: number;
  ratingsUpserted: number;
  statisticsUpserted: number;
  commentaryCreated: number;
  shotsCreated: number;
  highlightsCreated: number;
  averagePositionsUpserted: number;
  momentumCreated: number;
  oddsUpserted: number;
  unmatchedPlayers: string[];
}

// Đọc output/{matchId}.json (sinh bởi apps/scraper-sofascore/scraper.py) và ghi vào Postgres qua
// Prisma — Python KHÔNG đụng DB trực tiếp (xem CLAUDE.md § Scraper), đây là điểm duy nhất ghi dữ
// liệu Sofascore vào các bảng MatchEvent/MatchLineup/Formation/PlayerRating/MatchStatistic.
export async function ingestSofascoreOutputs(outputDir: string): Promise<IngestSummary> {
  const files = readdirSync(outputDir).filter((f) => f.endsWith(".json"));
  const summary: IngestSummary = {
    processedFiles: 0,
    eventsCreated: 0,
    lineupsUpserted: 0,
    ratingsUpserted: 0,
    statisticsUpserted: 0,
    commentaryCreated: 0,
    shotsCreated: 0,
    highlightsCreated: 0,
    averagePositionsUpserted: 0,
    momentumCreated: 0,
    oddsUpserted: 0,
    unmatchedPlayers: [],
  };

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(outputDir, file), "utf-8")) as ScrapedMatchOutput;
    const matchId = data.ourMatchId;

    if (data.events && data.events.length > 0) {
      const created = await prisma.matchEvent.createMany({
        data: data.events.map((e) => ({
          matchId,
          seq: e.seq,
          minute: e.minute,
          type: e.type,
          teamId: e.teamId,
          playerId: e.playerId,
          relatedPlayerId: e.relatedPlayerId,
          detail: e.detail as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      summary.eventsCreated += created.count;
    }

    if (data.lineups) {
      for (const side of [data.lineups.home, data.lineups.away]) {
        if (side.formation) {
          await prisma.formation.upsert({
            where: { matchId_teamId: { matchId, teamId: side.teamId } },
            create: { matchId, teamId: side.teamId, formation: side.formation },
            update: { formation: side.formation },
          });
        }
        for (const player of side.players) {
          await prisma.matchLineup.upsert({
            where: { matchId_playerId: { matchId, playerId: player.playerId } },
            create: {
              matchId,
              teamId: side.teamId,
              playerId: player.playerId,
              position: player.position,
              shirtNumber: player.shirtNumber,
              isStarting: player.isStarting,
            },
            update: {
              position: player.position,
              shirtNumber: player.shirtNumber,
              isStarting: player.isStarting,
            },
          });
          summary.lineupsUpserted++;
        }
      }
    }

    for (const rating of data.ratings ?? []) {
      await prisma.playerRating.upsert({
        where: { matchId_playerId: { matchId, playerId: rating.playerId } },
        create: {
          matchId,
          playerId: rating.playerId,
          rating: rating.rating,
          stats: rating.stats as Prisma.InputJsonValue,
        },
        update: { rating: rating.rating, stats: rating.stats as Prisma.InputJsonValue },
      });
      summary.ratingsUpserted++;
    }

    if (data.statistics) {
      for (const side of [data.statistics.home, data.statistics.away]) {
        await prisma.matchStatistic.upsert({
          where: { matchId_teamId: { matchId, teamId: side.teamId } },
          create: {
            matchId,
            teamId: side.teamId,
            possession: side.possession ?? null,
            raw: side.raw as Prisma.InputJsonValue,
          },
          update: { possession: side.possession ?? null, raw: side.raw as Prisma.InputJsonValue },
        });
        summary.statisticsUpserted++;
      }
    }

    if (data.commentary && data.commentary.length > 0) {
      const created = await prisma.commentary.createMany({
        data: data.commentary.map((c) => ({ matchId, minute: c.minute, seq: c.seq, text: c.text })),
        skipDuplicates: true,
      });
      summary.commentaryCreated += created.count;
    }

    // MatchShot KHÔNG có unique constraint tự nhiên (nhiều cú sút cùng phút vẫn hợp lệ, xem
    // schema.prisma) — xoá hết shot cũ của match rồi ghi lại toàn bộ để re-ingest idempotent,
    // khác pattern skipDuplicates/upsert theo key ở các loại data khác.
    if (data.shotmap) {
      await prisma.matchShot.deleteMany({ where: { matchId } });
      if (data.shotmap.length > 0) {
        const created = await prisma.matchShot.createMany({
          data: data.shotmap.map((s) => ({
            matchId,
            teamId: s.teamId,
            playerId: s.playerId,
            minute: s.minute,
            shotType: s.shotType,
            situation: s.situation,
            bodyPart: s.bodyPart,
            xg: s.xg,
            xgot: s.xgot,
            x: s.x,
            y: s.y,
            raw: s.raw as Prisma.InputJsonValue,
          })),
        });
        summary.shotsCreated += created.count;
      }
    }

    if (data.highlights && data.highlights.length > 0) {
      const created = await prisma.matchHighlight.createMany({
        data: data.highlights.map((h) => ({
          matchId,
          title: h.title,
          url: h.url,
          thumbnailUrl: h.thumbnailUrl,
        })),
        skipDuplicates: true,
      });
      summary.highlightsCreated += created.count;
    }

    for (const position of data.averagePositions ?? []) {
      await prisma.matchAveragePosition.upsert({
        where: { matchId_playerId: { matchId, playerId: position.playerId } },
        create: {
          matchId,
          teamId: position.teamId,
          playerId: position.playerId,
          averageX: position.averageX,
          averageY: position.averageY,
        },
        update: { averageX: position.averageX, averageY: position.averageY },
      });
      summary.averagePositionsUpserted++;
    }

    if (data.momentum && data.momentum.length > 0) {
      const created = await prisma.matchMomentum.createMany({
        data: data.momentum.map((p) => ({ matchId, minute: p.minute, value: p.value })),
        skipDuplicates: true,
      });
      summary.momentumCreated += created.count;
    }

    // Khác momentum/commentary (dữ liệu tĩnh sau khi trận đấu kết thúc) — odds hợp lệ để UPDATE lại
    // khi re-scrape (tỉ lệ có thể snapshot khác thời điểm), nên dùng upsert thay vì skipDuplicates.
    for (const odds of data.odds ?? []) {
      await prisma.matchOdds.upsert({
        where: { matchId_sofascoreMarketId: { matchId, sofascoreMarketId: odds.sofascoreMarketId } },
        create: {
          matchId,
          sofascoreMarketId: odds.sofascoreMarketId,
          marketName: odds.marketName,
          raw: odds.raw as Prisma.InputJsonValue,
        },
        update: { marketName: odds.marketName, raw: odds.raw as Prisma.InputJsonValue },
      });
      summary.oddsUpserted++;
    }

    if (data.unmatchedPlayers.length > 0) {
      summary.unmatchedPlayers.push(...data.unmatchedPlayers.map((name) => `${matchId}: ${name}`));
    }
    summary.processedFiles++;
  }

  return summary;
}
