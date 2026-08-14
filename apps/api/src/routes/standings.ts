import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";

const teamSelect = { id: true, name: true, logoUrl: true } as const;

type RecentFormEntry = {
  matchId: string;
  result: "WIN" | "DRAW" | "LOSS";
  homeScore: number;
  awayScore: number;
  isHome: boolean;
  opponent: { id: string; name: string; logoUrl: string | null };
  kickoffAt: string;
};

// Lấy 5 trận FINISHED gần nhất của 1 team trong đúng season đó (không tính chéo giải/mùa
// khác), xếp cũ -> mới. N+1 theo team chấp nhận được vì ~20-24 team/season, endpoint này
// không phải hot path (browse page, ISR-cached) — xem chỉ dẫn trong task.
async function getRecentForm(seasonId: string, teamId: string): Promise<RecentFormEntry[]> {
  const matches = await prisma.match.findMany({
    where: {
      seasonId,
      status: "FINISHED",
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    orderBy: { kickoffAt: "desc" },
    take: 5,
    include: {
      homeTeam: { select: teamSelect },
      awayTeam: { select: teamSelect },
    },
  });

  return matches
    .reverse()
    .filter((match) => match.homeScore !== null && match.awayScore !== null)
    .map((match) => {
      const isHome = match.homeTeamId === teamId;
      const homeScore = match.homeScore as number;
      const awayScore = match.awayScore as number;
      const teamScore = isHome ? homeScore : awayScore;
      const opponentScore = isHome ? awayScore : homeScore;
      const result: RecentFormEntry["result"] =
        teamScore > opponentScore ? "WIN" : teamScore < opponentScore ? "LOSS" : "DRAW";
      return {
        matchId: match.id,
        result,
        homeScore,
        awayScore,
        isHome,
        opponent: isHome ? match.awayTeam : match.homeTeam,
        kickoffAt: match.kickoffAt.toISOString(),
      };
    });
}

// Không phân trang — bảng xếp hạng 1 season vốn nhỏ (thường ~18-24 dòng), trả nguyên bảng.
export const standingsRoute = new Hono().get(
  "/standings",
  zValidator("query", z.object({ seasonId: z.string() })),
  async (c) => {
    const { seasonId } = c.req.valid("query");
    const standings = await prisma.standing.findMany({
      where: { seasonId },
      orderBy: { position: "asc" },
      include: { team: { select: teamSelect } },
    });

    const items = await Promise.all(
      standings.map(async (standing) => ({
        ...standing,
        recentForm: await getRecentForm(seasonId, standing.teamId),
      })),
    );

    return c.json({ items });
  },
);
