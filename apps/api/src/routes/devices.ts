import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const deviceBodySchema = z.object({
  fcmToken: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
});

export const devicesRoute = new Hono()
  .post("/devices", requireAuth, zValidator("json", deviceBodySchema), async (c) => {
    const userId = c.get("userId");
    const { fcmToken, platform } = c.req.valid("json");

    // fcmToken đã @unique (schema.prisma) — upsert keyed on it thay vì userId_platform: re-register
    // (app reinstall, đổi thiết bị...) cấp token MỚI cho user, và cùng 1 token vật lý không bao giờ
    // được attach cho 2 User row khác nhau (không tạo trùng, xem plan Phase 2 Bước 3 § A5).
    const device = await prisma.device.upsert({
      where: { fcmToken },
      create: { userId, fcmToken, platform },
      update: { userId, platform, lastActiveAt: new Date() },
    });

    return c.json(device, 200);
  })
  // Cho phép frontend biết "trình duyệt này đã bật thông báo chưa" khi load lại trang (client tự
  // getToken() lại — không prompt lại vì permission đã granted — rồi so với danh sách này theo
  // fcmToken), và lấy device.id để gọi DELETE bên dưới.
  .get("/devices", requireAuth, async (c) => {
    const userId = c.get("userId");
    const devices = await prisma.device.findMany({ where: { userId } });
    return c.json({ items: devices });
  })
  // Tắt thông báo — xoá hẳn Device row nên goal-notifier không còn tìm thấy device này nữa.
  // Idempotent (deleteMany, luôn 204) cùng convention với favorites.ts. Scope theo cả id VÀ
  // userId — không cho xoá device của user khác dù đoán được id.
  .delete(
    "/devices/:id",
    requireAuth,
    zValidator("param", z.object({ id: z.string() })),
    async (c) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param");
      await prisma.device.deleteMany({ where: { id, userId } });
      return c.body(null, 204);
    },
  );
