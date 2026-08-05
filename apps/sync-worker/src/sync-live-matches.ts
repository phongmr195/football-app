import { ApiFootballAdapter } from "@football-app/data-provider";
import { prisma } from "@football-app/database";

export async function syncLiveMatches() {
  const adapter = new ApiFootballAdapter({ apiKey: process.env.API_FOOTBALL_KEY ?? "" });
  const matches = await adapter.fetchLiveMatches();

  for (const match of matches) {
    const dbMatch = await prisma.match.findFirst({
      where: { externalRef: { path: ["id"], equals: match.externalRef.id } },
    });

    if (!dbMatch) {
      // TODO: match chưa tồn tại trong DB nghĩa là competition/team/season liên quan
      // cũng chưa được sync — cần chạy job sync danh mục (competitions/teams/seasons) trước.
      continue;
    }

    await prisma.liveMatchState.upsert({
      where: { matchId: dbMatch.id },
      create: {
        matchId: dbMatch.id,
        status: match.status,
        minute: match.minute,
        homeScore: match.homeScore ?? 0,
        awayScore: match.awayScore ?? 0,
      },
      update: {
        status: match.status,
        minute: match.minute,
        homeScore: match.homeScore ?? 0,
        awayScore: match.awayScore ?? 0,
      },
    });
  }

  return { syncedCount: matches.length };
}
