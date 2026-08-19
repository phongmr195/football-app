-- CreateEnum
CREATE TYPE "ScraperRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "scraper_runs" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "requestedLimit" INTEGER NOT NULL,
    "status" "ScraperRunStatus" NOT NULL DEFAULT 'PENDING',
    "matchesFound" INTEGER,
    "matchesScraped" INTEGER,
    "ingestSummary" JSONB,
    "errorMessage" TEXT,
    "createdByAdminUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scraper_runs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "scraper_runs" ADD CONSTRAINT "scraper_runs_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_runs" ADD CONSTRAINT "scraper_runs_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scraper_runs" ADD CONSTRAINT "scraper_runs_createdByAdminUserId_fkey" FOREIGN KEY ("createdByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
