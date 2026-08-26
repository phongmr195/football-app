import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { calculateTeamSeasonStatistics, rankCleanSheetTeams } from "@football-app/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

// seasonId optional — team/player detail pages (apps/web) không có season-selector riêng (đó là
// việc của /standings), nên khi không truyền seasonId thì trả về mùa giải GẦN NHẤT có
// TeamStatistics/PlayerStatistics cho team/player đó (order by season.startDate desc), thay vì
// bắt caller phải tự biết seasonId nào đang "current".
const statisticsQuerySchema = z.object({ seasonId: z.string().optional() });
// teamIds (mảng, >=1) — cho phép thống kê lại nhiều đội cùng lúc trong 1 season (2026-08-20, trang
// /admin/team-statistics đổi sang multi-select). recomputeSeasonTeamStatistics() vốn đã luôn tính
// lại NGUYÊN season (cần thiết cho clean sheet ranking đúng, không thể tính riêng lẻ từng đội) —
// nay chỉ khác ở việc REPORT kết quả cho nhiều teamId thay vì 1.
const adminRecomputeTeamStatisticsSchema = z.object({
  teamIds: z.array(z.string().min(1)).min(1),
  seasonId: z.string().min(1),
});

async function recomputeSeasonTeamStatistics(seasonId: string) {
  const matches = await prisma.match.findMany({
    where: { seasonId, status: "FINISHED" },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const { statsByTeamId, skippedMatches } = calculateTeamSeasonStatistics(matches);
  const activeTeamIds = [...statsByTeamId.keys()];

  // Xoá TeamStatistics của đội KHÔNG còn trận FINISHED-có-tỉ-số nào trong season này — nếu không,
  // row cũ đứng yên mãi với số liệu stale (bug thật đã gặp 2026-08-20: admin bấm "Thống kê lại"
  // cho 1 đội đã hết trận hợp lệ không có tác dụng gì). Cùng logic dọn stale row đã áp dụng cho
  // CleanSheet dưới đây. Upsert chạy song song (Promise.all, KHÔNG tuần tự) — mỗi upsert đụng row
  // khác nhau nên an toàn, và endpoint này chạy đồng bộ trong 1 request HTTP (khác bản gốc trong
  // sync-worker chạy nền), tuần tự N đội = N round-trip DB admin phải chờ.
  const [statisticsRows] = await Promise.all([
    Promise.all(
      activeTeamIds.map((teamId) =>
        prisma.teamStatistics.upsert({
          where: { teamId_seasonId: { teamId, seasonId } },
          create: { teamId, seasonId, ...statsByTeamId.get(teamId)! },
          update: { ...statsByTeamId.get(teamId)! },
        }),
      ),
    ),
    activeTeamIds.length === 0
      ? prisma.teamStatistics.deleteMany({ where: { seasonId } })
      : prisma.teamStatistics.deleteMany({ where: { seasonId, teamId: { notIn: activeTeamIds } } }),
  ]);

  const rankedCleanSheets = rankCleanSheetTeams(statsByTeamId);
  const cleanSheetTeamIds = rankedCleanSheets.map((entry) => entry.teamId);
  await Promise.all([
    Promise.all(
      rankedCleanSheets.map((entry) =>
        prisma.cleanSheet.upsert({
          where: { seasonId_teamId: { seasonId, teamId: entry.teamId } },
          create: { seasonId, teamId: entry.teamId, count: entry.count, rank: entry.rank },
          update: { count: entry.count, rank: entry.rank },
        }),
      ),
    ),
    cleanSheetTeamIds.length === 0
      ? prisma.cleanSheet.deleteMany({ where: { seasonId } })
      : prisma.cleanSheet.deleteMany({ where: { seasonId, teamId: { notIn: cleanSheetTeamIds } } }),
  ]);

  return { statsByTeamId, statisticsRows, rankedCleanSheets, processedMatches: matches.length, skippedMatches };
}

export const statisticsRoute = new Hono()
  .get(
    "/statistics/teams/:teamId",
    zValidator("param", z.object({ teamId: z.string() })),
    zValidator("query", statisticsQuerySchema),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { seasonId } = c.req.valid("query");
      const stats = seasonId
        ? await prisma.teamStatistics.findUnique({ where: { teamId_seasonId: { teamId, seasonId } } })
        : await prisma.teamStatistics.findFirst({
            where: { teamId },
            orderBy: { season: { startDate: "desc" } },
          });
      if (!stats) return c.json({ error: "not found" }, 404);
      return c.json(stats);
    },
  )
  .get(
    "/statistics/players/:playerId",
    zValidator("param", z.object({ playerId: z.string() })),
    zValidator("query", statisticsQuerySchema),
    async (c) => {
      const { playerId } = c.req.valid("param");
      const { seasonId } = c.req.valid("query");
      const stats = seasonId
        ? await prisma.playerStatistics.findUnique({ where: { playerId_seasonId: { playerId, seasonId } } })
        : await prisma.playerStatistics.findFirst({
            where: { playerId },
            orderBy: { season: { startDate: "desc" } },
          });
      if (!stats) return c.json({ error: "not found" }, 404);
      return c.json(stats);
    },
  )
  .post(
    "/admin/team-statistics/recompute",
    requireAdminSession,
    zValidator("json", adminRecomputeTeamStatisticsSchema),
    async (c) => {
      const { teamIds, seasonId } = c.req.valid("json");
      const uniqueTeamIds = [...new Set(teamIds)];

      const [teams, season] = await Promise.all([
        prisma.team.findMany({ where: { id: { in: uniqueTeamIds } }, select: { id: true, name: true } }),
        prisma.season.findUnique({
          where: { id: seasonId },
          select: {
            id: true,
            name: true,
            competition: { select: { id: true, name: true } },
          },
        }),
      ]);
      if (!season) return c.json({ error: "season not found" }, 404);
      const teamsById = new Map(teams.map((team) => [team.id, team]));
      const missingTeamIds = uniqueTeamIds.filter((teamId) => !teamsById.has(teamId));
      if (missingTeamIds.length > 0) {
        return c.json({ error: "team not found", teamIds: missingTeamIds }, 404);
      }

      const { statsByTeamId, statisticsRows, rankedCleanSheets, processedMatches, skippedMatches } =
        await recomputeSeasonTeamStatistics(seasonId);

      // Mỗi teamId được yêu cầu ra 1 entry riêng — đội không có trận hợp lệ trong season này vẫn
      // trả 200 với statistics: null (KHÔNG chặn/fail cả batch chỉ vì 1 trong nhiều đội được chọn
      // không có data, khác hành vi cũ 400 all-or-nothing khi chỉ chọn được 1 đội/lần).
      const results = uniqueTeamIds.map((teamId) => {
        const stats = statsByTeamId.get(teamId);
        const savedStatistics = stats ? statisticsRows.find((row) => row.teamId === teamId) ?? null : null;
        const cleanSheetRow = rankedCleanSheets.find((entry) => entry.teamId === teamId) ?? null;
        return {
          team: teamsById.get(teamId)!,
          hasMatches: !!stats,
          statistics: savedStatistics,
          cleanSheetRank: cleanSheetRow?.rank ?? null,
          cleanSheetCount: cleanSheetRow?.count ?? 0,
        };
      });

      return c.json({
        season,
        results,
        summary: {
          processedMatches,
          skippedMatches,
          seasonTeamsUpdated: statsByTeamId.size,
        },
      });
    },
  );
