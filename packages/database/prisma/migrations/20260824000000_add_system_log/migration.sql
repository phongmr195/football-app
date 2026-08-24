-- Lỗi/warning quan trọng từ apps/api và apps/sync-worker (service dài hạn) — trước đó chỉ có
-- console.error/warn, không có gì lưu lại được. Xem comment đầy đủ ở model SystemLog trong
-- schema.prisma.
CREATE TYPE "SystemLogService" AS ENUM ('API', 'SYNC_WORKER');

CREATE TYPE "SystemLogLevel" AS ENUM ('WARN', 'ERROR');

CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "service" "SystemLogService" NOT NULL,
    "level" "SystemLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_logs_service_level_createdAt_idx" ON "system_logs"("service", "level", "createdAt");
