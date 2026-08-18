import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-auth";

// ROADMAP Phase 4 — tra lịch sử gửi thông báo qua UI thay vì query psql tay (đã làm nhiều lần khi
// debug push notification ở Phase 2 Bước 3). Read-only, không có create/edit/delete.
const notificationLogsQuerySchema = paginationQuerySchema.extend({
  userId: z.string().optional(),
  status: z.enum(["SENT", "FAILED"]).optional(),
  channel: z.enum(["FCM", "EMAIL"]).optional(),
});

export const notificationLogsRoute = new Hono().get(
  "/notification-logs",
  requireAdminSession,
  zValidator("query", notificationLogsQuerySchema),
  async (c) => {
    const { page, pageSize, userId, status, channel } = c.req.valid("query");
    const where = {
      ...(status ? { status } : {}),
      ...(channel ? { channel } : {}),
      ...(userId ? { notification: { userId } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.notificationLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { sentAt: "desc" },
        include: {
          notification: {
            select: {
              id: true,
              userId: true,
              type: true,
              title: true,
              body: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.notificationLog.count({ where }),
    ]);
    return c.json({ items, page, pageSize, total });
  },
);
