import { zValidator } from "@hono/zod-validator";
import { paginationQuerySchema } from "@football-app/shared";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

// User-facing (khác admin/notification-logs.ts — trang admin xem log GỬI theo mọi user, đây là
// user tự xem thông báo CỦA MÌNH). Nguồn data: Notification model, đã được goal-notifier.ts/
// match-finished-notifier.ts ghi mỗi khi push FCM thành công/thất bại — bell icon (apps/web's
// NotificationBell.tsx) đọc trực tiếp bảng này, không cần thêm data source riêng.
const idParamSchema = z.object({ id: z.string() });

export const notificationsRoute = new Hono()
  .get("/notifications", requireAuth, zValidator("query", paginationQuerySchema), async (c) => {
    const userId = c.get("userId");
    const { page, pageSize } = c.req.valid("query");

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);

    return c.json({ items, page, pageSize, total });
  })
  // Badge số chưa đọc trên bell icon — query riêng (KHÔNG dựa vào page 1 của GET /notifications)
  // vì cần đúng ngay cả khi user đang xem trang 2+.
  .get("/notifications/unread-count", requireAuth, async (c) => {
    const userId = c.get("userId");
    const count = await prisma.notification.count({ where: { userId, readAt: null } });
    return c.json({ count });
  })
  // updateMany (không findUniqueOrThrow + update) để tự động no-op an toàn nếu :id không thuộc
  // user này (403 giả — không tiết lộ notification đó có tồn tại hay không) thay vì throw.
  .patch(
    "/notifications/:id/read",
    requireAuth,
    zValidator("param", idParamSchema),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      await prisma.notification.updateMany({
        where: { id, userId, readAt: null },
        data: { readAt: new Date() },
      });
      return c.body(null, 204);
    },
  )
  .patch("/notifications/read-all", requireAuth, async (c) => {
    const userId = c.get("userId");
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return c.body(null, 204);
  });
