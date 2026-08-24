-- Đăng ký/đăng nhập username+password cho user thường (khác AdminUser hoàn toàn tách biệt) —
-- xem apps/api/src/routes/auth.ts + comment ở model User trong schema.prisma.
ALTER TABLE "users" ADD COLUMN "username" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
