import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

// Xem CLAUDE.md/model SystemLog trong schema.prisma — chỉ ERROR/WARN từ apps/api +
// apps/sync-worker (2 service dài hạn duy nhất hiện có), KHÔNG phải firehose mọi console.log.
// Read-only, không có create/edit/delete (dọn log cũ >30 ngày tự động chạy mỗi lần ghi log mới,
// xem cleanupOldSystemLogsIfNeeded() ở logger.ts — không cần action riêng ở route này), cùng
// convention notification-logs.ts/ai-usage-logs.ts.
const systemLogsQuerySchema = paginationQuerySchema.extend({
  service: z.enum(["API", "SYNC_WORKER"]).optional(),
  level: z.enum(["WARN", "ERROR"]).optional(),
});

export const systemLogsRoute = new Hono().get(
  "/admin/system-logs",
  requireAdminSession,
  zValidator("query", systemLogsQuerySchema),
  async (c) => {
    const { page, pageSize, service, level } = c.req.valid("query");
    const where = {
      ...(service ? { service } : {}),
      ...(level ? { level } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.systemLog.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  },
);
