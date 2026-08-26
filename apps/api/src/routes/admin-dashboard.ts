import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { requireAdminSession } from "../middleware/admin-auth";

// "Hôm nay" tính theo UTC day boundary — đơn giản, không có tiền lệ timezone-aware "today" nào
// khác trong codebase để theo (matches list/admin pages hiện đều lọc theo range tuyệt đối, không
// theo "ngày" tương đối). Chấp nhận lệch vài giờ so với giờ VN thật cho mục đích 1 dashboard tổng
// quan, không phải báo cáo chính xác theo múi giờ.
function utcDayRange(daysAgo = 0): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Tổng hợp nhiều bảng cho trang /admin (Dashboard) — trước đó chỉ có lời chào trống, admin phải tự
// vào từng trang con mới biết tình hình. Toàn bộ query là count/aggregate rẻ (không load row), chạy
// song song qua Promise.all — không thêm bảng/model mới, chỉ đọc dữ liệu đã có sẵn từ các feature
// trước (SystemLog, NotificationLog, AiUsageLog, ScraperRun, SyncRun...).
export const adminDashboardRoute = new Hono().get(
  "/admin/dashboard-summary",
  requireAdminSession,
  async (c) => {
    const { start: todayStart, end: todayEnd } = utcDayRange();
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      competitions,
      seasons,
      teams,
      players,
      matchesTotal,
      matchesLive,
      matchesToday,
      matchesFinishedToday,
      users,
      favoriteTeams,
      favoritePlayers,
      usersWithDevice,
      aiUsageAggregate,
      systemLogsByLevel,
      notificationLogsByStatus,
      latestScraperRun,
      latestSyncRun,
    ] = await Promise.all([
      prisma.competition.count(),
      prisma.season.count(),
      prisma.team.count(),
      prisma.player.count(),
      prisma.match.count(),
      prisma.match.count({ where: { status: { in: ["LIVE", "HALFTIME"] } } }),
      prisma.match.count({ where: { kickoffAt: { gte: todayStart, lt: todayEnd } } }),
      prisma.match.count({
        where: { status: "FINISHED", kickoffAt: { gte: todayStart, lt: todayEnd } },
      }),
      prisma.user.count(),
      prisma.favoriteTeam.count(),
      prisma.favoritePlayer.count(),
      prisma.user.count({ where: { devices: { some: {} } } }),
      prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: last30Days } },
        _sum: { costUsd: true },
        _count: true,
      }),
      prisma.systemLog.groupBy({
        by: ["level"],
        where: { createdAt: { gte: last24h } },
        _count: true,
      }),
      prisma.notificationLog.groupBy({
        by: ["status"],
        where: { sentAt: { gte: last24h } },
        _count: true,
      }),
      prisma.scraperRun.findFirst({
        orderBy: { createdAt: "desc" },
        include: { competition: { select: { name: true } }, season: { select: { name: true } } },
      }),
      prisma.syncRun.findFirst({
        orderBy: { createdAt: "desc" },
        include: { competition: { select: { name: true } }, season: { select: { name: true } } },
      }),
    ]);

    const errorCount24h = systemLogsByLevel.find((g) => g.level === "ERROR")?._count ?? 0;
    const warnCount24h = systemLogsByLevel.find((g) => g.level === "WARN")?._count ?? 0;
    const notificationsSent24h = notificationLogsByStatus.find((g) => g.status === "SENT")?._count ?? 0;
    const notificationsFailed24h = notificationLogsByStatus.find((g) => g.status === "FAILED")?._count ?? 0;

    return c.json({
      catalog: { competitions, seasons, teams, players, matches: matchesTotal },
      matches: { live: matchesLive, today: matchesToday, finishedToday: matchesFinishedToday },
      users: { total: users, favoriteTeams, favoritePlayers, withDevice: usersWithDevice },
      aiUsage30d: {
        costUsd: aiUsageAggregate._sum.costUsd ?? 0,
        requestCount: aiUsageAggregate._count,
      },
      systemHealth24h: { errors: errorCount24h, warnings: warnCount24h },
      notifications24h: { sent: notificationsSent24h, failed: notificationsFailed24h },
      latestScraperRun: latestScraperRun
        ? {
            status: latestScraperRun.status,
            competitionName: latestScraperRun.competition.name,
            seasonName: latestScraperRun.season.name,
            finishedAt: latestScraperRun.finishedAt,
          }
        : null,
      latestSyncRun: latestSyncRun
        ? {
            status: latestSyncRun.status,
            competitionName: latestSyncRun.competition.name,
            seasonName: latestSyncRun.season.name,
            finishedAt: latestSyncRun.finishedAt,
          }
        : null,
    });
  },
);
