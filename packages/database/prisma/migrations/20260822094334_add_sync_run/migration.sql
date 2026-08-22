-- Lịch sử chạy đồng bộ danh mục football-data.org từ trang admin (/admin/data-sync) — trước đó
-- chỉ chạy tay qua CLI (SYNC_MODE=catalog, xem apps/sync-worker/src/sync-all.ts). Tái dùng
-- "ScraperRunStatus" (đã tồn tại từ migration 20260818171856_add_scraper_run, cùng semantics
-- PENDING/RUNNING/SUCCESS/FAILED) — KHÔNG tạo enum riêng.
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "ScraperRunStatus" NOT NULL DEFAULT 'PENDING',
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdByAdminUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
