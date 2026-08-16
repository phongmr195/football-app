import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";

const deviceBodySchema = z.object({
  fcmToken: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
});

export const devicesRoute = new Hono().post(
  "/devices",
  requireAuth,
  zValidator("json", deviceBodySchema),
  async (c) => {
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
  },
);
