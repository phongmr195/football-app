import { zValidator } from "@hono/zod-validator";
import { prisma } from "@football-app/database";
import { verifyPassword } from "@football-app/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession, signAdminToken } from "../middleware/admin-auth";

const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const adminRoute = new Hono()
  // Không dùng requireAuth/Firebase — username/password riêng, xem middleware/admin-auth.ts.
  .post("/admin/login", zValidator("json", loginBodySchema), async (c) => {
    const { username, password } = c.req.valid("json");

    const adminUser = await prisma.adminUser.findUnique({ where: { username } });
    // Lỗi chung chung "sai tên đăng nhập hoặc mật khẩu" cho cả 2 trường hợp (không tìm thấy
    // username / sai password) — không tiết lộ username nào tồn tại thật (tránh dò user hợp lệ).
    if (!adminUser || !(await verifyPassword(password, adminUser.passwordHash))) {
      return c.json({ error: "sai tên đăng nhập hoặc mật khẩu" }, 401);
    }

    const token = signAdminToken(adminUser.id);
    return c.json({ token, id: adminUser.id, username: adminUser.username });
  })
  .get("/admin/me", requireAdminSession, async (c) => {
    const adminUserId = c.get("adminUserId");
    const adminUser = await prisma.adminUser.findUniqueOrThrow({
      where: { id: adminUserId },
      select: { id: true, username: true },
    });
    return c.json(adminUser);
  });
