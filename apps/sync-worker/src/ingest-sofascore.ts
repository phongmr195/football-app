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

interface ScrapedMatchOutput {
  ourMatchId: string;
  sofascoreGameId: number;
  events: ScrapedEvent[];
  lineups: { home: ScrapedLineupSide; away: ScrapedLineupSide } | null;
  ratings: ScrapedRating[];
  statistics: { home: ScrapedStatSide; away: ScrapedStatSide } | null;
  unmatchedPlayers: string[];
}

export interface IngestSummary {
  processedFiles: number;
  eventsCreated: number;
  lineupsUpserted: number;
  ratingsUpserted: number;
  statisticsUpserted: number;
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
    unmatchedPlayers: [],
  };

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(outputDir, file), "utf-8")) as ScrapedMatchOutput;
    const matchId = data.ourMatchId;

    if (data.events.length > 0) {
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

    for (const rating of data.ratings) {
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

    if (data.unmatchedPlayers.length > 0) {
      summary.unmatchedPlayers.push(...data.unmatchedPlayers.map((name) => `${matchId}: ${name}`));
    }
    summary.processedFiles++;
  }

  return summary;
}
