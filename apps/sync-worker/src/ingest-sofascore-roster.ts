import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@football-app/database";

const PROVIDER = "sofascore";

interface ScrapedRosterPlayer {
  sofascorePlayerId: number;
  name: string;
  position: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  heightCm: number | null;
}

interface ScrapedTeamRoster {
  ourTeamId: string;
  teamName: string;
  sofascoreTeamId: number;
  players: ScrapedRosterPlayer[];
}

export interface IngestRosterSummary {
  processedTeams: number;
  playersCreated: number;
  playersUpdated: number;
}

async function findPlayerByExternalId(externalId: string) {
  return prisma.player.findFirst({
    where: {
      AND: [
        { externalRef: { path: ["provider"], equals: PROVIDER } },
        { externalRef: { path: ["id"], equals: String(externalId) } },
      ],
    },
  });
}

// Đọc roster-output/{ourTeamId}.json (sinh bởi apps/scraper-sofascore/backfill-roster.py) và ghi
// Player qua Prisma — CHỈ gap-fill khi football-data.org không lấy được squad (403, xem CLAUDE.md
// § Scraper), externalRef.provider="sofascore" (KHÁC "football-data") để không đụng/trùng lặp
// player đã sync từ nguồn chính. Upsert theo externalRef — an toàn khi chạy lại (không tạo trùng).
export async function ingestSofascoreRosters(outputDir: string): Promise<IngestRosterSummary> {
  const files = readdirSync(outputDir).filter((f) => f.endsWith(".json"));
  const summary: IngestRosterSummary = { processedTeams: 0, playersCreated: 0, playersUpdated: 0 };

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(outputDir, file), "utf-8")) as ScrapedTeamRoster;

    for (const player of data.players) {
      const externalId = String(player.sofascorePlayerId);
      const existing = await findPlayerByExternalId(externalId);
      const fields = {
        name: player.name,
        dateOfBirth: player.dateOfBirth ? new Date(player.dateOfBirth) : null,
        nationality: player.nationality,
        position: player.position,
        heightCm: player.heightCm,
        teamId: data.ourTeamId,
        externalRef: { provider: PROVIDER, id: externalId },
      };
      if (existing) {
        await prisma.player.update({ where: { id: existing.id }, data: fields });
        summary.playersUpdated++;
      } else {
        await prisma.player.create({ data: fields });
        summary.playersCreated++;
      }
    }
    summary.processedTeams++;
  }

  return summary;
}
