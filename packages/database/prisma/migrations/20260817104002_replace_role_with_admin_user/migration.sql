-- Viết tay (không qua `prisma migrate dev`) — CLI từ chối chạy interactive confirmation cho
-- destructive change (drop column có data) trong môi trường non-interactive. An toàn để drop tay
-- ở đây: cột "role" mới thêm ở migration ngay trước (20260817100630_add_user_role), chưa từng
-- dùng thật cho admin nào — thay bằng bảng admin_users riêng (xem CLAUDE.md § Authentication).

-- DropColumn
ALTER TABLE "users" DROP COLUMN "role";

-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");
