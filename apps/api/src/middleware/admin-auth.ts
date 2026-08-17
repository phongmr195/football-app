import { prisma } from "@football-app/database";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";

// Hoàn toàn tách biệt khỏi middleware/auth.ts's requireAuth (Firebase) — admin dùng
// username/password + JWT tự ký, không liên quan Firebase. Xem apps/web's
// lib/admin-auth-context.tsx (client) và apps/api/src/routes/admin.ts (login/me) cho 2 đầu
// còn lại của flow này.
const ADMIN_JWT_EXPIRES_IN = "7d";

function getAdminJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET env var is not set — copy apps/api/.env.example to apps/api/.env");
  }
  return secret;
}

export function signAdminToken(adminUserId: string): string {
  return jwt.sign({ sub: adminUserId }, getAdminJwtSecret(), { expiresIn: ADMIN_JWT_EXPIRES_IN });
}

declare module "hono" {
  interface ContextVariableMap {
    adminUserId: string;
  }
}

// requireAdminSession — verify JWT thật (chữ ký + hạn), rồi xác nhận AdminUser vẫn còn tồn tại
// (phòng trường hợp bị xoá sau khi token đã phát hành — token tự ký không có cách thu hồi giữa
// chừng ngoài việc kiểm tra lại DB mỗi request).
export const requireAdminSession: MiddlewareHandler = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

  if (!token) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  try {
    const decoded = jwt.verify(token, getAdminJwtSecret());
    if (typeof decoded === "string" || !decoded.sub) {
      return c.json({ error: "invalid token" }, 401);
    }

    const adminUser = await prisma.adminUser.findUnique({ where: { id: decoded.sub } });
    if (!adminUser) {
      return c.json({ error: "invalid token" }, 401);
    }

    c.set("adminUserId", adminUser.id);
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  await next();
});
