import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

// Read-only — tra chi phí/lượt dùng AI (chat + player_compare, 2 consumer thật hiện có, xem
// CLAUDE.md § AI) qua UI thay vì query psql tay. Cùng convention notification-logs.ts (đọc, filter
// + pagination, không có create/edit/delete).
const aiUsageLogsQuerySchema = paginationQuerySchema.extend({
  userId: z.string().optional(),
  feature: z.string().optional(),
});

export const aiUsageLogsRoute = new Hono()
  .get("/ai-usage-logs", requireAdminSession, zValidator("query", aiUsageLogsQuerySchema), async (c) => {
    const { page, pageSize, userId, feature } = c.req.valid("query");
    const where = {
      ...(userId ? { userId } : {}),
      ...(feature ? { feature } : {}),
    };
    const [items, total, aggregate] = await Promise.all([
      prisma.aiUsageLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true } } },
      }),
      prisma.aiUsageLog.count({ where }),
      // Tổng theo ĐÚNG filter đang áp dụng (không phải tổng toàn bảng) — admin lọc theo user/feature
      // thường để biết CHÍNH XÁC user/feature đó tốn bao nhiêu, không phải tổng toàn hệ thống.
      prisma.aiUsageLog.aggregate({
        where,
        _sum: { tokensInput: true, tokensOutput: true, costUsd: true },
      }),
    ]);
    return c.json({
      items,
      page,
      pageSize,
      total,
      summary: {
        tokensInput: aggregate._sum.tokensInput ?? 0,
        tokensOutput: aggregate._sum.tokensOutput ?? 0,
        costUsd: aggregate._sum.costUsd ?? 0,
      },
    });
  })
  // Danh sách feature khả dụng cho dropdown filter — tránh hardcode ["chat","player_compare"] ở
  // frontend, tự phản ánh đúng dữ liệu thật đang có trong DB (kể cả khi thêm consumer mới sau này).
  .get("/ai-usage-logs/features", requireAdminSession, async (c) => {
    const rows = await prisma.aiUsageLog.findMany({ distinct: ["feature"], select: { feature: true } });
    return c.json({ items: rows.map((r) => r.feature).sort() });
  })
  // Danh sách user CÓ ÍT NHẤT 1 dòng usage — cho dropdown filter theo email (User không có
  // "username", chỉ có email nullable, xem schema.prisma). Scope theo bảng này (không phải toàn bộ
  // User) vì chưa có trang admin quản lý User nói chung (ROADMAP Phase 4, "chưa làm, optional") —
  // không cần thiết phải làm trang đó chỉ để phục vụ 1 dropdown filter ở đây.
  .get("/ai-usage-logs/users", requireAdminSession, async (c) => {
    const rows = await prisma.aiUsageLog.findMany({
      distinct: ["userId"],
      select: { user: { select: { id: true, email: true } } },
      orderBy: { userId: "asc" },
    });
    return c.json({ items: rows.map((r) => r.user) });
  });
